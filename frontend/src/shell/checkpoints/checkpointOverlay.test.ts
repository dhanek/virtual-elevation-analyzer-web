/** @vitest-environment jsdom */
/**
 * Course checkpoints on the VE screen, through the real figure builders:
 * the table must read what the residual plot draws at each lap's passing,
 * a lap that misses a checkpoint reads "not passed", and a click on the
 * VE plot places the armed checkpoint at the clicked sample.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../analysis/requestModeUpdate", () => ({
	requestModeUpdate: vi.fn(),
}));

import { AppState } from "../../state/AppState";
import {
	calculateMeanElevationProfile,
	renderGpsLapVEPlots,
} from "../gpsLap/gpsLapPlots";
import { decorateStackedWithCheckpoints } from "../gpsLap/gpsLapCheckpoints";
import type { LapVEProfile } from "../gpsLap/types";
import {
	calculateOutAndBackMeanElevation,
	renderOutAndBackPlots,
} from "../outAndBack/outAndBackPlots";
import { decorateOutAndBackWithCheckpoints } from "../outAndBack/outAndBackCheckpoints";
import type { OutAndBackVEProfile } from "../outAndBack/types";
import { standardCheckpointRows } from "../ve/standardCheckpoints";
import { configureCheckpoints } from "./checkpointController";
import {
	bindCheckpointPlotClick,
	resetCheckpointPlacement,
	sampleAtClick,
	tagTraceSamples,
} from "./checkpointOverlay";

const CENTER_LAT = 52.53;
const CENTER_LON = 13.45;
const M_PER_DEG_LAT = 111_194.93;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((CENTER_LAT * Math.PI) / 180);
const T0 = 1_000_000;

/** A track from metre offsets (east, north), one sample a second. */
function fitDataFrom(points: [number, number][]) {
	return {
		timestamps: points.map((_, i) => T0 + i),
		position_lat: points.map(([, n]) => CENTER_LAT + n / M_PER_DEG_LAT),
		position_long: points.map(([e]) => CENTER_LON + e / M_PER_DEG_LON),
	};
}

const LAP = 126; // 5 m/s round a 100 m circle

function circlePoints(laps: number): [number, number][] {
	return Array.from({ length: laps * LAP }, (_, i) => {
		const a = (2 * Math.PI * i) / LAP;
		return [100 * Math.cos(a), 100 * Math.sin(a)];
	});
}

let appState: AppState;
let saved: number[][];
let reacted: Record<string, { data: any[]; layout: any }>;

function setUp(points: [number, number][], checkpointSamples: number[]): void {
	appState = new AppState();
	appState.currentFitData = fitDataFrom(points) as never;
	appState.currentFileHash = "hash";
	appState.checkpoints = checkpointSamples.map((i) => T0 + i);
	saved = [];
	configureCheckpoints({
		appState,
		parameterStorage: {
			saveCheckpoints: (_hash: string, ts: number[]) => {
				saved.push(ts);
				return Promise.resolve();
			},
		} as never,
		getMapVisualization: () => null,
		getSelectedDataTimeRange: () => ({ startTime: T0, duration: 1000 }),
	});
}

beforeEach(() => {
	reacted = {};
	(window as any).Plotly = {
		react: (id: string, data: any[], layout: any) => {
			reacted[id] = { data, layout };
		},
	};
	document.body.innerHTML = `
		<div id="gpsLapCheckpointTable"></div>
		<div id="oabCheckpointTable"></div>
		<div id="veCheckpointTable"></div>`;
	resetCheckpointPlacement();
});

afterEach(() => {
	delete (window as any).Plotly;
});

/** Three laps of the circle; lap 3 is cut short of every checkpoint. */
function stackedLaps(): LapVEProfile[] {
	return [0, 1, 2].map((lap) => {
		const length = lap === 2 ? 20 : LAP;
		const indices = Array.from({ length }, (_, j) => lap * LAP + j);
		return {
			lapNumber: lap + 1,
			indices,
			distances: indices.map((_, j) => j * 0.005),
			// VE drifts up by lap and along the lap; the reference is a hill.
			virtualElevation: indices.map((_, j) => lap * 0.3 + j * 0.01),
			virtualElevationCompare: null,
			actualElevation: indices.map((_, j) => 5 * Math.sin(j / 20)),
			referenceElevation: null,
			supplementarySeries: {} as never,
			duration: length,
			totalDistance: (length - 1) * 0.005,
		};
	});
}

function tableCells(id: string): string[][] {
	return Array.from(document.querySelectorAll(`#${id} tbody tr`)).map((tr) =>
		Array.from(tr.querySelectorAll("td")).map((td) => td.textContent ?? ""),
	);
}

function signed(value: number): string {
	const text = Math.abs(value).toFixed(2);
	return Number(text) === 0 ? text : `${value < 0 ? "−" : "+"}${text}`;
}

