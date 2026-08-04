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
 */
export function airSpeedOffsetControlMarkup(
	storedOffset: number | null | undefined,
	defaultOffset: number,
): string {
	const value = resolveInitialAirSpeedOffset(storedOffset, defaultOffset);

	return `
        <div class="ve-parameter ve-parameter--panel">
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
