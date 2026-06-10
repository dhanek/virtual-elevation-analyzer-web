// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
	bindCrrTempControls,
	crrTempControlsMarkup,
	formatCrrTempReadout,
	syncCrrTempAmbientFromWeather,
} from "./crrTempControls";
import type { AnalysisParameters } from "../../components/AnalysisParameters";
import { DEFAULT_PARAMETERS } from "../../components/AnalysisParameters";

function makeParams(
	overrides: Partial<AnalysisParameters> = {},
): AnalysisParameters {
	return { ...DEFAULT_PARAMETERS, ...overrides };
}

describe("formatCrrTempReadout", () => {
	test("empty when correction is disabled", () => {
		expect(formatCrrTempReadout(makeParams(), 0.005)).toBe("");
	});

	test("prompts for temperature when enabled without ambient temp", () => {
		const text = formatCrrTempReadout(
			makeParams({ crr_temp_correction: true, ambient_temp_c: null }),
			0.005,
		);
		expect(text).toMatch(/ambient temperature/i);
	});

	test("shows applied Crr and factor when enabled with temp", () => {
		const text = formatCrrTempReadout(
			makeParams({
				crr_temp_correction: true,
				ambient_temp_c: 10,
				tire_sensitivity: "supple",
			}),
			0.005,
		);
		// factor(10, 1.0) = 1.3097 → applied = 0.0065485
		expect(text).toContain("0.0065");
		expect(text).toContain("×1.310");
		expect(text).toContain("10.0");
	});

	test("warns when temperature is outside the 5-40 °C validity range", () => {
		const text = formatCrrTempReadout(
			makeParams({ crr_temp_correction: true, ambient_temp_c: 0 }),
			0.005,
		);
		expect(text).toMatch(/outside/i);
	});
});

describe("crrTempControlsMarkup", () => {
	test("renders unchecked toggle with hidden fields by default", () => {
		document.body.innerHTML = crrTempControlsMarkup(makeParams());
		const toggle = document.getElementById(
			"crrTempToggle",
		) as HTMLInputElement;
		const fields = document.getElementById("crrTempFields") as HTMLElement;
		expect(toggle.checked).toBe(false);
		expect(fields.style.display).toBe("none");
	});

	test("keeps the label short and moves the explanation into an info tooltip", () => {
		document.body.innerHTML = crrTempControlsMarkup(makeParams());
		const info = document.getElementById("crrTempInfo") as HTMLElement;
		expect(info).not.toBeNull();
		expect(info.title).toContain("22 °C");
		expect(info.title).toContain("±3 °C");
		// The long validity hint must not be visible text anymore.
		const visibleText = document.body.textContent ?? "";
		expect(visibleText).not.toContain("steady state");
	});

	test("renders enabled state with persisted values", () => {
		document.body.innerHTML = crrTempControlsMarkup(
			makeParams({
				crr_temp_correction: true,
				ambient_temp_c: 12.5,
				tire_sensitivity: "stiff",
			}),
		);
		const toggle = document.getElementById(
			"crrTempToggle",
		) as HTMLInputElement;
		const ambient = document.getElementById(
			"crrTempAmbient",
		) as HTMLInputElement;
		const sensitivity = document.getElementById(
			"crrTempSensitivity",
		) as HTMLSelectElement;
		expect(toggle.checked).toBe(true);
		expect(ambient.value).toBe("12.5");
		expect(sensitivity.value).toBe("stiff");
	});
});

