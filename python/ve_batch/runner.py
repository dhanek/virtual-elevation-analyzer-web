"""Spawn the Node/WASM runner and collect results.

The physics stays single-sourced in Rust: this module only locates the
frontend, spawns ``vite-node scripts/ve-run.ts`` and parses the JSON that
comes back.

Invocation details that matter:

- ``vite-node``'s own entry is invoked directly rather than ``npm run ve`` so
  npm's banner can never reach the stdout pipe.
- Configs travel on STDIN, results on STDOUT — no temp files, no shell
  quoting.
- ``run_many`` defaults to ONE process in ``--batch`` mode: vite-node boot +
  WASM init is ~2-4 s of fixed cost, which over 200 files is the difference
  between minutes of pure boot and seconds of work. ``parallel=N`` falls back
  to a per-file process pool for callers who want isolation.
"""

from __future__ import annotations

import json
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence

from .config import iter_ndjson
from .errors import VeAnalysisError, VeConfigError, VeRunError
from .results import RunOutcome

_EXIT_CODE_ERRORS = {
    2: VeConfigError,
    3: VeAnalysisError,
    4: VeAnalysisError,
}


def find_frontend(explicit: str | Path | None = None) -> Path:
    """Locate the frontend package: explicit arg → $VE_FRONTEND → repo layout."""
    candidates = []
    if explicit:
        candidates.append(Path(explicit))
    if os.environ.get("VE_FRONTEND"):
        candidates.append(Path(os.environ["VE_FRONTEND"]))
    candidates.append(Path(__file__).resolve().parents[2] / "frontend")

    for candidate in candidates:
        if (candidate / "scripts" / "ve-run.ts").is_file():
            return candidate
    raise VeRunError(
        "cannot locate the frontend package — pass frontend=..., or set VE_FRONTEND"
    )


class VeRunner:
    """One configured runner over one frontend checkout."""

    def __init__(
        self,
        frontend: str | Path | None = None,
        node: str = "node",
        timeout_seconds: float = 300.0,
    ) -> None:
        self.frontend = find_frontend(frontend)
        self.node = node
        self.timeout_seconds = timeout_seconds

        wasm = self.frontend / "pkg" / "virtual_elevation_analyzer_bg.wasm"
        if not wasm.is_file():
            # Fail ONCE, here, rather than letting every subprocess in a
            # 400-file sweep discover it independently.
            raise VeRunError(
                "wasm is not built — run `wasm-pack build --target web "
                "--out-dir ../frontend/pkg` in backend/"
            )
        vite_node = self.frontend / "node_modules" / "vite-node" / "vite-node.mjs"
        if not vite_node.is_file():
            raise VeRunError("vite-node is not installed — run `npm install` in frontend/")
        self._vite_node = vite_node

    # ------------------------------------------------------------------ spawn
    def _spawn(self, args: Sequence[str], stdin: str) -> subprocess.CompletedProcess:
        command = [
            self.node,
            str(self._vite_node),
            "scripts/ve-run.ts",
            "--",
            *args,
        ]
        try:
            return subprocess.run(
                command,
                cwd=self.frontend,
                input=stdin,
                capture_output=True,
                text=True,
                timeout=self.timeout_seconds,
            )
        except subprocess.TimeoutExpired as error:
            raise VeRunError(
                f"runner timed out after {self.timeout_seconds}s",
                stderr=(error.stderr or b"").decode() if isinstance(error.stderr, bytes) else (error.stderr or ""),
            ) from error

    @staticmethod
    def _parse_line(line: str, stderr: str) -> dict:
        try:
            return json.loads(line)
        except json.JSONDecodeError as error:
            # Unparseable stdout is almost always a stray log line; stderr is
            # what diagnoses it in one shot.
            raise VeRunError(f"runner stdout is not JSON: {error}", stderr=stderr) from error

    # ---------------------------------------------------------------- one-shot
    def run_one(
        self,
        file: str | Path | None,
        config: Mapping[str, Any],
        on_error: str = "raise",
    ) -> RunOutcome:
        args = ["--config", "-"]
        if file is not None:
            args = ["--file", str(Path(file).resolve()), *args]

        completed = self._spawn(args, json.dumps(config))
        payload = self._parse_line(completed.stdout.strip().splitlines()[-1] if completed.stdout.strip() else "", completed.stderr)
        outcome = RunOutcome(file=str(file) if file else None, payload=payload)

        if not outcome.ok:
            if on_error == "collect":
                return outcome
            error = outcome.error or {}
            kind = _EXIT_CODE_ERRORS.get(completed.returncode, VeRunError)
            if kind is VeConfigError:
                raise VeConfigError(error.get("message", "invalid config"), error.get("details"))
            if kind is VeAnalysisError:
                raise VeAnalysisError(error.get("message", "run failed"), error.get("code"))
            raise VeRunError(error.get("message", "runner failed"), stderr=completed.stderr)
        return outcome

    # ------------------------------------------------------------------- batch
    def run_many(
        self,
        files: Iterable[str | Path],
        config: Mapping[str, Any] | Callable[[Path], Mapping[str, Any]],
        parallel: int = 0,
    ) -> list[RunOutcome]:
        """One config (or a per-file factory) over N files; failures collect.

        A failed file yields a ``RunOutcome`` with ``ok=False`` rather than
        aborting the sweep — 1 bad ride must not lose the other 399.
        """
        paths = [Path(file) for file in files]
        config_for = config if callable(config) else (lambda _path: config)

        if parallel and parallel > 1:
            def one(path: Path) -> RunOutcome:
                try:
                    return self.run_one(path, config_for(path), on_error="collect")
                except VeRunError as error:
                    return RunOutcome.from_exception(path, error)

            with ThreadPoolExecutor(max_workers=parallel) as pool:
                return list(pool.map(one, paths))

        # A config that fails to build locally still occupies its slot, so the
        # results stay positionally correlated with the inputs.
        entries: list[dict] = []
        for path in paths:
            try:
                entries.append({"file": str(path.resolve()), "config": config_for(path)})
            except VeConfigError as error:
                entries.append({"__local_error__": str(error)})

        completed = self._spawn(
            ["--batch"],
            iter_ndjson(entry for entry in entries if "__local_error__" not in entry),
        )
        emitted = [
            self._parse_line(line, completed.stderr)
            for line in completed.stdout.strip().splitlines()
            if line.strip()
        ]

        results: list[RunOutcome] = []
        emitted_iter = iter(emitted)
        for path, entry in zip(paths, entries):
            if "__local_error__" in entry:
                results.append(
                    RunOutcome(
                        file=str(path),
                        payload={
                            "ok": False,
                            "error": {"code": "invalid-config", "message": entry["__local_error__"]},
                            "warnings": [],
                        },
                    )
                )
                continue
            try:
                results.append(RunOutcome(file=str(path), payload=next(emitted_iter)))
            except StopIteration:
                raise VeRunError(
                    f"runner emitted {len(emitted)} results for {sum(1 for e in entries if '__local_error__' not in e)} inputs",
                    stderr=completed.stderr,
                ) from None
        return results


def run_one(
    file: str | Path | None,
    config: Mapping[str, Any],
    frontend: str | Path | None = None,
    **kwargs: Any,
) -> RunOutcome:
    return VeRunner(frontend=frontend).run_one(file, config, **kwargs)


def run_many(
    files: Iterable[str | Path],
    config: Mapping[str, Any] | Callable[[Path], Mapping[str, Any]],
    frontend: str | Path | None = None,
    **kwargs: Any,
) -> list[RunOutcome]:
    return VeRunner(frontend=frontend).run_many(files, config, **kwargs)
