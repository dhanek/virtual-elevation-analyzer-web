/**
 * Course checkpoints on the VE screen: the dotted markers on the VE and
 * residual plots, the table under them, and placing a checkpoint by clicking
 * the VE plot.
 *
 * Each mode's renderer hands over its rows — a lap or a leg, with the residual
 * series its residual plot draws — and the two layouts before it draws them.
 * The values come off those same series, so the table reads what the plot
 * shows at the passing sample.
 */
import {
	locateCheckpoints,
	medianMarkerX,
	summarizeCheckpoints,
	type CheckpointRow,
	type CheckpointRowInput,
	type CheckpointSummary,
	MAX_CHECKPOINTS,
} from "../../analysis/Checkpoints";
import type { RepeatStat } from "../../analysis/RepeatSpread";
import { CHECKPOINT_COLOR } from "../../components/map/checkpointMarkers";
import { log } from "../../utils/log";
import {
	checkpointLabel,
	checkpointTrack,
	getCheckpointAppState,
	resolvedCheckpoints,
	setCheckpointAt,
} from "./checkpointController";

// ---------------------------------------------------------------- click → sample

/**
 * Full-activity sample indices of a drawn trace, point for point. A WeakMap on
 * the trace object itself: Plotly hands the same object back as `point.data`
 * on a click, so nothing has to be parsed out of trace names.
 */
const traceSamples = new WeakMap<object, readonly number[]>();

export function tagTraceSamples(
	trace: object,
	indices: readonly number[],
): void {
	traceSamples.set(trace, indices);
}

interface ClickPoint {
	data?: object;
	pointNumber?: number;
	x?: number;
}

/**
 * The sample a click on the VE plot names: the clicked trace's own sample when
 * it is a lap or leg, otherwise (the mean or reference line) the nearest x on
 * the first lap drawn.
 */
export function sampleAtClick(
	traces: readonly object[],
	point: ClickPoint,
): number | null {
	const own = point.data ? traceSamples.get(point.data) : undefined;
	if (own && point.pointNumber !== undefined) {
		return own[point.pointNumber] ?? null;
	}
	if (typeof point.x !== "number") return null;
	for (const trace of traces) {
		const indices = traceSamples.get(trace);
		const xs = (trace as { x?: ArrayLike<number> }).x;
		if (!indices || !xs) continue;
		let best = -1;
		let bestGap = Infinity;
		for (let i = 0; i < xs.length; i++) {
			const gap = Math.abs(xs[i] - point.x);
			if (gap < bestGap) {
				bestGap = gap;
				best = i;
			}
		}
		return best >= 0 ? (indices[best] ?? null) : null;
	}
	return null;
}

/** The checkpoint the next plot click places, or null (clicks do nothing). */
let armedSlot: number | null = null;

/** Test seam. */
export function resetCheckpointPlacement(): void {
	armedSlot = null;
}

const boundPlots = new WeakSet<HTMLElement>();

/**
 * Let a click on the VE plot place the armed checkpoint. Bound once per graph
 * div; reads the div's CURRENT traces at click time, so it never acts on a
 * previous draw.
 */
export function bindCheckpointPlotClick(divId: string): void {
	const div = document.getElementById(divId) as
		| (HTMLElement & {
				on?: (event: string, handler: (e: unknown) => void) => void;
				data?: object[];
		  })
		| null;
	if (!div || boundPlots.has(div) || typeof div.on !== "function") return;
	boundPlots.add(div);
	div.on("plotly_click", (event) => {
		if (armedSlot === null) return;
		const point = (event as { points?: ClickPoint[] }).points?.[0];
		const appState = getCheckpointAppState();
		if (!point || !appState?.currentFitData) return;
		const index = sampleAtClick(div.data ?? [], point);
		if (index === null) {
			log.debug("Checkpoint click: no sample under the click");
			return;
		}
		const slot = armedSlot;
		armedSlot = null;
		const timestamps = appState.currentFitData.timestamps;
		setCheckpointAt(slot, Number(timestamps[index]));
	});
}

// ---------------------------------------------------------------- markers

type Layout = Record<string, unknown>;

function append(layout: Layout, key: string, items: unknown[]): void {
	if (items.length === 0) return;
	const existing = Array.isArray(layout[key]) ? (layout[key] as unknown[]) : [];
	layout[key] = [...existing, ...items];
}

function markerLine(x: number) {
	return {
		type: "line",
		xref: "x",
		yref: "paper",
		x0: x,
		x1: x,
		y0: 0,
		y1: 1,
		line: { color: CHECKPOINT_COLOR, width: 1, dash: "dot" },
	};
}

