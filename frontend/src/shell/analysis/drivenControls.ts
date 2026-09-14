/**
 * Writes auto-converge's DRIVEN slider values back into the DOM, after the
 * primitive's pass has resolved them.
 *
 * DOM-only and funnel-only: the primitive itself never touches an element —
 * that is what keeps it node-testable and lets `veGolden.wasm.test.ts` drive
 * it — so the resolved pair rides out in `ModeUpdateOutcome` and the funnel
 * calls this after its `await`.
 *
 * REENTRANCY IS SAFE BY CONSTRUCTION, but only while the write stays
 * programmatic. `syncRangeAndNumber` (`dom/rangeNumberPair.ts`) listens on
 * the range's `input` and the number's `change`, neither of which fires when
 * `.value` is assigned from script — so this module assigns `.value` on both
 * elements directly and NEVER dispatches an event. `recomputeRunner`'s 20 ms
 * throttle is not a recursion guard and must not be leaned on as one.
 *
 * Values are written at DISPLAYED precision (CdA 3 dp, Crr 4 dp — the
 * `MODE_CONTROL_TABLE` decimals) and only when they actually differ, so a
 * settled solve stops writing.
 */
import { setAutoConvergeStatus } from "../ve/autoConvergeLocks";
import type { ModeUpdateOutcome } from "./updateModeVEPlots";

function writePair(
	rangeId: string,
	numberId: string,
	value: number,
	decimals: number,
): boolean {
	if (typeof document === "undefined" || !Number.isFinite(value)) {
		return false;
	}
	const text = value.toFixed(decimals);
	let wrote = false;

	const range = document.getElementById(rangeId) as HTMLInputElement | null;
	if (range && parseFloat(range.value).toFixed(decimals) !== text) {
		range.value = text;
		wrote = true;
	}
	const number = document.getElementById(numberId) as HTMLInputElement | null;
	if (number && parseFloat(number.value).toFixed(decimals) !== text) {
		number.value = text;
		wrote = true;
	}
	return wrote;
}

function statusMessage(
	autoConverge: ModeUpdateOutcome["autoConverge"],
): string | null {
	if (autoConverge.status === "underdetermined") {
		return autoConverge.reason;
	}
	if (autoConverge.status === "clamped") {
		return "The solve hit the CdA/Crr bounds — the driven value is clamped there.";
	}
	return null;
}

/**
 * Returns true when a slider value actually changed, so the funnel can re-run
 * the mode's `saveSettings` — the interaction-time save ran BEFORE this async
 * pass resolved the driven value, and would otherwise persist a stale one.
 */
export function syncDrivenControls(outcome: ModeUpdateOutcome): boolean {
	const { autoConverge, inputs } = outcome;
	setAutoConvergeStatus(statusMessage(autoConverge));

	let wrote = false;
	if (autoConverge.drivenCda) {
		wrote = writePair("cdaSlider", "cdaValue", inputs.cda, 3) || wrote;
	}
	if (autoConverge.drivenCrr) {
		wrote = writePair("crrSlider", "crrValue", inputs.crr, 4) || wrote;
	}
	return wrote;
}
