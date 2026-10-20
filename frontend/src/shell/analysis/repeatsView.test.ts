/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { RepeatLeg } from "../../analysis/RepeatSpread";
import {
	renderRepeatsView,
	repeatsTabMarkup,
	resetTimingRequest,
} from "./repeatsView";

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

const EXTRA = {
	cdaBounds: [0.15, 0.5] as [number, number],
	crrBounds: [0.0015, 0.03] as [number, number],
	sensitivities: [],
};

const text = () => document.getElementById("repeats-tab")!.textContent ?? "";

beforeEach(() => {
	resetTimingRequest();
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
			...EXTRA,
		});
		const [lapTable, pooledTable] =
			document.querySelectorAll("#repeats-tab table");
		const rows = lapTable.querySelectorAll("tbody tr");
		// Three laps, then mean, SD and n / df.
		expect(rows).toHaveLength(6);
		expect(text()).toContain("Lap 3");
		expect(text()).toContain("CdA @ Crr 0.0040");
		expect(rows[4].querySelector("td")!.textContent).toBe("SD");
		expect(rows[5].textContent).toContain("3 / 2");
		// Pooled: free CdA, free Crr, CdA at fixed Crr — each with both SEs
		// and a 95 % range.
		const pooledRows = pooledTable.querySelectorAll("tbody tr");
		expect(pooledRows).toHaveLength(3);
		for (const row of pooledRows) {
			const cells = [...row.querySelectorAll("td")].map((c) => c.textContent);
			expect(cells[2]).toMatch(/^± /);
			expect(cells[3]).toMatch(/^± /);
			expect(cells[5]).toMatch(/ – /);
		}
		expect(text()).toContain("each lap counts once (n 3, df 2)");
		expect(text()).toContain("rough with only 3 laps");
		expect(text()).not.toContain("not estimable");
	});

	it("a single lap says the spread is not estimable, never 0", () => {
		renderRepeatsView({
			units: [{ key: "lap-1", label: "Lap 1", legs: [leg(0, 0.3, 0.004)] }],
			fixedCrr: 0.004,
			...EXTRA,
		});
		const sdRow = [...document.querySelectorAll("#repeats-tab tbody tr")].find(
			(row) => row.querySelector("td")?.textContent === "SD",
		)!;
		expect(sdRow.textContent).toContain("not estimable");
		expect(sdRow.textContent).not.toMatch(/0\.0000/);
		expect(text()).toContain("One lap: no spread to measure");
		expect(text()).toContain("Clustered SE needs 2 or more laps.");
		const pooledRow = document
			.querySelectorAll("#repeats-tab table")[1]
			.querySelector("tbody tr")!;
		expect(pooledRow.textContent).toContain("not estimable");
	});

	it("escapes the repeat label", () => {
		renderRepeatsView({
			units: [{ key: "x", label: "<b>Lap</b>", legs: [leg(0, 0.3, 0.004)] }],
			fixedCrr: 0.004,
			...EXTRA,
		});
		expect(document.querySelector("#repeats-tab b")).toBeNull();
		expect(text()).toContain("<b>Lap</b>");
	});

	it("an unstable repeat is marked and pointed at the fixed-Crr column", () => {
		// A free Crr beyond the Crr bound marks the row.
		renderRepeatsView({
			units: [
				{ key: "lap-1", label: "Lap 1", legs: [leg(0, 0.3, 0.04)] },
				{ key: "lap-2", label: "Lap 2", legs: [leg(1, 0.3, 0.004)] },
			],
			fixedCrr: 0.004,
			...EXTRA,
		});
		const rows = document
			.querySelectorAll("#repeats-tab table")[0]
			.querySelectorAll("tbody tr");
		expect(rows[0].textContent).toContain("⚠");
		expect(text()).toContain("can't separate CdA from Crr");
		expect(text()).toContain("Use its CdA @ Crr");
	});

	it("sensitivities are signed rows, labelled, never combined", () => {
		const units = [0.29, 0.3].map((cda, j) => ({
			key: `lap-${j + 1}`,
			label: `Lap ${j + 1}`,
			legs: [leg(j, cda, 0.004)],
		}));
		renderRepeatsView({
			units,
			fixedCrr: 0.004,
			...EXTRA,
			sensitivities: [{ label: "Unchanged", units }],
		});
		expect(text()).toContain("If an input is off");
		expect(text()).toContain(
			"Sensitivities, not error bars — don't add them up.",
		);
		const sensitivityRow = document
			.querySelectorAll("#repeats-tab table")[2]
			.querySelector("tbody tr")!;
		expect(sensitivityRow.textContent).toContain("Unchanged");
		expect(sensitivityRow.textContent).toContain("0.0000");
		expect(sensitivityRow.textContent).not.toMatch(/[+−]0\.0000/);
	});

	it("the timing check waits for the button, then shows the sweep and says nothing is applied", () => {
		const units = [0.29, 0.3, 0.31].map((cda, j) => ({
			key: `lap-${j + 1}`,
			label: `Lap ${j + 1}`,
			legs: [leg(j, cda, 0.004)],
		}));
		let built = 0;
		const input = {
			units,
			fixedCrr: 0.004,
			...EXTRA,
			timing: () => {
				built++;
				const rows = [-3, -2, -1, 0, 1, 2, 3].map((shift) => ({
					shift,
					units,
				}));
				return {
					power: rows,
					position: rows,
					positionLabel: "Elevation reference",
				};
			},
		};
		renderRepeatsView(input);
		expect(built).toBe(0);
		const button = document.getElementById("repeatsTimingRun")!;
		expect(button.textContent).toBe("Run timing check");
		button.click();
		// The click asks the funnel for a pass; render that pass directly.
		renderRepeatsView(input);
		expect(built).toBe(1);
		expect(text()).toContain("Power: in sync — 0 s scores best.");
		expect(text()).toContain("Reported only — nothing is applied.");
		// The position row is named after what moved, everywhere it appears.
		expect(text()).toContain(
			"— is power or elevation reference out of step with speed?",
		);
		const headers = [
			...document
				.querySelectorAll("#repeats-tab table")[2]
				.querySelectorAll("thead th"),
		].map((th) => th.textContent);
		expect(headers).toContain("Elevation reference: held-out RMS (m)");
		expect(text()).toContain("Elevation reference: in sync — 0 s scores best.");
		expect(text()).not.toContain("GPS");
		// Laps, pooled, timing (no sensitivities passed here).
		expect(document.querySelectorAll("#repeats-tab table")).toHaveLength(3);
	});

	it("keeps GPS in capitals mid-sentence in the timing check title", () => {
		const units = [0.29, 0.3, 0.31].map((cda, j) => ({
			key: `lap-${j + 1}`,
			label: `Lap ${j + 1}`,
			legs: [leg(j, cda, 0.004)],
		}));
		const rows = [-3, -2, -1, 0, 1, 2, 3].map((shift) => ({ shift, units }));
		const input = {
			units,
			fixedCrr: 0.004,
			...EXTRA,
			timing: () => ({
				power: rows,
				position: rows,
				positionLabel: "GPS position + elevation reference",
			}),
		};
		renderRepeatsView(input);
		document.getElementById("repeatsTimingRun")!.click();
		renderRepeatsView(input);
		expect(text()).toContain(
			"— is power or GPS position + elevation reference out of step with speed?",
		);
		expect(text()).not.toContain("gPS");
	});

	it("says the position row's reference is too flat to time, leaving power alone", () => {
		// The same laps scaled to ≈2 m of relief: a flat circuit.
		const units = [0.29, 0.3, 0.31].map((cda, j) => {
			const base = leg(j, cda, 0.004);
			return {
				key: `lap-${j + 1}`,
				label: `Lap ${j + 1}`,
				legs: [
					{
						veProfile: (c: number, k: number) =>
							base.veProfile(c, k).map((h) => 0.05 * h),
						elevation: base.elevation!.map((h) => 0.05 * h),
					},
				],
			};
		});
		const rows = [-3, -2, -1, 0, 1, 2, 3].map((shift) => ({ shift, units }));
		const input = {
			units,
			fixedCrr: 0.004,
			...EXTRA,
			timing: () => ({
				power: rows,
				position: rows,
				positionLabel: "Elevation reference",
			}),
		};
		renderRepeatsView(input);
		document.getElementById("repeatsTimingRun")!.click();
		renderRepeatsView(input);
		expect(text()).toContain("Power: in sync — 0 s scores best.");
		expect(text()).toMatch(
			/Elevation reference: no clear optimum — the reference rises and falls only \d\.\d m per lap \(under 5 m\), too flat to time\./,
		);
		// Nothing bolded in the position column.
		const positionCells = [
			...document
				.querySelectorAll("#repeats-tab table")[2]
				.querySelectorAll("tbody tr td:last-child"),
		];
		expect(positionCells.some((td) => td.querySelector("strong"))).toBe(false);
	});
});
