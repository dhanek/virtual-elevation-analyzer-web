/**
 * The Calibration tab's figures: one fit figure with every fitted lap
 * overlaid (the wind component of measured air speed against compass heading,
 * each lap's fitted sinusoid over it and its residual beneath); then the
 * per-lap scales against the pooled one; then the per-lap wind vectors. A lap
 * has the same colour in all three.
 *
 * Why the wind COMPONENT and not raw air speed: the model is
 * `va = k·v + a·cos θ + b·sin θ`, so raw air speed also moves with ground
 * speed, and a lap ridden harder on one straight would draw as wind structure.
 * Subtracting the speed term leaves exactly the quantity the sinusoid claims to
 * explain — so a departure from the curve is a departure of the MODEL, which is
 * what the reader is being asked to judge.
 *
 * Every trace is a plain `type: "scatter"`: the app bundles the cartesian-only
 * Plotly build, so a polar subplot or a WebGL trace would pass unit tests and
 * then fail to render in the browser.
 *
 * House builder shape: pure `(input) => {data, layout, config}`, no DOM, no
 * Plotly reference, and no `layout.height`/`layout.width` — the container CSS
 * owns the box.
 */
import {
	getDefaultPlotConfig,
	type PlotDefinition,
} from "./StandardPlotBuilders";
import type { CalibrationSeries } from "../analysis/AirSpeedCalibration";

const MODEL_COLOR = "#ff8a3d";

/** Minus sign, not hyphen: matches the report's own number formatting. */
const signedPercent = (value: number): string =>
	`${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(1)} %`;

/**
 * One colour per lap, by the lap's position among the FITTED laps. The fit,
 * agreement and wind figures all call this with the same index, so a lap keeps
 * its colour from one figure to the next. Wraps after eight laps.
 */
const LAP_PALETTE = [
	"#4c8dff",
	"#ff8a3d",
	"#2fbf71",
	"#e5484d",
	"#a974ff",
	"#d4b106",
	"#17b8c4",
	"#e56fb0",
];

export const calibrationLapColor = (index: number): string =>
	LAP_PALETTE[index % LAP_PALETTE.length];

export interface CalibrationFitFigureInput {
	/** The fit's own pooled percent, for the title. */
	pooledPercent: number;
	/** Fitted laps only; a lap's position here sets its colour. */
	laps: Array<{
		series: CalibrationSeries;
		/** The lap's fitted wind coefficients, straight from the outcome row. */
		coefficients: { a: number; b: number };
		/** This lap's own fitted percent. */
		percent: number;
		windSpeed: number;
		windDirDeg: number;
	}>;
}

export function buildCalibrationFitFigure(
	input: CalibrationFitFigureInput,
): PlotDefinition {
	// The model is smooth; draw it on its own grid rather than through the
	// samples, which arrive in ride order and would zig-zag across the axis.
	const theta: number[] = [];
	for (let d = 0; d <= 360; d += 2) theta.push(d);

	const data = input.laps.flatMap((lap, i) => {
		const { series, coefficients } = lap;
		const color = calibrationLapColor(i);
		const group = series.label;
		const value = theta.map((d) => {
			const radians = (d * Math.PI) / 180;
			return (
				coefficients.a * Math.cos(radians) + coefficients.b * Math.sin(radians)
			);
		});
		return [
			{
				name: `${group} measured`,
				legendgroup: group,
				showlegend: false,
				type: "scatter",
				mode: "markers",
				x: series.headingDeg,
				y: series.windComponent,
				marker: { size: 4, color, opacity: 0.35 },
				hovertemplate: `${group}: %{x:.0f}° · %{y:.2f} m/s<extra></extra>`,
			},
			{
				// The one legend entry per lap: toggling it hides the lap's cloud,
				// curve and residual together through the shared legendgroup.
				name: `${group} · ${signedPercent(lap.percent)} · ${lap.windSpeed.toFixed(1)} m/s from ${Math.round(lap.windDirDeg)}°`,
				legendgroup: group,
				showlegend: true,
				type: "scatter",
				mode: "lines",
				x: theta,
				y: value,
				line: { color, width: 2 },
				hoverinfo: "skip",
			},
			{
				name: `${group} residual`,
				legendgroup: group,
				showlegend: false,
				type: "scatter",
				mode: "markers",
				x: series.headingDeg,
				y: series.residual,
				yaxis: "y2",
				marker: { size: 3, color, opacity: 0.35 },
				hovertemplate: `${group}: %{x:.0f}° · residual %{y:.2f} m/s<extra></extra>`,
			},
		];
	});

	return {
		data,
		layout: {
			title: {
				text: `Heading fit per lap · pooled ${signedPercent(input.pooledPercent)}`,
				font: { size: 13 },
			},
			showlegend: true,
			legend: { orientation: "h", y: -0.2 },
			margin: { l: 48, r: 12, t: 34, b: 34 },
			xaxis: {
				// Anchored to the residual strip, so the compass ticks and the
				// title sit at the bottom of the figure, not in the gap between
				// the fit and the strip.
				anchor: "y2",
				title: { text: "heading (°)" },
				range: [0, 360],
				tickvals: [0, 90, 180, 270, 360],
				ticktext: ["N", "E", "S", "W", "N"],
			},
			yaxis: { title: { text: "wind component (m/s)" }, domain: [0.34, 1] },
			yaxis2: {
				title: { text: "resid." },
				domain: [0, 0.24],
				anchor: "x",
				zeroline: true,
			},
		},
		config: getDefaultPlotConfig(),
	};
}

