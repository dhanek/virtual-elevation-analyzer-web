/**
 * @vitest-environment jsdom
 *
 * The closure-target block (phase 2): markup reflects the persisted
 * parameters, the binder writes `elevation_diff_source` /
 * `manual_elevation_diff_m` through the merge route and triggers a recompute,
 * the manual row shows only under 'manual', and the DEM status line is honest
 * about a missing DEM channel.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisParameters } from "../../components/AnalysisParameters";
import { DEFAULT_PARAMETERS } from "../../components/AnalysisParameters";
import {
	bindElevationDiffControls,
	elevationDiffControlsMarkup,
	elevationDiffStatusText,
	getSelectedElevationDiffSource,
} from "./elevationDiffControls";

function makeParams(
	overrides: Partial<AnalysisParameters> = {},
): AnalysisParameters {
	return { ...DEFAULT_PARAMETERS, ...overrides };
}

interface Bound {
	params: AnalysisParameters;
	merged: Array<Partial<AnalysisParameters>>;
	changes: number;
}

function renderAndBind(
	params: AnalysisParameters,
	demAvailable: boolean,
): Bound {
	document.body.innerHTML = elevationDiffControlsMarkup(params);
	const merged: Array<Partial<AnalysisParameters>> = [];
	const state: Bound = { params, merged, changes: 0 };
	const attached = bindElevationDiffControls(
		{
			getParams: () => state.params,
			setParams: (fields) => {
				merged.push(fields);
				state.params = { ...state.params, ...fields };
			},
			onChange: () => {
				state.changes++;
			},
		},
		demAvailable,
	);
	expect(attached).toBe(true);
	return state;
}

function radio(value: string): HTMLInputElement {
	return document.querySelector(
		`input[name="elevationDiffSource"][value="${value}"]`,
	) as HTMLInputElement;
}

beforeEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = "";
});

describe("elevationDiffControlsMarkup", () => {
	it("checks the persisted source and hides the manual row for it", () => {
		document.body.innerHTML = elevationDiffControlsMarkup(makeParams());
		expect(radio("dem").checked).toBe(true);
		expect(radio("barometer").checked).toBe(false);
		expect(
			document
				.getElementById("elevationDiffManualRow")!
				.classList.contains("elevation-diff-controls__manual--hidden"),
		).toBe(true);
	});

	it("shows the manual row and its persisted value under 'manual'", () => {
		document.body.innerHTML = elevationDiffControlsMarkup(
			makeParams({
				elevation_diff_source: "manual",
				manual_elevation_diff_m: -3.5,
			}),
		);
		expect(radio("manual").checked).toBe(true);
		expect(
			document
				.getElementById("elevationDiffManualRow")!
				.classList.contains("elevation-diff-controls__manual--hidden"),
		).toBe(false);
		expect(
			(document.getElementById("elevationDiffManual") as HTMLInputElement)
				.value,
		).toBe("-3.5");
	});
});

describe("bindElevationDiffControls", () => {
	it("reports unbound when the block is absent", () => {
		expect(
			bindElevationDiffControls(
				{ getParams: () => null, setParams: () => {}, onChange: () => {} },
				true,
			),
		).toBe(false);
	});

	it("a source change merges the field and triggers exactly one recompute", () => {
		const bound = renderAndBind(makeParams(), true);
		radio("barometer").checked = true;
		radio("barometer").dispatchEvent(new Event("change"));

		expect(bound.merged).toEqual([{ elevation_diff_source: "barometer" }]);
		expect(bound.changes).toBe(1);
	});

	it("selecting 'manual' reveals the row; a Δh entry merges the value", () => {
		const bound = renderAndBind(makeParams(), true);
		const row = document.getElementById("elevationDiffManualRow")!;

		radio("manual").checked = true;
		radio("manual").dispatchEvent(new Event("change"));
		expect(
			row.classList.contains("elevation-diff-controls__manual--hidden"),
		).toBe(false);

		const input = document.getElementById(
			"elevationDiffManual",
		) as HTMLInputElement;
		input.value = "4.2";
		input.dispatchEvent(new Event("change"));

		expect(bound.merged).toEqual([
			{ elevation_diff_source: "manual" },
			{ manual_elevation_diff_m: 4.2 },
		]);
		expect(bound.changes).toBe(2);

		// A cleared field persists null, never NaN.
		input.value = "";
		input.dispatchEvent(new Event("change"));
		expect(bound.merged[2]).toEqual({ manual_elevation_diff_m: null });
	});

	it("says so when 'dem' has no DEM channel behind it, at bind and on change", () => {
		renderAndBind(makeParams(), false);
		const status = document.getElementById("elevationDiffStatus")!;
		expect(status.textContent).toBe(
			elevationDiffStatusText("dem", false),
		);
		expect(status.textContent).toMatch(/No DEM elevation loaded/);

		radio("barometer").checked = true;
		radio("barometer").dispatchEvent(new Event("change"));
		expect(status.textContent).toBe("");
	});
});

describe("getSelectedElevationDiffSource", () => {
	it("validates rather than casts an unknown radio value", () => {
		document.body.innerHTML = `
			<label><input type="radio" name="elevationDiffSource" value="astm" checked></label>
		`;
		expect(getSelectedElevationDiffSource()).toBe("dem");
	});
});

describe("the manual field's wording is mode-specific", () => {
	const manualMarkup = (mode?: "standard" | "gpsLap" | "outAndBack") =>
		elevationDiffControlsMarkup(
			makeParams({ elevation_diff_source: "manual" }),
			mode,
		);

	it("out-and-back says the number is the outbound leg, gate to gate", () => {
		document.body.innerHTML = manualMarkup("outAndBack");
		const label = document.querySelector(
			'label[for="elevationDiffManual"]',
		)!.textContent!;
		const title = document
			.getElementById("elevationDiffManual")!
			.getAttribute("title")!;

		expect(label).toContain("outbound");
		expect(title).toContain("outbound");
		expect(title).toContain("negated");
	});

	it("the lap modes keep the window start-to-end wording", () => {
		for (const mode of ["standard", "gpsLap", undefined] as const) {
			document.body.innerHTML = manualMarkup(mode);
			const label = document.querySelector(
				'label[for="elevationDiffManual"]',
			)!.textContent!;

			expect(label).toBe("Δ elevation (m):");
			expect(
				document.getElementById("elevationDiffManual")!.getAttribute("title"),
			).toContain("window start to window end");
		}
	});

	it("only out-and-back's tooltip promises the automatic negation", () => {
		const info = (mode?: "standard" | "outAndBack") => {
			document.body.innerHTML = manualMarkup(mode);
			return document
				.querySelector(".crr-temp-controls__info")!
				.getAttribute("title")!;
		};

		expect(info("outAndBack")).toContain("OUTBOUND");
		expect(info("standard")).not.toContain("OUTBOUND");
		// The old advice -- "0 for a lap or out-and-back that starts and ends
		// at the same spot" -- was wrong for a section between gates at
		// different heights, which is the whole case this feature serves.
		expect(info("outAndBack")).toContain("same height");
	});
});
