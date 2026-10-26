/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KalmanOutput } from "../../analysis/KalmanFit";
import type { RepeatLeg, RepeatUnitInput } from "../../analysis/RepeatSpread";
import {
	KALMAN_BUTTON_ID,
	resetKalmanState,
	setKalmanRunner,
} from "./kalmanView";
import { renderRepeatsView, repeatsTabMarkup } from "./repeatsView";

function leg(seed: number): RepeatLeg {
	const n = 120;
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
			(_, i) => -0.3 * a[i] - 0.004 * f[i] + 0.02 * Math.sin(i + seed),
		),
		distance: Float64Array.from({ length: n }, (_, i) => 5 * i),
	};
}

const units = (count: number): RepeatUnitInput[] =>
	Array.from({ length: count }, (_, j) => ({
		key: `lap-${j + 1}`,
		label: `Lap ${j + 1}`,
		legs: [leg(j)],
	}));

const OK: KalmanOutput = {
	status: "ok",
	reason: null,
	coupled: null,
	fit: {
		names: ["CdA", "Crr"],
		beta: [0.2954, 0.00177],
		se: [0.006, 0.00047],
		cov: [
			[3.6e-5, -2e-6],
			[-2e-6, 2.2e-7],
		],
		noise: {
			qPer5m: 0.045 ** 2,
			s2: 0.109 ** 2,
			ell: 200,
			r: 1e-4,
			terrainByDirection: false,
			atBound: ["r"],
		},
		jumps: [
			{
				leg: 1,
				label: "Lap 2",
				pos: 410,
				distance: 370,
				size: 1.24,
				t: 23.8,
				fitted: true,
			},
			{
				leg: 2,
				label: "Lap 3",
				pos: 460,
				distance: 420,
				size: 0.5,
				t: 10.1,
				fitted: false,
			},
		],
		warnings: ["noiseAtBound:r"],
		cdaCrrCorrelation: -0.71,
		speedContrast: 0.62,
		legs: 3,
		observations: 600,
	},
	residuals: [
		{
			label: "Lap 1",
			pos: [0, 5, 10],
			residual: [0, 0.01, -0.01],
			stretch: [0, 0, 0],
			masked: [[20, 60]],
		},
	],
	closedLoop: false,
	loopLength: null,
	sessions: [],
	sessionZ: [],
};

function render(count: number, kalman = true) {
	renderRepeatsView({
		units: units(count),
		fixedCrr: 0.004,
		cdaBounds: [0.15, 0.5],
		crrBounds: [0.0015, 0.03],
		systemMass: 85,
		sensitivities: [],
		kalman: kalman
			? {
					physics: { mass: 85, eta: 0.98, cda: 0.3, crr: 0.004 },
					airSpeed: "measured",
				}
			: undefined,
	});
}

const text = () => document.getElementById("repeats-tab")!.textContent ?? "";

beforeEach(() => {
	resetKalmanState();
	document.body.innerHTML = repeatsTabMarkup();
});

describe("Kalman block in the Repeats tab", () => {
	it("waits for the button: no fit on render", () => {
		const runner = vi.fn(() => JSON.stringify(OK));
		setKalmanRunner(runner);
		render(3);
		const button = document.getElementById(KALMAN_BUTTON_ID)!;
		expect(button.textContent).toBe("Run Kalman fit");
		expect(runner).not.toHaveBeenCalled();
	});

	it("fits on click and shows estimates ± SE, the classic row, noise, warnings and jumps", () => {
		const runner = vi.fn((_input: string) => JSON.stringify(OK));
		setKalmanRunner(runner);
		render(3);
		document.getElementById(KALMAN_BUTTON_ID)!.click();
		render(3);
		expect(runner).toHaveBeenCalledTimes(1);
		const sent = JSON.parse(runner.mock.calls[0][0]);
		expect(sent.legs).toHaveLength(3);
		const t = text();
		expect(t).toContain("0.2954");
		expect(t).toContain("± 0.0060");
		expect(t).toContain("0.00177");
		expect(t).toContain("Classic");
		expect(t).toContain("3 legs");
		expect(t).toContain("White noise at its 1 cm floor");
		expect(t).toContain("Lap 2");
		expect(t).toContain("+1.24");
		expect(t).toMatch(/not fitted/);
		expect(document.getElementById("repeatsKalmanPlot")).not.toBeNull();
	});

	it("never refits on a slider move, only when asked again", () => {
		const runner = vi.fn(() => JSON.stringify(OK));
		setKalmanRunner(runner);
		render(3);
		document.getElementById(KALMAN_BUTTON_ID)!.click();
		render(3);
		render(3);
		render(3);
		expect(runner).toHaveBeenCalledTimes(1);
		expect(text()).toContain("0.2954");
	});

	it("marks a result stale when the selection changes, and refits on Re-run", () => {
		const runner = vi.fn(() => JSON.stringify(OK));
		setKalmanRunner(runner);
		render(3);
		document.getElementById(KALMAN_BUTTON_ID)!.click();
		render(4);
		expect(text()).toContain("Selection changed");
		expect(text()).not.toContain("0.2954");
		expect(document.getElementById(KALMAN_BUTTON_ID)!.textContent).toBe(
			"Re-run Kalman fit",
		);
		expect(runner).toHaveBeenCalledTimes(1);
		document.getElementById(KALMAN_BUTTON_ID)!.click();
		expect(runner).toHaveBeenCalledTimes(2);
	});

	it("names a refusal", () => {
		setKalmanRunner(() =>
			JSON.stringify({
				...OK,
				status: "refused",
				reason: "cdaNeedsAirspeed",
				fit: null,
				residuals: [],
			}),
		);
		render(3);
		document.getElementById(KALMAN_BUTTON_ID)!.click();
		render(3);
		expect(text()).toContain("No measured air speed");
	});

	it("escapes text from the fit's output instead of rendering it as markup", () => {
		setKalmanRunner(() =>
			JSON.stringify({
				...OK,
				status: "refused",
				reason: "notIdentified",
				coupled: ['<img src=x onerror="alert(1)">', "Crr"],
				fit: null,
				residuals: [],
			}),
		);
		render(3);
		document.getElementById(KALMAN_BUTTON_ID)!.click();
		render(3);
		expect(document.querySelector("#repeats-tab img")).toBeNull();
		expect(text()).toContain('<img src=x onerror="alert(1)">');
	});

	it("says why with fewer than two legs, without a button", () => {
		render(1);
		expect(document.getElementById(KALMAN_BUTTON_ID)).toBeNull();
		expect(text()).toContain("Needs 2 or more legs");
	});

	it("is absent when the caller passes no Kalman input", () => {
		render(3, false);
		expect(text()).not.toContain("Kalman");
	});
});
