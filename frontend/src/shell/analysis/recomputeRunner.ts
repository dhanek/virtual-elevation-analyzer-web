import type { AppState } from "../../state/AppState";
import { log } from "../../utils/log";

// One interval for every mode (D-15). The per-mode table it replaces gave
// standard 0 ms, gps-lap 0 ms and out-and-back 200 ms; out-and-back was slower
// because it computes 2N segments, not because it is out-and-back.
//
// A LEADING-EDGE THROTTLE, NOT A DEBOUNCE (maintainer ruling, 2026-08-16).
// Until this ruling `scheduleRecompute` cleared and re-armed its timer on every
// call, which is a RESETTING TRAILING DEBOUNCE: while input events arrive closer
// together than the window, the timer never reaches zero and NOT ONE update
// runs. At 50 ms that meant a normal drag (events every 8-33 ms) repainted
// ZERO times until the finger stopped. The plot only moved on release.
//
// The rule the old comment claimed -- "one recompute finishes before the next is
// scheduled" -- described a throttle while the code was a debounce, so it was
// vacuous at any non-zero value. Now it is true: the first event runs on the
// next macrotask, then at most one update per interval, and the last event
// always lands because the pending request is kept and a trailing run is armed.
//
// PROVISIONAL — NOT RATIFIED. 20 ms is the smallest value from
// {16, 20, 25, 33, 50} satisfying BOTH:
//
//   (a) >= 16.7 ms, one frame at 60 Hz. Updating faster than the display
//       refreshes burns main thread on frames nobody can see.
//   (b) >= 2 x the p95 measured update cost of the heaviest workload
//       (18 laps, 8.6 ms p95 -> 17.2 ms), so at most HALF the interval goes to
//       the part we can measure.
//
//   max(16.7, 17.2) = 17.2 -> 20 ms. Duty cycle on the measured part: 43% at
//   18 laps p95, 27% at 6 laps p95 (5.5 ms).
//
// THE ASSUMPTION IN (b), STATED SO IT CAN BE FALSIFIED: the other half of the
// interval is budgeted for Plotly, paint and input handling, none of which the
// headless profiler can see -- Plotly is a runtime CDN global and jsdom has no
// layout. It is handed 13 traces / ~14 400 points per VE-tab update. If the
// D-16 trace shows Plotly alone exceeding ~10 ms per update at the gate
// workload, the factor of 2 is wrong and this must rise to 33 or 50 ms.
//
// The measured costs behind (b) are post-D1/D2/D3/D4: those four speedups took
// the 6-lap VE-tab update from 22.3 ms to 3.7 ms median. Choosing the interval
// against the OLD cost would have picked 50 ms and thrown the speedups away.
//
// Owner of the ratified value: plan 04 (D-16). See
// .planning/phases/07-mode-pipeline-unification/07-DEBOUNCE-HANDOFF.md for the
// arithmetic, the gate protocol and the report-vs-code drift this reopens.
export const RECOMPUTE_THROTTLE_MS = 20;

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
let throttleTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * When the last run STARTED. The interval is measured from the start, not the
 * finish, so a slow update does not push the next one an extra interval away.
 */
let lastRunStartedAt = Number.NEGATIVE_INFINITY;
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
	if (throttleTimer) {
		clearTimeout(throttleTimer);
		throttleTimer = null;
	}
	pendingToken = null;
	pendingRequest = null;

	if (activeCancel) {
		activeCancel();
	}
	activeCancel = null;
}

/**
 * A LEADING-EDGE THROTTLE with a guaranteed trailing run.
 *
 * Three properties, each of which one of the tests in `recomputeRunner.test.ts`
 * exists to hold:
 *
 *   LEADING — the first event of a gesture runs on the NEXT MACROTASK, so the
 *   plot moves as the user starts dragging rather than after an interval. Not
 *   synchronously: that would run inside the DOM event handler that asked,
 *   before it had applied its own state, and a tab switch would recompute
 *   against the previously active tab. See the comment at the setTimeout.
 *
 *   THROTTLED — while events keep arriving, at most one run per interval. The
 *   timer is armed ONCE and NOT re-armed by later events; re-arming is exactly
 *   what made the previous implementation a resetting debounce that starved the
 *   drag completely.
 *
 *   TRAILING — the newest request always replaces the pending one, so whatever
 *   was armed runs with the LATEST values. Without this the plot would settle
 *   showing a stale value once the user let go, which is the failure a pure
 *   leading-edge throttle has.
 */
export function scheduleRecompute(request: RecomputeRequest): void {
	const token = ++activeToken;

	if (runningToken !== null) {
		setRecomputeStatus("handoff");
		cancelActiveRecompute("new-input");
	}

	pendingToken = token;
	pendingRequest = request;

	// Already armed: this newer request has just replaced the pending one above,
	// and the armed timer will run it. Re-arming here would reset the window and
	// turn the throttle back into a debounce.
	if (throttleTimer !== null) {
		return;
	}

	const sinceLastRun = Date.now() - lastRunStartedAt;

	// A NEGATIVE elapsed time means the wall clock moved backwards — an NTP
	// correction, a manual clock change, or a suite that resets a mocked clock
	// between tests. Without this branch the throttle would compute a delay of
	// `interval - (a large negative number)` and stall the plot for as long as
	// the jump, which for an NTP step can be minutes. Treat it as "the interval
	// has certainly elapsed" and run.
	const intervalElapsed = sinceLastRun < 0 || sinceLastRun >= RECOMPUTE_THROTTLE_MS;

	// ZERO, not a synchronous call, for the leading edge.
	//
	// Running synchronously here would execute the recompute INSIDE the DOM
	// event handler that asked for it, before that handler has finished. The
	// render callbacks ask `isVeTabActive(...)`, which reads a class the tab
	// handler has not applied yet — so a tab switch would recompute against the
	// PREVIOUS active tab and skip drawing the one the user just opened. Three
	// real-chain tests caught exactly that, and in the browser it would look
	// like "the VD tab is blank until you nudge a slider".
	//
	// A 0 ms timeout still runs on the next macrotask, which is the leading edge
	// in every sense that matters: no interval is waited out.
	throttleTimer = setTimeout(
		() => {
			throttleTimer = null;
			lastRunStartedAt = Date.now();
			void runPending();
		},
		intervalElapsed ? 0 : RECOMPUTE_THROTTLE_MS - sinceLastRun,
	);
}

/**
 * Test seam. The throttle carries state ACROSS calls by design — that is what
 * makes it a throttle — so a suite that drives it repeatedly needs to be able to
 * start from a known point.
 */
export function resetRecomputeThrottle(): void {
	cancelActiveRecompute("mode-switch");
	lastRunStartedAt = Number.NEGATIVE_INFINITY;
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
