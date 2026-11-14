/**
 * Ride-level air speed calibration with per-selection overrides (TODO.md,
 * "A ride-level air speed calibration with per-selection overrides").
 *
 * The sensor's scale belongs to the ride, so a file stores ONE ride value
 * (`StoredParameters.rideAirSpeedCalibration`) that every selection follows,
 * unless that exact selection was deliberately tuned with "this selection
 * only" (`StoredParameters.airSpeedCalibrationOverrides`, keyed by mode and
 * selection, `calibrationOverrideKey`; 0 is a valid override). The mode is in
 * the key because the same lap numbers in another mode are another selection.
 *
 * Before this, every settings save stored the then-current percent on its
 * selection as `LapSettings.airSpeedCalibration`, so a stored value cannot
 * tell a tune from a pin. `normalizeRideCalibration` reads those records per
 * file once, as the maintainer decided (D2, 2026-11-14).
 */
import type { AnalysisModeId } from "../modes/analysis/types";
import type { LapSettings, StoredParameters } from "../utils/ParameterStorage";

/** The three modes an override key can carry, in migration order. */
const CALIBRATION_MODES = ["standard", "gpsLap", "outAndBack"] as const;

/**
 * The `airSpeedCalibrationOverrides` key for one mode's exact selection, e.g.
 * `"standard:2"`, `"gpsLap:1-2"`, `"outAndBack:all"`.
 */
export function calibrationOverrideKey(
	mode: AnalysisModeId,
	lapKey: string,
): string {
	return `${mode}:${lapKey}`;
}

/** A key written before the mode was in it (or carried by an older export). */
function isUnprefixed(key: string): boolean {
	return !CALIBRATION_MODES.some((mode) => key.startsWith(`${mode}:`));
}

export type CalibrationSource = "ride" | "selection";

export interface ResolvedCalibration {
	percent: number;
	source: CalibrationSource;
}

/** Override, else the ride value, else 0. */
export function resolveSelectionCalibration(
	ride: number | undefined,
	override: number | undefined,
): ResolvedCalibration {
	if (override !== undefined) return { percent: override, source: "selection" };
	return { percent: ride ?? 0, source: "ride" };
}

/** The control steps in 0.1 %; stored values carry float noise beyond that. */
function tenth(value: number): number {
	return Math.round(value * 10) / 10;
}

function lapCount(key: string): number {
	return key === "all" ? 0 : key.split("-").length;
}

/**
 * D2, per file:
 *   - the non-zero value most of the file's selections share becomes the ride
 *     value (unless the record already has one); a tie goes to the value that
 *     covers more laps, then to the larger value;
 *   - a selection whose stored value is another non-zero value keeps it as an
 *     override;
 *   - a stored 0, or a value equal to the ride, follows the ride.
 * The ambiguous legacy field is then removed from every entry.
 *
 * The override key carries the mode (`calibrationOverrideKey`). An override
 * written before that (an unprefixed key), and a legacy entry that becomes an
 * override, is copied to all three modes, each only where that mode's key is
 * not already present: before the mode was in the key, all three modes read
 * it for those lap numbers, and the record does not say which mode wrote it.
 * Copying keeps every mode reading what it read before; from then on they
 * diverge. Pure and idempotent; returns the input itself when there is
 * nothing to migrate.
 */
export function normalizeRideCalibration(
	record: StoredParameters,
): StoredParameters {
	const entries = Object.entries(record.lapSettings ?? {});
	const legacy = entries.filter(
		([, s]) =>
			s.airSpeedCalibration !== undefined &&
			Number.isFinite(s.airSpeedCalibration),
	);
	const stray = entries.some(([, s]) => "airSpeedCalibration" in s);
	const unprefixed = Object.keys(
		record.airSpeedCalibrationOverrides ?? {},
	).filter(isUnprefixed);
	if (legacy.length === 0 && !stray && unprefixed.length === 0) return record;

	let ride = record.rideAirSpeedCalibration;
	if (ride === undefined) {
		const tally = new Map<number, { selections: number; laps: number }>();
		for (const [key, s] of legacy) {
			const value = tenth(s.airSpeedCalibration as number);
			if (value === 0) continue;
			const t = tally.get(value) ?? { selections: 0, laps: 0 };
			t.selections += 1;
			t.laps += lapCount(key);
			tally.set(value, t);
		}
		let best: [number, { selections: number; laps: number }] | null = null;
		for (const candidate of tally) {
			if (
				!best ||
				candidate[1].selections > best[1].selections ||
				(candidate[1].selections === best[1].selections &&
					(candidate[1].laps > best[1].laps ||
						(candidate[1].laps === best[1].laps && candidate[0] > best[0])))
			)
				best = candidate;
		}
		ride = best?.[0];
	}

	const overrides = { ...(record.airSpeedCalibrationOverrides ?? {}) };
	const copyToAllModes = (lapKey: string, value: number): void => {
		for (const mode of CALIBRATION_MODES) {
			const key = calibrationOverrideKey(mode, lapKey);
			if (overrides[key] === undefined) overrides[key] = value;
		}
	};
	for (const key of unprefixed) {
		copyToAllModes(key, overrides[key]);
		delete overrides[key];
	}
	const lapSettings: Record<string, LapSettings> = {};
	for (const [key, s] of entries) {
		const { airSpeedCalibration, ...rest } = s;
		lapSettings[key] = rest;
		if (
			airSpeedCalibration !== undefined &&
			Number.isFinite(airSpeedCalibration)
		) {
			const value = tenth(airSpeedCalibration);
			if (value !== 0 && ride !== undefined && value !== tenth(ride))
				copyToAllModes(key, value);
		}
	}

	const out: StoredParameters = { ...record, lapSettings };
	if (ride !== undefined) out.rideAirSpeedCalibration = ride;
	if (Object.keys(overrides).length > 0)
		out.airSpeedCalibrationOverrides = overrides;
	return out;
}
