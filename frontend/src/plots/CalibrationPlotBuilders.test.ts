import { describe, expect, it } from "vitest";
import type { CalibrationSeries } from "../analysis/AirSpeedCalibration";
import {
	buildCalibrationAgreementFigure,
	buildCalibrationLapFigure,
	buildCalibrationWindFigure,
} from "./CalibrationPlotBuilders";

const series = (): CalibrationSeries => {
	const headingDeg: number[] = [];
	const velocity: number[] = [];
	const windComponent: number[] = [];
	const model: number[] = [];
	const residual: number[] = [];
	for (let d = 0; d < 360; d += 10) {
		const m = 1.2 * Math.cos((d * Math.PI) / 180);
		headingDeg.push(d);
		velocity.push(10);
		model.push(m);
		windComponent.push(m + 0.1);
		residual.push(0.1);
	}
	return {
		label: "Lap 2",
		headingDeg,
		velocity,
		windComponent,
		model,
		residual,
	};
};

const lapFigure = () =>
	buildCalibrationLapFigure({
		series: series(),
		percent: -1.4,
		coefficients: { a: 1.2, b: 0 },
		windSpeed: 1.2,
		windDirDeg: 52,
	});

const agreementFigure = () =>
	buildCalibrationAgreementFigure({
		pooledPercent: 0.2,
		laps: [
			{ label: "Lap 2", percent: -1.4 },
			{ label: "Lap 3", percent: 0.0 },
			{ label: "Lap 4", percent: 1.5 },
		],
	});

const windFigure = () =>
	buildCalibrationWindFigure({
		laps: [
			{ label: "Lap 2", windSpeed: 1.2, windDirDeg: 52, warned: false },
			{ label: "Lap 5", windSpeed: 1.8, windDirDeg: 32, warned: true },
		],
	});

describe("buildCalibrationLapFigure", () => {
	const figure = lapFigure();

	it("draws measured samples, the model curve and the residual strip", () => {
		expect(figure.data).toHaveLength(3);
		expect(figure.data.map((t) => t.name)).toEqual([
			"measured",
			"model",
			"residual",
		]);
	});

	it("draws the curve from the passed coefficients", () => {
		const model = figure.data[1] as { x: number[]; y: number[] };
		expect(model.y[model.x.indexOf(0)]).toBeCloseTo(1.2, 9);
		const withB = buildCalibrationLapFigure({
			series: series(),
			percent: 0,
			coefficients: { a: 0.4, b: -0.7 },
			windSpeed: 1,
			windDirDeg: 0,
		}).data[1] as { x: number[]; y: number[] };
		expect(withB.y[withB.x.indexOf(0)]).toBeCloseTo(0.4, 9);
		expect(withB.y[withB.x.indexOf(90)]).toBeCloseTo(-0.7, 9);
	});

	it("puts the residual strip on its own axis, below the fit", () => {
		expect(figure.data[2].yaxis).toBe("y2");
		const y = figure.layout.yaxis as { domain: number[] };
		const y2 = figure.layout.yaxis2 as { domain: number[] };
		expect(y.domain[0]).toBeGreaterThan(y2.domain[1]);
	});

	it("names the lap, its percent and its wind in the title", () => {
		const title = figure.layout.title as { text: string };
		expect(title.text).toContain("Lap 2");
		expect(title.text).toContain("−1.4 %");
		expect(title.text).toContain("1.2 m/s");
		expect(title.text).toContain("52°");
	});

	it("leaves the box to the container CSS", () => {
		expect(figure.layout.height).toBeUndefined();
		expect(figure.layout.width).toBeUndefined();
	});

	it("spans a full turn on the heading axis", () => {
		const axis = figure.layout.xaxis as { range: number[] };
		expect(axis.range).toEqual([0, 360]);
	});
});

describe("buildCalibrationAgreementFigure", () => {
	const figure = agreementFigure();

	it("plots one point per lap", () => {
		expect(figure.data[0].x).toEqual([-1.4, 0.0, 1.5]);
		expect(figure.data[0].y).toEqual(["Lap 2", "Lap 3", "Lap 4"]);
	});

	it("marks the pooled value as a line, not a point", () => {
		const shapes = figure.layout.shapes as Array<{ x0: number; x1: number }>;
		expect(shapes).toHaveLength(1);
		expect(shapes[0].x0).toBe(0.2);
		expect(shapes[0].x1).toBe(0.2);
	});
});

describe("buildCalibrationWindFigure", () => {
	const figure = windFigure();
	const laps = [
		{ windSpeed: 1.2, windDirDeg: 52, warned: false },
		{ windSpeed: 1.8, windDirDeg: 32, warned: true },
	];

	it("draws each lap as a vector from the origin to (E, N)", () => {
		expect(figure.data).toHaveLength(2);
		laps.forEach((lap, i) => {
			const trace = figure.data[i] as {
				type: string;
				x: number[];
				y: number[];
			};
			const rad = (lap.windDirDeg * Math.PI) / 180;
			expect(trace.type).toBe("scatter");
			expect(trace.x[0]).toBe(0);
			expect(trace.y[0]).toBe(0);
			expect(trace.x[1]).toBeCloseTo(lap.windSpeed * Math.sin(rad), 9);
			expect(trace.y[1]).toBeCloseTo(lap.windSpeed * Math.cos(rad), 9);
		});
	});

	it("marks the warned laps distinctly at the tip", () => {
		const symbol = (i: number) =>
			(figure.data[i].marker as { symbol: string[] }).symbol[1];
		expect(symbol(0)).toBe("circle");
		expect(symbol(1)).toBe("circle-x");
	});

	it("locks the aspect so directions are true", () => {
		const yaxis = figure.layout.yaxis as {
			scaleanchor: string;
			scaleratio: number;
		};
		expect(yaxis.scaleanchor).toBe("x");
		expect(yaxis.scaleratio).toBe(1);
	});

	it("centres the origin with symmetric axes", () => {
		const x = figure.layout.xaxis as { range: number[] };
		const y = figure.layout.yaxis as { range: number[] };
		expect(x.range[0]).toBe(-x.range[1]);
		expect(y.range[0]).toBe(-y.range[1]);
		expect(x.range[1]).toBeGreaterThanOrEqual(1.8);
	});
});

describe("cartesian-only bundle", () => {
	it("every trace is a plain scatter (no polar, no WebGL)", () => {
		const traces = [lapFigure(), agreementFigure(), windFigure()].flatMap(
			(f) => f.data,
		);
		expect(traces.length).toBeGreaterThan(0);
		for (const trace of traces) {
			expect(trace.type).toBe("scatter");
		}
	});
});
