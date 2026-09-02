"""Pure config-building tests — no node, no wasm."""

import unittest

from ve_batch import SCHEMA_VERSION, VeConfigError, build_config


class BuildConfigTests(unittest.TestCase):
    def test_standard_laps_golden_shape(self):
        config = build_config(
            mode="standard",
            laps=[2, 5],
            cda=0.28,
            crr=0.005,
            mass=85,
            wind_source="fit",
            air_speed_calibration_percent=5,
            trim=(120, 640),
            notes="baseline",
        )
        self.assertEqual(
            config,
            {
                "schemaVersion": SCHEMA_VERSION,
                "mode": "standard",
                "selection": {"laps": [2, 5]},
                "inputs": {
                    "cda": 0.28,
                    "crr": 0.005,
                    "windSource": "fit",
                    "airSpeedCalibrationPercent": 5,
                },
                "parameters": {"system_mass": 85},
                "trim": {"space": "selection", "start": 120, "end": 640},
                "output": {"csvRow": True, "notes": "baseline"},
            },
        )

    def test_gps_lap_index_ranges_and_lap_numbers(self):
        config = build_config(
            mode="gpsLap",
            index_ranges=[(0, 100), (101, 200)],
            lap_numbers=[8, 9],
            cda=0.3,
            crr=0.004,
        )
        self.assertEqual(
            config["selection"],
            {
                "indexRanges": [
                    {"startIdx": 0, "endIdx": 100},
                    {"startIdx": 101, "endIdx": 200},
                ],
                "lapNumbers": [8, 9],
            },
        )

    def test_out_and_back_sections(self):
        section = {
            "sectionNumber": 1,
            "outboundStartIdx": 10,
            "outboundEndIdx": 100,
            "inboundStartIdx": 110,
            "inboundEndIdx": 200,
        }
        config = build_config(mode="outAndBack", sections=[section], cda=0.3, crr=0.004)
        self.assertEqual(config["selection"], {"sections": [section]})

    def test_mode_selection_mismatch_fails_locally(self):
        with self.assertRaises(VeConfigError):
            build_config(mode="gpsLap", laps=[1], cda=0.3, crr=0.004)
        with self.assertRaises(VeConfigError):
            build_config(mode="standard", cda=0.3, crr=0.004)

    def test_obviously_bad_numbers_fail_locally(self):
        with self.assertRaises(VeConfigError):
            build_config(mode="standard", laps=[1], cda=-1, crr=0.004)
        with self.assertRaises(VeConfigError):
            build_config(mode="standard", laps=[1], cda=0.3, crr=0.004, wind_source="gusty")

    def test_unknown_kwarg_is_rejected_not_swallowed(self):
        with self.assertRaises(VeConfigError):
            build_config(mode="standard", laps=[1], cda=0.3, crr=0.004, mas=85)

    def test_lap_numbers_must_align(self):
        with self.assertRaises(VeConfigError):
            build_config(
                mode="gpsLap",
                index_ranges=[(0, 100)],
                lap_numbers=[1, 2],
                cda=0.3,
                crr=0.004,
            )

    def test_rho_array_shapes(self):
        auto = build_config(mode="standard", laps=[1], cda=0.3, crr=0.004)
        self.assertNotIn("rhoArray", auto["inputs"])
        constant = build_config(mode="standard", laps=[1], cda=0.3, crr=0.004, rho_array=False)
        self.assertIs(constant["inputs"]["rhoArray"], False)
        explicit = build_config(
            mode="standard", laps=[1], cda=0.3, crr=0.004, rho_array=[1.1, 1.2]
        )
        self.assertEqual(explicit["inputs"]["rhoArray"], [1.1, 1.2])


if __name__ == "__main__":
    unittest.main()
