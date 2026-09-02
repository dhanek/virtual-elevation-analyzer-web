/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { ClosureBand } from "../../analysis/ClosureSurface";
import {
	CONVERGENCE_BAND_ID,
	convergenceBandMarkup,
	formatBandValue,
	renderConvergenceBandReadout,
} from "./convergenceBandReadout";

const band = (overrides: Partial<ClosureBand> = {}): ClosureBand => ({
	best: { cda: 0.312, crr: 0.005, error: 0.12 },
	toleranceM: 0.05,
	threshold: 0.17,
	cdaLow: 0.304,
	cdaHigh: 0.323,
	crrLow: 0.0047,
	crrHigh: 0.0054,
	touchesEdge: false,
	...overrides,
});
const render = (band: ClosureBand | null): void =>
	renderConvergenceBandReadout({ band, toleranceM: 0.05 });

beforeEach(() => {
	document.body.innerHTML = convergenceBandMarkup();
});

describe("renderConvergenceBandReadout", () => {
	it("the markup is an empty container with the owned id", () => {
		const container = document.getElementById(CONVERGENCE_BAND_ID)!;
		expect(container.textContent).toBe("");
	});

	it("writes the best fit with the offsets below and above it, per axis", () => {
		render(band());
		const container = document.getElementById(CONVERGENCE_BAND_ID)!;
		expect(container.textContent).toContain("Within 5 cm of best closure");
		expect(document.getElementById("convergenceBandCda")!.textContent).toBe(
			"0.312 (−0.008 / +0.011) m²",
		);
		expect(document.getElementById("convergenceBandCrr")!.textContent).toBe(
			"0.0050 (−0.0003 / +0.0004)",
		);
		expect(container.textContent).not.toContain("grid edge");
	});

	it("says when the band reaches the grid edge", () => {
		render(band({ touchesEdge: true }));
		expect(document.getElementById(CONVERGENCE_BAND_ID)!.textContent).toContain(
			"lower bound",
		);
	});

	it("shows n/a for both axes when there is no optimum", () => {
		render(null);
		const container = document.getElementById(CONVERGENCE_BAND_ID)!;
		expect(container.textContent).toContain("Within 5 cm of best closure");
		expect(document.getElementById("convergenceBandCda")!.textContent).toBe("n/a");
		expect(document.getElementById("convergenceBandCrr")!.textContent).toBe("n/a");
	});

	it("rewrites rather than appends on a second draw", () => {
		render(band());
		render(null);
		expect(document.querySelectorAll(`#${CONVERGENCE_BAND_ID} > *`)).toHaveLength(1);
	});

	it("is a no-op without the container", () => {
		document.body.innerHTML = "";
		expect(() => render(band())).not.toThrow();
	});
});

describe("formatBandValue", () => {
	it("prints the value then the distance to each bound", () => {
		expect(formatBandValue(0.3, 0.29, 0.32, 3)).toBe("0.300 (−0.010 / +0.020)");
	});
});
