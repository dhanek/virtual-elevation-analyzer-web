"""End-to-end: the real runner over the repo's golden fixture.

Skipped coherently when the toolchain is absent (no node, no built wasm, no
fixture) so the pure tests still run anywhere; CI builds the wasm first and
runs the whole file.
"""

import json
import shutil
import unittest

from ve_batch import VeConfigError, build_config, run_one, to_rows
from ve_batch.runner import find_frontend


def _toolchain_ready() -> bool:
    if shutil.which("node") is None:
        return False
    try:
        frontend = find_frontend()
    except Exception:
        return False
    return (
        (frontend / "pkg" / "virtual_elevation_analyzer_bg.wasm").is_file()
        and (frontend / "node_modules" / "vite-node" / "vite-node.mjs").is_file()
        and (frontend / "src/analysis/__fixtures__/golden-ride.json").is_file()
    )


@unittest.skipUnless(_toolchain_ready(), "node + wasm + golden fixture required")
class RunnerIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        frontend = find_frontend()
        golden = json.loads(
            (frontend / "src/analysis/__fixtures__/golden-ride.json").read_text()
        )
        cls.golden = golden
        cls.config = build_config(
            mode="gpsLap",
            index_ranges=[(r["startIdx"], r["endIdx"]) for r in golden["indexRanges"]],
            cda=0.28,
            crr=0.005,
            wind_source="fit",
            air_speed_calibration_percent=5,
            rho_array=golden["rhoArray"],
            parameters=golden["params"],
            file_name="golden-ride",
        )
        cls.config["activity"] = {
            "inline": {
                "channels": {
                    "record_count": golden["record_count"],
                    "timestamps": golden["timestamps"],
                    "power": golden["power"],
                    "velocity": golden["velocity"],
                    "position_lat": golden["position_lat"],
                    "position_long": golden["position_long"],
                    "altitude": golden["altitude"],
                    "distance": golden["distance"],
                    "air_speed": golden["air_speed"],
                    "wind_yaw": golden["wind_yaw"],
                    "temperature": golden["temperature"],
                }
            }
        }

    def test_run_one_produces_the_apps_csv_table(self):
        outcome = run_one(None, self.config)
        self.assertTrue(outcome.ok)
        self.assertEqual(len(outcome.payload["segments"]), len(self.golden["indexRanges"]))
        rows = to_rows([outcome])
        self.assertEqual(rows[0]["CdA"], "0.280")
        self.assertEqual(rows[0]["Crr"], "0.0050")
        self.assertEqual(rows[0]["WindSource"], "fit")
        # The CSV cell must be the APP'S aggregate, formatted the app's way —
        # for GPS-lap on the golden ride that is 0.0000 (every lap's r2 against
        # the mean-elevation profile is negative and the app clamps to 0),
        # which is exactly the number a naive per-segment mean would NOT give.
        aggregate = outcome.payload["aggregate"]
        self.assertEqual(rows[0]["R2"], f"{aggregate['r2']:.4f}")
        self.assertEqual(rows[0]["RMSE"], f"{aggregate['rmse']:.2f}")
        self.assertTrue(float(rows[0]["RMSE"]) > 0)

    def test_an_invalid_config_raises_with_the_runners_details(self):
        bad = dict(self.config)
        bad["schemaVersion"] = 99
        with self.assertRaises(VeConfigError):
            run_one(None, bad)


if __name__ == "__main__":
    unittest.main()
