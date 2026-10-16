/**
 * The Auto Adjust readout for the CURRENT selection (maintainer ruling D5):
 * what the applied value rests on, and every reason it may be unreliable.
 * Wording is qualitative on purpose (review R9); the evidence behind each
 * threshold lives beside its constant in `AirSpeedCalibration.ts`.
 *
 * T-08-02: everything reaches the DOM through `textContent`.
 */
import type {
	AutoCalibrationOutcome,
	CalibrationRefusal,
	CalibrationWarning,
} from "../../analysis/AirSpeedCalibration";

export const AIR_SPEED_CALIBRATION_REPORT_ID = "airSpeedCalibrationReport";

export interface CalibrationReportText {
	headline: string;
	details: string[];
	warnings: string[];
}

export const REFUSAL_TEXT: Record<CalibrationRefusal, string> = {
	noMeasuredAirSpeed: "this ride carries no measured wind channel",
	noUsablePositions: "the selection has no usable GPS positions",
	noWholeCircuit: "the selection holds no complete circuit",
	notClosed: "the circuits do not return to their start",
	reversal: "the track doubles back (figure-eight or reversal)",
	tooFewPoints: "too few samples above 5 m/s",
	headingCoverage: "the headings do not sweep a loop",
	degenerate: "the fit was numerically degenerate",
};

const signed = (percent: number) =>
	`${percent >= 0 ? "+" : ""}${percent.toFixed(1)} %`;
const sentence = (text: string) =>
	`${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
const circuits = (n: number, noun = "circuit") =>
	`${n} ${noun}${n === 1 ? "" : "s"}`;

function warningText(warning: CalibrationWarning): string {
	switch (warning.kind) {
		case "gusty":
			return `${warning.label}: gusty conditions (gust index ${warning.gustIndex.toFixed(3)}); the calibration may be unreliable.`;
		case "gustUnavailable":
			return `${warning.label}: gustiness could not be assessed (irregular timestamps).`;
		case "windChanged":
			return `${warning.label}: the wind changed during the lap (by ${warning.vectorChange.toFixed(1)} m/s); the calibration may be unreliable.`;
		case "stationarityUnavailable":
			return `${warning.label}: wind stability could not be checked.`;
		case "fewCircuits":
			return `Short selection (${circuits(warning.circuits, "complete circuit")}); more complete circuits generally improve repeatability.`;
		case "segmentSpread":
			return `Laps differ by ${warning.spreadPercent.toFixed(1)} pp. Calibration depends on riding position; select laps ridden in one position.`;
		case "clamped":
			return `The fitted ${signed(warning.unclampedPercent)} is outside the ±20 % control and was clamped.`;
	}
}

export function describeCalibration(
	outcome: AutoCalibrationOutcome,
): CalibrationReportText {
	switch (outcome.method) {
		case "none":
			return {
				headline: "No calibration available",
				details: [sentence(REFUSAL_TEXT[outcome.reason])],
				warnings: [],
			};
		case "vdRatio":
			return {
				headline: `Distance ratio: ${signed(outcome.percent)}`,
				details: [
					`Heading fit not used: ${REFUSAL_TEXT[outcome.fallback]}.`,
					"The distance ratio assumes a closed loop ridden at steady pace.",
				],
				warnings: [],
			};
		case "sinusoid":
			return {
				headline: `Heading fit: ${signed(outcome.percent)} from ${circuits(outcome.circuits, "complete circuit")}`,
				details: outcome.perSegment.map((row) =>
					row.percent === null
						? `${row.label}: not fitted, ${REFUSAL_TEXT[row.refusal ?? "degenerate"]}`
						: `${row.label}: ${signed(row.percent)} over ${circuits(row.circuits)}; estimated wind ${(row.windSpeed ?? NaN).toFixed(1)} m/s from ${Math.round(row.windDirDeg ?? NaN)}°`,
				),
				warnings: outcome.warnings.map(warningText),
			};
	}
}

export function renderCalibrationReport(
	container: HTMLElement | null,
	outcome: AutoCalibrationOutcome,
): void {
	if (!container) return;
	const text = describeCalibration(outcome);
	const line = (content: string, className?: string): HTMLDivElement => {
		const div = document.createElement("div");
		if (className) div.className = className;
		div.textContent = content;
		return div;
	};
	container.replaceChildren(
		line(text.headline, "ve-parameter__report-headline"),
		...text.details.map((detail) => line(detail)),
		...text.warnings.map((warning) =>
			line(`⚠ ${warning}`, "ve-parameter__report-warning"),
		),
	);
	container.hidden = false;
}

export function clearCalibrationReport(container: HTMLElement | null): void {
	if (!container) return;
	container.replaceChildren();
	container.hidden = true;
}
