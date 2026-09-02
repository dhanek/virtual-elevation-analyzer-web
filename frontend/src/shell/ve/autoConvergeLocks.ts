/**
 * The auto-converge LOCK controls: two checkboxes under the CdA/Crr sliders,
 * one shared markup helper for all three mode sidebars (the
 * `crrTempControls.ts` pattern).
 *
 * Lock semantics (confirmed): a locked slider is DRIVEN by the solver, not
 * frozen — which is why the UI labels the toggles "Automatic CdA" /
 * "Automatic Crr" while the ids and state keep the lock vocabulary. Locking CdA means the user drags Crr and CdA follows the ridge of
 * the closure-error surface; locking both parks the pair on its optimum. The
 * solve happens inside `updateModeVEPlots` (`resolveAutoConvergedControls`);
 * this module only owns the DOM: the checkboxes, the `disabled` state of a
 * driven slider, and the status line.
 *
 * PRESENT-AND-HIDDEN, never absent. The block renders in every sidebar and
 * carries `hidden` while auto-converge is off — the same rule the air-speed
 * offset block follows, and for the same reason: `bindModeControls` binds
 * ONCE, from the render, so a gated-out control would never be bound
 * (`modeControlBindingCoverage.test.ts` is the guard that noticed last time).
 *
 * A LOCKED SLIDER IS `disabled`. A disabled input fires no `input`/`change`
 * events, so the `cda`/`crr` table rows stay bound and simply never fire —
 * no unbinding, no special case in the funnel.
 */
import type { AutoConvergeState } from "../../analysis/AutoConverge";
import { AUTO_CONVERGE_DEFAULT } from "../../analysis/AutoConverge";
import type { AppState } from "../../state/AppState";

/**
 * The live lock state, created on first touch for AppState-shaped test
 * doubles that lack the field. The real `AppState` always carries it, so the
 * assignment branch never runs there (its `autoConverge` is a getter).
 */
export function ensureAutoConvergeState(appState: AppState): AutoConvergeState {
	if (!appState.autoConverge) {
		(appState as unknown as { autoConverge: AutoConvergeState }).autoConverge =
			{ ...AUTO_CONVERGE_DEFAULT };
	}
	return appState.autoConverge;
}

/**
 * The two info-badge tooltips, exported so tests can assert the wording stays
 * honest about what each solve actually minimises.
 */
export const AUTO_CONVERGE_INFO_TOOLTIP =
	"Each lap's virtual elevation is reduced to a single number: its " +
	"end-to-end VE gain minus the applied elevation target. An automatic " +
	"slider is driven so the laps' pooled difference is exactly zero; with " +
	"both sliders automatic, the optimum is where the per-lap numbers " +
	"disagree least with each other (lowest RMS spread). Needs laps with " +
	"different average speeds to separate CdA from Crr.";

export const PROFILE_SOLVE_INFO_TOOLTIP =
	"Each lap's VE curve is compared to the plain average of all the laps' " +
	"curves at 200 distance points along the lap. For every candidate CdA, " +
	"Crr is first set so the laps' pooled end-to-end gain hits the target " +
	"exactly; the solution is the candidate with the lowest RMSE across the " +
	"lap. Ticking also switches the Convergence map to this metric. Needs " +
	"two or more laps over the same course, with pacing differences between " +
	"them.";

/** Rendered under the Crr slider in all three sidebars; hidden until enabled. */
export function autoConvergeLockControlsMarkup(): string {
	return `
        <div class="ve-control-group auto-converge-locks" id="autoConvergeLocks" hidden>
            <label class="auto-converge-locks__label">Auto-converge: <span class="crr-temp-controls__info" title="${AUTO_CONVERGE_INFO_TOOLTIP}">i</span></label>
            <label class="auto-converge-locks__toggle" title="Automatic CdA: the solver drives CdA along the closure ridge while you tune Crr.">
                <input type="checkbox" id="cdaLockToggle"> Automatic CdA
            </label>
            <label class="auto-converge-locks__toggle" title="Automatic Crr: the solver drives Crr along the closure ridge while you tune CdA.">
                <input type="checkbox" id="crrLockToggle"> Automatic Crr
            </label>
            <label class="auto-converge-locks__toggle">
                <input type="checkbox" id="profileSolveToggle"> Intra-lap RMSE optimisation <span id="profileSolveInfo" class="crr-temp-controls__info" title="${PROFILE_SOLVE_INFO_TOOLTIP}">i</span>
            </label>
            <div id="autoConvergeStatus" class="auto-converge-locks__status" hidden></div>
        </div>`;
}

