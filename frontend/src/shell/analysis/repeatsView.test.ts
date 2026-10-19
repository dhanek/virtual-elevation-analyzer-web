/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { RepeatLeg } from "../../analysis/RepeatSpread";
import { renderRepeatsView, repeatsTabMarkup } from "./repeatsView";

/** A leg whose VE is linear in (CdA, Crr), fitted exactly by (cda, crr). */
function leg(seed: number, cda: number, crr: number): RepeatLeg {
	const n = 200;
	const a = Float64Array.from(
		{ length: n },
		(_, i) => i * (0.5 + 0.2 * Math.sin((i + seed) / 9)),
	);
	const f = Float64Array.from({ length: n }, (_, i) => i * 9);
	return {
		veProfile: (c, k) =>
			Float64Array.from({ length: n }, (_, i) => -c * a[i] - k * f[i]),
		elevation: Float64Array.from(
			{ length: n },
			(_, i) => -cda * a[i] - crr * f[i] + 0.02 * Math.sin(i + seed),
		),
	};
}

const text = () => document.getElementById("repeats-tab")!.textContent ?? "";

beforeEach(() => {
	document.body.innerHTML = repeatsTabMarkup();
});

describe("renderRepeatsView", () => {
	it("lists every repeat, the SD with n and df, and both pooled error bars", () => {
		renderRepeatsView({
			units: [0.29, 0.3, 0.31].map((cda, j) => ({
				key: `lap-${j + 1}`,
				label: `Lap ${j + 1}`,
				legs: [leg(j, cda, 0.004)],
			})),
			fixedCrr: 0.004,
		});
		const rows = document.querySelectorAll("#repeats-tab tbody tr");
		// Three laps, then mean, SD and n / df.
		expect(rows).toHaveLength(6);
		expect(text()).toContain("Lap 3");
		expect(text()).toContain("CdA @ Crr 0.0040");
		expect(text()).toContain("SD across repeats");
		expect(rows[5].textContent).toContain("3 / 2");
		expect(text()).toContain("naive");
		expect(text()).toContain("clustered over 3 repeats, df 2");
		expect(text()).not.toContain("not estimable");
	});

	it("a single lap says the spread is not estimable, never 0", () => {
		renderRepeatsView({
			units: [{ key: "lap-1", label: "Lap 1", legs: [leg(0, 0.3, 0.004)] }],
			fixedCrr: 0.004,
		});
		const sdRow = [...document.querySelectorAll("#repeats-tab tbody tr")].find(
			(row) => row.textContent?.includes("SD across repeats"),
		)!;
		expect(sdRow.textContent).toContain("not estimable");
		expect(sdRow.textContent).not.toMatch(/0\.0000/);
		expect(text()).toContain("Repeat spread not estimable");
		expect(text()).toContain("clustered SE not estimable");
	});

	it("escapes the repeat label", () => {
		renderRepeatsView({
			units: [{ key: "x", label: "<b>Lap</b>", legs: [leg(0, 0.3, 0.004)] }],
			fixedCrr: 0.004,
		});
		expect(document.querySelector("#repeats-tab b")).toBeNull();
		expect(text()).toContain("<b>Lap</b>");
	});
});
