// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
	bindWindHeightControls,
	formatWindHeightReadout,
	syncWindHeightFromWeather,
	windHeightControlsMarkup,
	windHeightReadoutIsWarning,
} from "./windHeightControls";
import type { AnalysisParameters } from "../../components/AnalysisParameters";
import { DEFAULT_PARAMETERS } from "../../components/AnalysisParameters";

function makeParams(
	overrides: Partial<AnalysisParameters> = {},
): AnalysisParameters {
	return { ...DEFAULT_PARAMETERS, ...overrides };
}

/** Either prompt, in the wording each branch actually uses. */
const ANY_PROMPT = /by hand|needs setting|saved before/i;
/** Claims of a hand entry — the "unknown" branch must make none of these. */
const CLAIMS_HAND_ENTRY = /by hand|you typed|entered manually/i;

describe("formatWindHeightReadout", () => {
	test("empty when no constant wind is configured", () => {
		expect(formatWindHeightReadout(makeParams({ wind_speed: null }))).toBe("");
	});

	test("shows the rider-height wind, the factor and the raw 10 m wind", () => {
		const text = formatWindHeightReadout(
			makeParams({
				wind_speed: 3.5,
				wind_entry: "weather",
				wind_height_factor: 0.5,
			}),
		);
		expect(text).toContain("1.75");
		expect(text).toContain("0.50");
		expect(text).toContain("3.50");
		expect(text).not.toMatch(ANY_PROMPT);
	});

	test("a weather-sourced wind at k = 1.0 carries no prompt", () => {
		const text = formatWindHeightReadout(
			makeParams({
				wind_speed: 3.5,
				wind_entry: "weather",
				wind_height_factor: 1.0,
			}),
		);
		// The raw wind reaches the rider untransferred — a deliberate choice.
		expect(text).toContain("3.50");
		expect(text).not.toMatch(ANY_PROMPT);
		expect(
			windHeightReadoutIsWarning(
				makeParams({
					wind_speed: 3.5,
					wind_entry: "weather",
					wind_height_factor: 1.0,
				}),
			),
		).toBe(false);
	});

	test("a hand-entered wind at k = 1.0 warns that the factor needs setting", () => {
		const params = makeParams({
			wind_speed: 3.5,
			wind_entry: "manual",
			wind_height_factor: 1.0,
		});
		expect(formatWindHeightReadout(params)).toMatch(/entered by hand/i);
		expect(windHeightReadoutIsWarning(params)).toBe(true);
	});

	test("a hand-entered wind with a set factor carries no prompt", () => {
		const params = makeParams({
			wind_speed: 3.5,
			wind_entry: "manual",
			wind_height_factor: 0.55,
		});
		expect(formatWindHeightReadout(params)).not.toMatch(ANY_PROMPT);
		expect(windHeightReadoutIsWarning(params)).toBe(false);
	});

	test("an unknown-provenance wind at k = 1.0 prompts without claiming hand entry", () => {
		const params = makeParams({
			wind_speed: 3.5,
			wind_entry: "unknown",
			wind_height_factor: 1.0,
		});
		const text = formatWindHeightReadout(params);
		expect(text).toMatch(/saved before the height factor existed/i);
		expect(text).toMatch(/needs setting/i);
		// T-08-18: the app does not know how this wind was entered, so it must
		// not say that it was typed.
		expect(text).not.toMatch(CLAIMS_HAND_ENTRY);
		expect(windHeightReadoutIsWarning(params)).toBe(true);
	});

	test("an unknown-provenance wind with a set factor carries no prompt", () => {
		const params = makeParams({
			wind_speed: 3.5,
			wind_entry: "unknown",
			wind_height_factor: 0.5,
		});
		expect(formatWindHeightReadout(params)).not.toMatch(ANY_PROMPT);
		expect(windHeightReadoutIsWarning(params)).toBe(false);
	});

	test("the manual and unknown prompts are different claims", () => {
		const manual = formatWindHeightReadout(
			makeParams({
				wind_speed: 3.5,
				wind_entry: "manual",
				wind_height_factor: 1.0,
			}),
		);
		const unknown = formatWindHeightReadout(
			makeParams({
				wind_speed: 3.5,
				wind_entry: "unknown",
				wind_height_factor: 1.0,
			}),
		);
		expect(manual).not.toBe(unknown);
	});

	test("a factor outside the fitted range carries the single-venue caveat", () => {
		const outside = formatWindHeightReadout(
			makeParams({
				wind_speed: 3.5,
				wind_entry: "weather",
				wind_height_factor: 0.9,
			}),
		);
		expect(outside).toMatch(/single open venue/i);

		const inside = formatWindHeightReadout(
			makeParams({
				wind_speed: 3.5,
				wind_entry: "weather",
				wind_height_factor: 0.5,
			}),
		);
		expect(inside).not.toMatch(/single open venue/i);
	});
});

