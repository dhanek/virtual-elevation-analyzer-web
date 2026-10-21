/**
 * Course checkpoints, the shell half: the one place they change.
 *
 * Three controls write them — the sidebar sliders, the remove/add buttons and a
 * click on the VE plot — and three views read them: the sidebar rows, the map
 * markers and the VE screen's markers and table. Every write goes through
 * `commitCheckpoints`, which stores them on `AppState`, saves them with the file
 * and repaints all three, so no view can show checkpoints another does not.
 */
import {
	checkpointBearings,
	MAX_CHECKPOINTS,
	resolveCheckpoint,
	type CheckpointPoint,
	type CheckpointTrack,
} from "../../analysis/Checkpoints";
import { getNormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import type { MapVisualization } from "../../components/MapVisualization";
import type { AppState } from "../../state/AppState";
import { log } from "../../utils/log";
import type { ParameterStorage } from "../../utils/ParameterStorage";
import { requestModeUpdate } from "../analysis/requestModeUpdate";

export interface CheckpointControllerDeps {
	appState: AppState;
	parameterStorage: ParameterStorage;
	getMapVisualization: () => MapVisualization | null;
	/** The selected FIT laps' time span — the sliders' range, as the gates'. */
	getSelectedDataTimeRange: () => { startTime: number; duration: number };
}

let deps: CheckpointControllerDeps | null = null;

export function configureCheckpoints(next: CheckpointControllerDeps): void {
	deps = next;
}

/** The app state the VE renderers read checkpoints from; null before configure. */
export function getCheckpointAppState(): AppState | null {
	return deps?.appState ?? null;
}

export function checkpointLabel(slot: number): string {
	return `CP${slot + 1}`;
}

/** The loaded activity's track, with the bearings the gate detectors use. */
export function checkpointTrack(appState: AppState): CheckpointTrack | null {
	const fitData = appState.currentFitData;
	if (!fitData) return null;
	const normalized = getNormalizedActivityArrays(fitData);
	const track = {
		positionLat: normalized.positionLat,
		positionLon: normalized.positionLong,
		timestamps: normalized.timestamps,
	};
	return { ...track, bearings: checkpointBearings(track) };
}

/** The stored checkpoints as places, in CP order; null where one has no position. */
export function resolvedCheckpoints(
	appState: AppState,
	track: CheckpointTrack,
): (CheckpointPoint | null)[] {
	return appState.checkpoints.map((t) => resolveCheckpoint(track, t));
}

/** Read the file's saved checkpoints into state. Call once per file load. */
export async function loadCheckpointsForFile(): Promise<void> {
	if (!deps) return;
	const { appState, parameterStorage } = deps;
	const fileHash = appState.currentFileHash;
	let saved: number[] = [];
	if (fileHash) {
		try {
			saved = await parameterStorage.loadCheckpoints(fileHash);
		} catch (err) {
			log.error("Failed to load checkpoints:", err);
		}
	}
	// A file switched while the read was in flight keeps its own.
	if (appState.currentFileHash !== fileHash) return;
	appState.checkpoints = saved;
	refreshCheckpointViews();
}

/**
 * Replace the checkpoints. `persist` is false only for live slider drags,
 * whose `change` event saves the final value.
 */
function commitCheckpoints(next: number[], persist = true): void {
	if (!deps) return;
	const { appState, parameterStorage } = deps;
	appState.checkpoints = next.slice(0, MAX_CHECKPOINTS);
	if (persist && appState.currentFileHash) {
		parameterStorage
			.saveCheckpoints(appState.currentFileHash, appState.checkpoints)
			.catch((err) => log.error("Failed to save checkpoints:", err));
	}
	refreshCheckpointViews();
}

/** Put checkpoint `slot` at `timestamp`; `slot` = count adds one. */
export function setCheckpointAt(slot: number, timestamp: number): void {
	if (!deps) return;
	const next = [...deps.appState.checkpoints];
	if (slot < 0 || slot > next.length || slot >= MAX_CHECKPOINTS) return;
	next[slot] = timestamp;
	commitCheckpoints(next);
}

/** Map markers and the VE screen; the sidebar rows are re-rendered too. */
function refreshCheckpointViews(): void {
	renderCheckpointRows();
	refreshCheckpointMap();
	requestModeUpdate("checkpoints");
}

export function refreshCheckpointMap(): void {
	if (!deps) return;
	const map = deps.getMapVisualization();
	const track = checkpointTrack(deps.appState);
	if (!map || !track) return;
	const markers = resolvedCheckpoints(deps.appState, track).flatMap(
		(cp, slot) =>
			cp ? [{ lat: cp.lat, lon: cp.lon, label: checkpointLabel(slot) }] : [],
	);
	map.setCheckpointMarkers(markers);
}

const ROWS_ID = "checkpointRows";
const ADD_ID = "checkpointAdd";

/** Seconds into the selection → FIT timestamp, via the nearest sample. */
function timestampAtOffset(offset: number): number | null {
	if (!deps?.appState.currentFitData) return null;
	return deps.getSelectedDataTimeRange().startTime + offset;
}

/** (Re-)render the sidebar rows from state. Safe when the panel is absent. */
export function renderCheckpointRows(): void {
	if (!deps) return;
	const rows = document.getElementById(ROWS_ID);
	const add = document.getElementById(ADD_ID) as HTMLButtonElement | null;
	if (!rows) return;
	const { appState } = deps;
	const range = deps.getSelectedDataTimeRange();
	const max = Math.max(0, Math.floor(range.duration));

	rows.innerHTML = appState.checkpoints
		.map((timestamp, slot) => {
			const offset = Math.round(timestamp - range.startTime);
			const sliderValue = Math.max(0, Math.min(offset, max));
			return `<div class="gate-slider-row gate-slider-row--tight" data-checkpoint-slot="${slot}">
                <label class="gate-slider-row__label gate-slider-row__label--checkpoint">${checkpointLabel(slot)}:</label>
                <input type="range" class="gate-slider-row__slider" min="0" max="${max}" step="1" value="${sliderValue}" aria-label="${checkpointLabel(slot)} position">
                <input type="number" class="gate-slider-row__value" step="1" value="${offset}" aria-label="${checkpointLabel(slot)} seconds">
                <span class="gate-slider-row__unit">s</span>
                <button type="button" class="checkpoint-remove" title="Remove ${checkpointLabel(slot)}" aria-label="Remove ${checkpointLabel(slot)}">×</button>
            </div>`;
		})
		.join("");

	rows
		.querySelectorAll<HTMLElement>("[data-checkpoint-slot]")
		.forEach((row) => {
			const slot = Number(row.dataset.checkpointSlot);
			const slider = row.querySelector<HTMLInputElement>('input[type="range"]');
			const value = row.querySelector<HTMLInputElement>('input[type="number"]');
			const remove = row.querySelector<HTMLButtonElement>(".checkpoint-remove");
			const move = (offset: number, persist: boolean) => {
				const timestamp = timestampAtOffset(offset);
				if (timestamp === null || !deps) return;
				const next = [...deps.appState.checkpoints];
				next[slot] = timestamp;
				if (persist) {
					commitCheckpoints(next);
					return;
				}
				// Live drag: no re-render, which would replace the slider under
				// the pointer.
				deps.appState.checkpoints = next;
				if (value) value.value = String(offset);
				refreshCheckpointMap();
				requestModeUpdate("checkpoints");
			};
			if (slider) {
				slider.oninput = () => move(parseInt(slider.value), false);
				slider.onchange = () => move(parseInt(slider.value), true);
			}
			if (value) {
				value.onchange = () => move(parseInt(value.value) || 0, true);
			}
			if (remove) {
				remove.onclick = () => {
					if (!deps) return;
					commitCheckpoints(
						deps.appState.checkpoints.filter((_, i) => i !== slot),
					);
				};
			}
		});

	if (add) {
		add.disabled = appState.checkpoints.length >= MAX_CHECKPOINTS;
		add.onclick = () => {
			if (!deps) return;
			// A new checkpoint starts mid-selection, where it is easy to see and
			// unlikely to sit on a gate.
			const timestamp = timestampAtOffset(Math.round(max / 2));
			if (timestamp === null) return;
			setCheckpointAt(deps.appState.checkpoints.length, timestamp);
		};
	}
}