function checkbox(id: string): HTMLInputElement | null {
	if (typeof document === "undefined") return null;
	return document.getElementById(id) as HTMLInputElement | null;
}

/**
 * Reflect the state onto the DOM: block visibility, checkbox positions, and
 * the `disabled` flag on a driven slider pair. Runs at bind time and on every
 * change — the two-moment pattern `bindWindSourceRadios` uses.
 */
export function syncAutoConvergeControlState(appState: AppState): void {
	if (typeof document === "undefined") return;
	const state = ensureAutoConvergeState(appState);

	const block = document.getElementById("autoConvergeLocks");
	if (block) {
		block.hidden = !state.enabled;
	}

	const cdaLock = checkbox("cdaLockToggle");
	if (cdaLock) cdaLock.checked = state.cdaLocked;
	const crrLock = checkbox("crrLockToggle");
	if (crrLock) crrLock.checked = state.crrLocked;
	// Never disabled: besides replacing the both-locked solve, the toggle
	// switches the Convergence tab's surface, which is worth inspecting
	// before handing the sliders to the solver.
	const profileSolve = checkbox("profileSolveToggle");
	if (profileSolve) {
		profileSolve.checked = state.profileSolve ?? false;
	}

	const setDisabled = (ids: string[], disabled: boolean) => {
		for (const id of ids) {
			const el = document.getElementById(id) as HTMLInputElement | null;
			if (el) el.disabled = disabled;
		}
	};
	setDisabled(["cdaSlider", "cdaValue"], state.enabled && state.cdaLocked);
	setDisabled(["crrSlider", "crrValue"], state.enabled && state.crrLocked);

	if (!state.enabled) {
		setAutoConvergeStatus(null);
	}
}

/** The status line under the locks (underdetermined / clamped messages). */
export function setAutoConvergeStatus(message: string | null): void {
	if (typeof document === "undefined") return;
	const status = document.getElementById("autoConvergeStatus");
	if (!status) return;
	status.textContent = message ?? "";
	status.hidden = !message;
}

/**
 * Bind both lock checkboxes. Returns whether anything attached, the
 * `bindModeControls` contract that feeds `modeControlBindingCoverage`.
 */
export function bindAutoConvergeLocks(
	appState: AppState,
	onChange: () => void,
): boolean {
	const cdaLock = checkbox("cdaLockToggle");
	const crrLock = checkbox("crrLockToggle");
	if (!cdaLock || !crrLock) {
		return false;
	}

	const state = ensureAutoConvergeState(appState);

	cdaLock.addEventListener("change", () => {
		state.cdaLocked = cdaLock.checked;
		syncAutoConvergeControlState(appState);
		onChange();
	});
	crrLock.addEventListener("change", () => {
		state.crrLocked = crrLock.checked;
		syncAutoConvergeControlState(appState);
		onChange();
	});

	// Optional in test fixtures that predate it; the two lock toggles alone
	// still count as bound.
	const profileSolve = checkbox("profileSolveToggle");
	profileSolve?.addEventListener("change", () => {
		state.profileSolve = profileSolve.checked;
		syncAutoConvergeControlState(appState);
		onChange();
	});

	// The info badge lives inside the toggle's <label>; without this, reading
	// the tooltip by clicking would also flip the checkbox.
	document
		.getElementById("profileSolveInfo")
		?.addEventListener("click", (event) => event.preventDefault());

	syncAutoConvergeControlState(appState);
	return true;
}