describe("windHeightControlsMarkup", () => {
	test("renders the slider with the D-02 bounds and the persisted factor", () => {
		document.body.innerHTML = windHeightControlsMarkup(
			makeParams({ wind_speed: 3.5, wind_height_factor: 0.65 }),
		);
		const slider = document.getElementById(
			"windHeightSlider",
		) as HTMLInputElement;
		expect(parseFloat(slider.min)).toBe(0.3);
		expect(parseFloat(slider.max)).toBe(1.0);
		expect(parseFloat(slider.step)).toBe(0.05);
		expect(parseFloat(slider.value)).toBe(0.65);
	});

	test("the number input mirrors the slider's bounds and value", () => {
		document.body.innerHTML = windHeightControlsMarkup(
			makeParams({ wind_speed: 3.5, wind_height_factor: 0.5 }),
		);
		const valueInput = document.getElementById(
			"windHeightValue",
		) as HTMLInputElement;
		expect(parseFloat(valueInput.min)).toBe(0.3);
		expect(parseFloat(valueInput.max)).toBe(1.0);
		expect(parseFloat(valueInput.value)).toBe(0.5);
	});

	test("keeps the label short and moves the caveats into an info tooltip", () => {
		document.body.innerHTML = windHeightControlsMarkup(
			makeParams({ wind_speed: 3.5 }),
		);
		const info = document.getElementById("windHeightInfo") as HTMLElement;
		expect(info).not.toBeNull();
		expect(info.title).toContain("CdA");
		expect(info.title).toContain("0.40");
		expect(info.title).toContain("0.65");
		// R-01/R-02 belong in the tooltip, not in visible text.
		const visibleText = document.body.textContent ?? "";
		expect(visibleText).not.toContain("shear layer");
	});

	test("pre-seeds the readout before any bind runs", () => {
		document.body.innerHTML = windHeightControlsMarkup(
			makeParams({
				wind_speed: 3.5,
				wind_entry: "weather",
				wind_height_factor: 0.5,
			}),
		);
		const readout = document.getElementById("windHeightReadout") as HTMLElement;
		expect(readout.textContent).toContain("1.75");
	});
});

