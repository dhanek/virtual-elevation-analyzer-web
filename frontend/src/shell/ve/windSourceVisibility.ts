/**
 * Visibility for the controls that only mean something under a FIT air-speed
 * channel (maintainer ruling, plan 07-03).
 *
 * WHY VISIBILITY AND NOT PRESENCE. `bindModeControls` binds ONCE, from the
 * sidebar render, and skips any row whose elements are not in the DOM at that
 * instant. A control gated on the selected wind source at TEMPLATE time is
 * therefore absent at bind time and stays unbound for the rest of the panel's
 * life — or, if the panel is rebuilt on every source change to work around
 * that, the mode keeps a private route to the primitive and the one-funnel
 * invariant gains a permanent exception. Rendering always and toggling `hidden`
 * is the route the k control already took (d4bf97f), and this is the same
 * mechanism generalised.
 *
 * WHICH CONTROLS, AND WHY THEY ARE HIDDEN RATHER THAN LEFT ALONE. Under
 * constant wind the air-speed time offset and the air-speed calibration percent
 * are applied nowhere. Both are read only on the `fit` branch of
 * `resolveWindSeries`; `calculateConstantApparentWindSeries` never consults
 * either. Measured on the golden fixture through the real production path,
 * offset 2 -> 30 under constant leaves mean r² at 0.181694 and the VE checksum
 * at 1254.10, and calibration 0% -> 10% leaves both likewise — byte-identical
 * to every digit computed, not merely close. A bound, responsive control that
 * changes nothing and gives no indication of that is the inert-but-live class,
 * and it lied in all three modes.
 *
 * The mirror image already ships and is the precedent: k is inert under `fit`
 * (0.3 -> 1.0 changes nothing there), and its block is hidden under `fit` for
 * exactly this reason.
 *
 * OPT-IN, NOT MODE-BRANCHED. The sync toggles whatever the template TAGGED,
 * and nothing else — never an `if (modeId)` in here (D-02). All four VE
 * templates now tag the VD tab, so all three modes hide it under constant.
 *
 * THAT UNIFORMITY IS A REVERSAL, and the history is worth keeping. On
 * 2026-08-05 the maintainer ruled that Standard KEEPS its VD tab under
 * constant, on the grounds that the tab does not lie there: it integrates
 * `apparentWindSpeedMps`, which the constant path computes properly and which
 * responds correctly to wind speed, direction and k. That reasoning still
 * holds and the computation is untouched. On 2026-08-14 the ruling was
 * reversed on a different axis: Standard's Stacked lap view is the GPS-lap
 * overlay, whose template tags the tab, so within one mode the VD tab appeared
 * under Stitched and vanished under Stacked as the user toggled views.
 * View-dependent tab visibility is surprising; the reversal buys uniformity,
 * not correctness.
 */
import { activateTab } from "../dom/tabs";

/**
 * Marks an element whose visibility follows the wind source. The only value is
 * `"fit"`: shown when the FIT air-speed channel is what the physics uses.
 */
export const WIND_SOURCE_VISIBILITY_ATTR = "data-wind-source";

/** The sources under which the FIT air-speed channel is actually applied. */
export function fitWindControlsApplyTo(
	windSource: string | null | undefined,
): boolean {
	// `compare` renders both methods and reaches the FIT branch for one of them,
	// so the FIT-only controls are live there. This mirrors the
	// `selectedWindSource === "compare" ? "fit" : ...` fold the templates do.
	return windSource === "fit" || windSource === "compare";
}

/**
 * The attributes that opt an element into the sync, for templates to
 * interpolate directly into a tag.
 *
 * `windSource` decides only the INITIAL hidden state and may be omitted; the
 * bind-time sync settles it either way, so passing it is the difference between
 * no flash and a flash, never between right and wrong. Returned as a string
 * rather than set from JS afterwards so the markup is correct in the same tick
 * it is written, which matters for the GPS sidebars: they interpolate their
 * whole panel in one `innerHTML` assignment.
 */
export function fitWindVisibilityAttrs(windSource?: string | null): string {
	const hidden =
		windSource !== undefined && windSource !== null
			? !fitWindControlsApplyTo(windSource)
			: false;
	return ` ${WIND_SOURCE_VISIBILITY_ATTR}="fit"${hidden ? " hidden" : ""}`;
}

/**
 * The tab a user is moved to when the one they were on disappears. VE is the
 * tab every mode renders unconditionally and the one every panel opens on.
 */
const FALLBACK_TAB = "ve";

/**
 * Show or hide the FIT-only controls to match the selected wind source, then
 * make sure the user is not left looking at a pane that just vanished.
 *
 * VISIBILITY ONLY, and that is load-bearing rather than decorative: every
 * element stays in the DOM holding its value, so `bindModeControls` binds it
 * once and a source round-trip returns the same offset and the same
 * calibration rather than re-seeding them from the defaults.
 *
 * Called from `bindWindSourceRadios` — at bind time and on every change — so
 * that all three sidebars get it from the one binder they already share and a
 * mode cannot be missed.
 */
export function syncFitWindControlsVisibility(
	windSource: string | null | undefined,
): void {
	if (typeof document === "undefined") return;

	const applies = fitWindControlsApplyTo(windSource);
	const tagged = document.querySelectorAll<HTMLElement>(
		`[${WIND_SOURCE_VISIBILITY_ATTR}="fit"]`,
	);
	tagged.forEach((element) => {
		element.hidden = !applies;
	});

	ensureActiveTabVisible();
}

/**
 * The active-tab guard, and the only genuinely NEW behaviour in this change.
 *
 * Today a wind-source change rebuilds the GPS sidebar and the rebuild resets to
 * the VE tab, so the VD tab cannot be active at the moment it disappears. Once
 * the rebuild is gone the panel persists across a source change, so a user
 * sitting on VD who switches to constant would be left with a hidden active
 * pane and no other pane active — a blank panel with the tab strip still
 * showing. Moving them to VE is what a rebuild used to do implicitly.
 */
function ensureActiveTabVisible(): void {
	const active = document.querySelector<HTMLElement>(".ve-tab-content--active");
	if (!active || !active.hidden) return;
	activateTab(FALLBACK_TAB);
}
