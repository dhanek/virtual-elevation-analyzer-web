/**
 * @vitest-environment jsdom
 *
 * What `headingCalibrationInput` classifies as a MEASURED wind channel, and
 * what offset each channel is aligned with.
 *
 * Nothing is mocked — in particular NOT `resolveWindSeries`. The behaviour
 * under test is how that resolver's OUTPUT is classified, so a mocked resolver
 * would only prove the mock. The real `AppState`, the real Standard mode
 * handler and the real segment cutter all run.
 *
 * Two properties are pinned here:
 *
 *  1. Eligibility. A ride carrying `wind_speed`/`wind_yaw` instead of a native
 *     `air_speed` field is just as fittable: the estimator reads the resolved
 *     longitudinal, offset-aligned series, which the resolver produces the same
 *     way for both channels. The old gate excluded those rides by field name.
 *
 *  2. The offset that comes with each channel. The +2 s lag is measured for the
 *     ELEMNT ACE `air_speed` channel ONLY; the `wind_speed` path defaults to
 *     0 s. Widening eligibility must not carry a sensor-specific lag onto a
 *     channel it was never measured for, so case 1 asserts NO shift against a
 *     deliberately non-flat series and case 2 asserts the +2 s shift is still
 *     there, which is what makes case 1's assertion a distinction rather than
 *     an artefact.
 */
import { describe, expect, it } from "vitest";
import type { AnalysisParameters } from "../../components/AnalysisParameters";
import { AppState } from "../../state/AppState";
import type { ActivityDataLike, ActivityLapLike } from "../../state/AppState";
import { headingCalibrationInput } from "./autoCalibration";

const SAMPLE_COUNT = 40;
/** Well inside the ride, and inside a stretch where both series move. */
const PROBE_INDEX = 7;

/** Deliberately NOT flat: a +2 s shift has to change every one of these. */
function windMagnitude(index: number): number {
	return 11 + 3 * Math.sin(index / 3);
}

function windYawDegrees(index: number): number {
	return 25 * Math.cos(index / 4);
}

/** What `resolveWindSeries` reduces the channel to, before any offset. */
function longitudinal(index: number): number {
	return (
		Math.cos((windYawDegrees(index) * Math.PI) / 180) * windMagnitude(index)
	);
}

interface Channels {
	air_speed?: number[];
	wind_speed?: number[];
	wind_yaw?: number[];
}

function makeFitData(channels: Channels): ActivityDataLike {
	const timestamps = Array.from({ length: SAMPLE_COUNT }, (_, i) => i);
	return {
		timestamps,
		power: timestamps.map(() => 200),
		// Ground speed sits well below the air speed, so the two series are
		// never confusable and a fit has something to work on.
		velocity: timestamps.map((i) => 8 + Math.sin(i / 5)),
		position_lat: timestamps.map((i) => 45 + i / 10000),
		position_long: timestamps.map((i) => -30 + Math.sin(i / 6) / 10000),
		altitude: timestamps.map(() => 100),
		distance: timestamps.map((i) => i * 10),
		temperature: timestamps.map(() => 16),
		...channels,
	} as unknown as ActivityDataLike;
}

function makeAppState(
	channels: Channels,
	airSpeedOffset: number | undefined,
): AppState {
	const appState = new AppState();
	appState.currentFitData = makeFitData(channels);
	appState.currentLaps = [
		{ start_time: 0, end_time: SAMPLE_COUNT - 1 } as unknown as ActivityLapLike,
	];
	appState.selectedLaps = [1];
	// Only the one field the resolver reads. `air_speed_offset` is left
	// UNDEFINED for the `wind_speed` ride, which is what the app has when no
	// offset was ever set, so the resolver's own per-channel fallback decides.
	appState.currentParameters = {
		air_speed_offset: airSpeedOffset,
	} as unknown as AnalysisParameters;
	return appState;
}

describe("headingCalibrationInput eligibility", () => {
	it("accepts a wind_speed/wind_yaw ride and aligns it with NO offset", () => {
		const magnitudes = Array.from({ length: SAMPLE_COUNT }, (_, i) =>
			windMagnitude(i),
		);
		const yaw = Array.from({ length: SAMPLE_COUNT }, (_, i) =>
			windYawDegrees(i),
		);
		const appState = makeAppState(
			{ wind_speed: magnitudes, wind_yaw: yaw },
			undefined,
		);

		const input = headingCalibrationInput(appState);

		expect(input.measuredAirSpeed).toBe(true);
		expect(input.headingSegments).toHaveLength(1);

		// The offset pin. A +2 s shift would read index PROBE_INDEX + 2, so the
		// fixture is asserted non-flat first — otherwise this case would pass
		// against a resolver that shifted.
		expect(longitudinal(PROBE_INDEX)).not.toBeCloseTo(
			longitudinal(PROBE_INDEX + 2),
			3,
		);
		expect(input.headingSegments[0].airSpeed[PROBE_INDEX]).toBeCloseTo(
			longitudinal(PROBE_INDEX),
			10,
		);
	});

	it("keeps accepting an air_speed ride, still shifted by its +2 s offset", () => {
		const magnitudes = Array.from({ length: SAMPLE_COUNT }, (_, i) =>
			windMagnitude(i),
		);
		const yaw = Array.from({ length: SAMPLE_COUNT }, (_, i) =>
			windYawDegrees(i),
		);
		const appState = makeAppState({ air_speed: magnitudes, wind_yaw: yaw }, 2);

		const input = headingCalibrationInput(appState);

		expect(input.measuredAirSpeed).toBe(true);
		expect(input.headingSegments).toHaveLength(1);
		// Shifted by +2 SAMPLES, i.e. this index reads the value two seconds
		// later in the ride. The contrast with case 1 is the whole point.
		expect(input.headingSegments[0].airSpeed[PROBE_INDEX]).toBeCloseTo(
			longitudinal(PROBE_INDEX + 2),
			10,
		);
	});

	it("refuses a ride with neither measured channel", () => {
		const appState = makeAppState(
			{ air_speed: Array.from({ length: SAMPLE_COUNT }, () => 0) },
			undefined,
		);

		const input = headingCalibrationInput(appState);

		expect(input.measuredAirSpeed).toBe(false);
	});
});
