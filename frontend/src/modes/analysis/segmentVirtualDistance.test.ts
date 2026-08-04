/**
 * Change-list entry (h): multi-lap Standard stores the PER-LAP virtual
 * distances, not zeros.
 *
 * These drive the REAL `standardMode.summarize` through the REAL registry
 * against hand-built profiles — no module is mocked, so the assertions reach
 * the code that actually runs when the Analyze button is pressed. That matters
 * here specifically: this phase has shipped three guards that passed while the
 * bug was live, twice because the fixture skipped the failing branch. The
 * branch under test is `profiles.length > 1`, so every multi-lap case below
 * uses two profiles and every value asserted is one the fixture makes
 * distinguishable per lap.
 *
 * The fixture puts a 601-second wall-clock gap between the two laps for a
 * reason. It is what separates the honest answer from the tempting one: the
 * concatenated integral over the same two laps reads 8.648 km, because it
 * charges the gap as if the rider had ridden it, while the two laps together
 * are 0.234 km. A test whose laps were adjacent in time could not tell the two
 * apart.
 */
import { describe, expect, it } from "vitest";
import { AppState } from "../../state/AppState";
import { computeVirtualDistanceWindowTotals } from "../../analysis/VirtualDistance";
import { getAnalysisModeHandler } from "./AnalysisModes";
import type {
	ModeAggregateStats,
	ResolvedUpdateInputs,
	SegmentVeProfile,
} from "./types";

const SAMPLE_COUNT = 30;

/**
 * Three ten-sample laps at one sample per second, separated by 600-second
 * stops. Lap 1 is indices 0-9, lap 2 is 10-19, lap 3 is 20-29.
 */
function timestamps(): number[] {
	return Array.from({ length: SAMPLE_COUNT }, (_, i) => {
		if (i < 10) return i;
		if (i < 20) return i + 600;
		return i + 1200;
	});
}

function normalizedArrays() {
	return {
		timestamps: timestamps(),
		velocity: Array.from({ length: SAMPLE_COUNT }, () => 10),
	};
}

function makeInputs(): ResolvedUpdateInputs {
	return {
		wind: { selectedWindSource: "fit" },
		windSource: "fit",
		normalized: normalizedArrays(),
	} as unknown as ResolvedUpdateInputs;
}

/**
 * One lap's profile. `apparentWindSpeedMps` is segment-local (0..n-1), which is
 * what `standardVirtualDistances` integrates; `indices` are full-activity, which
 * is what it looks the timestamps up by.
 */
function makeProfile(
	label: string,
	startIdx: number,
	apparentWind: number,
	trim?: { start: number; end: number },
): SegmentVeProfile {
	const indices = Array.from({ length: 10 }, (_, i) => startIdx + i);
	return {
		segment: {
			key: label,
			label,
			range: { startIdx, endIdx: startIdx + 9 },
			trim,
		},
		indices,
		distancesKm: indices.map((_, i) => i / 100),
		timeIndices: indices.map((_, i) => i),
		virtualElevation: indices.map(() => 1),
		virtualElevationCompare: null,
		actualElevation: indices.map(() => 100),
		supplementarySeries: {
			distancesKm: indices.map((_, i) => i / 100),
			powerWatts: indices.map(() => 200),
			apparentWindSpeedMps: indices.map(() => apparentWind),
			virtualDistanceAirKm: [],
			virtualDistanceGroundKm: [],
		},
		result: {
			virtual_elevation: new Float64Array(indices.length),
			r2: 0.5,
			rmse: 1,
			ve_elevation_diff: 2,
			actual_elevation_diff: 3,
			virtual_distance_air: 0,
			virtual_distance_ground: 0,
			vd_difference_percent: 0,
		},
	};
}

const AGGREGATE: ModeAggregateStats = {
	r2: 0.5,
	rmse: 1,
	veGain: 2,
	actualGain: 3,
	segmentCount: 2,
};

/**
 * `getAnalysisModeHandler` takes the LAP DETECTION MODE STRING, not the mode
 * id. Passing "gpsLap" falls through the switch to Standard and the test then
 * asserts against the wrong handler while reporting success — which is how a
 * guard in this phase passes while its bug is live. Every handler this file
 * fetches is checked against its `id` before it is used.
 */
function handlerFor(lapDetectionMode: string | null, expectedId: string) {
	const handler = getAnalysisModeHandler(lapDetectionMode);
	expect(handler.id).toBe(expectedId);
	return handler;
}

function summarizeStandard(profiles: SegmentVeProfile[]): AppState {
	const appState = new AppState();
	handlerFor(null, "standard").summarize(
		appState,
		profiles,
		AGGREGATE,
		makeInputs(),
	);
	return appState;
}

