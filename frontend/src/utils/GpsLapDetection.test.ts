import { describe, expect, it } from "vitest";
import {
	DEFAULT_ONE_WAY_GATE_CONFIG,
	DEFAULT_OUT_AND_BACK_CONFIG,
	GpsLapDetector,
	OneWayGateDetector,
	OutAndBackDetector,
	getDefaultLapDetectionConfig,
} from "./GpsLapDetection";

/**
 * Synthetic 1 Hz tracks on a flat local plane, metres east (x) and north (y)
 * of an origin. Each finding below was first measured on the reference ride;
 * these tracks reproduce its shape with nothing else going on.
 */
const ORIGIN_LAT = 52.5;
const ORIGIN_LON = 13.4;
const METERS_PER_DEGREE_LAT = 111320;
const SAMPLE_SPACING_M = 8;

type Point = [x: number, y: number];

interface Track {
	lat: number[];
	lon: number[];
	timestamps: number[];
	distance: number[];
	/** Index of the sample nearest a point, for windows and assertions. */
	nearest: (p: Point, from?: number) => number;
}

/** Sample a polyline every SAMPLE_SPACING_M metres, one sample per second. */
function buildTrack(waypoints: Point[]): Track {
	const xy: Point[] = [waypoints[0]];
	for (let w = 1; w < waypoints.length; w++) {
		const [x0, y0] = waypoints[w - 1];
		const [x1, y1] = waypoints[w];
		const steps = Math.max(
			1,
			Math.round(Math.hypot(x1 - x0, y1 - y0) / SAMPLE_SPACING_M),
		);
		for (let s = 1; s <= steps; s++) {
			xy.push([x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps]);
		}
	}
	const metersPerDegreeLon =
		METERS_PER_DEGREE_LAT * Math.cos((ORIGIN_LAT * Math.PI) / 180);
	const distance = [0];
	for (let i = 1; i < xy.length; i++) {
		distance.push(
			distance[i - 1] +
				Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]),
		);
	}
	return {
		lat: xy.map(([, y]) => ORIGIN_LAT + y / METERS_PER_DEGREE_LAT),
		lon: xy.map(([x]) => ORIGIN_LON + x / metersPerDegreeLon),
		timestamps: xy.map((_, i) => 1_000_000 + i),
		distance,
		nearest: ([px, py], from = 0) => {
			let best = from;
			for (let i = from; i < xy.length; i++) {
				if (
					Math.hypot(xy[i][0] - px, xy[i][1] - py) <
					Math.hypot(xy[best][0] - px, xy[best][1] - py)
				)
					best = i;
			}
			return best;
		},
	};
}

function toLatLon(p: Point): { lat: number; lon: number } {
	const metersPerDegreeLon =
		METERS_PER_DEGREE_LAT * Math.cos((ORIGIN_LAT * Math.PI) / 180);
	return {
		lat: ORIGIN_LAT + p[1] / METERS_PER_DEGREE_LAT,
		lon: ORIGIN_LON + p[0] / metersPerDegreeLon,
	};
}

/**
 * One out-and-back repetition on a two-lane road: north on x = 0 to y = 500,
 * a tight U-turn, south on x = 6 to y = -100, and a U-turn back onto x = 0.
 */
const OUT_AND_BACK_REP: Point[] = [
	[3, -104],
	[0, -100],
	[0, 500],
	[3, 504],
	[6, 500],
	[6, -100],
	[3, -104],
];

function repeat(rep: Point[], times: number): Point[] {
	const out: Point[] = [];
	for (let t = 0; t < times; t++) out.push(...(t === 0 ? rep : rep.slice(1)));
	return out;
}

const GATE_A: Point = [3, 0];
const TURNAROUND: Point = [3, 500];

function lapConfig(gate: Point, windows: Window[]) {
	const { lat, lon } = toLatLon(gate);
	return {
		markerLat: lat,
		markerLon: lon,
		windows,
		...getDefaultLapDetectionConfig(),
	};
}

function outAndBackConfig(a: Point, b: Point, windows: Window[]) {
	const pa = toLatLon(a);
	const pb = toLatLon(b);
	return {
		markerALat: pa.lat,
		markerALon: pa.lon,
		markerBLat: pb.lat,
		markerBLon: pb.lon,
		windows,
		...DEFAULT_OUT_AND_BACK_CONFIG,
	};
}

interface Window {
	startIdx: number;
	endIdx: number;
}

const whole = (track: Track): Window[] => [
	{ startIdx: 0, endIdx: track.timestamps.length - 1 },
];

