import { describe, expect, it } from "vitest";
import {
	fitSharedScale,
	headingFromGps,
	isValidFix,
	windStationarity,
	type ScaleFitSegment,
} from "./HeadingCalibration";

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
