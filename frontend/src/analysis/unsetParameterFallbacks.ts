/**
 * THE VALUES A NULL CdA/Crr IS SHOWN AND COMPUTED WITH — one definition, because
 * two of them is a defect that reached production.
 *
 * `DEFAULT_PARAMETERS.crr` is `null`, meaning "optimize". Everything that has to
 * put a NUMBER on screen or into the calculator before an optimization has run
 * needs a stand-in, and until 2026-09-04 the codebase had two:
 *
 *   - `renderStandardVe.ts:84`  analyze leg   `crr ?? 0.005`
 *   - `renderStandardVe.ts:439` slider markup `crr || 0.008`
 *
 * So on a file with NO stored parameter record, Standard computed its first
 * paint at 0.005 while the slider displayed 0.008; the post-bind kick then read
 * the slider and recomputed, and the panel changed by itself. Measured on the
 * reference ride, lap 2 in Standard mode: `0.8264 / 3.56 m / −7.32 m` replaced
 * 16 ms later by `0.8200 / 4.56 m / −9.07 m`, with the two calls differing in
 * `crr` (0.005 vs 0.008) and in NOTHING ELSE — same CdA, trim, rho array, wind,
 * altitude and sample count.
 *
 * GPS-lap (`renderGpsLap.ts:178`) and out-and-back (`renderOutAndBack.ts:202`)
 * already used 0.008 for both halves, which is why only Standard drifted. 0.008
 * is therefore the value kept, and 0.005 the outlier removed.
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
