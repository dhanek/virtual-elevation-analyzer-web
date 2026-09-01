/**
 * The verdict both ridge tracers share. What matters here is the rule the two
 * of them used to apply differently: the columns whose Crr sits on a bound are
 * excluded, so the steep climb of the box cannot pass for curvature of the
 * valley.
 */
import { describe, expect, test } from "vitest";
import {
	judgeRidge,
	MIN_ON_RIDGE_COLUMNS,
	RIDGE_FLATNESS_FLOOR_M,
	type RidgeColumn,
} from "./ClosureRidge";

const onRidge = (errors: number[]): RidgeColumn[] =>
	errors.map((error) => ({ error, onRidge: true }));

/** A flat valley floor, plus the steep walls where the ridge left the box. */
const flatFloorInsideSteepWalls: RidgeColumn[] = [
	{ error: 40, onRidge: false },
	{ error: 20, onRidge: false },
	...onRidge([1.0, 1.05, 1.0, 1.02, 1.0, 1.01]),
	{ error: 25, onRidge: false },
	{ error: 60, onRidge: false },
];

describe("judgeRidge", () => {
	test("a curved ridge names its argmin", () => {
		const verdict = judgeRidge(onRidge([5, 3, 1, 2, 4, 6]));
		expect(verdict.status).toBe("ok");
		expect(verdict.bestIndex).toBe(2);
	});

	test("a flat ridge is refused", () => {
		const verdict = judgeRidge(onRidge([1, 1.1, 1.05, 1.2, 1.0, 1.15]));
		expect(verdict.status).toBe("underdetermined");
		expect(verdict.reason).toMatch(/ridge is flat/);
	});

	/**
	 * THE FINDING, in one case. Measured over every column the spread here is
	 * 59 m and the ridge looks emphatically determined; measured over the
	 * columns that are actually on it, 0.05 m — flat, and refused. The rise
	 * belongs to the CdA/Crr box, not to the data.
	 */
	test("the clamped columns do not count towards the spread", () => {
		expect(judgeRidge(flatFloorInsideSteepWalls).status).toBe(
			"underdetermined",
		);
		expect(judgeRidge(flatFloorInsideSteepWalls).reason).toMatch(
			/ridge is flat/,
		);
		// The same errors with nothing clamped: the walls are then real
		// curvature and the same ridge is determined.
		const allCounted = onRidge(
			flatFloorInsideSteepWalls.map((column) => column.error),
		);
		expect(judgeRidge(allCounted).status).toBe("ok");
	});

	test("the argmin ignores clamped columns even when they are lower", () => {
		const verdict = judgeRidge([
			{ error: 0.01, onRidge: false },
			...onRidge([5, 3, 1, 2, 4, 6]),
		]);
		expect(verdict.status).toBe("ok");
		expect(verdict.bestIndex).toBe(3); // the 1, not the clamped 0.01
	});

	test("too few columns left on the ridge is its own refusal", () => {
		const columns: RidgeColumn[] = [
			...onRidge(Array.from({ length: MIN_ON_RIDGE_COLUMNS - 1 }, (_, i) => i)),
			...Array.from({ length: 20 }, (_, i) => ({
				error: 100 + i,
				onRidge: false,
			})),
		];
		const verdict = judgeRidge(columns);
		expect(verdict.status).toBe("underdetermined");
		expect(verdict.reason).toMatch(/outside the CdA\/Crr/);
	});

	test("an empty ridge is refused rather than throwing", () => {
		expect(judgeRidge([]).status).toBe("underdetermined");
	});

	test("the floor is exactly the boundary, and adjustable", () => {
		const atTheFloor = onRidge([1, 1, 1, 1, 1, 1 + RIDGE_FLATNESS_FLOOR_M]);
		expect(judgeRidge(atTheFloor).status).toBe("ok");
		expect(
			judgeRidge(atTheFloor, { ridgeFlatnessFloorM: 1e9 }).status,
		).toBe("underdetermined");
	});
});