describe("multi-lap Standard stores per-lap virtual distances (entry (h))", () => {
	const profiles = () => [
		makeProfile("Lap 2", 10, 12),
		makeProfile("Lap 3", 20, 14),
	];

	it("writes one labelled entry per lap, with that lap's own figures", () => {
		const appState = summarizeStandard(profiles());

		expect(appState.currentVirtualDistances).toHaveLength(2);
		expect(appState.currentVirtualDistances[0].label).toBe("Lap 2");
		expect(appState.currentVirtualDistances[1].label).toBe("Lap 3");

		// 9 one-second steps per lap: 12 m/s and 14 m/s of apparent wind
		// against 10 m/s of ground speed.
		expect(appState.currentVirtualDistances[0].airKm).toBeCloseTo(0.108, 10);
		expect(appState.currentVirtualDistances[0].groundKm).toBeCloseTo(0.09, 10);
		expect(appState.currentVirtualDistances[0].differencePercent).toBeCloseTo(20, 8);

		expect(appState.currentVirtualDistances[1].airKm).toBeCloseTo(0.126, 10);
		expect(appState.currentVirtualDistances[1].groundKm).toBeCloseTo(0.09, 10);
		expect(appState.currentVirtualDistances[1].differencePercent).toBeCloseTo(40, 8);
	});

	it("no longer leaves the stored virtual distances at zero", () => {
		const appState = summarizeStandard(profiles());

		// The combined VE result's three scalars are still zero, and still
		// deliberately so — there is no single virtual distance for a selection
		// D-19 Option B integrates one lap at a time. What changed is that the
		// per-lap figures are no longer discarded alongside them.
		expect(appState.currentVEResult!.virtual_distance_air).toBe(0);
		expect(appState.currentVEResult!.virtual_distance_ground).toBe(0);
		expect(appState.currentVEResult!.vd_difference_percent).toBe(0);

		for (const entry of appState.currentVirtualDistances) {
			expect(entry.airKm).toBeGreaterThan(0);
			expect(entry.groundKm).toBeGreaterThan(0);
		}
	});

	it("stores the per-lap figures, NOT the concatenated integral", () => {
		const appState = summarizeStandard(profiles());
		const perLapTotal = appState.currentVirtualDistances.reduce(
			(sum, entry) => sum + entry.airKm,
			0,
		);

		// What integrating the two laps end to end would give: the 601-second
		// stop between them charged at lap 3's apparent wind.
		const concatenated = computeVirtualDistanceWindowTotals({
			timestamps: [...timestamps().slice(10, 20), ...timestamps().slice(20, 30)],
			velocity: Array.from({ length: 20 }, () => 10),
			windSpeed: [
				...Array.from({ length: 10 }, () => 12),
				...Array.from({ length: 10 }, () => 14),
			],
			trimStart: 0,
			trimEnd: 19,
		});

		expect(concatenated.airKm).toBeCloseTo(8.648, 10);
		expect(perLapTotal).toBeCloseTo(0.234, 10);
		expect(perLapTotal).toBeLessThan(concatenated.airKm / 10);
	});

	it("integrates each lap over that lap's OWN trim window", () => {
		const appState = summarizeStandard([
			makeProfile("Lap 2", 10, 12, { start: 2, end: 5 }),
			makeProfile("Lap 3", 20, 14),
		]);

		// Three one-second steps inside the window, not nine.
		expect(appState.currentVirtualDistances[0].airKm).toBeCloseTo(0.036, 10);
		expect(appState.currentVirtualDistances[0].groundKm).toBeCloseTo(0.03, 10);
		// The untrimmed lap is unaffected by its neighbour's window.
		expect(appState.currentVirtualDistances[1].airKm).toBeCloseTo(0.126, 10);
	});
});

describe("single-lap Standard is unregressed", () => {
	it("stores exactly one entry, equal to the whole-window reading", () => {
		const appState = summarizeStandard([makeProfile("Lap 2", 10, 12)]);

		const expected = computeVirtualDistanceWindowTotals({
			timestamps: timestamps().slice(10, 20),
			velocity: Array.from({ length: 10 }, () => 10),
			windSpeed: Array.from({ length: 10 }, () => 12),
			trimStart: 0,
			trimEnd: 9,
		});

		expect(appState.currentVirtualDistances).toHaveLength(1);
		expect(appState.currentVirtualDistances[0].airKm).toBe(expected.airKm);
		expect(appState.currentVirtualDistances[0].groundKm).toBe(expected.groundKm);
		expect(appState.currentVirtualDistances[0].differencePercent).toBe(
			expected.differencePercent,
		);
	});
});

describe("the segment modes store per-segment figures too", () => {
	/** GPS-lap reads the cumulative series its stacked plot draws. */
	function makeStackedProfile(label: string, startIdx: number, airKm: number[]) {
		const profile = makeProfile(label, startIdx, 12);
		profile.supplementarySeries.virtualDistanceAirKm = airKm;
		profile.supplementarySeries.virtualDistanceGroundKm = airKm.map(
			(value) => value / 1.2,
		);
		return profile;
	}

	it("gpsLap summarize writes one entry per lap off the plotted series", () => {
		const appState = new AppState();
		handlerFor("GPS based lap splitting", "gpsLap").summarize(
			appState,
			[
				makeStackedProfile("Lap 2", 10, [0, 1.2, 2.4]),
				makeStackedProfile("Lap 3", 20, [0, 1.5, 3.0]),
			],
			AGGREGATE,
			makeInputs(),
		);

		expect(appState.currentVirtualDistances.map((entry) => entry.label)).toEqual([
			"Lap 2",
			"Lap 3",
		]);
		expect(appState.currentVirtualDistances[0].airKm).toBe(2.4);
		expect(appState.currentVirtualDistances[0].groundKm).toBeCloseTo(2, 10);
		expect(appState.currentVirtualDistances[1].airKm).toBe(3.0);
		expect(appState.currentVirtualDistances[1].differencePercent).toBeCloseTo(20, 8);
	});
});