describe("stacked laps (GPS laps, one-way, Standard stacked)", () => {
	it("reads VE − reference off each lap's residual trace at its passing", () => {
		setUp(circlePoints(3), [40, 90]);
		const laps = stackedLaps();
		const mean = calculateMeanElevationProfile(laps);
		renderGpsLapVEPlots(
			laps,
			mean,
			{ meanR2: 0, meanRMSE: 0, closingError: 0 },
			null,
			decorateStackedWithCheckpoints(laps),
		);
		const residuals = reacted.gpsLapResidualPlot.data;
		const rows = tableCells("gpsLapCheckpointTable");

		// Laps 1 and 2 pass both checkpoints at their own samples 40 and 90.
		for (const lap of [0, 1]) {
			const y = residuals[lap].y as number[];
			expect(rows[lap]).toEqual([
				`Lap ${lap + 1}`,
				signed(y[40]),
				signed(y[90]),
				signed(y[90] - y[40]),
			]);
		}
		// Lap 3 never gets there: "not passed", never a number.
		expect(rows[2]).toEqual(["Lap 3", "not passed", "not passed", "—"]);
		// Mean / SD / n over the two laps that passed.
		expect(rows[3][0]).toBe("Mean");
		expect(rows[5]).toEqual(["n", "2", "2", "2"]);
	});

	it("draws one dotted marker per checkpoint at the median passing", () => {
		setUp(circlePoints(3), [40, 90]);
		const laps = stackedLaps();
		renderGpsLapVEPlots(
			laps,
			calculateMeanElevationProfile(laps),
			{ meanR2: 0, meanRMSE: 0, closingError: 0 },
			null,
			decorateStackedWithCheckpoints(laps),
		);
		const ve = reacted.gpsLapVePlot.layout;
		expect(ve.annotations.map((a: any) => a.text)).toEqual(["CP1", "CP2"]);
		expect(ve.shapes.map((s: any) => s.x0)).toEqual([
			expect.closeTo(0.2, 9),
			expect.closeTo(0.45, 9),
		]);
		// The residual plot keeps its zero line and gains the two labelled markers.
		const residual = reacted.gpsLapResidualPlot.layout;
		expect(residual.shapes).toHaveLength(3);
		expect(residual.annotations.map((a: any) => a.text)).toEqual([
			"CP1",
			"CP2",
		]);
	});

	it("names a lap whose curve is shifted away from the markers", () => {
		setUp(circlePoints(3), [40, 90]);
		const laps = stackedLaps();
		// Lap 2 drawn 75 m further along the axis, as a lap that started early.
		laps[1].distances = laps[1].distances.map((d) => d + 0.075);
		renderGpsLapVEPlots(
			laps,
			calculateMeanElevationProfile(laps),
			{ meanR2: 0, meanRMSE: 0, closingError: 0 },
			null,
			decorateStackedWithCheckpoints(laps),
		);
		// Two laps passed: the median sits halfway, 38 m from each. The lap
		// label carries a ⚠ whose tooltip says by how much; lap 3 passed none.
		const labels = [
			...document.querySelectorAll(
				"#gpsLapCheckpointTable tbody td:first-child",
			),
		].slice(0, 3);
		expect(labels.map((td) => td.textContent)).toEqual([
			"Lap 1 ⚠",
			"Lap 2 ⚠",
			"Lap 3",
		]);
		const tip = (td: Element) =>
			td.querySelector("span")?.getAttribute("title");
		expect(tip(labels[0])).toMatch(/^Passes the checkpoints −3[78]/);
		expect(tip(labels[1])).toMatch(/^Passes the checkpoints \+3[78]/);
	});

	it("shows no markers and a hint when there are no checkpoints", () => {
		setUp(circlePoints(3), []);
		const laps = stackedLaps();
		renderGpsLapVEPlots(
			laps,
			calculateMeanElevationProfile(laps),
			{ meanR2: 0, meanRMSE: 0, closingError: 0 },
			null,
			decorateStackedWithCheckpoints(laps),
		);
		expect(reacted.gpsLapVePlot.layout.shapes).toBeUndefined();
		const table = document.getElementById("gpsLapCheckpointTable")!;
		expect(table.querySelector("table")).toBeNull();
		expect(table.textContent).toContain("+ CP1");
	});
});

