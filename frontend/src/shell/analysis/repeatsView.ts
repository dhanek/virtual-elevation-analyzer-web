/**
 * The Repeats tab (TODO J2): each lap — or out-and-back section — fitted on
 * its own, the spread across them, and the pooled fit with its naive and its
 * repeat-clustered error bar. The numbers are `RepeatSpread.ts`'s; this file
 * owns the markup and the drawing, shared by all three mode templates.
 *
 * A readout only: nothing here writes a slider, and the joint fit the
 * sliders and auto-converge use is untouched.
 *
 * Activation works like the Convergence tab's: an inactive tab is skipped by
 * the primitive's lazy gate, so the render-map entry asks the funnel for a
 * normal pass (`requestRepeatsRedraw`) instead of drawing from a closure.
 */
import {
	computeRepeatSpread,
	type PooledFit,
	type RepeatSpreadResult,
	type RepeatStat,
	type RepeatUnitFit,
} from "../../analysis/RepeatSpread";
import type { RepeatsUpdateInput } from "../../modes/analysis/types";
import { requestModeUpdate } from "./requestModeUpdate";

/** Container `renderRepeatsView` owns outright. Empty in the templates. */
const REPEATS_CONTENT_ID = "repeatsContent";

export function repeatsTabMarkup(): string {
	return `<div class="ve-tab-content" id="repeats-tab">
    <div class="ve-lap-summary ve-repeats" id="${REPEATS_CONTENT_ID}"></div>
</div>`;
}

/** The Repeats tab's activation callback, for every render-map site. */
export function requestRepeatsRedraw(): void {
	requestModeUpdate("repeats");
}

const NOT_ESTIMABLE = "not estimable";

