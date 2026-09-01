/**
 * @vitest-environment jsdom
 *
 * THE SURFACE CACHE'S ONE JOB: a CdA/Crr drag must not recompute the
 * closure-error grid — the signatures exclude the slider values, so a pass
 * with unchanged physics redraws the marker from the cached surface — while
 * any change that IS physics (a trim move, a wind change, anything that
 * alters `gainsSignature`) must recompute. Since phase 2 the cache has two
 * levels: a closure-TARGET change (the elevation-difference radio) alters
 * only the pooled-surface `signature`, so it re-pools the cached grids
 * without recomputing any of them. Invalidate too eagerly and every drag
 * frame pays ~70 ms of grid; too lazily and the map silently describes a
 * fit the user has already changed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./plotlyLoader", () => ({
	waitForPlotly: () => Promise.resolve(plotlySpy),
}));
vi.mock("./requestModeUpdate", () => ({
	requestModeUpdate: vi.fn(),
}));

import type { ConvergenceUpdateInput } from "../../modes/analysis/types";
import { DEFAULT_GRID_STEPS } from "../../analysis/ClosureSurface";
import {
	renderConvergenceView,
	resetConvergenceSurfaceCache,
} from "./convergenceView";

const plotlySpy = {
	react: vi.fn(() => Promise.resolve()),
};

/** Two synthetic segments whose grid calls are observable. */
function makeInput(overrides: Partial<ConvergenceUpdateInput> = {}): {
	input: ConvergenceUpdateInput;
	gridCalls: () => number;
} {
	let gridCalls = 0;
	const veGainGrid = (
		cdaMin: number,
		cdaMax: number,
		cdaSteps: number,
		crrMin: number,
		crrMax: number,
		crrSteps: number,
	): Float64Array => {
		gridCalls++;
		const gains = new Float64Array(cdaSteps * crrSteps);
		for (let i = 0; i < cdaSteps; i++) {
			const cda = cdaMin + (i * (cdaMax - cdaMin)) / (cdaSteps - 1);
			for (let j = 0; j < crrSteps; j++) {
				const crr = crrMin + (j * (crrMax - crrMin)) / (crrSteps - 1);
				gains[i * crrSteps + j] = -40 * (cda - 0.3) - 2000 * (crr - 0.005);
			}
		}
		return gains;
	};

	const input: ConvergenceUpdateInput = {
		segments: [
			{ key: "s1", veGainGrid, windowSamples: 500, closureTarget: 0 },
			{ key: "s2", veGainGrid, windowSamples: 500, closureTarget: 0 },
		],
		cda: 0.3,
		crr: 0.005,
		cdaMin: 0.15,
		cdaMax: 0.5,
		crrMin: 0.0015,
		crrMax: 0.03,
		crrScale: 1,
		signature: "sig-A",
		gainsSignature: "gains-A",
		targetSource: "dem",
		targetLabel: "DEM",
		...overrides,
	};
	return { input, gridCalls: () => gridCalls };
}

beforeEach(() => {
	resetConvergenceSurfaceCache();
	plotlySpy.react.mockClear();
	document.body.innerHTML = `<div id="convergencePlot"></div>`;
});

describe("the convergence surface cache", () => {
	it("computes the grid once and redraws the marker from cache on a drag", async () => {
		const first = makeInput();
		await renderConvergenceView(first.input);
		expect(first.gridCalls()).toBe(2); // one per segment

		// A CdA drag: same signature, different marker.
		const drag = makeInput({ cda: 0.32, crr: 0.006 });
		await renderConvergenceView(drag.input);
		expect(drag.gridCalls()).toBe(0);

		// Both passes drew, and the second carries the new marker.
		expect(plotlySpy.react).toHaveBeenCalledTimes(2);
		const secondFigure = plotlySpy.react.mock.calls[1] as unknown[];
		const traces = secondFigure[1] as Array<{ name?: string; x?: number[] }>;
		const marker = traces.find((trace) => trace.name === "Current");
		expect(marker?.x).toEqual([0.32]);
	});

	it("recomputes when the gains signature changes (a trim or physics move)", async () => {
		const first = makeInput();
		await renderConvergenceView(first.input);

		// Production embeds the gains signature in the pooled one, so a
		// physics move always changes both.
		const trimmed = makeInput({
			gainsSignature: "gains-B",
			signature: "sig-B",
		});
		await renderConvergenceView(trimmed.input);
		expect(trimmed.gridCalls()).toBe(2);
	});

	it("re-pools without recomputing when only the closure targets change", async () => {
		// The elevation-difference radio (phase 2): same physics, new targets.
		const first = makeInput();
		await renderConvergenceView(first.input);

		const retargeted = makeInput({ signature: "sig-A-manual" });
		retargeted.input.segments = retargeted.input.segments.map((segment) => ({
			...segment,
			closureTarget: 5,
		}));
		await renderConvergenceView(retargeted.input);

		// No grid was recomputed…
		expect(retargeted.gridCalls()).toBe(0);
		// …but the drawn surface is the NEW pooling, not the cached one.
		const zOf = (call: number) => {
			const traces = (plotlySpy.react.mock.calls[call] as unknown[])[1] as Array<{
				type?: string;
				z?: number[][];
			}>;
			return traces.find((trace) => trace.type === "contour")?.z;
		};
		expect(zOf(1)).not.toEqual(zOf(0));
	});

	it("evaluates the grid over the Crr axis scaled into applied space", async () => {
		// The temperature correction is a pure scaling of Crr; the surface must
		// be computed at applied values while the axis stays in slider values,
		// so the error shown at (CdA, Crr) is the one the VE tab would report.
		let seenCrrMin = NaN;
		let seenCrrMax = NaN;
		const { input } = makeInput({ crrScale: 1.1 });
		const original = input.segments[0].veGainGrid;
		input.segments = [
			{
				...input.segments[0],
				veGainGrid: (cdaMin, cdaMax, cdaSteps, crrMin, crrMax, crrSteps) => {
					seenCrrMin = crrMin;
					seenCrrMax = crrMax;
					return original(cdaMin, cdaMax, cdaSteps, crrMin, crrMax, crrSteps);
				},
			},
		];
		await renderConvergenceView(input);
		expect(seenCrrMin).toBeCloseTo(0.0015 * 1.1, 12);
		expect(seenCrrMax).toBeCloseTo(0.03 * 1.1, 12);

		const contour = (plotlySpy.react.mock.calls[0] as unknown[])[1] as Array<{
			type?: string;
			y?: number[];
		}>;
		const axis = contour.find((trace) => trace.type === "contour")?.y;
		expect(axis?.[0]).toBeCloseTo(0.0015, 12);
		expect(axis?.[axis.length - 1]).toBeCloseTo(0.03, 12);
	});

	it("uses the default grid resolution under the measured budget", async () => {
		const { input } = makeInput();
		await renderConvergenceView(input);
		const contour = (plotlySpy.react.mock.calls[0] as unknown[])[1] as Array<{
			type?: string;
			x?: number[];
		}>;
		const axis = contour.find((trace) => trace.type === "contour")?.x;
		expect(axis).toHaveLength(DEFAULT_GRID_STEPS);
	});

	it("does nothing without the pane in the DOM", async () => {
		document.body.innerHTML = "";
		const { input, gridCalls } = makeInput();
		await renderConvergenceView(input);
		expect(gridCalls()).toBe(0);
		expect(plotlySpy.react).not.toHaveBeenCalled();
	});
});