/** Each checkpoint's label one step lower, so close neighbours stay legible. */
const LABEL_STEP = 0.07;

function markerLabel(x: number, text: string, slot: number) {
	return {
		x,
		y: 1 - slot * LABEL_STEP,
		xref: "x",
		yref: "paper",
		text,
		showarrow: false,
		xanchor: "left",
		yanchor: "top",
		font: { size: 10, color: CHECKPOINT_COLOR },
	};
}

/**
 * Marker positions: one per checkpoint at the median passing x (stacked
 * laps, where every lap shares the axis), or one per passing (the stitched
 * Standard plot, where each lap has its own stretch of axis).
 */
function markerPositions(
	rows: readonly CheckpointRow[],
	count: number,
	mode: "median" | "each",
): { x: number; slot: number }[] {
	const positions: { x: number; slot: number }[] = [];
	for (let k = 0; k < count; k++) {
		if (mode === "median") {
			const x = medianMarkerX(rows, k);
			if (x !== null) positions.push({ x, slot: k });
			continue;
		}
		for (const row of rows) {
			const hit = row.hits[k];
			if (hit && Number.isFinite(hit.x)) {
				positions.push({ x: hit.x, slot: k });
			}
		}
	}
	return positions;
}

// ---------------------------------------------------------------- table

function signed(value: number): string {
	const text = Math.abs(value).toFixed(2);
	if (Number(text) === 0) return text;
	return `${value < 0 ? "−" : "+"}${text}`;
}

function valueCell(hit: CheckpointRow["hits"][number]): string {
	if (!hit) return cell("not passed", NOTE);
	return Number.isFinite(hit.value)
		? cell(signed(hit.value))
		: cell("no reference", NOTE);
}

function deltaCell(delta: number | null): string {
	return delta === null ? cell("—") : cell(signed(delta));
}

const LABEL = " ve-lap-summary__cell--label";
const NOTE = " ve-repeats__note";

function cell(text: string, modifier = ""): string {
	return `<td class="ve-lap-summary__cell${modifier}">${text}</td>`;
}

function headCell(text: string, modifier = ""): string {
	return `<th class="ve-lap-summary__cell${modifier}">${text}</th>`;
}

function statRow(
	label: string,
	summary: CheckpointSummary,
	pick: (stat: RepeatStat) => string,
): string {
	const cells = [
		...summary.checkpoints.map(pick),
		...summary.segments.map((segment) => pick(segment.stat)),
	];
	return `<tr class="ve-lap-summary__row ve-repeats__row--summary">${cell(label, LABEL)}${cells.map((c) => cell(c)).join("")}</tr>`;
}

function placeControls(count: number): string {
	const slots = Math.min(count + 1, MAX_CHECKPOINTS);
	const buttons = Array.from({ length: slots }, (_, slot) => {
		const active = armedSlot === slot ? " plot-x-axis-toggle__btn--active" : "";
		const text =
			slot < count ? checkpointLabel(slot) : `+ ${checkpointLabel(slot)}`;
		return `<button type="button" class="plot-x-axis-toggle__btn ve-checkpoints__place-btn${active}" data-checkpoint-place="${slot}" aria-pressed="${armedSlot === slot}">${text}</button>`;
	}).join("");
	const hint =
		armedSlot === null
			? "pick one, then click the VE plot"
			: `click the VE plot to put ${checkpointLabel(armedSlot)} there`;
	return `<div class="ve-checkpoints__place"><span class="plot-x-axis-toggle__label">Place on the plot:</span>${buttons}<span class="plot-x-axis-toggle__label">${hint}</span></div>`;
}

