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
// ZERO times until the finger stopped. The plot only moved on release. Now the
// first event runs on the next macrotask, then at most one update per interval,
// and the last event always lands because the pending request is kept and a
// trailing run is armed.
//
// RATIFIED 2026-08-21 by the D-16 gate. This is the value the gate was run at
// and the value it passed at -- Chrome DevTools, real FIT, continuous CdA drag:
// Max Stall 25.7-60.0 ms against a 100 ms limit, 215-308 update cycles against
// a floor of 5, no visible freeze in any measured row. The measurements are in
// .planning/phases/07-mode-pipeline-unification/07-PROFILE-REPORT.md; the
// one-word decision is in the sibling 07-GATE-RESULT. One interval, not a
// per-mode table, per D-15 — and since the request no longer carries a mode at
// all, that table cannot be reintroduced without first re-adding one.
//
// WHAT THE GATE COVERS, stated because a bare "ratified" reads broader than the
// evidence: gps-lap only, in both wind sources, at 6 and 18 laps. Standard mode
// was INFERRED from the margin, not measured. Out-and-back was not measured at
// all -- no ride was available -- so its compare view has no browser exposure.
// Seven of the twelve planned rows are not measurements. This is not a
// whole-app performance clearance.
//
// 0 ms is UNTESTED, NOT REJECTED. The ladder rule is "the most responsive
// candidate that passes every row", and 0 is more responsive than 20; the only
// thing keeping it out is that nobody ran it. In every measured row the
// throttle NEVER BINDS -- a gps-lap update cycle cost ~45-49 ms against a 20 ms
// interval, so the pipeline is cost-capped and 0 would have changed nothing
// observable there. Where 0 WOULD differ is standard mode and small workloads,
// which are exactly the unmeasured rows: cheap updates at 0 ms redraw on
// essentially every input event, which the gate lists as a failure condition.
// Anyone wanting 0 measures those rows first.
//
// That ~45-49 ms per-cycle figure also FALSIFIES the assumption 20 ms was
// picked under. It was chosen as >= 2x the headless p95 (18 laps, 8.6 ms) on
// the theory that the other half of the interval covered Plotly, paint and
// input handling, which the headless profiler cannot see. In the browser one
// cycle costs more than TWICE the whole interval. So for the workloads that
// were measured, cost sets the update rate and this constant does not bind at
// all; it is ratified as a CEILING on update frequency for the cheap cases, not
// as a budget the expensive ones fit inside.
//
// (An earlier revision of this comment attributed the sentence "one recompute
// finishes before the next is scheduled" to a previous comment in THIS file. No
// committed version of this file ever contained it -- it is from
// 07-DEBOUNCE-HANDOFF.md section 2 and the plan. Dropped rather than repeated;
// the real comment-vs-code drift, and this mis-quotation of it, are in
// 07-PROFILE-REPORT.md section "Corrections to 3-PROFILE-REPORT.md".)
export const RECOMPUTE_THROTTLE_MS = 20;

export type RecomputeStatus = "idle" | "running" | "handoff";

/**
 * NO `mode` FIELD, deliberately. It carried a `RecomputeMode` that this module
 * read nowhere — the comment above claimed it stayed "for cancel semantics and
 * logging only", and there was neither. Its absence is also what makes the D-15
 * ruling structural rather than merely tested: a per-mode throttle table cannot
 * be reintroduced without first re-adding a mode to this request.
 *
 * NO `cancel` EITHER. No caller ever supplied one, so the runner's cancel path
 * was unreachable, and `cancelActiveRecompute` nulled the handle while an
 * in-flight pass still owned it — a bug that would have surfaced the moment
 * anyone did supply one. Serialisation through `inFlight` is what actually keeps
 * passes apart; an in-flight pass always runs to completion.
 */
export interface RecomputeRequest {
	run: (token: number) => Promise<void> | void;
}

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
let statusFlashTimer: ReturnType<typeof setTimeout> | null = null;

const RUNNING_COPY = "Recomputing…";
const HANDOFF_COPY = "Input updated — running latest values…";
const UPDATED_COPY = "Updated";

