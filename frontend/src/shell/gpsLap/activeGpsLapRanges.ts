/**
 * Re-export shim.
 *
 * The implementation moved to `modes/analysis/activeGpsLapRanges.ts` in plan
 * 07-02 Task 1 so that `gpsLapMode.getUpdateSegments` can reach it —
 * `modes/analysis/` must not import from `shell/` (D-03). This file stays so
 * that existing importers and the co-located test are untouched.
 */
export { resolveActiveGpsLapRanges } from "../../modes/analysis/activeGpsLapRanges";