describe("bindWindHeightControls", () => {
	let params: AnalysisParameters;
	let getParams: ReturnType<typeof vi.fn>;
	let setParams: ReturnType<typeof vi.fn>;
	let onChange: ReturnType<typeof vi.fn>;

	function render(next: AnalysisParameters) {
		params = next;
		document.body.innerHTML =
			`<div id="paramForm">` +
			`<input type="number" id="wind_speed" value="3.5">` +
			`<input type="number" id="wind_direction" value="180">` +
			`</div>` +
			windHeightControlsMarkup(params);
	}

	function bind() {
		bindWindHeightControls({
			getParams: getParams as unknown as () => AnalysisParameters | null,
			setParams: setParams as unknown as (
				fields: Partial<AnalysisParameters>,
			) => void,
			onChange: onChange as unknown as () => void,
		});
	}

	beforeEach(() => {
		getParams = vi.fn(() => params);
		setParams = vi.fn((fields: Partial<AnalysisParameters>) => {
			params = { ...params, ...fields };
		});
		onChange = vi.fn();
		render(
			makeParams({
				wind_speed: 3.5,
				wind_entry: "weather",
				wind_height_factor: 0.5,
			}),
		);
		bind();
	});

	test("dragging the slider updates the readout without recomputing", () => {
		onChange.mockClear();
		const slider = document.getElementById(
			"windHeightSlider",
		) as HTMLInputElement;
		slider.value = "0.8";
		slider.dispatchEvent(new Event("input"));

		const readout = document.getElementById("windHeightReadout") as HTMLElement;
		expect(readout.textContent).toContain("2.80");
		expect(onChange).not.toHaveBeenCalled();
		expect(setParams).not.toHaveBeenCalled();
	});

	test("releasing the slider commits the factor and recomputes once", () => {
		const slider = document.getElementById(
			"windHeightSlider",
		) as HTMLInputElement;
		slider.value = "0.6";
		slider.dispatchEvent(new Event("change"));

		expect(setParams).toHaveBeenCalledWith({ wind_height_factor: 0.6 });
		expect(onChange).toHaveBeenCalledTimes(1);
	});

	test("moving the slider clears the hand-entry warning", () => {
		render(
			makeParams({
				wind_speed: 3.5,
				wind_entry: "manual",
				wind_height_factor: 1.0,
			}),
		);
		bind();

		const readout = document.getElementById("windHeightReadout") as HTMLElement;
		expect(readout.textContent).toMatch(/by hand/i);
		expect(
			readout.classList.contains("wind-height-controls__readout--warning"),
		).toBe(true);

		const slider = document.getElementById(
			"windHeightSlider",
		) as HTMLInputElement;
		slider.value = "0.5";
		slider.dispatchEvent(new Event("change"));

		expect(readout.textContent).not.toMatch(/by hand|needs setting/i);
		expect(
			readout.classList.contains("wind-height-controls__readout--warning"),
		).toBe(false);
	});

	test("moving the slider clears the unknown-provenance prompt", () => {
		render(
			makeParams({
				wind_speed: 3.5,
				wind_entry: "unknown",
				wind_height_factor: 1.0,
			}),
		);
		bind();

		const readout = document.getElementById("windHeightReadout") as HTMLElement;
		expect(readout.textContent).toMatch(/saved before/i);
		expect(
			readout.classList.contains("wind-height-controls__readout--warning"),
		).toBe(true);

		const slider = document.getElementById(
			"windHeightSlider",
		) as HTMLInputElement;
		slider.value = "0.5";
		slider.dispatchEvent(new Event("change"));

		expect(readout.textContent).not.toMatch(/saved before|needs setting/i);
		expect(
			readout.classList.contains("wind-height-controls__readout--warning"),
		).toBe(false);
	});

	test("an out-of-range number entry commits a clamped factor", () => {
		const valueInput = document.getElementById(
			"windHeightValue",
		) as HTMLInputElement;
		valueInput.value = "2.5";
		valueInput.dispatchEvent(new Event("change"));

		expect(setParams).toHaveBeenCalledWith({ wind_height_factor: 1.0 });
		expect(valueInput.value).toBe("1.00");
	});

	test("a NaN number entry commits nothing and restores the model value", () => {
		const valueInput = document.getElementById(
			"windHeightValue",
		) as HTMLInputElement;
		valueInput.value = "not a number";
		valueInput.dispatchEvent(new Event("change"));

		expect(setParams).not.toHaveBeenCalled();
		expect(onChange).not.toHaveBeenCalled();
		expect(valueInput.value).toBe("0.50");
	});

	test("typing a wind speed refreshes the readout and its prompt", () => {
		render(
			makeParams({
				wind_speed: 3.5,
				wind_entry: "manual",
				wind_height_factor: 1.0,
			}),
		);
		bind();

		const windSpeed = document.getElementById("wind_speed") as HTMLInputElement;
		// The component writes the parsed value into the model; the readout reads
		// from the model, so mirror that here.
		params = { ...params, wind_speed: 6 };
		windSpeed.value = "6";
		windSpeed.dispatchEvent(new Event("input"));

		const readout = document.getElementById("windHeightReadout") as HTMLElement;
		expect(readout.textContent).toContain("6.00");
		expect(readout.textContent).toMatch(/by hand/i);
	});

	test("re-binding the same wind field does not stack listeners", () => {
		// A sidebar re-render leaves #wind_speed in place.
		bind();
		const windSpeed = document.getElementById("wind_speed") as HTMLInputElement;
		const before = getParams.mock.calls.length;
		windSpeed.dispatchEvent(new Event("input"));
		expect(getParams.mock.calls.length - before).toBe(1);
	});

	test("a re-rendered wind field node is re-bound", () => {
		// A file load replaces the whole parameter form: new node, same id.
		const form = document.getElementById("paramForm") as HTMLElement;
		form.innerHTML =
			`<input type="number" id="wind_speed" value="3.5">` +
			`<input type="number" id="wind_direction" value="180">`;
		bind();

		const fresh = document.getElementById("wind_speed") as HTMLInputElement;
		const before = getParams.mock.calls.length;
		fresh.dispatchEvent(new Event("input"));
		// Exactly one, not zero (a module-level boolean latch would leave the new
		// node unbound) and not two (a missing guard would stack).
		expect(getParams.mock.calls.length - before).toBe(1);
	});
});

describe("syncWindHeightFromWeather", () => {
	test("a first fill after a manual entry seeds the default factor", () => {
		expect(
			syncWindHeightFromWeather(makeParams({ wind_entry: "manual" })),
		).toEqual({ wind_entry: "weather", wind_height_factor: 0.5 });
	});

	test("a first fill on a record with no provenance seeds the default factor", () => {
		expect(
			syncWindHeightFromWeather(makeParams({ wind_entry: undefined })),
		).toEqual({ wind_entry: "weather", wind_height_factor: 0.5 });
	});

	test("a refill never clobbers a tuned factor", () => {
		expect(
			syncWindHeightFromWeather(
				makeParams({ wind_entry: "weather", wind_height_factor: 0.65 }),
			),
		).toEqual({});
	});

	test("a reopened pre-feature record is never treated as a first fill", () => {
		// T-08-16: seeding here would re-seed k = 0.5 whenever auto-rho fires on
		// load, silently re-fitting an analysis the maintainer has already read.
		expect(
			syncWindHeightFromWeather(
				makeParams({ wind_entry: "unknown", wind_height_factor: 1.0 }),
			),
		).toEqual({});
	});
});