function escapeAttr(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function tableHtml(
	rows: readonly CheckpointRow[],
	count: number,
	rowNoun: string,
	reference: string,
	offMarker: ReadonlyMap<number, string>,
): string {
	const title = `<h4 class="ve-lap-summary__title" title="${escapeAttr(reference)}">Checkpoints — VE − reference (m)</h4>`;
	if (count === 0) {
		return `${title}${placeControls(0)}`;
	}
	const summary = summarizeCheckpoints(rows, count);
	const labels = Array.from({ length: count }, (_, k) => checkpointLabel(k));
	const head = [
		headCell(rowNoun, LABEL),
		...labels.map((label) => headCell(label)),
		...labels.slice(1).map((label, k) => headCell(`${labels[k]}→${label}`)),
	].join("");
	const body = rows
		.map((row, r) => {
			const warning = offMarker.get(r);
			const label = warning
				? `<span title="${escapeAttr(warning)}">${row.label} ⚠</span>`
				: row.label;
			return `<tr class="ve-lap-summary__row">${cell(label, LABEL)}${row.hits
				.map(valueCell)
				.join("")}${summary.segments
				.map((segment) => deltaCell(segment.deltas[r]))
				.join("")}</tr>`;
		})
		.join("");
	const stats =
		statRow("Mean", summary, (s) => (s.n > 0 ? signed(s.mean) : "—")) +
		statRow("SD", summary, (s) => (s.sd === null ? "—" : s.sd.toFixed(2))) +
		statRow("n", summary, (s) => String(s.n));
	return `${title}${placeControls(count)}
<div class="ve-repeats__scroll"><table class="ve-lap-summary__table ve-repeats__table">
    <thead><tr class="ve-lap-summary__row ve-lap-summary__row--head">${head}</tr></thead>
    <tbody>${body}${stats}</tbody>
</table></div>`;
}

function bindPlaceButtons(container: HTMLElement, rerender: () => void): void {
	container
		.querySelectorAll<HTMLButtonElement>("[data-checkpoint-place]")
		.forEach((button) => {
			button.onclick = () => {
				const slot = Number(button.dataset.checkpointPlace);
				armedSlot = armedSlot === slot ? null : slot;
				rerender();
			};
		});
}

/**
 * Rows passing a checkpoint well away from its median marker. A stacked axis
 * measures distance from the lap's own start, so a lap that started a little
 * earlier or later draws every feature shifted; its value is still read where
 * IT passes, which is not where the marker is. The row label carries a ⚠
 * whose tooltip says so.
 */
const OFF_MARKER_METRES = 20;
const METRES_PER_KM = 1000;

function offMarkerWarnings(
	rows: readonly CheckpointRow[],
	count: number,
): Map<number, string> {
	const markers = Array.from({ length: count }, (_, k) =>
		medianMarkerX(rows, k),
	);
	const warnings = new Map<number, string>();
	rows.forEach((row, r) => {
		const offsets = row.hits.flatMap((hit, k): number[] => {
			const marker = markers[k];
			return hit && marker !== null ? [(hit.x - marker) * METRES_PER_KM] : [];
		});
		if (!offsets.some((d) => Math.abs(d) > OFF_MARKER_METRES)) return;
		const metres = (d: number) =>
			`${d < 0 ? "−" : "+"}${Math.round(Math.abs(d))}`;
		const lo = metres(Math.min(...offsets));
		const hi = metres(Math.max(...offsets));
		const range = lo === hi ? lo : `${lo} … ${hi}`;
		warnings.set(
			r,
			`Passes the checkpoints ${range} m from their markers: read this lap where it passes, not at the marker.`,
		);
	});
	return warnings;
}

// ---------------------------------------------------------------- entry point

export interface CheckpointOverlayInput {
	rows: readonly CheckpointRowInput[];
	markers: "median" | "each";
	/** Mutated: the checkpoint lines and labels are appended. */
	veLayout: Layout;
	/** Mutated: the checkpoint lines and labels are appended. */
	residualLayout: Layout;
	tableId: string;
	/** What a row is, for the table head: "Lap" or "Leg". */
	rowNoun: string;
	/** What VE − reference means in this view: the heading's tooltip. */
	reference: string;
}

/**
 * Locate the checkpoints on the caller's rows, add their markers to the two
 * layouts and paint the table. Call BEFORE drawing the layouts.
 */
export function applyCheckpointOverlay(input: CheckpointOverlayInput): void {
	const appState = getCheckpointAppState();
	const container = document.getElementById(input.tableId);
	if (!appState) return;
	const track = checkpointTrack(appState);
	const count = appState.checkpoints.length;
	const rows =
		track && count > 0
			? locateCheckpoints(
					input.rows,
					resolvedCheckpoints(appState, track),
					track,
				)
			: [];

	const positions = markerPositions(rows, count, input.markers);
	append(
		input.veLayout,
		"shapes",
		positions.map((p) => markerLine(p.x)),
	);
	append(
		input.veLayout,
		"annotations",
		positions.map((p) => markerLabel(p.x, checkpointLabel(p.slot), p.slot)),
	);
	append(
		input.residualLayout,
		"shapes",
		positions.map((p) => markerLine(p.x)),
	);
	append(
		input.residualLayout,
		"annotations",
		positions.map((p) => markerLabel(p.x, checkpointLabel(p.slot), p.slot)),
	);

	if (!container) return;
	const offMarker =
		input.markers === "median"
			? offMarkerWarnings(rows, count)
			: new Map<number, string>();
	const render = () => {
		container.innerHTML = tableHtml(
			rows,
			count,
			input.rowNoun,
			input.reference,
			offMarker,
		);
		bindPlaceButtons(container, render);
	};
	render();
}