export function setRecomputeStatus(status: RecomputeStatus): void {
	// This used to mirror `status` into `appState.recomputeStatus` as well.
	// Nothing ever read that field back — not even this function, which renders
	// from its own argument — so it was the same write-only class `3fed12d`
	// deleted for `currentRhoArray`. The pill below IS the status.
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

/**
 * Drop the pending request and disarm the throttle timer.
 *
 * NO `reason` PARAMETER. It took `"new-input" | "mode-switch"`, ignored it, and
 * gave both callers identical behaviour — a union type documenting a
 * distinction the function did not make. Not exported either: the only callers
 * are `scheduleRecompute` and `resetRecomputeThrottle`, both in this file. If
 * the two reasons should ever differ, the parameter comes back WITH the
 * behaviour that makes it mean something.
 */
function cancelActiveRecompute(): void {
	if (throttleTimer) {
		clearTimeout(throttleTimer);
		throttleTimer = null;
	}
	pendingToken = null;
	pendingRequest = null;
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
 *   THROTTLED — while events keep arriving, at most one run per interval.
 *
 *   READ THE NEXT PARAGRAPH BEFORE CHANGING EITHER THE GUARD OR THE DELAY. An
 *   earlier revision of this comment claimed "the timer is armed ONCE and NOT
 *   re-armed by later events". THAT IS NOT WHAT THE CODE DOES. Whenever a pass
 *   is running, `scheduleRecompute` calls `cancelActiveRecompute()`,
 *   which CLEARS `throttleTimer`; the `if (throttleTimer !== null) return`
 *   guard below then sees null and arms a fresh timer. A gps-lap cycle costs
 *   ~45-49 ms against a 20 ms interval (see the file header), so during a
 *   sustained drag the runner is in the running state for most of the gesture
 *   and the timer is in fact cleared and re-armed on essentially EVERY input
 *   event.
 *
 *   What stops that from being the resetting debounce that starved the drag is
 *   NOT the guard — it is the DELAY FORMULA. The re-armed delay is measured
 *   from `lastRunStartedAt`, not from the event, so it can only shrink as time
 *   passes and reaches 0 once the interval has elapsed. The window therefore
 *   converges instead of receding. Anyone changing `sinceLastRun` /
 *   `intervalElapsed` to a delay measured from the EVENT reintroduces the
 *   starvation, and the guard will not save them.
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
		cancelActiveRecompute();
	}

	pendingToken = token;
	pendingRequest = request;

	// Already armed: this newer request has just replaced the pending one above,
	// and the armed timer will run it.
	//
	// NOTE this is reached with `throttleTimer === null` on most events of a
	// sustained drag, because the `cancelActiveRecompute` call above clears it
	// whenever a pass is running. The re-arm that follows is bounded by the
	// delay formula, not by this guard — see THROTTLED in the doc comment.
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
 *
 * PARTIAL, and knowing it matters when reading a flaky suite: this clears the
 * pending request and the armed timer, and rewinds `lastRunStartedAt`. It does
 * NOT touch `runningToken`, `activeToken` or the `inFlight` chain, so a call
 * made while a pass is queued or running does not actually return the runner to
 * a known point — the queued pass still resolves against the old `activeToken`
 * and the next scheduled pass still queues behind it. Await the in-flight work
 * before resetting if that matters to the test.
 */
export function resetRecomputeThrottle(): void {
	cancelActiveRecompute();
	lastRunStartedAt = Number.NEGATIVE_INFINITY;
}

/**
 * SERIALISED. Passes are chained onto this, never started alongside one another.
 *
 * The throttle interval alone does NOT keep two passes apart: the file header
 * records a ~45-49 ms gps-lap cycle against a 20 ms interval, so for the
 * workloads the D-16 gate actually measured the timer fires roughly twice per
 * cycle. Before this chain that meant the STEADY STATE of a gps-lap drag was two
 * or more overlapping `updateModeVEPlots` passes, each writing `currentVEResult`
 * / `currentFilteredData` / `currentAnalyzedLaps` and then calling
 * `Plotly.react`. Whichever resumed last won the screen while AppState held the
 * other's numbers — the stored result and the plot could disagree, which is the
 * invariant the D1 anti-drift seam exists to establish.
 *
 * Cancellation cannot substitute for this: the request carries no `cancel` hook
 * at all, so an in-flight pass always runs to completion.
 */
let inFlight: Promise<void> = Promise.resolve();

async function runPending(): Promise<void> {
	if (pendingToken === null || !pendingRequest) {
		return;
	}

	const token = pendingToken;
	const request = pendingRequest;
	pendingToken = null;
	pendingRequest = null;

	inFlight = inFlight.then(async () => {
		// Superseded while queued behind the previous pass. Its replacement is
		// already pending with a timer armed, so running this one would spend a
		// full cycle painting values the user has already moved past. This is
		// what keeps a sustained drag cost-capped rather than backlogged: every
		// intermediate input collapses and only the newest survives the queue.
		if (token !== activeToken) {
			return;
		}

		runningToken = token;
		setRecomputeStatus("running");

		try {
			await request.run(token);
		} catch (error) {
			log.error("Recompute runner failed:", error);
		} finally {
			// Guarded rather than unconditional: an unconditional null here was
			// how the old bookkeeping corrupted, clearing the flag out from under
			// a pass that was still running.
			if (runningToken === token) {
				runningToken = null;
			}

			if (token === activeToken) {
				flashUpdatedStatus();
			}
		}
	});

	await inFlight;
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
