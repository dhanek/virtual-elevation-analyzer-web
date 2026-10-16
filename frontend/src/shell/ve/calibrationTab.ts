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
	calibrationSeries,
	type HeadingCalibrationSegment,
} from "../../analysis/AirSpeedCalibration";
import {
	buildCalibrationAgreementFigure,
	buildCalibrationLapFigure,
	buildCalibrationWindFigure,
} from "../../plots/CalibrationPlotBuilders";
import type { PlotDefinition } from "../../plots/StandardPlotBuilders";
import { log } from "../../utils/log";
import { waitForPlotly } from "../analysis/plotlyLoader";
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
		byId(id)?.replaceChildren();
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
	const agreementLaps: Array<{ label: string; percent: number }> = [];
	const windLaps: Array<{
		label: string;
		windSpeed: number;
		windDirDeg: number;
		warned: boolean;
	}> = [];

	for (const row of outcome.perSegment) {
		const segment = state.segments.find((s) => s.label === row.label);
		if (
			row.percent === null ||
			!row.coefficients ||
			row.windSpeed === undefined ||
			row.windDirDeg === undefined ||
			!segment
		) {
			const panel = document.createElement("div");
			panel.className = "ve-calibration__lap-empty";
			panel.textContent = `${row.label}: not fitted, ${REFUSAL_TEXT[row.refusal ?? "degenerate"]}`;
			lapsBox.appendChild(panel);
			continue;
		}
		figures.push({
			host: plotBox(lapsBox, "ve-plot-container__plot--tall"),
			figure: buildCalibrationLapFigure({
				series: calibrationSeries(segment, row.coefficients, outcome.scale),
				percent: row.percent,
				windSpeed: row.windSpeed,
				windDirDeg: row.windDirDeg,
				coefficients: row.coefficients,
			}),
		});
		agreementLaps.push({ label: row.label, percent: row.percent });
		windLaps.push({
			label: row.label,
			windSpeed: row.windSpeed,
			windDirDeg: row.windDirDeg,
			warned: warned.has(row.label),
		});
	}
	if (agreementLaps.length >= 2) {
		figures.push({
			host: plotBox(agreementBox, ""),
			figure: buildCalibrationAgreementFigure({
				pooledPercent: outcome.percent,
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
