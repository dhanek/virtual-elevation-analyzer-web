import { headingFromGps } from "../HeadingCalibration";

/**
 * Synthetic tracks generated from GEOMETRY (arc length), not from the heading
 * code under test (review, Task 6 note).
 *
 * Air speed is derived from the GPS heading of the generated positions, so a
 * fit on them is exact and the tests isolate gating, pooling and windowing.
 * Positions are metres about (52.53, 13.45).
 */
export interface TrackOptions {
	shape?: "oval" | "spiral" | "figureEight";
	circuits: number;
	straightMeters?: number;
	radiusMeters?: number;
	/** Spiral only: radius growth per circuit. */
	growthMeters?: number;
	reverse?: boolean;
	/** Pace as a function of position around the lap (0–1) and sample index. */
	speed?: (lapFraction: number, i: number) => number;
	wind?: (i: number) => { speed: number; from: number };
	scale?: number;
	gust?: (i: number) => number;
	/** Seconds per step. */
	dt?: (i: number) => number;
	/** Air speed reported this many samples LATE (the ACE behaviour; app offset +d corrects it). */
	delaySamples?: number;
	/** After generation, overwrite these indices with the parser's (0, 0) sentinel. */
	zeroFixAt?: (i: number) => boolean;
}

export interface SyntheticTrack {
	timestamps: number[];
	velocity: number[];
	airSpeed: number[];
	positionLat: number[];
	positionLong: number[];
}

const CENTER_LAT = 52.53;
const CENTER_LON = 13.45;
const M_PER_DEG_LAT = 111_194.93;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((CENTER_LAT * Math.PI) / 180);

function ovalPoint(
	s: number,
	straight: number,
	radius: number,
): [number, number] {
	const perimeter = 2 * straight + 2 * Math.PI * radius;
	const u = ((s % perimeter) + perimeter) % perimeter;
	if (u < straight) return [radius, -straight / 2 + u];
	if (u < straight + Math.PI * radius) {
		const a = (u - straight) / radius;
		return [radius * Math.cos(a), straight / 2 + radius * Math.sin(a)];
	}
	if (u < 2 * straight + Math.PI * radius) {
		return [-radius, straight / 2 - (u - straight - Math.PI * radius)];
	}
	const a = (u - 2 * straight - Math.PI * radius) / radius;
	return [-radius * Math.cos(a), -straight / 2 - radius * Math.sin(a)];
}

export function syntheticTrack(options: TrackOptions): SyntheticTrack {
	const shape = options.shape ?? "oval";
	const straight = options.straightMeters ?? 100;
	const radius = options.radiusMeters ?? 40;
	const perimeter =
		shape === "oval"
			? 2 * straight + 2 * Math.PI * radius
			: 2 * Math.PI * radius * (shape === "figureEight" ? 2 : 1);
	const speedAt = options.speed ?? (() => 10);
	const dtAt = options.dt ?? (() => 1);

	const x: number[] = [];
	const y: number[] = [];
	const velocity: number[] = [];
	const timestamps: number[] = [];
	let s = 0;
	let t = 0;
	for (let i = 0; s < options.circuits * perimeter; i++) {
		const lapFraction = (s % perimeter) / perimeter;
		const along = options.reverse ? options.circuits * perimeter - s : s;
		let point: [number, number];
		if (shape === "oval") {
			point = ovalPoint(along, straight, radius);
		} else if (shape === "spiral") {
			const r = radius + (options.growthMeters ?? 0) * (along / perimeter);
			const a = along / radius;
			point = [r * Math.cos(a), r * Math.sin(a)];
		} else {
			const lap = Math.floor(along / (2 * Math.PI * radius));
			const a = along / radius;
			point =
				lap % 2 === 0
					? [radius - radius * Math.cos(a), radius * Math.sin(a)]
					: [-radius + radius * Math.cos(a), radius * Math.sin(a)];
		}
		const v = speedAt(lapFraction, i);
		x.push(point[0]);
		y.push(point[1]);
		velocity.push(v);
		timestamps.push(t);
		const dt = dtAt(i);
		s += v * dt;
		t += dt;
	}

	const positionLat = y.map((north) => CENTER_LAT + north / M_PER_DEG_LAT);
	const positionLong = x.map((east) => CENTER_LON + east / M_PER_DEG_LON);
	const heading = headingFromGps(positionLat, positionLong, timestamps);
	const windAt = options.wind ?? (() => ({ speed: 2, from: 247 }));
	const scale = options.scale ?? 1;
	const gustAt = options.gust ?? (() => 0);

	const measured = velocity.map((v, i) => {
		const w = windAt(i);
		const theta = (heading[i] * Math.PI) / 180;
		return (
			(v + w.speed * Math.cos(theta - (w.from * Math.PI) / 180) + gustAt(i)) /
			scale
		);
	});
	const delay = options.delaySamples ?? 0;
	const airSpeed = measured.map((_, i) =>
		i - delay >= 0 ? measured[i - delay] : NaN,
	);

	if (options.zeroFixAt) {
		for (let i = 0; i < positionLat.length; i++) {
			if (options.zeroFixAt(i)) {
				positionLat[i] = 0;
				positionLong[i] = 0;
			}
		}
	}
	return { timestamps, velocity, airSpeed, positionLat, positionLong };
}
