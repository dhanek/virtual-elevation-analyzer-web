import { describe, expect, it } from "vitest";
import {
	circuitWindows,
	fitSharedScale,
	gustIndex,
	headingFromGps,
	isValidFix,
	windStationarity,
	type ScaleFitSegment,
} from "./HeadingCalibration";
import { syntheticTrack } from "./__fixtures__/syntheticTrack";

const RAD = Math.PI / 180;

/**
 * Synthetic heading sweep (no GPS), for the estimator in isolation.
 * va_meas = (v + w·cos(heading − from)) / scale.
 */
function sweep({
	loops = 6,
	perLoop = 60,
	velocity = (_h: number, _i: number): number => 10,
	wind = (_i: number) => ({ speed: 2, from: 247 }),
	scale = 1,
	phaseDeg = 0,
} = {}) {
	const n = loops * perLoop;
	const heading: number[] = [];
	const v: number[] = [];
	const va: number[] = [];
	for (let i = 0; i < n; i++) {
		const h = (((i % perLoop) / perLoop) * 360 + phaseDeg) % 360;
		const speed = velocity(h, i);
		const w = wind(i);
		heading.push(h);
		v.push(speed);
		va.push((speed + w.speed * Math.cos((h - w.from) * RAD)) / scale);
	}
	return { heading, v, va, timestamps: v.map((_, i) => i) };
}

function segmentOf(
	ride: ReturnType<typeof sweep>,
	mask?: boolean[],
): ScaleFitSegment {
	return {
		velocity: ride.v,
		airSpeed: ride.va,
		headingDeg: ride.heading,
		mask: mask ?? ride.v.map(() => true),
	};
}

function ok<T extends { ok: boolean }>(fit: T): Extract<T, { ok: true }> {
	if (!fit.ok) throw new Error(`refused: ${JSON.stringify(fit)}`);
	return fit as Extract<T, { ok: true }>;
}

/**
 * `syntheticTrack` reports GPS, not heading — derive it the same way the
 * production caller (`AirSpeedCalibration.ts`) does, rather than duplicating
 * `segmentOf`'s sweep-shaped fixture for a track that has no `heading` field.
 */
function scaleFitSegmentOf(
	track: ReturnType<typeof syntheticTrack>,
): ScaleFitSegment {
	return {
		velocity: track.velocity,
		airSpeed: track.airSpeed,
		headingDeg: headingFromGps(
			track.positionLat,
			track.positionLong,
			track.timestamps,
		),
		mask: track.velocity.map(() => true),
	};
}

describe("isValidFix", () => {
	it("rejects the parser's (0, 0) sentinel, non-finite and out-of-range values", () => {
		expect(isValidFix(0, 0)).toBe(false);
		expect(isValidFix(NaN, 13)).toBe(false);
		expect(isValidFix(91, 13)).toBe(false);
	});

	it("accepts a fix on the equator or the prime meridian", () => {
		expect(isValidFix(0, 13.4)).toBe(true);
		expect(isValidFix(52.5, 0)).toBe(true);
	});
});