/** Three repetitions, selected as the first and third with the second left out. */
function threeRepsFirstAndThirdSelected() {
	const track = buildTrack(repeat(OUT_AND_BACK_REP, 3));
	const repLength = (track.timestamps.length - 1) / 3;
	const windows: Window[] = [
		{ startIdx: 0, endIdx: repLength },
		{ startIdx: 2 * repLength, endIdx: 3 * repLength },
	];
	return { track, windows, repLength };
}

function insideSomeWindow(windows: Window[], start: number, end: number) {
	return windows.some((w) => start >= w.startIdx && end <= w.endIdx);
}

describe("OutAndBackDetector", () => {
	it("finds one section per repetition with A on the road and B short of the turn", () => {
		const track = buildTrack(repeat(OUT_AND_BACK_REP, 3));
		const result = new OutAndBackDetector(
			track.lat,
			track.lon,
			track.timestamps,
			track.distance,
			outAndBackConfig(GATE_A, [3, 400], whole(track)),
		).detectSections();

		expect(result.detectedSections).toHaveLength(3);
	});

	it("finds one section per repetition when B sits on the turnaround itself", () => {
		const track = buildTrack(repeat(OUT_AND_BACK_REP, 3));
		const result = new OutAndBackDetector(
			track.lat,
			track.lon,
			track.timestamps,
			track.distance,
			outAndBackConfig(GATE_A, TURNAROUND, whole(track)),
		).detectSections();

		expect(result.detectedSections).toHaveLength(3);
		for (const s of result.detectedSections) {
			// The turn is where the outbound leg ends and the inbound one begins.
			expect(s.inboundStartIdx - s.outboundEndIdx).toBeLessThanOrEqual(1);
			expect(s.outboundDuration).toBeGreaterThan(50);
			expect(s.inboundDuration).toBeGreaterThan(50);
		}
	});

	it("never builds a section across a FIT lap that is not selected", () => {
		const { track, windows } = threeRepsFirstAndThirdSelected();
		const result = new OutAndBackDetector(
			track.lat,
			track.lon,
			track.timestamps,
			track.distance,
			outAndBackConfig(GATE_A, [3, 400], windows),
		).detectSections();

		expect(result.detectedSections).toHaveLength(2);
		for (const s of result.detectedSections) {
			expect(
				insideSomeWindow(windows, s.outboundStartIdx, s.inboundEndIdx),
			).toBe(true);
		}
		expect(result.detectedSections.map((s) => s.sectionNumber)).toEqual([1, 2]);
	});

	it("starts the outbound leg at the LAST pass of A before B", () => {
		// A block loop brings the rider through A northbound twice before
		// heading out to B.
		const track = buildTrack([
			[0, -100],
			[0, 100],
			[150, 100],
			[150, -100],
			[0, -100],
			[0, 500],
			[3, 504],
			[6, 500],
			[6, -100],
		]);
		const secondPassOfA = track.nearest([0, 0], track.nearest([150, -100]));
		const result = new OutAndBackDetector(
			track.lat,
			track.lon,
			track.timestamps,
			track.distance,
			outAndBackConfig(GATE_A, [3, 400], whole(track)),
		).detectSections();

		expect(result.detectedSections).toHaveLength(1);
		expect(
			Math.abs(result.detectedSections[0].outboundStartIdx - secondPassOfA),
		).toBeLessThanOrEqual(2);
	});

	for (const bend of [100, 135, 170]) {
		it(`starts the inbound leg at the return pass when B sits on a ${bend}° bend`, () => {
			const rad = (bend * Math.PI) / 180;
			const far: Point = [300 * Math.sin(rad), 500 + 300 * Math.cos(rad)];
			const track = buildTrack([
				[0, -100],
				[0, 500],
				far,
				[far[0] + 4, far[1] + 4],
				[0, 500],
				[0, -100],
			]);
			const firstB = track.nearest([0, 500]);
			const returnB = track.nearest([0, 500], track.nearest(far));
			const result = new OutAndBackDetector(
				track.lat,
				track.lon,
				track.timestamps,
				track.distance,
				outAndBackConfig([0, 0], [0, 500], whole(track)),
			).detectSections();

			expect(result.detectedSections).toHaveLength(1);
			const s = result.detectedSections[0];
			// Without this the test would pass just as well if the doubling stopped firing.
			expect(
				result.passingsB.filter((p) => p.index === s.outboundEndIdx),
			).toHaveLength(2);
			expect(Math.abs(s.outboundEndIdx - firstB)).toBeLessThanOrEqual(3);
			expect(Math.abs(s.inboundStartIdx - returnB)).toBeLessThanOrEqual(3);
		});
	}
});

