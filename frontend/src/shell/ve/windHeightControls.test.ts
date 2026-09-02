// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
	bindWindHeightControls,
	formatWindHeightReadout,
	refreshWindHeightReadout,
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

describe("windHeightControlsMarkup", () => {
	test("the k row contains no label of its own", () => {
		// IN-01: `.wind-height-controls__row ... label` was styled in
		// analysis-params.css but matched nothing — the control's only label is a
		// SIBLING of the row, not a descendant. That rule is now deleted, so if a
		// label is ever moved into the row it will arrive unstyled. This test is
		// the note that says so. It passed before the deletion too: it pins the
		// premise, it does not prove the removal.
		const host = document.createElement("div");
		host.innerHTML = windHeightControlsMarkup(makeParams());

		expect(host.querySelector(".wind-height-controls__row")).not.toBeNull();
		expect(host.querySelector(".wind-height-controls__row label")).toBeNull();
		expect(host.querySelector("label.wind-height-controls__label")).not.toBeNull();
	});
});

describe("formatWindHeightReadout", () => {
	test("empty when no constant wind is configured", () => {
		expect(formatWindHeightReadout(makeParams({ wind_speed: null }))).toBe("");
	});

	test("empty when the configured wind is not finite", () => {
		// IN-02: the guard rejected null/undefined/NaN but not the infinities,
		// so a non-finite wind reached toFixed and printed "Infinity m/s".
		for (const raw of [Infinity, -Infinity]) {
			expect(formatWindHeightReadout(makeParams({ wind_speed: raw }))).toBe(
				"",
			);
		}
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
		// D-b: the control and its readout speak percent; storage stays 0-1.
		expect(text).toContain("50%");
		expect(text).not.toContain("×0.50");
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
	test("renders the slider on the percent scale at the persisted factor", () => {
		// D-b: bounds are 0-100% now; the stored factor is still 0-1.
		document.body.innerHTML = windHeightControlsMarkup(
			makeParams({ wind_speed: 3.5, wind_height_factor: 0.65 }),
		);
		const slider = document.getElementById(
			"windHeightSlider",
		) as HTMLInputElement;
		expect(parseFloat(slider.min)).toBe(0);
		expect(parseFloat(slider.max)).toBe(100);
		expect(parseFloat(slider.step)).toBe(1);
		expect(parseFloat(slider.value)).toBe(65);
	});

	test("the number input mirrors the slider's bounds and value", () => {
		document.body.innerHTML = windHeightControlsMarkup(
			makeParams({ wind_speed: 3.5, wind_height_factor: 0.5 }),
		);
		const valueInput = document.getElementById(
			"windHeightValue",
		) as HTMLInputElement;
		expect(parseFloat(valueInput.min)).toBe(0);
		expect(parseFloat(valueInput.max)).toBe(100);
		expect(parseFloat(valueInput.value)).toBe(50);
	});

	test("keeps the label short and moves the caveats into an info tooltip", () => {
		document.body.innerHTML = windHeightControlsMarkup(
			makeParams({ wind_speed: 3.5 }),
		);
		const info = document.getElementById("windHeightInfo") as HTMLElement;
		expect(info).not.toBeNull();
		expect(info.title).toContain("CdA");
		expect(info.title).toContain("40–65%");
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

	test("dragging the slider commits and recomputes at every position", () => {
		onChange.mockClear();
		const slider = document.getElementById(
			"windHeightSlider",
		) as HTMLInputElement;

		// D-b: the thumb is on the percent scale; the model still receives 0-1.
		for (const position of ["70", "80"]) {
			slider.value = position;
			slider.dispatchEvent(new Event("input"));
		}

		const readout = document.getElementById("windHeightReadout") as HTMLElement;
		expect(readout.textContent).toContain("2.80");
		// Live, like every other slider in the panel — see the cadence block in
		// modeControls.callshape.test.ts for the cross-row comparison.
		expect(setParams).toHaveBeenNthCalledWith(1, { wind_height_factor: 0.7 });
		expect(setParams).toHaveBeenNthCalledWith(2, { wind_height_factor: 0.8 });
		expect(onChange).toHaveBeenCalledTimes(2);
	});

	test("a drag never rewrites the element under the cursor (CR-01)", () => {
		const slider = document.getElementById(
			"windHeightSlider",
		) as HTMLInputElement;
		// The model is deliberately made to disagree with the thumb: a full
		// refresh mid-drag would write the model's factor back into the slider.
		setParams.mockImplementation(() => {
			params = { ...params, wind_height_factor: 0.3 };
		});

		slider.value = "0.9";
		slider.dispatchEvent(new Event("input"));

		expect(slider.value).toBe("0.9");
	});

	test("releasing the slider adds no second recompute", () => {
		const slider = document.getElementById(
			"windHeightSlider",
		) as HTMLInputElement;
		slider.value = "0.6";
		slider.dispatchEvent(new Event("input"));
		onChange.mockClear();
		setParams.mockClear();

		// A browser emits `change` after the last `input` of a drag. One gesture
		// must still be one commit, so nothing may be listening for it.
		slider.dispatchEvent(new Event("change"));

		expect(setParams).not.toHaveBeenCalled();
		expect(onChange).not.toHaveBeenCalled();
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
		slider.dispatchEvent(new Event("input"));

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
		slider.dispatchEvent(new Event("input"));

		expect(readout.textContent).not.toMatch(/saved before|needs setting/i);
		expect(
			readout.classList.contains("wind-height-controls__readout--warning"),
		).toBe(false);
	});

	test("an out-of-range number entry commits a clamped factor", () => {
		const valueInput = document.getElementById(
			"windHeightValue",
		) as HTMLInputElement;
		// 250% is out of range on the percent scale; it clamps to 100%, which is
		// the factor 1.0 the model stores.
		valueInput.value = "250";
		valueInput.dispatchEvent(new Event("change"));

		expect(setParams).toHaveBeenCalledWith({ wind_height_factor: 1.0 });
		expect(valueInput.value).toBe("100");
	});

	test("a below-range number entry clamps to 0%, not to a hidden floor", () => {
		// D-b removed the 0.3 floor. -20% must land on 0, and 0 must survive as
		// 0 rather than being read back as "no transfer".
		const valueInput = document.getElementById(
			"windHeightValue",
		) as HTMLInputElement;
		valueInput.value = "-20";
		valueInput.dispatchEvent(new Event("change"));

		expect(setParams).toHaveBeenCalledWith({ wind_height_factor: 0 });
		expect(valueInput.value).toBe("0");
	});

	test("a NaN number entry commits nothing and restores the model value", () => {
		const valueInput = document.getElementById(
			"windHeightValue",
		) as HTMLInputElement;
		valueInput.value = "not a number";
		valueInput.dispatchEvent(new Event("change"));

		expect(setParams).not.toHaveBeenCalled();
		expect(onChange).not.toHaveBeenCalled();
		expect(valueInput.value).toBe("50");
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

/**
 * CR-01. `wind_height_factor` has three writers, but before this fix only the
 * slider's own handlers wrote `#windHeightSlider` / `#windHeightValue`. The two
 * model-only writers — `markManualWindEntry` (D-05) and the auto-rho weather
 * sync — left the control displaying a factor the physics was no longer using.
 *
 * That is not a cosmetic desync. The readout's own instruction is "set the
 * factor", so the user drags — and the drag starts from the stale value and
 * re-commits it, height-transferring a wind the user typed by hand. That is
 * precisely the D-05 harm `markManualWindEntry` exists to prevent.
 */
describe("refreshWindHeightReadout keeps the inputs in step with the model", () => {
	let params: AnalysisParameters;

	function inputs() {
		return {
			slider: document.getElementById("windHeightSlider") as HTMLInputElement,
			value: document.getElementById("windHeightValue") as HTMLInputElement,
			readout: document.getElementById("windHeightReadout") as HTMLElement,
		};
	}

	beforeEach(() => {
		params = makeParams({
			wind_speed: 3.5,
			wind_entry: "weather",
			wind_height_factor: 0.5,
		});
		document.body.innerHTML =
			`<div id="paramForm">` +
			`<input type="number" id="wind_speed" value="3.5">` +
			`<input type="number" id="wind_direction" value="180">` +
			`</div>` +
			windHeightControlsMarkup(params);
		bindWindHeightControls({
			getParams: () => params,
			setParams: (fields: Partial<AnalysisParameters>) => {
				params = { ...params, ...fields };
			},
			onChange: () => {},
		});
	});

	test("a model-only flip to manual/1.0 moves the slider, not just the text", () => {
		expect(inputs().slider.value).toBe("50");

		// What markManualWindEntry does: writes the model, re-emits, and leaves
		// the wind field's own DOM alone. It never touches the k control.
		params = { ...params, wind_entry: "manual", wind_height_factor: 1.0 };
		refreshWindHeightReadout(params);

		expect(inputs().slider.value).toBe("100");
		expect(inputs().value.value).toBe("100");
		expect(inputs().readout.textContent).toMatch(/by hand/i);
	});

	test("a weather sync down to 0.5 moves the slider back", () => {
		params = { ...params, wind_entry: "manual", wind_height_factor: 1.0 };
		refreshWindHeightReadout(params);
		expect(inputs().slider.value).toBe("100");

		params = { ...params, wind_entry: "weather", wind_height_factor: 0.5 };
		refreshWindHeightReadout(params);
		expect(inputs().slider.value).toBe("50");
		expect(inputs().value.value).toBe("50");
	});

	test("a live drag is not fought — the readout tracks but the inputs are left to the user", () => {
		const { slider, value } = inputs();
		// Mid-drag the model still holds 0.5; the handler passes a shallow copy
		// carrying the dragged value. If the refresh wrote the inputs from the
		// MODEL here it would snap the slider back to 0.50 under the cursor.
		slider.value = "85";
		slider.dispatchEvent(new Event("input"));

		expect(slider.value).toBe("85");
		expect(value.value).toBe("85");
		expect(inputs().readout.textContent).toContain("2.98");
	});
});

describe("the k control on the 0-100% scale (D-b)", () => {
	function render(params = makeParams({ wind_speed: 3.5 })) {
		const host = document.createElement("div");
		host.innerHTML = windHeightControlsMarkup(params);
		return {
			slider: host.querySelector("#windHeightSlider") as HTMLInputElement,
			number: host.querySelector("#windHeightValue") as HTMLInputElement,
		};
	}

	test("both inputs span 0-100 in integer steps", () => {
		const { slider, number } = render();

		for (const input of [slider, number]) {
			expect(input.min).toBe("0");
			expect(input.max).toBe("100");
			expect(input.step).toBe("1");
		}
	});

	test("a stored factor renders as its percent", () => {
		const { slider, number } = render(
			makeParams({ wind_speed: 3.5, wind_height_factor: 0.65 }),
		);

		expect(slider.value).toBe("65");
		expect(number.value).toBe("65");
	});

	test("the readout states the percent, the applied wind and the 10 m wind", () => {
		const text = formatWindHeightReadout(
			makeParams({
				wind_speed: 4,
				wind_entry: "weather",
				wind_height_factor: 0.25,
			}),
		);

		expect(text).toContain("1.00");
		expect(text).toContain("25%");
		expect(text).toContain("4.00");
	});

	test("the fitted-range caveat is stated in percent", () => {
		const text = formatWindHeightReadout(
			makeParams({
				wind_speed: 3.5,
				wind_entry: "weather",
				wind_height_factor: 0.9,
			}),
		);

		expect(text).toContain("40–65%");
		expect(text).not.toContain("0.40");
	});

	test("0% reads as no wind reaching the rider, not as full wind", () => {
		// The guard in resolveWindHeightFactor used to map 0 onto 1.0, so this is
		// the user-visible half of that change: the readout must agree with the
		// slider rather than silently reporting the untransferred wind.
		const text = formatWindHeightReadout(
			makeParams({
				wind_speed: 3.5,
				wind_entry: "weather",
				wind_height_factor: 0,
			}),
		);

		expect(text).toContain("0.00 m/s");
		expect(text).toContain("0%");
	});
});

describe("the wind fields follow the CURRENT binding (WR-06)", () => {
	test("a re-bind on the same nodes reads the new getParams, not the first", () => {
		// windFieldsBound was membership-only: it skipped re-binding a node it had
		// seen, which is right, but the listener already attached still closed
		// over the FIRST binding's getParams. Harmless only while every mode
		// passes an identical closure -- a latent trap, not a live bug. The node
		// must resolve to whichever binding is current.
		document.body.innerHTML =
			`<div id="paramForm">` +
			`<input type="number" id="wind_speed" value="3.5">` +
			`<input type="number" id="wind_direction" value="180">` +
			`</div>` +
			windHeightControlsMarkup(makeParams({ wind_speed: 3.5 }));

		const first = makeParams({
			wind_speed: 3.5,
			wind_entry: "weather",
			wind_height_factor: 0.5,
		});
		bindWindHeightControls({
			getParams: () => first,
			setParams: () => {},
			onChange: () => {},
		});

		// A second mode binds the very same wind fields with its own closure.
		const second = makeParams({
			wind_speed: 8,
			wind_entry: "weather",
			wind_height_factor: 0.25,
		});
		bindWindHeightControls({
			getParams: () => second,
			setParams: () => {},
			onChange: () => {},
		});

		const windSpeedField = document.getElementById(
			"wind_speed",
		) as HTMLInputElement;
		windSpeedField.dispatchEvent(new Event("input"));

		const readout = document.getElementById("windHeightReadout") as HTMLElement;
		// 25% of 8 = 2.00, from the SECOND binding.
		expect(readout.textContent).toContain("2.00");
		expect(readout.textContent).toContain("25%");
	});
});

describe("a persisted factor outside the control's range (WR-07)", () => {
	// Storage must never rewrite a persisted value (D-03), so a stored 1.5
	// survives — but the CONTROL cannot show 150%: the range element pins its
	// thumb at 100. The old behaviour left three views disagreeing (slider 100,
	// number 150, readout 150%) with nothing saying why, and the first touch of
	// the thumb silently committed the narrowing. The fix is not to clamp
	// storage; it is to say so, before the user destroys the value.
	const stored = () =>
		makeParams({
			wind_speed: 3.5,
			wind_entry: "weather",
			wind_height_factor: 1.5,
		});

	test("the readout names the stored value and warns it cannot be shown", () => {
		const text = formatWindHeightReadout(stored());

		expect(text).toContain("150%");
		expect(text).toMatch(/outside the 0–100% the slider covers/i);
		expect(text).toMatch(/moving the slider will replace it/i);
	});

	test("that warning is styled as a warning", () => {
		expect(windHeightReadoutIsWarning(stored())).toBe(true);
	});

	test("the physics still uses the stored value, unnarrowed", () => {
		// The whole point: 1.5 x 3.5 = 5.25 reaches the calculator regardless of
		// what the slider can render.
		expect(formatWindHeightReadout(stored())).toContain("5.25");
	});

	test("an in-range factor carries none of that", () => {
		const text = formatWindHeightReadout(
			makeParams({
				wind_speed: 3.5,
				wind_entry: "weather",
				wind_height_factor: 0.5,
			}),
		);

		expect(text).not.toMatch(/the slider covers/i);
	});
});
