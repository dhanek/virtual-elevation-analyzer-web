import { describe, expect, it } from "vitest";
import type { CalibrationSeries } from "../analysis/AirSpeedCalibration";
import {
	buildCalibrationAgreementFigure,
	buildCalibrationFitFigure,
	calibrationLapColor,
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

const lapInput = (
	label: string,
	coefficients: { a: number; b: number },
	percent: number,
) => ({
	series: { ...series(), label },
	percent,
	coefficients,
	windSpeed: 1.2,
	windDirDeg: 52,
});

const fitFigure = () =>
	buildCalibrationFitFigure({
		pooledPercent: 0.2,
		laps: [
			lapInput("Lap 2", { a: 1.2, b: 0 }, -1.4),
			lapInput("Lap 3", { a: 0.4, b: -0.7 }, 0.0),
		],
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

type FitTrace = {
	name: string;
	type: string;
	legendgroup: string;
	showlegend: boolean;
	yaxis?: string;
	x: number[];
	y: number[];
	marker?: { color: string };
	line?: { color: string };
};

describe("buildCalibrationFitFigure", () => {
	const figure = fitFigure();
	const traces = figure.data as unknown as FitTrace[];
	const lapTraces = (i: number) => traces.slice(i * 3, i * 3 + 3);

	it("draws three traces per lap: cloud, curve, residual", () => {
		expect(traces).toHaveLength(6);
	});

	it("groups a lap's traces and lists only its curve in the legend", () => {
		["Lap 2", "Lap 3"].forEach((label, i) => {
			const [cloud, curve, resid] = lapTraces(i);
			for (const t of [cloud, curve, resid]) expect(t.legendgroup).toBe(label);
			expect(curve.showlegend).toBe(true);
			expect(cloud.showlegend).toBe(false);
			expect(resid.showlegend).toBe(false);
		});
		expect(traces[1].name).toBe("Lap 2 · −1.4 % · 1.2 m/s from 52°");
		expect(figure.layout.showlegend).toBe(true);
	});

	it("draws each curve from its own coefficients", () => {
		const at = (t: FitTrace, d: number) => t.y[t.x.indexOf(d)];
		expect(at(traces[1], 0)).toBeCloseTo(1.2, 9);
		expect(at(traces[1], 90)).toBeCloseTo(0, 9);
		expect(at(traces[4], 0)).toBeCloseTo(0.4, 9);
		expect(at(traces[4], 90)).toBeCloseTo(-0.7, 9);
	});

	it("puts every residual on y2, below the fit", () => {
		expect(traces[2].yaxis).toBe("y2");
		expect(traces[5].yaxis).toBe("y2");
		expect(traces[0].yaxis).toBeUndefined();
		const y = figure.layout.yaxis as { domain: number[] };
		const y2 = figure.layout.yaxis2 as { domain: number[] };
		expect(y.domain[0]).toBeGreaterThan(y2.domain[1]);
	});

	it("labels the heading axis under the residual strip", () => {
		expect((figure.layout.xaxis as { anchor: string }).anchor).toBe("y2");
	});

	it("colours by lap position, in all three of a lap's traces", () => {
		[0, 1].forEach((i) => {
			const [cloud, curve, resid] = lapTraces(i);
			expect(cloud.marker?.color).toBe(calibrationLapColor(i));
			expect(curve.line?.color).toBe(calibrationLapColor(i));
			expect(resid.marker?.color).toBe(calibrationLapColor(i));
		});
		expect(calibrationLapColor(0)).not.toBe(calibrationLapColor(1));
	});

	it("titles the figure with the pooled percent", () => {
		const title = figure.layout.title as { text: string };
		expect(title.text).toBe("Heading fit per lap · pooled +0.2 %");
	});

	it("leaves the box to the container CSS", () => {
		expect(figure.layout.height).toBeUndefined();
		expect(figure.layout.width).toBeUndefined();
	});

	it("spans a full turn on the heading axis", () => {
		const axis = figure.layout.xaxis as { range: number[] };
		expect(axis.range).toEqual([0, 360]);
	});

	it("gives the same lap the same colour in the agreement and wind figures", () => {
		const agreement = agreementFigure().data[0].marker as { color: string[] };
		const wind = windFigure().data as unknown as Array<{
			line: { color: string };
			marker: { color: string };
		}>;
		[0, 1].forEach((i) => {
			expect(agreement.color[i]).toBe(calibrationLapColor(i));
			expect(wind[i].line.color).toBe(calibrationLapColor(i));
			expect(wind[i].marker.color).toBe(calibrationLapColor(i));
		});
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
		const traces = [fitFigure(), agreementFigure(), windFigure()].flatMap(
			(f) => f.data,
		);
		expect(traces.length).toBeGreaterThan(0);
		for (const trace of traces) {
			expect(trace.type).toBe("scatter");
		}
	});
});
