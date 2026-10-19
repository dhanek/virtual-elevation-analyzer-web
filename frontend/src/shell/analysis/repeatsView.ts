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
	computeSensitivities,
	REPEAT_SPREAD_NONE_REASON,
	type SensitivityRow,
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
	// An unstable free fit keeps its numbers — hiding them would hide why
	// the spread is wide — but is marked, and the note under the table
	// points to the fixed-Crr column.
	const label = fit.unstable
		? `${escapeHtml(fit.label)} <span class="ve-repeats__unstable" title="Unstable: ${fit.unstable}">⚠</span>`
		: escapeHtml(fit.label);
	const rowClass = fit.unstable
		? "ve-lap-summary__row ve-repeats__row--unstable"
		: "ve-lap-summary__row";
	const correlation = Number.isFinite(fit.correlation)
		? ` title="corr(CdA, Crr) of this repeat's free fit: ${fit.correlation.toFixed(3)}"`
		: "";
	return `<tr class="${rowClass}"><td class="ve-lap-summary__cell${LABEL}"${correlation}>${label}</td>${free.join("")}${fixedCrr.join("")}</tr>`;
}

function sdText(stat: RepeatStat, digits: number): string {
	return stat.sd === null ? NOT_ESTIMABLE : stat.sd.toFixed(digits);
}

