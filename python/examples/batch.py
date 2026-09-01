"""Sweep every FIT file in a directory through one config and collect a CSV.

    python examples/batch.py rides/ results.csv
"""

import sys
from pathlib import Path

from ve_batch import build_config, run_many, to_csv


def main() -> int:
    rides_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("rides")
    out_csv = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("results.csv")

    config = build_config(
        mode="standard",
        laps=[1],
        cda=0.28,
        crr=0.005,
        mass=85,
        eta=0.97,
        wind_source="constant",
        wind_speed=0,
        notes="batch sweep",
    )

    files = sorted(rides_dir.glob("*.fit"))
    if not files:
        print(f"no .fit files under {rides_dir}", file=sys.stderr)
        return 1

    results = run_many(files, config)
    to_csv(results, out_csv)

    ok = sum(1 for result in results if result.ok)
    print(f"{ok}/{len(results)} rides analysed -> {out_csv}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
