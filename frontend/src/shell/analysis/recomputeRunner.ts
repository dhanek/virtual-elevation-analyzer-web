import type { AppState } from "../../state/AppState";
import { log } from "../../utils/log";

export const HEAVY_RECOMPUTE_DEBOUNCE_MS = 200;
export const STANDARD_RECOMPUTE_DEBOUNCE_MS = 0;
// GPS-lap (incl. the stacked-from-standard overlay) recomputes in-place via
// Plotly.react, so it can update live during a slider drag like standard mode.
export const GPS_LAP_RECOMPUTE_DEBOUNCE_MS = 0;

export type RecomputeMode = "standard" | "gps-lap" | "out-and-back";
export type RecomputeStatus = "idle" | "running" | "handoff";

export interface RecomputeRequest {
	mode: RecomputeMode;
	run: (token: number) => Promise<void> | void;
	cancel?: () => void;
}

let appState: AppState | null = null;
let activeToken = 0;
let runningToken: number | null = null;
let pendingToken: number | null = null;
let pendingRequest: RecomputeRequest | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let activeCancel: (() => void) | null = null;
let statusFlashTimer: ReturnType<typeof setTimeout> | null = null;

const RUNNING_COPY = "Recomputing…";
const HANDOFF_COPY = "Input updated — running latest values…";
const UPDATED_COPY = "Updated";

export function configureRecomputeRunner(nextAppState: AppState): void {
	appState = nextAppState;
}

export function setRecomputeStatus(status: RecomputeStatus): void {
	if (appState) {
		appState.recomputeStatus = status;
	}

	const node = ensureStatusNode();
	if (!node) return;

	if (statusFlashTimer) {
		clearTimeout(statusFlashTimer);
		statusFlashTimer = null;
	}

	if (status === "idle") {
		node.hidden = true;
		return;
	}

	node.hidden = false;
	node.textContent = status === "handoff" ? HANDOFF_COPY : RUNNING_COPY;
}

export function cancelActiveRecompute(
	_reason: "new-input" | "mode-switch",
): void {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
		debounceTimer = null;
	}
	pendingToken = null;
	pendingRequest = null;

	if (activeCancel) {
		activeCancel();
	}
	activeCancel = null;
}

export function scheduleRecompute(request: RecomputeRequest): void {
	const token = ++activeToken;
	const debounceMs = getDebounceMs(request.mode);

	if (runningToken !== null) {
		setRecomputeStatus("handoff");
		cancelActiveRecompute("new-input");
	}

	pendingToken = token;
	pendingRequest = request;

	if (debounceTimer) {
		clearTimeout(debounceTimer);
	}

	debounceTimer = setTimeout(() => {
		debounceTimer = null;
		void runPending();
	}, debounceMs);
}

function getDebounceMs(mode: RecomputeMode): number {
	switch (mode) {
		case "standard":
			return STANDARD_RECOMPUTE_DEBOUNCE_MS;
		case "gps-lap":
			return GPS_LAP_RECOMPUTE_DEBOUNCE_MS;
		default:
			return HEAVY_RECOMPUTE_DEBOUNCE_MS;
	}
}

async function runPending(): Promise<void> {
	if (pendingToken === null || !pendingRequest) {
		return;
	}

	const token = pendingToken;
	const request = pendingRequest;
	pendingToken = null;
	pendingRequest = null;

	runningToken = token;
	activeCancel = request.cancel ?? null;
	setRecomputeStatus("running");

	try {
		await request.run(token);
	} catch (error) {
		log.error("Recompute runner failed:", error);
	} finally {
		activeCancel = null;
		runningToken = null;

		if (token === activeToken) {
			flashUpdatedStatus();
		}
	}
}

function flashUpdatedStatus(): void {
	const node = ensureStatusNode();
	if (node) {
		node.hidden = false;
		node.textContent = UPDATED_COPY;
	}

	if (statusFlashTimer) {
		clearTimeout(statusFlashTimer);
	}

	statusFlashTimer = setTimeout(() => {
		setRecomputeStatus("idle");
	}, 250);
}

function ensureStatusNode(): HTMLElement | null {
	if (typeof document === "undefined") {
		return null;
	}

	let node = document.getElementById("veRecomputeStatus") as HTMLElement | null;
	if (node) {
		return node;
	}

	const host =
		document.querySelector("#veAnalysisContent .ve-controls") ||
		document.querySelector("#veAnalysisContent .ve-tabs") ||
		document.getElementById("veAnalysisContent");

	if (!host) {
		return null;
	}

	node = document.createElement("div");
	node.id = "veRecomputeStatus";
	node.className = "ve-recompute-status";
	node.setAttribute("role", "status");
	node.setAttribute("aria-live", "polite");
	node.hidden = true;

	host.prepend(node);
	return node;
}