function summaryRows(result: RepeatSpreadResult): string {
	const { free, fixed: fixedStats } = result;
	const mean = `<tr class="ve-lap-summary__row ve-repeats__row--summary">${cell("Mean", LABEL)}${cell(
		fixed(free.cda.mean, 4),
	)}${cell(fixed(free.crr.mean, 5))}${cell("")}${cell(fixed(fixedStats.cda.mean, 4))}${cell("")}</tr>`;
	const sd = `<tr class="ve-lap-summary__row ve-repeats__row--summary">${cell("SD", LABEL)}${cell(
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

function pooledRow(
	label: string,
	pooled: PooledFit,
	parameter: "cda" | "crr",
	digits: number,
): string {
	const naive = pooled.naiveSe[parameter];
	const clustered = pooled.clusteredSe?.[parameter] ?? NaN;
	const ratio =
		Number.isFinite(clustered) && naive > 0
			? `${(clustered / naive).toFixed(1)}×`
			: "—";
	const range = pooled.range95?.[parameter];
	return `<tr class="ve-lap-summary__row">${cell(label, LABEL)}${cell(
		pooled[parameter].toFixed(digits),
	)}${cell(seText(naive, digits))}${cell(
		pooled.clusteredSe ? seText(clustered, digits) : NOT_ESTIMABLE,
	)}${cell(ratio)}${cell(
		range ? `${range[0].toFixed(digits)} – ${range[1].toFixed(digits)}` : "—",
	)}</tr>`;
}

function pooledBlock(result: RepeatSpreadResult, noun: string): string {
	const rows: string[] = [];
	if (result.pooled) {
		rows.push(pooledRow("CdA", result.pooled, "cda", 4));
		rows.push(pooledRow("Crr", result.pooled, "crr", 5));
	}
	if (result.pooledFixed) {
		rows.push(
			pooledRow(
				`CdA @ Crr ${result.fixedCrr.toFixed(4)}`,
				result.pooledFixed,
				"cda",
				4,
			),
		);
	}
	if (rows.length === 0) {
		return "";
	}
	const pooled = result.pooled ?? result.pooledFixed!;
	const notes = pooled.clusteredSe
		? [
				"Naive SE: treats every second as independent — too optimistic.",
				`Clustered SE: each ${noun} counts once (n ${pooled.clusters}, df ${pooled.df}).`,
				...(pooled.df < 5
					? [`95 % range: rough with only ${pooled.clusters} ${noun}s.`]
					: []),
			]
		: [`Clustered SE needs 2 or more ${noun}s.`];
	return `${heading(`All ${noun}s together`)}
<table class="ve-lap-summary__table ve-repeats__table">
    <thead>
        <tr class="ve-lap-summary__row ve-lap-summary__row--head">
            ${headCell("", LABEL)}${headCell("Estimate")}${headCell("Naive SE")}${headCell("Clustered SE")}${headCell("× naive")}${headCell("95 % range")}
        </tr>
    </thead>
    <tbody>${rows.join("")}</tbody>
</table>
${bullets(notes)}`;
}

function heading(title: string, subtitle = ""): string {
	return `<div class="ve-lap-summary__title ve-repeats__section-title"><strong>${title}</strong>${subtitle ? ` <span class="ve-repeats__sub">${subtitle}</span>` : ""}</div>`;
}

function bullets(items: readonly string[]): string {
	if (items.length === 0) {
		return "";
	}
	return `<ul class="ve-repeats__notes">${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function signed(value: number, digits: number): string {
	if (!Number.isFinite(value)) {
		return "—";
	}
	const text = Math.abs(value).toFixed(digits);
	// A delta that rounds to zero carries no sign: "−0.00000" reads as a
	// direction the refit did not find.
	if (Number(text) === 0) {
		return text;
	}
	return value < 0 ? `−${text}` : `+${text}`;
}

function sensitivityBlock(
	rows: readonly SensitivityRow[],
	fixedCrr: number,
): string {
	if (rows.length === 0) {
		return "";
	}
	const body = rows
		.map(
			(row) =>
				`<tr class="ve-lap-summary__row">${cell(row.label, LABEL)}${cell(
					signed(row.dCda, 4),
				)}${cell(signed(row.dCrr, 5))}${cell(signed(row.dCdaAtFixedCrr, 4))}</tr>`,
		)
		.join("");
	return `${heading("If an input is off", "— shift of the all-together fit")}
<table class="ve-lap-summary__table ve-repeats__table">
    <thead>
        <tr class="ve-lap-summary__row ve-lap-summary__row--head">
            ${headCell("Input", LABEL)}${headCell("ΔCdA")}${headCell("ΔCrr")}${headCell(`ΔCdA @ Crr ${fixedCrr.toFixed(4)}`)}
        </tr>
    </thead>
    <tbody>${body}</tbody>
</table>
${bullets(["Sensitivities, not error bars — don't add them up."])}`;
}

/** The tab's whole content for one result. */
function repeatsMarkup(
	result: RepeatSpreadResult,
	sensitivities: readonly SensitivityRow[],
): string {
	const crrLabel = `CdA @ Crr ${result.fixedCrr.toFixed(4)}`;
	// Out-and-back repeats are sections; everything else is a lap.
	const noun = result.units.some((unit) => unit.key.startsWith("section-"))
		? "section"
		: "lap";
	const notes: string[] = [];
	if (result.notEstimableReason === REPEAT_SPREAD_NONE_REASON) {
		notes.push("No elevation profile to fit against.");
	} else if (result.notEstimableReason) {
		notes.push(`One ${noun}: no spread to measure — select 2 or more.`);
	} else {
		notes.push(`SD across ${noun}s = the honest error bar.`);
	}
	if (result.units.some((fit) => fit.unstable)) {
		notes.push(
			`⚠ = this ${noun} can't separate CdA from Crr (hover for why). Use its CdA @ Crr.`,
		);
	}
	return `${heading(`Each ${noun} on its own`)}
<table class="ve-lap-summary__table ve-repeats__table">
    <thead>
        <tr class="ve-lap-summary__row ve-lap-summary__row--head">
            ${headCell(noun === "section" ? "Section" : "Lap", LABEL)}${headCell("CdA")}${headCell("Crr")}${headCell("RMS (m)")}${headCell(crrLabel)}${headCell("RMS (m)")}
        </tr>
    </thead>
    <tbody>${result.units.map(unitRow).join("")}${summaryRows(result)}</tbody>
</table>
${bullets(notes)}
${pooledBlock(result, noun)}
${sensitivityBlock(sensitivities, result.fixedCrr)}`;
}

export function renderRepeatsView(input: RepeatsUpdateInput): void {
	if (typeof document === "undefined") {
		return;
	}
	const container = document.getElementById(REPEATS_CONTENT_ID);
	if (!container) {
		return;
	}
	const result = computeRepeatSpread(input.units, input.fixedCrr, {
		cdaBounds: input.cdaBounds,
		crrBounds: input.crrBounds,
	});
	container.innerHTML = repeatsMarkup(
		result,
		result.pooled || result.pooledFixed
			? computeSensitivities(result, input.sensitivities)
			: [],
	);
}
