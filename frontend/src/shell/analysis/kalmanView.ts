/**
 * The Repeats tab's Kalman block (TODO J6): CdA and Crr from the error-model
 * fit with honest standard errors, beside the classic pooled fit, with the
 * noise it found, its warnings, the disturbances it took out, and the
 * residuals by road position (spec §6).
 *
 * ON DEMAND ONLY. A fit runs when the button is pressed and its result is
 * kept for that selection: slider moves redraw from the cache and never
 * refit (TODO J6 criterion). A different selection marks the result stale
 * and asks for a re-run instead of running one.
 */
import { fit_selection_json } from "@wasm/virtual_elevation_analyzer.js";
import {
	buildKalmanSelection,
	type KalmanOutput,
	kalmanReasonText,
	kalmanWarningText,
	parseKalmanOutput,
} from "../../analysis/KalmanFit";
import type { PooledFit, RepeatUnitInput } from "../../analysis/RepeatSpread";
import type { RepeatsUpdateInput } from "../../modes/analysis/types";
import { log } from "../../utils/log";
import { waitForPlotly } from "./plotlyLoader";

export const KALMAN_BUTTON_ID = "repeatsKalmanRun";
const KALMAN_PLOT_ID = "repeatsKalmanPlot";

type Runner = (input: string) => string;

let runner: Runner = fit_selection_json;
let requested = false;
let cache: { signature: string; output: KalmanOutput } | null = null;

/** Test seam: the WASM entry point. */
export function setKalmanRunner(next: Runner): void {
	runner = next;
}

/** Test seam. */
export function resetKalmanState(): void {
	requested = false;
	cache = null;
	runner = fit_selection_json;
}

/**
 * What a cached result belongs to: the legs (by repeat key and window
 * length), where the air speed comes from, and the mass. Deliberately not
 * CdA or Crr, so a slider move keeps the result.
 */
function signatureOf(
	units: readonly RepeatUnitInput[],
	kalman: NonNullable<RepeatsUpdateInput["kalman"]>,
): string {
	const legs = units.map(
		(u) => `${u.key}:${u.legs.map((l) => l.elevation?.length ?? 0).join("/")}`,
	);
	return `${legs.join(",")}|${kalman.airSpeed}|${kalman.physics.mass}`;
}

function usableLegs(units: readonly RepeatUnitInput[]): number {
	return units.reduce(
		(n, u) =>
			n + u.legs.filter((l) => l.elevation && l.elevation.length > 1).length,
		0,
	);
}

