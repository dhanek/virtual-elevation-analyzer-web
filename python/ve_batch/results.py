"""Collect runner results into rows, CSV, or a DataFrame.

THE HEADERS COME FROM THE RESPONSE, NEVER FROM PYTHON. The runner renders its
``csvRow`` through the app's own ``RESULT_COLUMNS`` table, so reading headers
off the payload — rather than restating them here — is what keeps "the batch
CSV and the app's Export CSV are the same table" true by construction.
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any, Iterable, Mapping

from .errors import VeRunError


class RunOutcome:
    """One runner result: the parsed JSON payload plus the file it described."""

    def __init__(self, file: str | None, payload: Mapping[str, Any]) -> None:
        self.file = file
        self.payload = dict(payload)

    @classmethod
    def from_exception(cls, file: str | Path, error: Exception) -> "RunOutcome":
        return cls(
            file=str(file),
            payload={
                "ok": False,
                "error": {"code": "internal", "message": str(error)},
                "warnings": [],
            },
        )

    @property
    def ok(self) -> bool:
        return bool(self.payload.get("ok"))

    @property
    def error(self) -> Mapping[str, Any] | None:
        return self.payload.get("error")

    @property
    def aggregate(self) -> Mapping[str, Any] | None:
        return self.payload.get("aggregate")

    @property
    def csv_row(self) -> Mapping[str, Any] | None:
        return self.payload.get("csvRow")

    def __repr__(self) -> str:  # pragma: no cover - debugging nicety
        state = "ok" if self.ok else (self.error or {}).get("code", "error")
        return f"RunOutcome(file={self.file!r}, {state})"


def to_rows(results: Iterable[RunOutcome]) -> list[dict[str, str]]:
    """One dict per result, keyed by the runner's own CSV headers.

    A failed run still yields a row — ``FileName`` filled from the input and an
    ``Error`` key appended — so the collected table accounts for every input.
    """
    rows: list[dict[str, str]] = []
    headers: list[str] | None = None

    for result in results:
        if result.ok and result.csv_row:
            row_headers = list(result.csv_row["headers"])
            if headers is None:
                headers = row_headers
            elif headers != row_headers:
                # Two different header sets in one batch means two runner
                # versions produced it; a silently mixed table is worse than
                # a loud failure.
                raise VeRunError("mixed csvRow headers in one batch — two runner versions?")
            row = dict(zip(row_headers, (str(v) for v in result.csv_row["values"])))
            row["Error"] = ""
            rows.append(row)
        else:
            message = (result.error or {}).get("message", "unknown failure")
            rows.append({"FileName": result.file or "", "Error": message})

    if headers is not None:
        # Give failed rows every column so csv.DictWriter stays happy.
        blank = {header: "" for header in headers}
        rows = [{**blank, **row} for row in rows]
    return rows


def to_csv(results: Iterable[RunOutcome], path: str | Path) -> Path:
    rows = to_rows(list(results))
    target = Path(path)
    if not rows:
        target.write_text("", encoding="utf-8")
        return target
    fieldnames = list(rows[0].keys())
    with target.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    return target


def to_dataframe(results: Iterable[RunOutcome]):
    """Rows as a pandas DataFrame; pandas is imported lazily (optional extra)."""
    try:
        import pandas
    except ImportError as error:  # pragma: no cover
        raise VeRunError("pandas is not installed — pip install 've-batch[pandas]'") from error
    return pandas.DataFrame(to_rows(list(results)))
