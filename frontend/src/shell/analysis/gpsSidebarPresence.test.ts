/**
 * @vitest-environment jsdom
 *
 * What the two GPS sidebars ACTUALLY contain, per wind source.
 *
 * 07-GPS-SIDEBAR-DECISION.md §1 tabulated this for both modes, but only the
 * GPS-lap column was executed: out-and-back's template was interpolated inline
 * inside an `async` function that awaits Plotly, so its whole column was a READ
 * of source that had never been run. §7 of that document named it "the one
 * claim I would not bet the ruling on", and this phase has already had one
 * static claim refuted by running the code (the retracted §5).
 *
 * The migration in plan 07-03 changes exactly these rows, so the table is now
 * load-bearing. `buildOutAndBackVeAnalysisTemplate` was extracted for this file
 * to be able to exist; the two modes are asserted by ONE parameterised suite so
 * that "structurally parallel" is a checked property rather than an inference —
 * which is precisely the inference that produced the §5 error.
 *
 * The suite is written against a ride that has BOTH a FIT air-speed channel and
 * a configured constant wind, because that is the only configuration in which a
 * user can reach all three radios.
 */
import { describe, expect, it } from "vitest";
import type { AnalysisParameters } from "../../components/AnalysisParameters";
import { buildGpsLapVeAnalysisTemplate } from "../gpsLap/renderGpsLap";
import { buildOutAndBackVeAnalysisTemplate } from "../outAndBack/renderOutAndBack";

const params = {
	cda: 0.3,
	cda_min: 0.15,
	cda_max: 0.5,
	crr: 0.008,
	crr_min: 0.002,
	crr_max: 0.02,
	air_speed_offset: 2,
	wind_height_factor: 0.5,
} as unknown as AnalysisParameters;

type WindSource = "fit" | "constant" | "compare";

/**
 * The flag arithmetic both templates run before interpolating, lifted verbatim
 * from `showGpsLapVEPlot` / `showOutAndBackVEPlot`. Driving the templates
 * through it is what makes this a test of the RENDERED sidebar rather than of
 * the template's parameters.
 */
function flagsFor(selectedWindSource: WindSource) {
	const effective =
		selectedWindSource === "compare" ? "fit" : selectedWindSource;
	const showFitWindControls = effective === "fit";
	return {
		selectedWindSource,
		showWindTab: true,
		showFitWindControls,
		showVirtualDistanceTab: showFitWindControls,
	};
}

function renderGpsLap(source: WindSource): Document {
	return parse(
		buildGpsLapVeAnalysisTemplate({
			params,
			hasWindSpeed: true,
			hasConstantWind: true,
			...flagsFor(source),
			currentAirSpeedCalibrationValue: "0.0",
			initialStats: { meanR2: 0.5, meanRMSE: 1, closingError: 2 },
			lapCount: 7,
			defaultAirSpeedOffset: 0,
			elevationToggleMarkup: "",
		}),
	);
}

function renderOutAndBack(source: WindSource): Document {
	return parse(
		buildOutAndBackVeAnalysisTemplate({
			params,
			hasWindSpeed: true,
			hasConstantWind: true,
			...flagsFor(source),
			currentAirSpeedCalibrationValue: "0.0",
			initialStats: { rmse: 1, avgVeGain: 2, avgActualGain: 3 },
			sectionCount: 4,
			defaultAirSpeedOffset: 0,
			elevationToggleMarkup: "",
		}),
	);
}

function parse(html: string): Document {
	return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
}

const MODES: ReadonlyArray<{
	name: string;
	render: (source: WindSource) => Document;
}> = [
	{ name: "GPS-lap", render: renderGpsLap },
	{ name: "out-and-back", render: renderOutAndBack },
];

/** Controls both GPS templates render regardless of the selected source. */
const ALWAYS_PRESENT = [
	"#cdaSlider",
	"#cdaValue",
	"#crrSlider",
	"#crrValue",
	"#crrTempControls",
	"#windHeightControls",
	"#airSpeedCalibrationSlider",
	"#airSpeedCalibrationValue",
	"#autoAdjustCalibration",
	"#saveScreenshot",
	"#storeResult",
	"#exportAllResults",
	"#ve-tab",
	"#wind-tab",
	"#power-tab",
	'.ve-tab-button[data-tab="ve"]',
	'.ve-tab-button[data-tab="wind"]',
	'.ve-tab-button[data-tab="power"]',
	'input[name="windSource"][value="constant"]',
	'input[name="windSource"][value="fit"]',
	'input[name="windSource"][value="compare"]',
];

/** Controls whose PRESENCE depends on the selected source, today. */
const SOURCE_DEPENDENT = [
	"#airSpeedOffsetSlider",
	"#airSpeedOffsetValue",
	"#vd-tab",
	'.ve-tab-button[data-tab="vd"]',
];

describe.each(MODES)("the $name sidebar, as rendered", ({ render }) => {
	it.each<WindSource>(["fit", "constant", "compare"])(
		"renders the source-independent controls under %s",
		(source) => {
			const doc = render(source);
			for (const selector of ALWAYS_PRESENT) {
				expect(doc.querySelector(selector), selector).not.toBeNull();
			}
		},
	);

	it.each<WindSource>(["fit", "compare"])(
		"renders the FIT air-speed controls under %s",
		(source) => {
			const doc = render(source);
			for (const selector of SOURCE_DEPENDENT) {
				expect(doc.querySelector(selector), selector).not.toBeNull();
			}
		},
	);

	it("omits the FIT air-speed controls entirely under constant", () => {
		const doc = render("constant");
		for (const selector of SOURCE_DEPENDENT) {
			expect(doc.querySelector(selector), selector).toBeNull();
		}
	});

	it("renders compare identically to fit apart from checked and hidden state", () => {
		// `compare` folds onto `fit` before the presence flags are computed, so
		// the two sidebars contain the same ELEMENTS.
		//
		// They are not byte-identical, and 07-GPS-SIDEBAR-DECISION.md §7 was
		// wrong to say they were: `windHeightControlsMarkup` is passed the
		// SELECTED source rather than the effective one, so the k block is
		// hidden under fit and visible under compare. §1's own table records
		// that difference correctly; only the §7 summary line overstated it.
		// Normalising both attributes keeps this assertion about presence and
		// leaves the k block's visibility to the dedicated test below.
		const normalise = (html: string) =>
			html.replace(/ checked=""/g, "").replace(/ hidden=""/g, "");
		expect(normalise(render("compare").body.innerHTML)).toBe(
			normalise(render("fit").body.innerHTML),
		);
	});

	it("hides the wind-height block under fit and shows it otherwise", () => {
		expect(
			render("fit").querySelector("#windHeightControls")?.hasAttribute("hidden"),
		).toBe(true);
		expect(
			render("constant")
				.querySelector("#windHeightControls")
				?.hasAttribute("hidden"),
		).toBe(false);
		expect(
			render("compare")
				.querySelector("#windHeightControls")
				?.hasAttribute("hidden"),
		).toBe(false);
	});
});
