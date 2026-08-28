/**
 * The shared "Air Speed Time Offset" control block (N-3).
 *
 * The offset shifts the recorded FIT air-speed channel in time so it lines up
 * with ground speed; `calculateAirSpeedSyncError` is the number it is tuned to
 * minimise. Both the handler and that metric have existed for a long time and
 * were DEAD in every mode:
 *
 * - Standard never rendered the slider at all, so its handler had nothing to
 *   bind to;
 * - no template in any mode has ever rendered `#airSpeedOffsetErrorMetric`, so
 *   the metric had nowhere to display.
 *
 * The maintainer ruled (plan 07-03) that Standard gains the control it was
 * always supposed to have, so the generalised error metric applies in all three
 * modes. One markup helper rather than three copies is what makes "it reads as
 * the same control" a property of the code instead of a review note — and it is
 * why `bindModeControls`' single `airSpeedOffset` row can bind all three modes
 * without per-mode element lists.
 *
 * T-08-02: every interpolated value is a NUMBER. No user-controlled string
 * reaches the template.
 */

import {
	fitWindControlsApplyTo,
	WIND_SOURCE_VISIBILITY_ATTR,
} from "./windSourceVisibility";

/** The block's own id, so the visibility sync and tests can name it. */
export const AIR_SPEED_OFFSET_CONTROLS_ID = "airSpeedOffsetControls";

export const AIR_SPEED_OFFSET_MIN_SECONDS = -10;
export const AIR_SPEED_OFFSET_MAX_SECONDS = 10;
export const AIR_SPEED_OFFSET_STEP_SECONDS = 1;

/**
 * Resolve the offset the control opens on: the stored parameter when the record
 * carries one, otherwise the mode's default. `??` deliberately, not `||`, so a
 * stored offset of 0 is honoured rather than falling through to the default.
 */
export function resolveInitialAirSpeedOffset(
	storedOffset: number | null | undefined,
	defaultOffset: number,
): number {
	return storedOffset ?? defaultOffset;
}

/**
 * The control block, for the three sidebars to interpolate.
 *
 * Callers decide WHETHER to render it — it is meaningful only where a FIT
 * air-speed channel exists — but they must not gate it on the SELECTED WIND
 * SOURCE. None of the three templates is rebuilt when the source changes, so a
 * source-gated control would be absent at bind time and stay unbound for the
 * rest of the panel's life. That is the N-3 failure mode restated, and it is why
 * the k control took the same visibility-not-presence route in d4bf97f.
 *
 * The block carries `data-wind-source="fit"`, so `syncFitWindControlsVisibility`
 * hides it under constant wind, where the offset is applied nowhere: it is read
 * only on the `fit` branch of `resolveWindSeries`, and on the golden fixture
 * offset 2 -> 30 under constant leaves mean r² at 0.181694 and the VE checksum
 * at 1254.10, byte-identical. `3dbaefc` gated this block on `hasWindSpeed` so
 * the binder could bind it once and did not add the matching visibility toggle,
 * which is what left it visible and inert in Standard under constant.
 *
 * `windSource` is optional and decides only the INITIAL hidden state, exactly
 * as in `windHeightControlsMarkup`: the bind-time sync settles it either way,
 * so passing it is the difference between no flash and a flash, never between
 * right and wrong.
 */
export function airSpeedOffsetControlMarkup(
	storedOffset: number | null | undefined,
	defaultOffset: number,
	windSource?: string | null,
): string {
	const value = resolveInitialAirSpeedOffset(storedOffset, defaultOffset);
	const hidden =
		windSource !== undefined && windSource !== null
			? !fitWindControlsApplyTo(windSource)
			: false;

	return `
        <div class="ve-parameter ve-parameter--panel" id="${AIR_SPEED_OFFSET_CONTROLS_ID}" ${WIND_SOURCE_VISIBILITY_ATTR}="fit"${hidden ? " hidden" : ""}>
            <h4 class="ve-parameter__title">Air Speed Time Offset</h4>
            <div class="ve-parameter__grid">
                <input type="range" id="airSpeedOffsetSlider" min="${AIR_SPEED_OFFSET_MIN_SECONDS}" max="${AIR_SPEED_OFFSET_MAX_SECONDS}" step="${AIR_SPEED_OFFSET_STEP_SECONDS}" value="${value}"
                       class="ve-parameter__slider" />
                <input type="number" id="airSpeedOffsetValue" value="${value}" step="${AIR_SPEED_OFFSET_STEP_SECONDS}" min="${AIR_SPEED_OFFSET_MIN_SECONDS}" max="${AIR_SPEED_OFFSET_MAX_SECONDS}"
                       class="ve-parameter__value" />
                <span class="ve-parameter__unit">seconds</span>
            </div>
            <div class="ve-parameter__metric">
                Ground/air speed sync error:<span id="airSpeedOffsetErrorMetric"></span>
            </div>
        </div>
    `;
}
