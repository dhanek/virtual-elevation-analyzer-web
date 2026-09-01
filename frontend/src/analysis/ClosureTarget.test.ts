import { describe, expect, test } from "vitest";
import {
	ELEVATION_DIFF_SOURCES,
	hasUsableAltitude,
	isClosureTargetPinned,
	resolveClosureSelection,
	resolveClosureTarget,
	toElevationDiffSource,
} from "./ClosureTarget";

const ramp = (length: number, start = 100, perStep = 0.5): number[] =>
	Array.from({ length }, (_, i) => start + i * perStep);

describe("toElevationDiffSource", () => {
	test("accepts exactly the known sources", () => {
		for (const source of ELEVATION_DIFF_SOURCES) {
			expect(toElevationDiffSource(source)).toBe(source);
		}
	});

	test("returns null rather than casting an unknown value", () => {
		expect(toElevationDiffSource("astm")).toBeNull();
		expect(toElevationDiffSource("")).toBeNull();
		expect(toElevationDiffSource("DEM")).toBeNull();
	});
});

describe("hasUsableAltitude", () => {
	test("empty, all-NaN and all-zero channels are unusable", () => {
		expect(hasUsableAltitude([])).toBe(false);
		expect(hasUsableAltitude([Number.NaN, Number.NaN])).toBe(false);
		expect(hasUsableAltitude([0, 0, 0])).toBe(false);
	});

	test("a channel with any real non-zero value is usable", () => {
		expect(hasUsableAltitude([0, 0, 1])).toBe(true);
		expect(hasUsableAltitude([Number.NaN, 3])).toBe(true);
	});
});

describe("resolveClosureTarget (dem, no DEM channel — the phase-1 anchor)", () => {
	test("is the altitude difference over the trim window", () => {
		const altitude = ramp(100);
		const target = resolveClosureTarget({
			source: "dem",
			altitude,
			velodrome: false,
			trimStart: 10,
			trimEnd: 60,
		});
		expect(target).toBeCloseTo(altitude[60] - altitude[10], 12);
	});

	test("clamps the window to the profile like the metrics do", () => {
		const altitude = ramp(50);
		const target = resolveClosureTarget({
			source: "dem",
			altitude,
			velodrome: false,
			trimStart: 0,
			trimEnd: 500,
		});
		expect(target).toBeCloseTo(altitude[49] - altitude[0], 12);
	});

	test("velodrome zeroes the target regardless of altitude", () => {
		expect(
			resolveClosureTarget({
				source: "dem",
				altitude: ramp(100),
				velodrome: true,
				trimStart: 0,
				trimEnd: 99,
			}),
		).toBe(0);
	});

	test("an unusable altitude channel zeroes the target", () => {
		for (const altitude of [[], [0, 0, 0, 0], [Number.NaN, Number.NaN, Number.NaN]]) {
			expect(
				resolveClosureTarget({
					source: "dem",
					altitude,
					velodrome: false,
					trimStart: 0,
					trimEnd: 2,
				}),
			).toBe(0);
		}
	});

	test("a window the metrics reject reports 0, matching their zeros", () => {
		const altitude = ramp(100);
		// Span of one sample: rejected (span must be at least two).
		expect(
			resolveClosureTarget({
				source: "dem",
				altitude,
				velodrome: false,
				trimStart: 5,
				trimEnd: 6,
			}),
		).toBe(0);
		// Fewer than three samples in the whole profile: rejected.
		expect(
			resolveClosureTarget({
				source: "dem",
				altitude: [100, 105],
				velodrome: false,
				trimStart: 0,
				trimEnd: 1,
			}),
		).toBe(0);
		// A span of exactly two is the smallest the metrics accept.
		expect(
			resolveClosureTarget({
				source: "dem",
				altitude,
				velodrome: false,
				trimStart: 5,
				trimEnd: 7,
			}),
		).toBeCloseTo(altitude[7] - altitude[5], 12);
	});
});

describe("resolveClosureTarget (dem, with a DEM channel)", () => {
	test("prefers the DEM channel over the resolved profile", () => {
		const altitude = ramp(100, 100, 0.5);
		const dem = ramp(100, 200, 1.0);
		const target = resolveClosureTarget({
			source: "dem",
			altitude,
			demAltitude: dem,
			velodrome: false,
			trimStart: 10,
			trimEnd: 60,
		});
		expect(target).toBeCloseTo(dem[60] - dem[10], 12);
	});

	test("a null DEM channel falls back to the resolved profile", () => {
		const altitude = ramp(100);
		const target = resolveClosureTarget({
			source: "dem",
			altitude,
			demAltitude: null,
			velodrome: false,
			trimStart: 10,
			trimEnd: 60,
		});
		expect(target).toBeCloseTo(altitude[60] - altitude[10], 12);
	});
});

