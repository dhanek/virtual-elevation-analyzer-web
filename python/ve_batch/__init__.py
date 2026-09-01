"""Batch driver for the Virtual Elevation Analyzer's headless runner.

The physics is single-sourced in the app's Rust/WASM; this package only
builds configs, spawns ``frontend/scripts/ve-run.ts`` and collects results.

    from ve_batch import build_config, run_one, run_many, to_csv

    cfg = build_config(mode="standard", laps=[2, 5], cda=0.28, crr=0.005,
                       mass=85, wind_source="fit", trim=(120, 640))
    result = run_one("ride.fit", cfg)
    results = run_many(sorted(Path("rides").glob("*.fit")), cfg)
    to_csv(results, "results.csv")
"""

from .config import SCHEMA_VERSION, build_config, write_config
from .errors import VeAnalysisError, VeBatchError, VeConfigError, VeRunError
from .results import RunOutcome, to_csv, to_dataframe, to_rows
from .runner import VeRunner, find_frontend, run_many, run_one

__all__ = [
    "SCHEMA_VERSION",
    "build_config",
    "write_config",
    "VeAnalysisError",
    "VeBatchError",
    "VeConfigError",
    "VeRunError",
    "RunOutcome",
    "to_csv",
    "to_dataframe",
    "to_rows",
    "VeRunner",
    "find_frontend",
    "run_many",
    "run_one",
]