describe("bindCrrTempControls", () => {
	let params: AnalysisParameters;
	let setParams: ReturnType<typeof vi.fn>;
	let onChange: ReturnType<typeof vi.fn>;

	function bind() {
		bindCrrTempControls({
			getParams: () => params,
			setParams: setParams as unknown as (
				fields: Partial<AnalysisParameters>,
			) => void,
			onChange: onChange as unknown as () => void,
		});
	}

	beforeEach(() => {
		params = makeParams();
		setParams = vi.fn((fields: Partial<AnalysisParameters>) => {
			params = { ...params, ...fields };
		});
		onChange = vi.fn();
		document.body.innerHTML =
			`<input type="range" id="crrSlider" value="0.005">` +
			`<input type="number" id="crrValue" value="0.005">` +
			crrTempControlsMarkup(params);
		bind();
	});

	test("enabling the toggle sets the parameter and triggers a recompute", () => {
		const toggle = document.getElementById(
			"crrTempToggle",
		) as HTMLInputElement;
		toggle.checked = true;
		toggle.dispatchEvent(new Event("change"));

		expect(setParams).toHaveBeenCalledWith(
			expect.objectContaining({ crr_temp_correction: true }),
		);
		expect(onChange).toHaveBeenCalled();
		const fields = document.getElementById("crrTempFields") as HTMLElement;
		expect(fields.style.display).not.toBe("none");
	});

	test("enabling the toggle prefills ambient temp from weather metadata", () => {
		params = makeParams({
			weather_metadata: {
				temperature: 18.3,
				dewPoint: 10,
				pressure: 1013,
				location: { lat: 0, lon: 0 },
				timestamp: "2026-06-10T10:00:00Z",
				source: "api",
			},
		});
		document.body.innerHTML =
			`<input type="range" id="crrSlider" value="0.005">` +
			`<input type="number" id="crrValue" value="0.005">` +
			crrTempControlsMarkup(params);
		bind();

		const toggle = document.getElementById(
			"crrTempToggle",
		) as HTMLInputElement;
		toggle.checked = true;
		toggle.dispatchEvent(new Event("change"));

		expect(setParams).toHaveBeenCalledWith(
			expect.objectContaining({
				crr_temp_correction: true,
				ambient_temp_c: 18.3,
			}),
		);
		const ambient = document.getElementById(
			"crrTempAmbient",
		) as HTMLInputElement;
		expect(ambient.value).toBe("18.3");
	});

	test("changing ambient temperature updates the parameter and readout", () => {
		params = makeParams({ crr_temp_correction: true });
		document.body.innerHTML =
			`<input type="range" id="crrSlider" value="0.005">` +
			`<input type="number" id="crrValue" value="0.005">` +
			crrTempControlsMarkup(params);
		bind();

		const ambient = document.getElementById(
			"crrTempAmbient",
		) as HTMLInputElement;
		ambient.value = "30";
		ambient.dispatchEvent(new Event("change"));

		expect(setParams).toHaveBeenCalledWith(
			expect.objectContaining({ ambient_temp_c: 30 }),
		);
		expect(onChange).toHaveBeenCalled();
		const readout = document.getElementById("crrTempReadout") as HTMLElement;
		// factor(30, 0.8) = 0.918 → applied = 0.00459
		expect(readout.textContent).toContain("0.0046");
	});

	test("changing the sensitivity preset updates the parameter", () => {
		params = makeParams({ crr_temp_correction: true, ambient_temp_c: 30 });
		document.body.innerHTML =
			`<input type="range" id="crrSlider" value="0.005">` +
			`<input type="number" id="crrValue" value="0.005">` +
			crrTempControlsMarkup(params);
		bind();

		const sensitivity = document.getElementById(
			"crrTempSensitivity",
		) as HTMLSelectElement;
		sensitivity.value = "supple";
		sensitivity.dispatchEvent(new Event("change"));

		expect(setParams).toHaveBeenCalledWith(
			expect.objectContaining({ tire_sensitivity: "supple" }),
		);
		expect(onChange).toHaveBeenCalled();
	});

	test("weather refresh rounds the ambient temperature to one decimal", () => {
		params = makeParams({ crr_temp_correction: true, ambient_temp_c: 12 });
		document.body.innerHTML =
			`<input type="range" id="crrSlider" value="0.005">` +
			`<input type="number" id="crrValue" value="0.005">` +
			crrTempControlsMarkup(params);

		const fields = syncCrrTempAmbientFromWeather(params, 18.333333);
		expect(fields).toEqual({ ambient_temp_c: 18.3 });

		const ambient = document.getElementById(
			"crrTempAmbient",
		) as HTMLInputElement;
		expect(ambient.value).toBe("18.3");
	});

	test("weather refresh updates the ambient temperature when correction is on", () => {
		params = makeParams({ crr_temp_correction: true, ambient_temp_c: 12 });
		document.body.innerHTML =
			`<input type="range" id="crrSlider" value="0.005">` +
			`<input type="number" id="crrValue" value="0.005">` +
			crrTempControlsMarkup(params);

		const fields = syncCrrTempAmbientFromWeather(params, 21.4);
		expect(fields).toEqual({ ambient_temp_c: 21.4 });

		const ambient = document.getElementById(
			"crrTempAmbient",
		) as HTMLInputElement;
		expect(ambient.value).toBe("21.4");
	});

	test("weather refresh leaves parameters alone when correction is off", () => {
		params = makeParams({ crr_temp_correction: false, ambient_temp_c: 12 });
		document.body.innerHTML =
			`<input type="range" id="crrSlider" value="0.005">` +
			`<input type="number" id="crrValue" value="0.005">` +
			crrTempControlsMarkup(params);

		const fields = syncCrrTempAmbientFromWeather(params, 21.4);
		expect(fields).toEqual({});

		const ambient = document.getElementById(
			"crrTempAmbient",
		) as HTMLInputElement;
		expect(ambient.value).toBe("12");
	});

	test("moving the Crr slider refreshes the readout without recompute calls", () => {
		params = makeParams({ crr_temp_correction: true, ambient_temp_c: 10 });
		document.body.innerHTML =
			`<input type="range" id="crrSlider" value="0.005">` +
			`<input type="number" id="crrValue" value="0.005">` +
			crrTempControlsMarkup(params);
		bind();
		onChange.mockClear();

		const crrValue = document.getElementById("crrValue") as HTMLInputElement;
		crrValue.value = "0.004";
		const crrSlider = document.getElementById("crrSlider") as HTMLInputElement;
		crrSlider.dispatchEvent(new Event("input"));

		const readout = document.getElementById("crrTempReadout") as HTMLElement;
		// factor(10, 0.8) = 1.241 → applied = 0.004964
		expect(readout.textContent).toContain("0.0050");
		expect(onChange).not.toHaveBeenCalled();
	});
});
