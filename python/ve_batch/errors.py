"""Error taxonomy for the batch layer.

Three kinds, matching who is at fault:

- ``VeConfigError``  — the CONFIG is wrong. Raised locally by ``build_config``
  for mistakes cheap to catch before spawning anything, and for the runner's
  exit-2 envelope.
- ``VeAnalysisError`` — the config was well-formed but the RUN could not
  produce numbers (activity failed to load, no segment survived).
- ``VeRunError``     — the RUNNER itself misbehaved: unparseable stdout,
  missing toolchain, timeout. Carries stderr, because unparseable stdout is
  almost always a stray log line and stderr is what diagnoses it in one shot.
"""

from __future__ import annotations


class VeBatchError(Exception):
    """Base class for everything this package raises."""


class VeConfigError(VeBatchError):
    def __init__(self, message: str, details: list | None = None) -> None:
        super().__init__(message)
        self.details = details or []


class VeAnalysisError(VeBatchError):
    def __init__(self, message: str, code: str | None = None) -> None:
        super().__init__(message)
        self.code = code


class VeRunError(VeBatchError):
    def __init__(self, message: str, stderr: str = "") -> None:
        if stderr:
            trimmed = stderr[-2000:]
            message = f"{message}\n--- runner stderr (tail) ---\n{trimmed}"
        super().__init__(message)
        self.stderr = stderr
