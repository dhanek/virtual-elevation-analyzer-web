/**
 * Pure geo helpers extracted from `MapVisualization.ts` (plan 05-09, D-14).
 *
 * No DOM or Leaflet imports — everything here is unit-testable in the default
 * node environment (`geo.test.ts`, no jsdom pragma). `degreeToCardinal` moved
 * verbatim from the facade's private method; `collectValidPoints` centralizes
 * the zero/falsy-coordinate guard loop that was repeated 7x across the facade
 * (`lat && lng && lat !== 0 && lng !== 0`).
 */

const CARDINAL_DIRECTIONS = [
	"N",
	"NNE",
	"NE",
	"ENE",
	"E",
	"ESE",
	"SE",
	"SSE",
	"S",
	"SSW",
	"SW",
	"WSW",
	"W",
	"WNW",
	"NW",
	"NNW",
];

/**
 * Convert a wind direction in degrees to a 16-point compass direction.
 * Values round to the nearest 22.5° sector and wrap at 360° (348.75° and
 * above map back to "N" via Math.round half-up).
 */
export function degreeToCardinal(degrees: number): string {
	const index = Math.round((degrees % 360) / 22.5) % 16;
	return CARDINAL_DIRECTIONS[index];
}

/** Valid GPS points with their source indices into the input arrays. */
export interface ValidPoints {
	/** `[lat, lng]` pairs for every valid coordinate in the range. */
	points: [number, number][];
	/** For each point, its index into the source arrays (fitData index). */
	indices: number[];
}

/**
 * Collect valid GPS points from parallel lat/long columns over the inclusive
 * index range `[startIdx, endIdx]`. Entries where either coordinate is falsy
 * (undefined/NaN) or exactly 0 are filtered out. The range is clamped to the
 * bounds of `posLat`, so out-of-range or inverted ranges yield empty results.
 */
export function collectValidPoints(
	posLat: ArrayLike<number>,
	posLong: ArrayLike<number>,
	startIdx: number,
	endIdx: number,
): ValidPoints {
	const points: [number, number][] = [];
	const indices: number[] = [];

	const start = Math.max(0, startIdx);
	const end = Math.min(endIdx, posLat.length - 1);

	for (let i = start; i <= end; i++) {
		const lat = posLat[i];
		const lng = posLong[i];
		if (lat && lng && lat !== 0 && lng !== 0) {
			points.push([lat, lng]);
			indices.push(i);
		}
	}

	return { points, indices };
}