function run(
	units: readonly RepeatUnitInput[],
	kalman: NonNullable<RepeatsUpdateInput["kalman"]>,
): void {
	const selection = buildKalmanSelection(
		units,
		kalman.physics,
		kalman.airSpeed,
	);
	const signature = signatureOf(units, kalman);
	if (!selection) {
		cache = {
			signature,
			output: {
				status: "refused",
				reason: "tooFewLegs",
				coupled: null,
				fit: null,
				residuals: [],
				closedLoop: false,
				loopLength: null,
				sessions: [],
				sessionZ: [],
			},
		};
		return;
	}
	const start = performance.now();
	cache = {
		signature,
		output: parseKalmanOutput(runner(JSON.stringify(selection))),
	};
	log.debug(
		`Kalman fit: ${selection.legs.length} legs in ${(performance.now() - start).toFixed(0)} ms`,
	);
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function cell(text: string, modifier = ""): string {
	return `<td class="ve-lap-summary__cell${modifier}">${text}</td>`;
}

function headCell(text: string, modifier = ""): string {
	return `<th class="ve-lap-summary__cell${modifier}">${text}</th>`;
}

const LABEL = " ve-lap-summary__cell--label";

function heading(title: string, subtitle: string): string {
	return `<div class="ve-lap-summary__title ve-repeats__section-title"><strong>${title}</strong> <span class="ve-repeats__sub">${subtitle}</span></div>`;
}

function bullets(items: readonly string[]): string {
	return items.length === 0
		? ""
		: `<ul class="ve-repeats__notes">${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
}

function fixed(value: number, digits: number): string {
	return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function pm(value: number, digits: number): string {
	return Number.isFinite(value) ? `± ${value.toFixed(digits)}` : "—";
}

function button(label: string): string {
	return `<button type="button" class="ve-repeats__timing-run" id="${KALMAN_BUTTON_ID}">${label}</button>`;
}

function resultMarkup(
	output: KalmanOutput,
	pooled: PooledFit | null,
	noun: string,
): string {
	if (output.status !== "ok" || !output.fit) {
		return bullets([kalmanReasonText(output.reason, output.coupled)]);
	}
	const fit = output.fit;
	const at = (name: string) => fit.names.indexOf(name);
	const cda = at("CdA");
	const crr = at("Crr");
	const row = (label: string, c: string, cse: string, r: string, rse: string) =>
		`<tr class="ve-lap-summary__row">${cell(label, LABEL)}${cell(c)}${cell(cse)}${cell(r)}${cell(rse)}</tr>`;
	const rows = [
		row(
			`Kalman (${fit.legs} legs)`,
			cda >= 0 ? fixed(fit.beta[cda], 4) : "fixed",
			cda >= 0 ? pm(fit.se[cda], 4) : "",
			crr >= 0 ? fixed(fit.beta[crr], 5) : "—",
			crr >= 0 ? pm(fit.se[crr], 5) : "",
		),
	];
	if (pooled) {
		const clustered = pooled.clusteredSe;
		rows.push(
			row(
				"Classic (pooled LS)",
				fixed(pooled.cda, 4),
				`${pm(pooled.naiveSe.cda, 4)} naive${clustered ? ` / ${pm(clustered.cda, 4)} clustered` : ""}`,
				fixed(pooled.crr, 5),
				`${pm(pooled.naiveSe.crr, 5)} naive${clustered ? ` / ${pm(clustered.crr, 5)} clustered` : ""}`,
			),
		);
	}
	const n = fit.noise;
	const terrain =
		n.s2 > 0
			? `terrain ${(Math.sqrt(n.s2) * 100).toFixed(1)} cm over ${n.ell.toFixed(0)} m (${n.terrainByDirection ? "per direction" : "shared by every leg"})`
			: "no shared terrain";
	const notes = [
		`Noise: drift ${(Math.sqrt(n.qPer5m) * 100).toFixed(1)} cm per 5 m · ${terrain} · white ${(Math.sqrt(n.r) * 100).toFixed(1)} cm.`,
	];
	if (fit.cdaCrrCorrelation !== null) {
		notes.push(
			`corr(CdA, Crr) ${fit.cdaCrrCorrelation.toFixed(2)}${fit.speedContrast !== null ? ` · speed contrast ${fit.speedContrast.toFixed(2)}` : ""}.`,
		);
	}
	notes.push(...fit.warnings.map(kalmanWarningText));
	notes.push(
		`SEs from the fit's information matrix: they carry the drift and the shared terrain, unlike the naive ones. ${fit.observations} points on ${fit.legs} legs (${noun}s split into their legs).`,
	);
	const jumps = fit.jumps.length
		? `<div class="ve-repeats__scroll"><table class="ve-lap-summary__table ve-repeats__table">
    <thead><tr class="ve-lap-summary__row ve-lap-summary__row--head">${headCell("Disturbance", LABEL)}${headCell("Road (m)")}${headCell("Into leg (m)")}${headCell("Step (m)")}${headCell("t")}${headCell("")}</tr></thead>
    <tbody>${fit.jumps
			.map(
				(j) =>
					`<tr class="ve-lap-summary__row">${cell(escapeHtml(j.label), LABEL)}${cell(fixed(j.pos, 0))}${cell(fixed(j.distance, 0))}${cell(`${j.size >= 0 ? "+" : "−"}${Math.abs(j.size).toFixed(2)}`)}${cell(fixed(Math.abs(j.t), 1))}${cell(j.fitted ? "taken out" : "not fitted — moves nothing")}</tr>`,
			)
			.join("")}</tbody>
</table></div>`
		: bullets(["No disturbances flagged."]);
	return `<div class="ve-repeats__scroll"><table class="ve-lap-summary__table ve-repeats__table">
    <thead><tr class="ve-lap-summary__row ve-lap-summary__row--head">${headCell("", LABEL)}${headCell("CdA")}${headCell("SE")}${headCell("Crr")}${headCell("SE")}</tr></thead>
    <tbody>${rows.join("")}</tbody>
</table></div>
${bullets(notes)}
${jumps}
<div class="ve-repeats__plot" id="${KALMAN_PLOT_ID}"></div>`;
}

