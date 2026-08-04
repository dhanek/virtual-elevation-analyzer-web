/**
 * Regression coverage for the tiny compare-plot defect.
 *
 * `.ve-plot-container` is `flex: 1` inside a `display: block` tab pane with no
 * height, so a responsive Plotly figure with no `layout.height` sizes itself
 * from a content-driven container and collapses to near-zero. The non-compare
 * builder never hit this because it pins `height` (350 / 200) and `margin`; the
 * comparison builder set neither and used a bare `{ responsive: true }` config.
 * See deferred-items.md "maintainer defect 3, second half".
 *
 * This asserts the two builders agree on sizing, so the compare figures cannot
 * drift back to unsized without a test failing.
 */
import { describe, expect, it } from "vitest";
import {
	buildVirtualElevationFigures,
	buildVirtualElevationComparisonFigures,
	getDefaultPlotConfig,
} from "./StandardPlotBuilders";
import { createPlotContext } from "./PlotContext";

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

const standard = buildVirtualElevationFigures({
	context,
	virtualElevation: series(1.1),
	actualElevation: series(1),
	cdaLabel: "0.250",
	crrLabel: "0.0040",
});

describe("virtual elevation comparison figure sizing", () => {
	it.each(["elevation", "residuals"] as const)(
		"%s pins an explicit height so a flex container cannot collapse it",
		(figure) => {
			const height = comparison[figure].layout.height;
			expect(typeof height).toBe("number");
			expect(height as number).toBeGreaterThan(0);
		},
	);

	it.each(["elevation", "residuals"] as const)(
		"%s matches the non-compare builder's height",
		(figure) => {
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

	it.each(["elevation", "residuals"] as const)(
		"%s uses the shared plot config, not a bare responsive flag",
		(figure) => {
			expect(comparison[figure].config).toEqual(getDefaultPlotConfig());
		},
	);
});
