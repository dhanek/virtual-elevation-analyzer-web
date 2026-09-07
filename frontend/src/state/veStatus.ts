import type { AppState } from "./AppState";

/**
 * Whether the analyze-derived state describes the current selection.
 *
 * `idle`      nothing to compute — no FIT data or no parameters
 * `computing` a pass is in flight; the panel's numbers are not trustworthy
 * `ready`     `currentVEResult` and its three sibling fields are current
 * `error`     the pass ran and produced no usable segment
 */
export type VeStatus = "idle" | "computing" | "ready" | "error";

/**
 * THE ONLY WRITER of `appState.veStatus`.
 *
 * It also reflects the status onto `#storeResult`, because a status field and a
 * button updated from two different call sites is exactly the two-copies-of-one
 * -answer drift this change removes. Store Result is meaningful only at `ready`.
 *
 * The button lookup tolerates absence: the status moves while no panel is
 * mounted (analyze start, teardown), and that is not an error.
 */
export function applyVeStatus(appState: AppState, status: VeStatus): void {
	appState.veStatus = status;

	// Guarded the same way `updateModeVEPlots.ts` and its siblings guard `document`:
	// several node-environment suites (`updateModeVEPlots.test.ts`,
	// `veGolden.wasm.test.ts`) drive this primitive with no DOM at all, not merely
	// a DOM missing `#storeResult`.
	if (typeof document === "undefined") {
		return;
	}

	const storeButton = document.getElementById(
		"storeResult",
	) as HTMLButtonElement | null;
	if (storeButton) {
		storeButton.disabled = status !== "ready";
	}
}
