/**
 * The Calibration tab: how the last Auto Adjust arrived at its number.
 *
 * It draws what the heading fit already computed (see `calibrationSeries`) and
 * never fits anything itself. The tab keeps the last run's outcome and the
 * exact segments the estimator was given, so what is on screen is the run the
 * report above the control describes; `setCalibrationTabState(null)` is called
 * wherever that report is cleared, so the tab cannot outlive it.
 *
 * T-08-02: text reaches the DOM through `textContent`.
 */
import {
	type AutoCalibrationOutcome,
	type CalibrationRefusal,
	calibrationSeries,
	type HeadingCalibrationSegment,
} from "../../analysis/AirSpeedCalibration";
import {
	buildCalibrationAgreementFigure,
	type CalibrationFitFigureInput,
	buildCalibrationFitFigure,
	buildCalibrationWindFigure,
} from "../../plots/CalibrationPlotBuilders";
import type { PlotDefinition } from "../../plots/StandardPlotBuilders";
import { log } from "../../utils/log";
import { waitForPlotly } from "../analysis/plotlyLoader";
import { purgePlotlyGraphsIn } from "../dom/plotlyPurge";
import { fitWindVisibilityAttrs } from "./windSourceVisibility";
import { REFUSAL_TEXT } from "./airSpeedCalibrationReport";

export const CALIBRATION_TAB_CONTENT_ID = "calibration-tab";

const EMPTY_ID = "calibrationEmpty";
const LAPS_ID = "calibrationLaps";
const AGREEMENT_ID = "calibrationAgreement";
const WIND_ID = "calibrationWind";

export function calibrationTabMarkup(): string {
	return `
        <div class="ve-tab-content" id="${CALIBRATION_TAB_CONTENT_ID}"${fitWindVisibilityAttrs()}>
            <div class="ve-calibration__empty" id="${EMPTY_ID}"></div>
            <div class="ve-calibration__laps" id="${LAPS_ID}"></div>
            <div class="ve-calibration__agreement" id="${AGREEMENT_ID}"></div>
            <div class="ve-calibration__wind" id="${WIND_ID}"></div>
        </div>
    `;
}

export interface CalibrationTabState {
	outcome: AutoCalibrationOutcome | null;
	segments: HeadingCalibrationSegment[];
}

let state: CalibrationTabState | null = null;
let drawCounter = 0;

/** Remembers the last Auto Adjust run so the tab can draw it when opened. */
export function setCalibrationTabState(next: CalibrationTabState | null): void {
	state = next;
	// The tab is not redrawn by anything else when the run changes under it.
	if (
		byId(CALIBRATION_TAB_CONTENT_ID)?.classList.contains(
			"ve-tab-content--active",
		)
	)
		renderCalibrationTab();
}

type PlotlyReact = {
	react: (
		id: string | HTMLElement,
		data: unknown,
		layout: unknown,
		config: unknown,
	) => Promise<unknown>;
};

function byId(id: string): HTMLElement | null {
	return document.getElementById(id);
}

function clearPlots(): void {
	for (const id of [LAPS_ID, AGREEMENT_ID, WIND_ID]) {
		const box = byId(id);
		if (!box) continue;
		// Every render makes fresh hosts, and `responsive: true` hangs a window
		// resize listener on each graph that only `purge` takes off again.
		purgePlotlyGraphsIn(box);
		box.replaceChildren();
	}
}

function showMessage(text: string): void {
	const empty = byId(EMPTY_ID);
	if (empty) empty.textContent = text;
	clearPlots();
}

function plotBox(parent: HTMLElement, cls: string): HTMLDivElement {
	const box = document.createElement("div");
	box.className = `ve-plot-container__plot ${cls}`;
	parent.appendChild(box);
	return box;
}

/** A lap the fit refused is listed beneath the fit figure, as a quiet line. */
function refusedLapLine(
	label: string,
	refusal: CalibrationRefusal | undefined,
): HTMLDivElement {
	const line = document.createElement("div");
	line.className = "ve-calibration__lap-refused";
	line.textContent = `${label}: not fitted, ${
		refusal ? REFUSAL_TEXT[refusal] : "nothing to draw for this lap"
	}`;
	return line;
}

