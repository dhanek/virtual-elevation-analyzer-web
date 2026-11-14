/**
 * Ride-level air speed calibration with per-selection overrides (TODO.md,
 * "A ride-level air speed calibration with per-selection overrides").
 *
 * The sensor's scale belongs to the ride, so a file stores ONE ride value
 * (`StoredParameters.rideAirSpeedCalibration`) that every selection follows,
 * unless that exact selection was deliberately tuned with "this selection
 * only" (`StoredParameters.airSpeedCalibrationOverrides`, keyed like
 * `lapSettings`; 0 is a valid override).
 *
 * Before this, every settings save stored the then-current percent on its
 * selection as `LapSettings.airSpeedCalibration`, so a stored value cannot
 * tell a tune from a pin. `normalizeRideCalibration` reads those records per
 * file once, as the maintainer decided (D2, 2026-11-14).
 */
import type { LapSettings, StoredParameters } from "../utils/ParameterStorage";

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
 * The ambiguous legacy field is then removed from every entry. Pure and
 * idempotent; returns the input itself when there is nothing to migrate.
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
	if (legacy.length === 0 && !stray) return record;

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
	const lapSettings: Record<string, LapSettings> = {};
	for (const [key, s] of entries) {
		const { airSpeedCalibration, ...rest } = s;
		lapSettings[key] = rest;
		if (
			overrides[key] === undefined &&
			airSpeedCalibration !== undefined &&
			Number.isFinite(airSpeedCalibration)
		) {
			const value = tenth(airSpeedCalibration);
			if (value !== 0 && ride !== undefined && value !== tenth(ride))
				overrides[key] = value;
		}
	}

	const out: StoredParameters = { ...record, lapSettings };
	if (ride !== undefined) out.rideAirSpeedCalibration = ride;
	if (Object.keys(overrides).length > 0)
		out.airSpeedCalibrationOverrides = overrides;
	return out;
}
