/**
 * THE VALUES A NULL CdA/Crr IS SHOWN AND COMPUTED WITH — one definition, because
 * two of them is a defect that reached production.
 *
 * `DEFAULT_PARAMETERS.crr` is `null`, meaning "optimize". Everything that has to
 * put a NUMBER on screen or into the calculator before an optimization has run
 * needs a stand-in, and until 2026-09-04 the codebase had two:
 *
 *   - `renderStandardVe.ts`'s `initializeVEAnalysis` — analyze leg, `crr ?? 0.005`
 *   - `renderStandardVe.ts`'s `#crrSlider` control — slider markup, `crr || 0.008`
 *
 * So on a file with NO stored parameter record, Standard computed its first
 * paint at 0.005 while the slider displayed 0.008; the post-bind kick then read
 * the slider and recomputed, and the panel changed by itself. Measured on the
 * reference ride, lap 2 in Standard mode: `0.8264 / 3.56 m / −7.32 m` replaced
 * 16 ms later by `0.8200 / 4.56 m / −9.07 m`, with the two calls differing in
 * `crr` (0.005 vs 0.008) and in NOTHING ELSE — same CdA, trim, rho array, wind,
 * altitude and sample count.
 *
 * GPS-lap already used 0.008 for both halves, and out-and-back did too, until
 * each mode's analyze-leg copy of the computed half (`resolveAppliedCrr` over
 * `resolveDisplayCrr`) was deleted in the 2026-09-04 retirement of its own
 * fit. Standard's analyze-leg copy went the same way when its own fit
 * was retired, so NEITHER of the two sites above computes any more: for all
 * three modes the computed half now runs through the shared producer's
 * `resolveAppliedCrr` call (`updateModeVEPlots.ts`) and the display half stays
 * at each mode's `#crrSlider` markup. Standard was the only mode that drifted.
 * 0.008 is therefore the value kept, and 0.005 the outlier removed.
 *
 * `storageHandlers.ts` carried the same 0.005 on the path that PERSISTS a
 * result when no slider is rendered, so this was never only cosmetic.
 */
export const UNSET_CRR_FALLBACK = 0.008;

/** The CdA counterpart. Already consistent everywhere; named so it stays that way. */
export const UNSET_CDA_FALLBACK = 0.3;

/** The number to compute with and to display when `crr` is unset. */
export function resolveDisplayCrr(crr: number | null | undefined): number {
	return crr ?? UNSET_CRR_FALLBACK;
}

/** The CdA equivalent of `resolveDisplayCrr`. */
export function resolveDisplayCda(cda: number | null | undefined): number {
	return cda ?? UNSET_CDA_FALLBACK;
}