describe("out-and-back legs", () => {
	it("finds the checkpoint on both legs, the inbound one going the other way", () => {
		// 600 m north from A and back, 5 m/s: outbound 0–120, inbound 120–240.
		const points: [number, number][] = Array.from({ length: 241 }, (_, i) => [
			0,
			i <= 120 ? i * 5 : (240 - i) * 5,
		]);
		setUp(points, [40]);
		const out = Array.from({ length: 121 }, (_, j) => j);
		const back = Array.from({ length: 121 }, (_, j) => 120 + j);
		const profile: OutAndBackVEProfile = {
			sectionNumber: 1,
			outboundIndices: out,
			inboundIndices: back,
			outboundDistances: out.map((j) => j * 0.005),
			outboundVE: out.map((j) => j * 0.02),
			outboundVECompare: null,
			outboundActualElevation: out.map((j) => j * 0.015),
			outboundReferenceElevation: null,
			outboundSeries: null,
			inboundDistances: back.map((_, j) => j * 0.005),
			inboundVE: back.map((_, j) => -j * 0.01),
			inboundVECompare: null,
			inboundActualElevation: back.map((_, j) => (120 - j) * 0.015),
			inboundReferenceElevation: null,
			inboundSeries: null,
			outboundDuration: 120,
			inboundDuration: 120,
			totalDistance: 1.2,
		};
		renderOutAndBackPlots(
			(window as any).Plotly,
			[profile],
			calculateOutAndBackMeanElevation([profile]),
			null,
			decorateOutAndBackWithCheckpoints([profile]),
		);
		const rows = tableCells("oabCheckpointTable");
		expect(rows[0][0]).toBe("S1 A→B");
		expect(rows[1][0]).toBe("S1 B→A");

		// Each leg's value is the residual plot's y at the leg's passing x.
		const residuals = reacted.oabVeResidualsPlot.data;
		const at = (trace: any, x: number) =>
			trace.y[trace.x.findIndex((v: number) => Math.abs(v - x) < 1e-9)];
		expect(rows[0][1]).toBe(signed(at(residuals[0], 0.2)));
		expect(rows[1][1]).toBe(signed(at(residuals[1], 0.2)));
	});
});

describe("Standard stitched rows", () => {
	it("cut each FIT lap to the trim window and read the residual trace", () => {
		const main = [10, 11, 12, 13, 14, 15];
		const residualY = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
		const figures = {
			elevation: { data: [{ x: main, y: main }], layout: {} },
			residuals: { data: [{ x: main, y: residualY }], layout: {} },
		};
		const series = {
			indices: Array.from({ length: 20 }, (_, i) => 100 + i),
			timestamps: Array.from({ length: 20 }, (_, i) => T0 + i),
		};
		const rows = standardCheckpointRows(
			series,
			{ trimStart: 10, xPointsMain: main },
			figures,
			[
				{ lapNumber: 1, lap: { start_time: T0, end_time: T0 + 12 } as never },
				{
					lapNumber: 2,
					lap: { start_time: T0 + 12, end_time: T0 + 19 } as never,
				},
				{
					lapNumber: 3,
					lap: { start_time: T0 + 30, end_time: T0 + 40 } as never,
				},
			],
		);
		expect(rows.map((r) => r.label)).toEqual(["Lap 1", "Lap 2"]);
		expect(rows[0].indices).toEqual([110, 111, 112]);
		expect(rows[1].residual).toEqual([0.3, 0.4, 0.5, 0.6]);
		// The VE traces are tagged for a click.
		expect(
			sampleAtClick(figures.elevation.data, {
				data: figures.elevation.data[0],
				pointNumber: 2,
			}),
		).toBe(112);
	});
});

describe("placing a checkpoint by clicking the VE plot", () => {
	it("a click lands on the clicked trace's sample, or the nearest x of the first lap", () => {
		const lap = { x: [0, 0.1, 0.2] };
		const mean = { x: [0, 0.05, 0.1, 0.15, 0.2] };
		tagTraceSamples(lap, [500, 501, 502]);
		expect(sampleAtClick([mean, lap], { data: lap, pointNumber: 1 })).toBe(501);
		expect(
			sampleAtClick([mean, lap], { data: mean, pointNumber: 3, x: 0.16 }),
		).toBe(502);
	});

	it("does nothing until a checkpoint is picked, then places that one", () => {
		setUp(circlePoints(3), [40]);
		const laps = stackedLaps();
		renderGpsLapVEPlots(
			laps,
			calculateMeanElevationProfile(laps),
			{ meanR2: 0, meanRMSE: 0, closingError: 0 },
			null,
			decorateStackedWithCheckpoints(laps),
		);
		const div = document.createElement("div");
		div.id = "gpsLapVePlot";
		let handler: ((e: unknown) => void) | null = null;
		Object.assign(div, {
			on: (_: string, h: (e: unknown) => void) => (handler = h),
			data: reacted.gpsLapVePlot.data,
		});
		document.body.appendChild(div);
		bindCheckpointPlotClick("gpsLapVePlot");
		const lapTrace = reacted.gpsLapVePlot.data.find(
			(t: any) => t.x === laps[1].distances,
		);

		handler!({ points: [{ data: lapTrace, pointNumber: 60 }] });
		expect(appState.checkpoints).toEqual([T0 + 40]);

		// Pick "+ CP2", then click lap 2 at its sample 60.
		const add = document.querySelector<HTMLButtonElement>(
			'[data-checkpoint-place="1"]',
		)!;
		expect(add.textContent).toBe("+ CP2");
		add.click();
		handler!({ points: [{ data: lapTrace, pointNumber: 60 }] });
		expect(appState.checkpoints).toEqual([T0 + 40, T0 + LAP + 60]);
		expect(saved[saved.length - 1]).toEqual([T0 + 40, T0 + LAP + 60]);

		// One click per pick.
		handler!({ points: [{ data: lapTrace, pointNumber: 10 }] });
		expect(appState.checkpoints).toHaveLength(2);
	});
});
