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

	it("draws each lap as a polar spoke from the centre out to its wind", () => {
		expect(figure.data).toHaveLength(2);
		laps.forEach((lap, i) => {
			const trace = figure.data[i] as {
				type: string;
				r: number[];
				theta: number[];
			};
			expect(trace.type).toBe("scatterpolar");
			expect(trace.r).toEqual([0, lap.windSpeed]);
			expect(trace.theta).toEqual([lap.windDirDeg, lap.windDirDeg]);
		});
	});

	it("colours each lap with the shared lap colour", () => {
		figure.data.forEach((trace, i) => {
			expect((trace.line as { color: string }).color).toBe(
				calibrationLapColor(i),
			);
		});
	});

	it("names each lap and its wind in the legend, not at the tip", () => {
		expect(figure.layout.showlegend).toBe(true);
		expect(figure.data[0].name).toBe("Lap 2 · 1.2 m/s from 52°");
		expect(figure.data[0].mode).toBe("lines+markers");
	});

	it("marks the warned laps distinctly at the tip, and only the tip", () => {
		const marker = (i: number) =>
			figure.data[i].marker as { symbol: string[]; size: number[] };
		expect(marker(0).symbol[1]).toBe("circle");
		expect(marker(1).symbol[1]).toBe("circle-x");
		expect(marker(0).size[0]).toBe(0);
	});

	it("reads as a compass: north up, clockwise", () => {
		const polar = figure.layout.polar as {
			angularaxis: { direction: string; rotation: number; ticktext: string[] };
		};
		expect(polar.angularaxis.direction).toBe("clockwise");
		expect(polar.angularaxis.rotation).toBe(90);
		expect(polar.angularaxis.ticktext).toEqual(["N", "E", "S", "W"]);
	});

	it("starts the radius at zero and keeps the radial labels sparse", () => {
		const radial = (
			figure.layout.polar as {
				radialaxis: { range: number[]; tickvals: number[] };
			}
		).radialaxis;
		expect(radial.range[0]).toBe(0);
		expect(radial.range[1]).toBeGreaterThanOrEqual(1.8);
		expect(radial.tickvals.length).toBeGreaterThan(0);
		expect(radial.tickvals.length).toBeLessThanOrEqual(3);
		expect(Math.max(...radial.tickvals)).toBeLessThanOrEqual(radial.range[1]);
	});

	it("keeps the radial labels sparse for a strong wind too", () => {
		const strong = buildCalibrationWindFigure({
			laps: [
				{ label: "Lap 1", windSpeed: 9.3, windDirDeg: 200, warned: false },
			],
		});
		const radial = (
			strong.layout.polar as {
				radialaxis: { range: number[]; tickvals: number[] };
			}
		).radialaxis;
		expect(radial.tickvals.length).toBeLessThanOrEqual(3);
		expect(radial.range[1]).toBeGreaterThanOrEqual(9.3);
	});
});

describe("trace types the bundled Plotly registers", () => {
	/**
	 * `plotlyBundle.ts` registers core (scatter), contour and scatterpolar only;
	 * any other type passes these tests and renders as nothing in the browser.
	 * Polar is allowed for the wind rose alone — the fit and agreement figures
	 * share cartesian axes with their siblings.
	 */
	it("the fit and agreement figures are plain scatter", () => {
		const traces = [fitFigure(), agreementFigure()].flatMap((f) => f.data);
		expect(traces.length).toBeGreaterThan(0);
		for (const trace of traces) {
			expect(trace.type).toBe("scatter");
		}
	});

	it("the wind figure is scatterpolar", () => {
		const traces = windFigure().data;
		expect(traces.length).toBeGreaterThan(0);
		for (const trace of traces) {
			expect(trace.type).toBe("scatterpolar");
		}
	});
});
