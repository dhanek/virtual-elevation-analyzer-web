// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
	type AnalysisParameters,
	AnalysisParametersComponent,
	DEFAULT_PARAMETERS,
} from "./AnalysisParameters";

const CONTAINER_ID = "analysisParametersTestContainer";

let component: AnalysisParametersComponent;
let onChange: ReturnType<typeof vi.fn>;

function input(id: string): HTMLInputElement {
	const element = document.querySelector(`#${id}`) as HTMLInputElement | null;
	if (!element) throw new Error(`missing #${id} in the rendered form`);
	return element;
}

/** Type into a field the way a user does: set the value, then fire "input". */
function typeInto(id: string, value: string): void {
	const element = input(id);
	element.value = value;
	element.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
	document.body.innerHTML = `<div id="${CONTAINER_ID}"></div>`;
	onChange = vi.fn();
	component = new AnalysisParametersComponent(
		CONTAINER_ID,
		onChange as unknown as (params: AnalysisParameters) => void,
	);
	onChange.mockClear();
});

describe("DEFAULT_PARAMETERS wind height fields", () => {
	test("carries the fresh 0.5 default and a 'manual' provenance", () => {
		expect(DEFAULT_PARAMETERS.wind_height_factor).toBe(0.5);
		expect(DEFAULT_PARAMETERS.wind_entry).toBe("manual");
	});
});

describe("manual wind entry (D-05)", () => {
	test("typing a wind speed sets wind_entry='manual' and the factor to 1.0", () => {
		typeInto("wind_speed", "3.5");

		const params = component.getParameters();
		expect(params.wind_entry).toBe("manual");
		expect(params.wind_height_factor).toBe(1.0);
	});

	/**
	 * WR-04. This test used to assert the opposite, and the assertion was wrong.
	 *
	 * D-09 is explicit that k scales wind SPEED only — it never touches the
	 * bearing. The D-05 argument for resetting k ("the app cannot know whether a
	 * typed number is a 10 m forecast or a rider-height reading") is an argument
	 * about the speed; it says nothing about a direction. So a one-degree
	 * correction to a bearing must not un-transfer a wind speed the weather API
	 * wrote and the user never edited — otherwise the wind term silently changes
	 * by 2x because of an edit to an orthogonal field.
	 */
	test("typing a wind direction leaves the speed's provenance and factor alone", () => {
		// A wind speed is needed first, otherwise validateParameters disables
		// and clears the direction field.
		component.setParameters({
			wind_speed: 3.5,
			wind_entry: "weather",
			wind_height_factor: 0.5,
		});
		onChange.mockClear();

		typeInto("wind_direction", "220");

		const params = component.getParameters();
		expect(params.wind_direction).toBe(220);
		expect(params.wind_entry).toBe("weather");
		expect(params.wind_height_factor).toBe(0.5);
	});

	test("typing a wind speed still marks manual even after a direction edit", () => {
		component.setParameters({
			wind_speed: 3.5,
			wind_entry: "weather",
			wind_height_factor: 0.5,
		});
		typeInto("wind_direction", "220");
		typeInto("wind_speed", "4.2");

		const params = component.getParameters();
		expect(params.wind_entry).toBe("manual");
		expect(params.wind_height_factor).toBe(1.0);
	});

	test("editing system_mass raises no false manual-entry signal", () => {
		component.setParameters({
			wind_entry: "weather",
			wind_height_factor: 0.5,
		});
		onChange.mockClear();

		typeInto("system_mass", "82");

		const params = component.getParameters();
		expect(params.system_mass).toBe(82);
		expect(params.wind_entry).toBe("weather");
		expect(params.wind_height_factor).toBe(0.5);
	});

	test("a programmatic .value fill does not trip the listener", () => {
		component.setParameters({
			wind_entry: "weather",
			wind_height_factor: 0.5,
		});
		onChange.mockClear();

		// This is how auto-rho fills the weather wind: no "input" event.
		input("wind_speed").value = "4.2";
		typeInto("system_mass", "82");

		const params = component.getParameters();
		expect(params.wind_speed).toBe(4.2);
		expect(params.wind_entry).toBe("weather");
		expect(params.wind_height_factor).toBe(0.5);
	});

	test("is idempotent once already manual at 1.0", () => {
		component.setParameters({
			wind_speed: 3.5,
			wind_entry: "manual",
			wind_height_factor: 1.0,
		});
		onChange.mockClear();

		typeInto("wind_speed", "3.6");

		// Only the shared form handler emitted; markManualWindEntry returned
		// early rather than re-writing state on every keystroke.
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(component.getParameters().wind_entry).toBe("manual");
		expect(component.getParameters().wind_height_factor).toBe(1.0);
	});
});

describe("carry-over through the wholesale form rebuild", () => {
	test("a system_mass edit preserves a tuned wind_height_factor", () => {
		component.setParameters({
			wind_entry: "weather",
			wind_height_factor: 0.65,
		});
		onChange.mockClear();

		typeInto("system_mass", "82");

		expect(component.getParameters().wind_height_factor).toBe(0.65);
	});

	test("a system_mass edit preserves the legacy 'unknown' provenance", () => {
		component.setParameters({
			wind_entry: "unknown",
			wind_height_factor: 1.0,
		});
		onChange.mockClear();

		typeInto("system_mass", "82");

		const params = component.getParameters();
		expect(params.wind_entry).toBe("unknown");
		expect(params.wind_height_factor).toBe(1.0);
	});

	test("hand-typing a wind resolves 'unknown' to 'manual' at k = 1.0", () => {
		component.setParameters({
			wind_entry: "unknown",
			wind_height_factor: 1.0,
		});
		onChange.mockClear();

		typeInto("wind_speed", "3.5");

		const params = component.getParameters();
		expect(params.wind_entry).toBe("manual");
		expect(params.wind_height_factor).toBe(1.0);
	});
});