export interface CalibrationAgreementInput {
	pooledPercent: number;
	laps: Array<{ label: string; percent: number }>;
}

export function buildCalibrationAgreementFigure(
	input: CalibrationAgreementInput,
): PlotDefinition {
	return {
		data: [
			{
				name: "lap",
				type: "scatter",
				mode: "markers",
				x: input.laps.map((lap) => lap.percent),
				y: input.laps.map((lap) => lap.label),
				marker: {
					size: 10,
					color: input.laps.map((_, i) => calibrationLapColor(i)),
				},
				hovertemplate: "%{y}: %{x:.2f} %<extra></extra>",
			},
		],
		layout: {
			title: {
				text: `Lap agreement · pooled ${signedPercent(input.pooledPercent)}`,
				font: { size: 13 },
			},
			showlegend: false,
			margin: { l: 70, r: 12, t: 34, b: 40 },
			xaxis: { title: { text: "fitted scale (%)" }, zeroline: true },
			yaxis: { automargin: true },
			shapes: [
				{
					type: "line",
					x0: input.pooledPercent,
					x1: input.pooledPercent,
					yref: "paper",
					y0: 0,
					y1: 1,
					line: { color: MODEL_COLOR, width: 2, dash: "dash" },
				},
			],
		},
		config: getDefaultPlotConfig(),
	};
}

export interface CalibrationWindInput {
	laps: Array<{
		label: string;
		windSpeed: number;
		windDirDeg: number;
		warned: boolean;
	}>;
}

export function buildCalibrationWindFigure(
	input: CalibrationWindInput,
): PlotDefinition {
	// θ is the meteorological "from" direction, so (E, N) = (W·sin θ, W·cos θ)
	// points toward where the wind COMES FROM, not where it blows to.
	const maxSpeed = Math.max(0, ...input.laps.map((lap) => lap.windSpeed));
	const extent = Math.max(1, Math.ceil(maxSpeed * 1.2 * 2) / 2);
	return {
		data: input.laps.map((lap, i) => {
			const color = calibrationLapColor(i);
			const radians = (lap.windDirDeg * Math.PI) / 180;
			return {
				name: lap.label,
				type: "scatter",
				mode: "lines+markers+text",
				x: [0, lap.windSpeed * Math.sin(radians)],
				y: [0, lap.windSpeed * Math.cos(radians)],
				text: ["", lap.label],
				textposition: "top center",
				line: { width: 2, color },
				marker: {
					color,
					size: [0, 10],
					symbol: ["circle", lap.warned ? "circle-x" : "circle"],
				},
				hovertemplate: `${lap.label}: ${lap.windSpeed.toFixed(1)} m/s from ${Math.round(lap.windDirDeg)}°<extra></extra>`,
			};
		}),
		layout: {
			title: { text: "Wind per lap (from)", font: { size: 13 } },
			showlegend: false,
			margin: { l: 48, r: 12, t: 34, b: 40 },
			xaxis: {
				title: { text: "E (m/s)" },
				range: [-extent, extent],
				zeroline: true,
			},
			yaxis: {
				title: { text: "N (m/s)" },
				range: [-extent, extent],
				scaleanchor: "x",
				scaleratio: 1,
				zeroline: true,
			},
		},
		config: getDefaultPlotConfig(),
	};
}