function fixed(value: number, digits: number): string {
	return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function statusNote(fit: RepeatUnitFit): string {
	if (fit.status === "no-profile") {
		return "no elevation profile";
	}
	if (fit.status === "singular") {
		return "cannot separate CdA from Crr";
	}
	return "";
}

function cell(text: string, modifier = ""): string {
	return `<td class="ve-lap-summary__cell${modifier}">${text}</td>`;
}

function headCell(text: string, modifier = ""): string {
	return `<th class="ve-lap-summary__cell${modifier}">${text}</th>`;
}

const LABEL = " ve-lap-summary__cell--label";

function unitRow(fit: RepeatUnitFit): string {
	const note = statusNote(fit);
	const free =
		fit.status === "ok"
			? [
					cell(fixed(fit.cda, 4)),
					cell(fixed(fit.crr, 5)),
					cell(fixed(fit.rms, 3)),
				]
			: [
					`<td class="ve-lap-summary__cell ve-repeats__note" colspan="3">${note}</td>`,
				];
	const fixedCrr =
		fit.status === "no-profile"
			? [cell("—"), cell("—")]
			: [cell(fixed(fit.cdaAtFixedCrr, 4)), cell(fixed(fit.rmsAtFixedCrr, 3))];
	return `<tr class="ve-lap-summary__row">${cell(escapeHtml(fit.label), LABEL)}${free.join("")}${fixedCrr.join("")}</tr>`;
}

function sdText(stat: RepeatStat, digits: number): string {
	return stat.sd === null ? NOT_ESTIMABLE : stat.sd.toFixed(digits);
}

function summaryRows(result: RepeatSpreadResult): string {
	const { free, fixed: fixedStats } = result;
	const mean = `<tr class="ve-lap-summary__row ve-repeats__row--summary">${cell("Mean", LABEL)}${cell(
		fixed(free.cda.mean, 4),
	)}${cell(fixed(free.crr.mean, 5))}${cell("")}${cell(fixed(fixedStats.cda.mean, 4))}${cell("")}</tr>`;
	const sd = `<tr class="ve-lap-summary__row ve-repeats__row--summary">${cell("SD across repeats", LABEL)}${cell(
		sdText(free.cda, 4),
	)}${cell(sdText(free.crr, 5))}${cell("")}${cell(sdText(fixedStats.cda, 4))}${cell("")}</tr>`;
	const n = `<tr class="ve-lap-summary__row ve-repeats__row--summary">${cell("n / df", LABEL)}${cell(
		`${free.cda.n} / ${free.cda.df}`,
	)}${cell(`${free.crr.n} / ${free.crr.df}`)}${cell("")}${cell(
		`${fixedStats.cda.n} / ${fixedStats.cda.df}`,
	)}${cell("")}</tr>`;
	return mean + sd + n;
}

function seText(value: number, digits: number): string {
	return Number.isFinite(value) ? `± ${value.toFixed(digits)}` : "—";
}

function pooledLine(
	label: string,
	pooled: PooledFit,
	parameter: "cda" | "crr",
	digits: number,
): string {
	const value = pooled[parameter];
	const naive = pooled.naiveSe[parameter];
	const clustered = pooled.clusteredSe?.[parameter] ?? NaN;
	const ratio =
		Number.isFinite(clustered) && naive > 0
			? ` (${(clustered / naive).toFixed(1)}× the naive)`
			: "";
	const clusteredText = pooled.clusteredSe
		? `${seText(clustered, digits)} clustered over ${pooled.clusters} repeats, df ${pooled.df}${ratio}`
		: `clustered SE ${NOT_ESTIMABLE}`;
	return `<div class="ve-metrics-compact__line">${label} ${value.toFixed(digits)}: ${seText(
		naive,
		digits,
	)} naive · ${clusteredText}</div>`;
}

function pooledBlock(result: RepeatSpreadResult): string {
	const lines: string[] = [];
	if (result.pooled) {
		lines.push(pooledLine("Pooled CdA", result.pooled, "cda", 4));
		lines.push(pooledLine("Pooled Crr", result.pooled, "crr", 5));
	}
	if (result.pooledFixed) {
		lines.push(
			pooledLine(
				`Pooled CdA at Crr ${result.fixedCrr.toFixed(4)}`,
				result.pooledFixed,
				"cda",
				4,
			),
		);
	}
	if (lines.length === 0) {
		return "";
	}
	return `<div class="ve-metrics-compact ve-repeats__pooled">
    <div class="ve-metrics-compact__line"><strong>All repeats in one profile fit</strong></div>
    ${lines.join("")}
    <div class="ve-metrics-compact__line ve-metrics-compact__caveat">The naive SE assumes independent 1 s residuals, which VE residuals are not. The clustered SE counts each repeat as one unit; with few repeats (low df) it is itself a rough estimate.</div>
</div>`;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/** The tab's whole content for one result. */
function repeatsMarkup(result: RepeatSpreadResult): string {
	const crrLabel = `CdA @ Crr ${result.fixedCrr.toFixed(4)}`;
	const notice = result.notEstimableReason
		? `<div class="ve-metrics-compact__line ve-metrics-compact__caveat ve-repeats__notice">${result.notEstimableReason}</div>`
		: "";
	return `<div class="ve-lap-summary__title"><strong>Each repeat fitted alone</strong> — profile RMS fit per lap (out-and-back: per section, both legs). The spread across repeats is the honest error bar.</div>
${notice}
<table class="ve-lap-summary__table ve-repeats__table">
    <thead>
        <tr class="ve-lap-summary__row ve-lap-summary__row--head">
            ${headCell("Repeat", LABEL)}${headCell("CdA")}${headCell("Crr")}${headCell("RMS (m)")}${headCell(crrLabel)}${headCell("RMS (m)")}
        </tr>
    </thead>
    <tbody>${result.units.map(unitRow).join("")}${summaryRows(result)}</tbody>
</table>
${pooledBlock(result)}`;
}

export function renderRepeatsView(input: RepeatsUpdateInput): void {
	if (typeof document === "undefined") {
		return;
	}
	const container = document.getElementById(REPEATS_CONTENT_ID);
	if (!container) {
		return;
	}
	container.innerHTML = repeatsMarkup(
		computeRepeatSpread(input.units, input.fixedCrr),
	);
}