describe("headingFromGps", () => {
	const line = (dLat: number, dLon: number, n = 20) => ({
		lat: Array.from({ length: n }, (_, i) => 50 + i * dLat),
		lon: Array.from({ length: n }, (_, i) => 8 + i * dLon),
		t: Array.from({ length: n }, (_, i) => i),
	});

	it("reads the four cardinal directions", () => {
		const north = line(0.00005, 0);
		const east = line(0, 0.00005);
		const south = line(-0.00005, 0);
		const west = line(0, -0.00005);
		for (const h of headingFromGps(north.lat, north.lon, north.t))
			expect(h).toBeCloseTo(0, 6);
		for (const h of headingFromGps(east.lat, east.lon, east.t))
			expect(h).toBeCloseTo(90, 2);
		for (const h of headingFromGps(south.lat, south.lon, south.t))
			expect(h).toBeCloseTo(180, 6);
		for (const h of headingFromGps(west.lat, west.lon, west.t))
			expect(h).toBeCloseTo(270, 2);
	});

	it("treats a (0, 0) fix exactly like a missing one", () => {
		const east = line(0, 0.00005);
		const zeroed = { ...east, lat: [...east.lat], lon: [...east.lon] };
		const nanned = { ...east, lat: [...east.lat], lon: [...east.lon] };
		zeroed.lat[7] = 0;
		zeroed.lon[7] = 0;
		nanned.lat[7] = NaN;
		nanned.lon[7] = NaN;
		const a = headingFromGps(zeroed.lat, zeroed.lon, zeroed.t);
		const b = headingFromGps(nanned.lat, nanned.lon, nanned.t);
		expect(a).toEqual(b);
		expect(Number.isNaN(a[7])).toBe(true);
		expect(a[6]).toBeCloseTo(90, 2);
		expect(a[8]).toBeCloseTo(90, 2);
	});

	it("never fabricates due north from a repeated fix", () => {
		const east = line(0, 0.00005);
		east.lon[8] = east.lon[7];
		const heading = headingFromGps(east.lat, east.lon, east.t);
		expect(heading[7]).toBeCloseTo(90, 2);
	});

	it("does not bridge a bearing across a gap longer than 3 s", () => {
		const lat = [50, 50, 50, 50.001, 50.001];
		const lon = [8, 8.0001, 8.0002, 8.0002, 8.0003];
		const t = [0, 1, 2, 30, 31];
		const heading = headingFromGps(lat, lon, t);
		// Fix 2 is followed by a 28 s gap: it keeps its incoming (east) bearing.
		expect(heading[2]).toBeCloseTo(90, 1);
	});
});

describe("fitSharedScale", () => {
	it("recovers scale and wind on one segment", () => {
		const fit = ok(fitSharedScale([segmentOf(sweep({ scale: 1.08 }))]));
		expect(Math.abs(fit.scale - 1.08)).toBeLessThan(1e-9);
		expect(Math.abs(fit.winds[0].windSpeed - 2)).toBeLessThan(1e-9);
		expect(Math.abs(fit.winds[0].windDirDeg - 247)).toBeLessThan(1e-6);
		expect(fit.residSd).toBeLessThan(1e-9);
	});

	it("R1: pools segments with opposite winds and heading-correlated pace without biasing the scale", () => {
		const a = sweep({
			scale: 1.08,
			wind: () => ({ speed: 3, from: 0 }),
			velocity: (h) => 10 + 2 * Math.cos(h * RAD),
		});
		const b = sweep({
			scale: 1.08,
			wind: () => ({ speed: 3, from: 180 }),
			velocity: (h) => 10 + 2 * Math.sin(h * RAD),
			perLoop: 47,
			phaseDeg: 33,
		});
		const fit = ok(fitSharedScale([segmentOf(a), segmentOf(b)]));
		expect(Math.abs(fit.scale - 1.08)).toBeLessThan(1e-9);
		expect(fit.winds[0].windDirDeg).toBeCloseTo(0, 5);
		expect(fit.winds[1].windDirDeg).toBeCloseTo(180, 5);
	});

	it("returns residuals aligned to input indices, NaN where excluded", () => {
		const ride = sweep({ scale: 1.05 });
		const mask = ride.v.map((_, i) => i >= 30);
		const fit = ok(fitSharedScale([segmentOf(ride, mask)]));
		expect(Number.isNaN(fit.residuals[0][0])).toBe(true);
		expect(Math.abs(fit.residuals[0][30])).toBeLessThan(1e-9);
	});

	it("refuses too few points, a straight line, and a negative velocity coefficient", () => {
		expect(
			fitSharedScale([segmentOf(sweep({ loops: 1, perLoop: 20 }))]),
		).toMatchObject({
			ok: false,
			reason: "tooFewPoints",
		});
		const straight = sweep();
		straight.heading.fill(45);
		expect(fitSharedScale([segmentOf(straight)])).toMatchObject({
			ok: false,
			reason: "headingCoverage",
		});
		const negative = sweep({ wind: () => ({ speed: 0, from: 0 }) });
		negative.va = negative.va.map((x) => -x);
		expect(fitSharedScale([segmentOf(negative)])).toMatchObject({
			ok: false,
			reason: "degenerate",
		});
	});

	it("exposes the wind coefficients the residuals were computed from", () => {
		const track = syntheticTrack({ circuits: 3 });
		const fit = ok(fitSharedScale([scaleFitSegmentOf(track)]));

		const { a, b } = fit.coefficients[0];
		// windSpeed = scale * hypot(a, b) and windDirDeg = atan2(b, a): the
		// coefficients must be consistent with the wind the fit already reports.
		expect(Math.hypot(a, b) * fit.scale).toBeCloseTo(
			fit.winds[0].windSpeed,
			10,
		);

		// And they must reproduce the fit's own residuals, sample for sample.
		const segment = scaleFitSegmentOf(track);
		for (let i = 0; i < fit.residuals[0].length; i++) {
			const expected = fit.residuals[0][i];
			if (!Number.isFinite(expected)) continue;
			const theta = (segment.headingDeg[i] * Math.PI) / 180;
			const modelled =
				segment.velocity[i] / fit.scale +
				a * Math.cos(theta) +
				b * Math.sin(theta);
			expect(segment.airSpeed[i] - modelled).toBeCloseTo(expected, 10);
		}
	});

	it("refuses the pool when any one segment lacks heading coverage", () => {
		const good = sweep();
		const straight = sweep();
		straight.heading.fill(10);
		expect(
			fitSharedScale([segmentOf(good), segmentOf(straight)]),
		).toMatchObject({
			ok: false,
			reason: "headingCoverage",
		});
	});
});