describe("resolveClosureTarget (barometer)", () => {
	test("reads the raw barometric channel, not the resolved profile", () => {
		const altitude = ramp(100, 100, 0.5);
		const baro = ramp(100, 300, 2.0);
		const target = resolveClosureTarget({
			source: "barometer",
			altitude,
			barometricAltitude: baro,
			velodrome: false,
			trimStart: 10,
			trimEnd: 60,
		});
		expect(target).toBeCloseTo(baro[60] - baro[10], 12);
	});

	test("shares the velodrome and usability zeros with dem", () => {
		expect(
			resolveClosureTarget({
				source: "barometer",
				altitude: ramp(100),
				barometricAltitude: ramp(100),
				velodrome: true,
				trimStart: 0,
				trimEnd: 99,
			}),
		).toBe(0);
		expect(
			resolveClosureTarget({
				source: "barometer",
				altitude: ramp(100),
				barometricAltitude: [0, 0, 0, 0],
				velodrome: false,
				trimStart: 0,
				trimEnd: 3,
			}),
		).toBe(0);
	});

	test("falls back to the resolved profile when no raw channel is passed", () => {
		const altitude = ramp(100);
		expect(
			resolveClosureTarget({
				source: "barometer",
				altitude,
				velodrome: false,
				trimStart: 10,
				trimEnd: 60,
			}),
		).toBeCloseTo(altitude[60] - altitude[10], 12);
	});
});

describe("resolveClosureTarget (manual)", () => {
	test("is the entered value, verbatim", () => {
		expect(
			resolveClosureTarget({
				source: "manual",
				altitude: ramp(100),
				manualDiffMetres: -12.5,
				velodrome: false,
				trimStart: 0,
				trimEnd: 99,
			}),
		).toBe(-12.5);
	});

	test("neither the velodrome flag nor channel usability overrides it", () => {
		// The user asserted the number; an all-zero channel or velodrome mode
		// says nothing about whether they are right.
		expect(
			resolveClosureTarget({
				source: "manual",
				altitude: [0, 0, 0],
				manualDiffMetres: 7,
				velodrome: true,
				trimStart: 0,
				trimEnd: 2,
			}),
		).toBe(7);
	});

	test("unset or non-finite means 0", () => {
		for (const manual of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(
				resolveClosureTarget({
					source: "manual",
					altitude: ramp(100),
					manualDiffMetres: manual as number | null,
					velodrome: false,
					trimStart: 0,
					trimEnd: 99,
				}),
			).toBe(0);
		}
	});
});

describe("resolveClosureTarget (manual, out-and-back legs)", () => {
	const manualLeg = (legDirection?: "outbound" | "inbound") =>
		resolveClosureTarget({
			source: "manual",
			altitude: ramp(100),
			manualDiffMetres: 4.2,
			legDirection,
			velodrome: false,
			trimStart: 0,
			trimEnd: 99,
		});

	test("the outbound leg takes the number as typed", () => {
		expect(manualLeg("outbound")).toBe(4.2);
	});

	test("the inbound leg negates it — one number describes both legs", () => {
		expect(manualLeg("inbound")).toBe(-4.2);
	});

	test("the two legs of a section are equal and opposite", () => {
		expect(manualLeg("outbound")).toBe(-manualLeg("inbound"));
	});

	test("an absent direction is unchanged, so the lap modes cannot move", () => {
		expect(manualLeg(undefined)).toBe(4.2);
	});

	test("a 0 difference stays +0 inbound rather than -0", () => {
		expect(
			Object.is(
				resolveClosureTarget({
					source: "manual",
					altitude: ramp(100),
					manualDiffMetres: 0,
					legDirection: "inbound",
					velodrome: false,
					trimStart: 0,
					trimEnd: 99,
				}),
				0,
			),
		).toBe(true);
	});

	test("the channel sources ignore the leg — they already differ by window", () => {
		// The inbound leg's own window supplies the opposite sign; negating on
		// top of that would cancel the very effect it is there to produce.
		for (const source of ["dem", "barometer"] as const) {
			const args = {
				source,
				altitude: ramp(100),
				manualDiffMetres: 4.2,
				velodrome: false,
				trimStart: 10,
				trimEnd: 60,
			};
			expect(resolveClosureTarget({ ...args, legDirection: "inbound" })).toBe(
				resolveClosureTarget({ ...args, legDirection: "outbound" }),
			);
		}
	});
});

describe("resolveClosureSelection", () => {
	test("GPS-lap mode is pinned to manual 0 regardless of the persisted choice", () => {
		expect(isClosureTargetPinned("gpsLap")).toBe(true);
		expect(
			resolveClosureSelection("gpsLap", {
				elevation_diff_source: "barometer",
				manual_elevation_diff_m: 4.2,
			}),
		).toEqual({ source: "manual", manualDiffMetres: 0 });
	});

	test("the other modes read the persisted choice, validated not cast", () => {
		for (const mode of ["standard", "outAndBack", undefined] as const) {
			expect(isClosureTargetPinned(mode)).toBe(false);
			expect(
				resolveClosureSelection(mode, {
					elevation_diff_source: "barometer",
					manual_elevation_diff_m: 4.2,
				}),
			).toEqual({ source: "barometer", manualDiffMetres: 4.2 });
			expect(resolveClosureSelection(mode, {})).toEqual({
				source: "dem",
				manualDiffMetres: null,
			});
			expect(
				resolveClosureSelection(mode, { elevation_diff_source: "bogus" }),
			).toEqual({ source: "dem", manualDiffMetres: null });
		}
	});

	test("a pinned selection resolves to a 0 target through resolveClosureTarget", () => {
		const selection = resolveClosureSelection("gpsLap", {
			elevation_diff_source: "dem",
		});
		expect(
			resolveClosureTarget({
				...selection,
				altitude: ramp(20),
				velodrome: false,
				trimStart: 0,
				trimEnd: 19,
			}),
		).toBe(0);
	});
});