describe("GpsLapDetector", () => {
	it("splits a repeated out-and-back into one lap per repetition", () => {
		const track = buildTrack(repeat(OUT_AND_BACK_REP, 3));
		const result = new GpsLapDetector(
			track.lat,
			track.lon,
			track.timestamps,
			track.distance,
			lapConfig([0, 0], whole(track)),
		).detectLaps();

		expect(result.detectedLaps).toHaveLength(2);
	});

	it("keeps looking when the first passing has no same-direction partner", () => {
		// One southbound pass through the gate, then three northbound circuits.
		const circuit: Point[] = [
			[0, -300],
			[0, 300],
			[200, 300],
			[200, -300],
			[0, -300],
		];
		const track = buildTrack([[0, 200], ...repeat(circuit, 3)]);
		const result = new GpsLapDetector(
			track.lat,
			track.lon,
			track.timestamps,
			track.distance,
			lapConfig([0, 0], whole(track)),
		).detectLaps();

		expect(result.detectedLaps).toHaveLength(2);
	});

	it("never builds a lap across a FIT lap that is not selected", () => {
		const { track, windows } = threeRepsFirstAndThirdSelected();
		// The gate sits on the lane northbound traffic uses, just past A.
		const result = new GpsLapDetector(
			track.lat,
			track.lon,
			track.timestamps,
			track.distance,
			lapConfig([0, 0], windows),
		).detectLaps();

		for (const lap of result.detectedLaps) {
			expect(insideSomeWindow(windows, lap.startIdx, lap.endIdx)).toBe(true);
		}
	});
});

describe("OneWayGateDetector", () => {
	/**
	 * A gate as the binder hands it over: the sample the slider resolved to.
	 * That sample's own bearing is the one way the gate counts.
	 */
	function gateAt(track: Track, p: Point, from = 0) {
		const index = track.nearest(p, from);
		return { lat: track.lat[index], lon: track.lon[index], index };
	}

	function detect(
		track: Track,
		a: { lat: number; lon: number; index: number },
		b: { lat: number; lon: number; index: number },
		windows: Window[],
	) {
		return new OneWayGateDetector(
			track.lat,
			track.lon,
			track.timestamps,
			track.distance,
			{ gateA: a, gateB: b, windows, ...DEFAULT_ONE_WAY_GATE_CONFIG },
		).detectLaps();
	}

	it("counts only the passes in the direction the gates were placed", () => {
		const track = buildTrack(repeat(OUT_AND_BACK_REP, 3));
		const a = gateAt(track, [0, 0]);
		const b = gateAt(track, [0, 400], a.index);
		const result = detect(track, a, b, whole(track));

		expect(result.detectedLaps).toHaveLength(3);
		for (const lap of result.detectedLaps) {
			// 400 m northbound at 8 m a second, never the 1.2 km round trip.
			expect(lap.duration).toBeGreaterThan(45);
			expect(lap.duration).toBeLessThan(55);
			expect(lap.directionName).toBe("N");
		}
		expect(result.detectedLaps.map((l) => l.lapNumber)).toEqual([1, 2, 3]);
	});

	it("measures the return leg when the gates are placed on it", () => {
		const track = buildTrack(repeat(OUT_AND_BACK_REP, 3));
		const turn = track.nearest([6, 500]);
		const a = gateAt(track, [6, 400], turn);
		const b = gateAt(track, [6, 0], a.index);
		const result = detect(track, a, b, whole(track));

		expect(result.detectedLaps).toHaveLength(3);
		for (const lap of result.detectedLaps) {
			expect(lap.directionName).toBe("S");
		}
	});

	it("never builds a segment across a FIT lap that is not selected", () => {
		const { track, windows } = threeRepsFirstAndThirdSelected();
		const a = gateAt(track, [0, 0]);
		const b = gateAt(track, [0, 400], a.index);
		const result = detect(track, a, b, windows);

		expect(result.detectedLaps).toHaveLength(2);
		for (const lap of result.detectedLaps) {
			expect(insideSomeWindow(windows, lap.startIdx, lap.endIdx)).toBe(true);
		}
	});

	it("starts from the last pass of A before B", () => {
		// Through A, back round a short loop, through A again, then out to B.
		const track = buildTrack([
			[0, -100],
			[0, 100],
			[3, 104],
			[6, 100],
			[6, -100],
			[3, -104],
			[0, -100],
			[0, 500],
		]);
		const secondPassOfA = track.nearest([0, 0], track.nearest([3, -104]));
		const a = gateAt(track, [0, 0]);
		const b = gateAt(track, [0, 400], secondPassOfA);
		const result = detect(track, a, b, whole(track));

		expect(result.detectedLaps).toHaveLength(1);
		expect(
			Math.abs(result.detectedLaps[0].startIdx - secondPassOfA),
		).toBeLessThanOrEqual(2);
	});
});