describe("windStationarity", () => {
	it("R4: catches a reversal of equal magnitude as a 4 m/s vector change", () => {
		const ride = sweep({
			wind: (i) => ({ speed: 2, from: i < 180 ? 0 : 180 }),
		});
		const result = windStationarity(segmentOf(ride), ride.timestamps);
		expect(result.available).toBe(true);
		expect(result.available && result.vectorChange).toBeCloseTo(4, 6);
	});

	it("R4: splits by time over fitted samples, so an excluded prefix changes nothing", () => {
		const ride = sweep({
			wind: (i) => ({ speed: i < 180 ? 1 : 3, from: 200 }),
		});
		const plain = windStationarity(segmentOf(ride), ride.timestamps);
		const pad = 600;
		const padded = {
			heading: [...new Array(pad).fill(0), ...ride.heading],
			v: [...new Array(pad).fill(10), ...ride.v],
			va: [...new Array(pad).fill(10), ...ride.va],
			timestamps: [
				...Array.from({ length: pad }, (_, i) => i - pad),
				...ride.timestamps,
			],
		};
		const mask = padded.v.map((_, i) => i >= pad);
		const shifted = windStationarity(
			segmentOf(padded, mask),
			padded.timestamps,
		);
		expect(shifted).toEqual(plain);
		expect(plain.available && plain.vectorChange).toBeCloseTo(2, 6);
	});

	it("says unavailable instead of silently passing when a half cannot be fitted", () => {
		const ride = sweep({ loops: 1, perLoop: 50 });
		expect(windStationarity(segmentOf(ride), ride.timestamps)).toEqual({
			available: false,
		});
	});
});

function windowsOf(
	track: ReturnType<typeof syntheticTrack>,
	usableAt: (i: number) => boolean = () => true,
) {
	return circuitWindows({
		timestamps: track.timestamps,
		positionLat: track.positionLat,
		positionLong: track.positionLong,
		usable: track.velocity.map((_, i) => usableAt(i)),
	});
}

function sliceTrack(
	track: ReturnType<typeof syntheticTrack>,
	from: number,
	to: number,
): ReturnType<typeof syntheticTrack> {
	return {
		timestamps: track.timestamps.slice(from, to),
		velocity: track.velocity.slice(from, to),
		airSpeed: track.airSpeed.slice(from, to),
		positionLat: track.positionLat.slice(from, to),
		positionLong: track.positionLong.slice(from, to),
	};
}