/** The block's markup for this pass. */
export function kalmanBlock(
	input: RepeatsUpdateInput,
	pooled: PooledFit | null,
	noun: string,
): string {
	const kalman = input.kalman;
	if (!kalman) {
		return "";
	}
	const title = heading(
		"Kalman fit",
		"— honest uncertainty from a model of the residuals",
	);
	if (usableLegs(input.units) < 2) {
		return `${title}${bullets([kalmanReasonText("tooFewLegs", null)])}`;
	}
	const intro = bullets([
		"Each leg's VE drifts (power, gusts) and every leg shares the same road's elevation error; the fit models both and takes out jumps such as braking. Runs only when asked: a fit can take a second.",
	]);
	if (!requested || !cache) {
		return `${title}${button("Run Kalman fit")}${intro}`;
	}
	if (cache.signature !== signatureOf(input.units, kalman)) {
		return `${title}${button("Re-run Kalman fit")}${bullets(["Selection changed since the last fit."])}`;
	}
	return `${title}${button("Re-run Kalman fit")}${resultMarkup(cache.output, pooled, noun)}`;
}

/** Wire the button: fit now, then redraw the tab through `redraw`. */
export function bindKalman(
	input: RepeatsUpdateInput,
	redraw: () => void,
): void {
	const kalman = input.kalman;
	document.getElementById(KALMAN_BUTTON_ID)?.addEventListener("click", () => {
		if (!kalman) {
			return;
		}
		requested = true;
		run(input.units, kalman);
		redraw();
	});
	void drawResiduals();
}

/**
 * Residuals by road position (spec §6): each clean stretch centred on its
 * own fitted offset, cut zones shaded, taken-out jumps marked with their
 * size.
 */
async function drawResiduals(): Promise<void> {
	const output = cache?.output;
	const target = document.getElementById(KALMAN_PLOT_ID);
	if (!target || !output?.fit || output.residuals.length === 0) {
		return;
	}
	let Plotly: { react: (...args: unknown[]) => Promise<unknown> };
	try {
		Plotly = (await waitForPlotly()) as typeof Plotly;
	} catch (e) {
		log.warn(`Kalman residual plot: Plotly unavailable (${String(e)})`);
		return;
	}
	const traces: Record<string, unknown>[] = output.residuals.map((leg) => {
		// A gap between stretches breaks the line: null at each new stretch.
		const x: (number | null)[] = [];
		const y: (number | null)[] = [];
		leg.pos.forEach((p, i) => {
			if (i > 0 && leg.stretch[i] !== leg.stretch[i - 1]) {
				x.push(null);
				y.push(null);
			}
			x.push(p);
			y.push(leg.residual[i] * 100);
		});
		return {
			type: "scatter",
			mode: "lines",
			name: leg.label,
			x,
			y,
			line: { width: 1.2 },
			connectgaps: false,
		};
	});
	const fitted = output.fit.jumps.filter((j) => j.fitted);
	if (fitted.length > 0) {
		traces.push({
			type: "scatter",
			mode: "markers+text",
			name: "Jumps taken out",
			x: fitted.map((j) => j.pos),
			y: fitted.map(() => 0),
			text: fitted.map(
				(j) => `${j.size >= 0 ? "+" : "−"}${Math.abs(j.size).toFixed(2)} m`,
			),
			textposition: "top center",
			marker: { symbol: "triangle-down", size: 10 },
		});
	}
	const spans = output.residuals.flatMap((leg) => leg.masked);
	const shapes = spans.map(([a, b]): Record<string, unknown> => ({
		type: "rect",
		xref: "x",
		yref: "paper",
		x0: Math.min(a, b),
		x1: Math.max(a, b),
		y0: 0,
		y1: 1,
		fillcolor: "rgba(128,128,128,0.08)",
		line: { width: 0 },
		layer: "below",
	}));
	await Plotly.react(
		target,
		traces,
		{
			title: {
				text: "Residuals by road position (each clean stretch on its own offset)",
				font: { size: 13 },
			},
			xaxis: { title: { text: "Road position (m)" } },
			yaxis: { title: { text: "Residual (cm)" }, zeroline: true },
			shapes,
			margin: { l: 50, r: 10, t: 40, b: 40 },
			height: 320,
			showlegend: output.residuals.length <= 12,
			paper_bgcolor: "rgba(0,0,0,0)",
			plot_bgcolor: "rgba(0,0,0,0)",
		},
		{ responsive: true, displaylogo: false },
	);
}