export function renderCalibrationTab(): void {
	const pane = byId(CALIBRATION_TAB_CONTENT_ID);
	if (!pane) return;
	const outcome = state?.outcome ?? null;
	if (!state || !outcome) {
		showMessage("Run Auto Adjust to see how the calibration was derived.");
		return;
	}
	if (outcome.method !== "sinusoid") {
		const reason =
			outcome.method === "vdRatio" ? outcome.fallback : outcome.reason;
		showMessage(`Heading fit not used: ${REFUSAL_TEXT[reason]}.`);
		return;
	}

	const empty = byId(EMPTY_ID);
	const lapsBox = byId(LAPS_ID);
	const agreementBox = byId(AGREEMENT_ID);
	const windBox = byId(WIND_ID);
	if (!empty || !lapsBox || !agreementBox || !windBox) return;
	empty.textContent = "";
	clearPlots();

	const warned = new Set(
		outcome.warnings.flatMap((w) =>
			w.kind === "gusty" || w.kind === "windChanged" ? [w.label] : [],
		),
	);
	const figures: Array<{ host: HTMLElement; figure: PlotDefinition }> = [];
	const fitLaps: CalibrationFitFigureInput["laps"] = [];
	const refusedLines: HTMLElement[] = [];
	const agreementLaps: Array<{ label: string; percent: number }> = [];
	const windLaps: Array<{
		label: string;
		windSpeed: number;
		windDirDeg: number;
		warned: boolean;
	}> = [];

	// One row per segment, in the order the estimator was given them, so the
	// index pairs them even when two laps share a label.
	for (const [i, row] of outcome.perSegment.entries()) {
		const segment = state.segments[i];
		if (
			row.percent === null ||
			!row.coefficients ||
			row.windSpeed === undefined ||
			row.windDirDeg === undefined ||
			!segment
		) {
			refusedLines.push(refusedLapLine(row.label, row.refusal));
			continue;
		}
		fitLaps.push({
			series: calibrationSeries(segment, row.coefficients, outcome.scale),
			percent: row.percent,
			windSpeed: row.windSpeed,
			windDirDeg: row.windDirDeg,
			coefficients: row.coefficients,
		});
		agreementLaps.push({ label: row.label, percent: row.percent });
		windLaps.push({
			label: row.label,
			windSpeed: row.windSpeed,
			windDirDeg: row.windDirDeg,
			warned: warned.has(row.label),
		});
	}
	if (fitLaps.length > 0) {
		figures.push({
			host: plotBox(lapsBox, "ve-plot-container__plot--calibration-fit"),
			figure: buildCalibrationFitFigure({
				// Same unclamped value as the agreement line below.
				pooledPercent: (outcome.scale - 1) * 100,
				laps: fitLaps,
			}),
		});
	}
	for (const line of refusedLines) lapsBox.appendChild(line);
	if (agreementLaps.length >= 2) {
		figures.push({
			host: plotBox(agreementBox, "ve-plot-container__plot--agreement"),
			figure: buildCalibrationAgreementFigure({
				// The fit's own value, not the clamped `percent`: the lap points
				// beside it are unclamped, and a clamped line would sit apart from
				// laps that all agree with it.
				pooledPercent: (outcome.scale - 1) * 100,
				laps: agreementLaps,
			}),
		});
	}
	if (windLaps.length > 0) {
		figures.push({
			host: plotBox(windBox, "ve-plot-container__plot--square"),
			figure: buildCalibrationWindFigure({ laps: windLaps }),
		});
	}

	const mine = ++drawCounter;
	void waitForPlotly()
		.then(async (handle) => {
			const Plotly = handle as PlotlyReact;
			for (const { host, figure } of figures) {
				if (mine !== drawCounter || !host.isConnected) return;
				await Plotly.react(host, figure.data, figure.layout, figure.config);
			}
		})
		.catch((err) => log.error("Calibration tab: plot failed", err));
}