describe("circuitWindows", () => {
	it("keeps complete oval circuits and closes them on the start ray", () => {
		const result = windowsOf(syntheticTrack({ circuits: 6.5 }));
		expect(result.circuits).toBe(6);
		expect(result.windows).toHaveLength(1);
		expect(result.windows[0].closureMeters).toBeLessThan(1);
	});

	it("counts circuits ridden the other way round", () => {
		expect(
			windowsOf(syntheticTrack({ circuits: 6.5, reverse: true })).circuits,
		).toBe(6);
	});

	it("R3: refuses an expanding spiral as not closed", () => {
		const result = windowsOf(
			syntheticTrack({ shape: "spiral", circuits: 7.2, growthMeters: 5 }),
		);
		expect(result).toMatchObject({ circuits: 0, refusal: "notClosed" });
	});

	it("R3: refuses a figure-eight as a reversal", () => {
		const result = windowsOf(
			syntheticTrack({ shape: "figureEight", circuits: 3 }),
		);
		expect(result).toMatchObject({ circuits: 0, refusal: "reversal" });
	});

	it("splits runs at a gap and never bridges it", () => {
		const track = syntheticTrack({
			circuits: 7,
			dt: (i) => (i === 180 ? 60 : 1),
		});
		const result = windowsOf(track);
		expect(result.windows.length).toBe(2);
		expect(result.windows[0].endIdx).toBeLessThanOrEqual(180);
		expect(result.windows[1].startIdx).toBe(181);
	});

	it("R6: a (0, 0) fix per circuit neither splits a run nor moves the window", () => {
		const clean = windowsOf(syntheticTrack({ circuits: 6.5 }));
		const dropped = windowsOf(
			syntheticTrack({ circuits: 6.5, zeroFixAt: (i) => i % 34 === 17 }),
		);
		expect(dropped.circuits).toBe(clean.circuits);
		expect(dropped.windows[0].startIdx).toBe(clean.windows[0].startIdx);
	});

	it("R7: splits a run at a non-increasing timestamp", () => {
		const track = syntheticTrack({ circuits: 7 });
		track.timestamps[200] = track.timestamps[199];
		expect(windowsOf(track).windows.length).toBe(2);
	});

	it("reports noWholeCircuit for an open arc", () => {
		expect(windowsOf(syntheticTrack({ circuits: 0.8 }))).toMatchObject({
			circuits: 0,
			refusal: "noWholeCircuit",
		});
	});

	it("counts a lap that closes on its start but samples a few degrees short", () => {
		const result = windowsOf(syntheticTrack({ circuits: 1 }));
		expect(result.circuits).toBe(1);
		expect(result.refusal).toBeUndefined();
		expect(result.windows[0].closureMeters).toBeLessThan(15);
	});

	it("a four-sample eligibility hole splits nothing, and stays out of the mask", () => {
		const result = windowsOf(
			syntheticTrack({ circuits: 1 }),
			(i) => i < 20 || i >= 24,
		);
		expect(result.circuits).toBe(1);
		expect(result.refusal).toBeUndefined();
		expect(result.mask.slice(20, 24)).toEqual([false, false, false, false]);
		expect(result.mask[19]).toBe(true);
		expect(result.mask[24]).toBe(true);
	});

	it("does not lose the last circuit of a whole-number multi-lap selection", () => {
		expect(windowsOf(syntheticTrack({ circuits: 7 })).circuits).toBe(7);
	});

	it("still refuses a lap whose endpoint never returns to its start", () => {
		expect(windowsOf(syntheticTrack({ circuits: 0.95 }))).toMatchObject({
			circuits: 0,
			refusal: "noWholeCircuit",
		});
	});

	it("counts a small, fast circuit where one sample is 15 m of travel", () => {
		const track = syntheticTrack({
			circuits: 1,
			straightMeters: 44,
			radiusMeters: 25,
			speed: () => 15,
		});
		expect(windowsOf(track)).toMatchObject({ circuits: 1 });
	});

	it("counts one turn for a lap that oversweeps and ends on its own start", () => {
		// F66-01: sweep 365.41 deg, 5.41 deg past a whole turn, ending 8.67 m from
		// the start. Crediting the turn ABOVE the sweep measures closure at the
		// run's own endpoint, which every closed lap passes, so the count has to
		// be the NEAREST whole turn, not the one above.
		const result = windowsOf(syntheticTrack({ circuits: 1.02 }));
		expect(result.circuits).toBe(1);
		expect(result.windows).toHaveLength(1);
		expect(result.windows[0].closureMeters).toBeLessThan(1);
	});

	it("counts a lap whose window ends where the azimuth turns fastest", () => {
		// F65-01: a window cut from a longer ride, starting mid-straight — the
		// point of this oval closest to its own bounding-box centre, where the
		// azimuth rate is 2.2x the median step. It ends 11.3 m short of its own
		// start, which is 15.8 deg of azimuth against a median step of 6.34 deg,
		// so the median tolerance under-covers it by 2.5x and the closure check
		// does not.
		const result = windowsOf(
			sliceTrack(syntheticTrack({ circuits: 3 }), 5, 50),
		);
		expect(result.circuits).toBe(1);
		expect(result.refusal).toBeUndefined();
		expect(result.windows[0].closureMeters).toBeGreaterThan(10);
		expect(result.windows[0].closureMeters).toBeLessThan(15);
	});
});

