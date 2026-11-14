import { describe, expect, it } from "vitest";
import type { LapSettings, StoredParameters } from "../utils/ParameterStorage";
import {
	normalizeRideCalibration,
	resolveSelectionCalibration,
} from "./RideCalibration";

const lap = (extra: Partial<LapSettings>): LapSettings => ({
	trimStart: 0,
	trimEnd: 100,
	cda: 0.3,
	crr: 0.004,
	...extra,
});

function record(
	lapSettings: Record<string, LapSettings>,
	extra: Partial<StoredParameters> = {},
): StoredParameters {
	return {
		fileHash: "h",
		parameters: {} as StoredParameters["parameters"],
		lapSettings,
		lastUsed: 0,
		...extra,
	};
}

describe("normalizeRideCalibration (D2: per-file migration)", () => {
	it("promotes the value most selections share and keeps the others as overrides", () => {
		const out = normalizeRideCalibration(
			record({
				"1-2-3": lap({ airSpeedCalibration: 0 }),
				"6": lap({ airSpeedCalibration: 7.7 }),
				"7-8-9": lap({ airSpeedCalibration: 7.7 }),
				"4-5-6": lap({ airSpeedCalibration: 5 }),
			}),
		);
		expect(out.rideAirSpeedCalibration).toBe(7.7);
		expect(out.airSpeedCalibrationOverrides?.["4-5-6"]).toBe(5);
		// Zeros and values equal to the ride follow the ride: no override.
		expect(Object.keys(out.airSpeedCalibrationOverrides ?? {})).toEqual([
			"4-5-6",
		]);
		// The ambiguous legacy field is gone from every entry.
		for (const entry of Object.values(out.lapSettings)) {
			expect("airSpeedCalibration" in entry).toBe(false);
		}
	});

	it("leaves the rest of each entry untouched", () => {
		const out = normalizeRideCalibration(
			record({ "6": lap({ airSpeedCalibration: 7.7, cda: 0.28 }) }),
		);
		expect(out.lapSettings["6"]).toEqual(lap({ cda: 0.28 }));
	});

	it("sets no ride value when every stored value is 0", () => {
		const out = normalizeRideCalibration(
			record({
				"1": lap({ airSpeedCalibration: 0 }),
				"2": lap({ airSpeedCalibration: 0 }),
			}),
		);
		expect(out.rideAirSpeedCalibration).toBeUndefined();
		expect(out.airSpeedCalibrationOverrides).toBeUndefined();
	});

	it("breaks a tie by the laps the value covers, then by the larger value", () => {
		const byLaps = normalizeRideCalibration(
			record({
				"1": lap({ airSpeedCalibration: 3 }),
				"2-3-4": lap({ airSpeedCalibration: 6 }),
			}),
		);
		expect(byLaps.rideAirSpeedCalibration).toBe(6);
		expect(byLaps.airSpeedCalibrationOverrides).toEqual({ "1": 3 });

		const byValue = normalizeRideCalibration(
			record({
				"1": lap({ airSpeedCalibration: 3 }),
				"2": lap({ airSpeedCalibration: 6 }),
			}),
		);
		expect(byValue.rideAirSpeedCalibration).toBe(6);
	});

	it("groups values that differ only by float noise", () => {
		const out = normalizeRideCalibration(
			record({
				"1": lap({ airSpeedCalibration: 7.700000001 }),
				"2": lap({ airSpeedCalibration: 7.7 }),
			}),
		);
		expect(out.rideAirSpeedCalibration).toBe(7.7);
		expect(out.airSpeedCalibrationOverrides).toBeUndefined();
	});

	it("keeps an existing ride value and existing overrides", () => {
		const out = normalizeRideCalibration(
			record(
				{
					"1": lap({ airSpeedCalibration: 4 }),
					"2": lap({ airSpeedCalibration: 4 }),
					"3": lap({ airSpeedCalibration: 6 }),
				},
				{
					rideAirSpeedCalibration: 9,
					airSpeedCalibrationOverrides: { "3": 0 },
				},
			),
		);
		expect(out.rideAirSpeedCalibration).toBe(9);
		expect(out.airSpeedCalibrationOverrides).toEqual({
			"1": 4,
			"2": 4,
			"3": 0,
		});
	});

	it("returns the same record when there is nothing to migrate", () => {
		const input = record(
			{ "1": lap({}) },
			{ rideAirSpeedCalibration: 5, airSpeedCalibrationOverrides: { "1": 2 } },
		);
		expect(normalizeRideCalibration(input)).toBe(input);
	});

	it("is idempotent", () => {
		const once = normalizeRideCalibration(
			record({
				"1": lap({ airSpeedCalibration: 7.7 }),
				"2": lap({ airSpeedCalibration: 5 }),
				"3": lap({ airSpeedCalibration: 7.7 }),
			}),
		);
		expect(normalizeRideCalibration(once)).toEqual(once);
	});

	it("does not mutate its input", () => {
		const input = record({ "1": lap({ airSpeedCalibration: 5 }) });
		const snapshot = structuredClone(input);
		normalizeRideCalibration(input);
		expect(input).toEqual(snapshot);
	});
});

describe("resolveSelectionCalibration", () => {
	it("prefers the selection's override, 0 included", () => {
		expect(resolveSelectionCalibration(7.7, 0)).toEqual({
			percent: 0,
			source: "selection",
		});
		expect(resolveSelectionCalibration(7.7, 5)).toEqual({
			percent: 5,
			source: "selection",
		});
	});

	it("falls back to the ride value, then to 0", () => {
		expect(resolveSelectionCalibration(7.7, undefined)).toEqual({
			percent: 7.7,
			source: "ride",
		});
		expect(resolveSelectionCalibration(undefined, undefined)).toEqual({
			percent: 0,
			source: "ride",
		});
	});
});
