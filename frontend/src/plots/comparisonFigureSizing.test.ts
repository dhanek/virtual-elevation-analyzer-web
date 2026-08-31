/**
 * Regression coverage for the tiny compare-plot defect.
 *
 * THE SYMPTOM WAS REAL; THE DIAGNOSIS WAS WRONG, and this file recorded the
 * wrong one. It said `.ve-plot-container` is `flex: 1` inside a `display: block`
 * pane, so a figure with no `layout.height` collapses. The `flex: 1` was inert
 * -- the pane is never a flex container -- and the actual cause was that the
 * container had NO CSS HEIGHT AT ALL, so a figure without `layout.height` was
 * sized from a box that was itself sized by the plot. The compare builder set
 * no height and collapsed; the non-compare builder pinned 350/200 and did not.
 *
 * Pinning a height was therefore a fix by accident, and it became a defect of
 * its own: `Plots.resize` guards on `layout.width && layout.height`, so a
 * height-only layout gets BOTH deleted and re-autosized into that same
 * height-less box. Measured 350 px -> 26 px.
 *
 * The container now carries the height (`.ve-plot-container__plot--*`) and NO
 * figure carries one, which is the convention the other two modes always had.
 * So what these cases hold is inverted: the two builders must still agree about
 * sizing, and the thing they must agree on is that neither of them sets a
 * height.
 */
import { describe, expect, it } from "vitest";
import {
	buildVirtualElevationFigures,
	buildVirtualElevationComparisonFigures,
	getDefaultPlotConfig,
} from "./StandardPlotBuilders";
import {
	createDistancePlotContext,
	createPlotContext,
	X_AXIS_TITLES,
} from "./PlotContext";

const LENGTH = 20;
const context = createPlotContext(LENGTH, 2, 17);

function series(scale: number): number[] {
	return Array.from({ length: LENGTH }, (_, i) => i * scale);
}

const comparison = buildVirtualElevationComparisonFigures({
	context,
	virtualElevationFit: series(1.1),
	virtualElevationConstant: series(0.9),
	actualElevation: series(1),
});

const distanceComparison = buildVirtualElevationComparisonFigures({
	context: createDistancePlotContext(
		Array.from({ length: LENGTH }, (_, i) => i * 2),
		2,
		17,
	),
	virtualElevationFit: series(1.1),
	virtualElevationConstant: series(0.9),
	actualElevation: series(1),
});

const standard = buildVirtualElevationFigures({
	context,
	virtualElevation: series(1.1),
	actualElevation: series(1),
	cdaLabel: "0.250",
	crrLabel: "0.0040",
});

/**
 * The x-axis title out of a layout. `PlotLayout` is `Record<string, unknown>`
 * (`StandardPlotBuilders.ts:56`), so the nested read has to be narrowed here
 * rather than at every call.
 */
function xAxisTitle(figure: { layout: Record<string, unknown> }): unknown {
	return (figure.layout.xaxis as { title?: unknown } | undefined)?.title;
}

describe("virtual elevation comparison figure sizing", () => {
	it.each(["elevation", "residuals"] as const)(
		"%s sets NO height, leaving the size to the container's CSS",
		(figure) => {
			// A height here is not merely redundant, it is destructive:
			// `Plots.resize` deletes a height-only layout and re-autosizes, and
			// the tab layer calls it whenever a hidden pane becomes visible.
			expect(comparison[figure].layout.height).toBeUndefined();
			expect(standard[figure].layout.height).toBeUndefined();
		},
	);

	it.each(["elevation", "residuals"] as const)(
		"%s agrees with the non-compare builder about height",
		(figure) => {
			// The property the original defect was about, and it survives the
			// correction: the two builders must not diverge on sizing. They now
			// agree by both saying nothing.
			expect(comparison[figure].layout.height).toBe(
				standard[figure].layout.height,
			);
		},
	);

	it.each(["elevation", "residuals"] as const)(
		"%s matches the non-compare builder's margins",
		(figure) => {
			expect(comparison[figure].layout.margin).toEqual(
				standard[figure].layout.margin,
			);
		},
	);

	/**
	 * The compare builder was the one builder left hardcoding `'Time Point'`
	 * after every other layout in `StandardPlotBuilders` moved to
	 * `context.xAxisTitle`, and `drawVe` routes here whenever the wind source is
	 * *compare*. So flipping the x-axis toggle to Distance put kilometres under
	 * an axis that said time — and even in time mode the label disagreed with
	 * the `'Time (seconds)'` every other plot on the page was showing.
	 */
	it.each(["elevation", "residuals"] as const)(
		"%s labels its x axis exactly as the non-compare builder does",
		(figure) => {
			// Both builders draw into the SAME stacked pair, `#vePlot` above
			// `#veResidualsPlot` (`bindStandardSliders.ts:184`), so they must
			// agree here or flipping the wind source to *compare* relabels the
			// axis under the user.
			expect(xAxisTitle(comparison[figure])).toBe(
				xAxisTitle(standard[figure]),
			);
		},
	);

	it("puts the shared axis title on the residuals plot, not the elevation plot", () => {
		// The stacked convention (`renderStandardVe.ts:532`): the upper plot has
		// `b: 5` and no room for a label, the lower one carries it for both.
		expect(xAxisTitle(comparison.elevation)).toBe("");
		expect(xAxisTitle(comparison.residuals)).toBe(X_AXIS_TITLES.time);
	});

	it("follows the x-axis toggle into distance mode", () => {
		// The defect: this builder was the last one hardcoding `'Time Point'`,
		// so *compare* + Distance drew kilometres under an axis claiming time —
		// and in time mode it disagreed with every other plot on the page, which
		// say `'Time (seconds)'`.
		expect(xAxisTitle(distanceComparison.residuals)).toBe(
			X_AXIS_TITLES.distance,
		);
		expect(xAxisTitle(distanceComparison.elevation)).toBe("");
	});

	it.each(["elevation", "residuals"] as const)(
		"%s uses the shared plot config, not a bare responsive flag",
		(figure) => {
			expect(comparison[figure].config).toEqual(getDefaultPlotConfig());
		},
	);
});