describe("gustIndex", () => {
	function fittedResiduals(gust: (i: number) => number) {
		const ride = sweep({ scale: 1.08 });
		ride.va = ride.va.map((va, i) => va + gust(i) / 1.08);
		const fit = ok(fitSharedScale([segmentOf(ride)]));
		return {
			residuals: fit.residuals[0],
			airSpeed: ride.va,
			timestamps: ride.timestamps,
		};
	}

	it("is zero in steady wind", () => {
		const { residuals, airSpeed, timestamps } = fittedResiduals(() => 0);
		const result = gustIndex(residuals, airSpeed, timestamps);
		expect(result.available && result.value).toBeLessThan(1e-9);
	});

	it("stays low for 1 s alternating noise", () => {
		const { residuals, airSpeed, timestamps } = fittedResiduals((i) =>
			i % 2 === 0 ? 0.5 : -0.5,
		);
		const result = gustIndex(residuals, airSpeed, timestamps);
		expect(result.available && result.value).toBeLessThan(0.01);
	});

	it("crosses 0.04 for a 40 s gust of 1.2 m/s", () => {
		const { residuals, airSpeed, timestamps } = fittedResiduals(
			(i) => 1.2 * Math.sin((2 * Math.PI * i) / 40),
		);
		const result = gustIndex(residuals, airSpeed, timestamps);
		expect(result.available && result.value).toBeGreaterThan(0.04);
	});

	it("R7: is unavailable, not zero, for repeated or non-finite timestamps", () => {
		const { residuals, airSpeed } = fittedResiduals(
			(i) => 1.2 * Math.sin((2 * Math.PI * i) / 40),
		);
		expect(
			gustIndex(
				residuals,
				airSpeed,
				residuals.map(() => 0),
			),
		).toEqual({ available: false });
		const withNaN = residuals.map((_, i) => (i === 50 ? NaN : i));
		expect(gustIndex(residuals, airSpeed, withNaN)).toEqual({
			available: false,
		});
	});

	it("R7: does not smooth across a gap", () => {
		const residuals = [...new Array(60).fill(1), ...new Array(60).fill(-1)];
		const airSpeed = residuals.map(() => 10);
		const timestamps = [
			...Array.from({ length: 60 }, (_, i) => i),
			...Array.from({ length: 60 }, (_, i) => 120 + i),
		];
		const result = gustIndex(residuals, airSpeed, timestamps);
		expect(result.available && result.value * 10).toBeCloseTo(1, 12);
	});
});
