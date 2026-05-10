---
phase: 4
plan: 01
wave: 1
depends_on: []
requirements_addressed: [SMOOTH-01, SMOOTH-02]
files_modified:
  - frontend/src/state/AppState.ts
  - frontend/src/shell/fileLoad/fileLoadOrchestration.ts
  - frontend/src/analysis/elevationProfiles.ts
  - frontend/src/analysis/demSmoothing.ts
  - backend/src/dem_processor/sampler.rs
  - frontend/src/shell/analysis/elevationProfileResolver.ts
  - frontend/src/shell/analysis/prepareAnalysisPayload.ts
  - frontend/src/shell/analysis/elevationProfiles.contract.test.ts
  - backend/tests/dem_interpolation.rs
autonomous: true
---

# Phase 4: Smoothing Clarity - Plan 01 (Implement BOTH DEM methods side-by-side)

**Phase:** 4  
**Plan:** 01  
**Wave:** 1  
**Goal:** Implement both candidate methods in parallel outputs (not stacked), with explicit profile ownership and resolver support.

## Objective

Implement non-UI core for explicit method comparison:

1. keep raw DEM nearest-neighbor profile,
2. generate moving-average-smoothed profile from DEM nearest profile,
3. generate DEM interpolated profile using raster-cell neighbor weighting,
4. keep all three profiles side-by-side and selectable (no blending/composition),
5. preserve FIT raw fallback when DEM is unavailable.

---

## Tasks

### Task 1: Expand elevation profile contract to 3 DEM display profiles

<read_first>

- `.planning/phases/4-smoothing-clarity/4-CONTEXT.md`
- `frontend/src/state/AppState.ts`
- `frontend/src/shell/fileLoad/fileLoadOrchestration.ts`

</read_first>

<action>
Create/update `frontend/src/analysis/elevationProfiles.ts` and extend app state contract.

Add exact union:

- `export type ElevationDisplayProfile = 'fit-raw' | 'dem-raw-nearest' | 'dem-smoothed-moving-average' | 'dem-interpolated';`

Add `ElevationProfilesState` keys:

- `fitRawElevation: number[] | null`
- `demRawNearestElevation: number[] | null`
- `demSmoothedMovingAverageElevation: number[] | null`
- `demInterpolatedElevation: number[] | null`
- `activeDisplayProfile: ElevationDisplayProfile`
- `demProfilesAvailable: boolean`

Default contract in `AppState`:

- `activeDisplayProfile: 'fit-raw'`
- DEM profile fields all `null`
- `demProfilesAvailable: false`

</action>

<acceptance_criteria>

- `frontend/src/analysis/elevationProfiles.ts` contains exact `dem-raw-nearest` and `dem-interpolated`
- `frontend/src/state/AppState.ts` contains `demSmoothedMovingAverageElevation`
- `frontend/src/state/AppState.ts` contains `demInterpolatedElevation`
- default includes `activeDisplayProfile: 'fit-raw'`

</acceptance_criteria>

---

### Task 2: Implement Method 1 (moving average) and Method 2 (grid interpolation) side-by-side

<read_first>

- `frontend/src/analysis/demSmoothing.ts`
- `frontend/src/shell/fileLoad/fileLoadOrchestration.ts`
- `backend/src/dem_processor/sampler.rs`
- `frontend/src/utils/DEMManager.ts`

</read_first>

<action>
Implement BOTH methods as separate outputs.

Method 1 (moving average on DEM nearest profile):

- in `frontend/src/analysis/demSmoothing.ts`:
  - `export const DEM_MOVING_AVERAGE_WINDOW = 9;`
  - `export function smoothDemMovingAverage(input: number[]): number[]`

Method 2 (interpolated DEM lookup at source):

- in `backend/src/dem_processor/sampler.rs`, add bilinear interpolation path using 4 surrounding raster cells:
  - compute `col0=floor(col)`, `col1=col0+1`, `row0=floor(row)`, `row1=row0+1`
  - compute normalized offsets `tx=col-col0`, `ty=row-row0`
  - weighted value:
    - `v = v00*(1-tx)*(1-ty) + v10*tx*(1-ty) + v01*(1-tx)*ty + v11*tx*ty`
  - if one or more neighbors are nodata/NaN, renormalize using only valid neighbors
  - if no valid neighbors, return NaN fallback

Expose interpolated lookup to frontend through DEM processor path used by `DEMManager` (e.g. add `batch_lookup_interpolated` and call it from DEM load orchestration).

In `fileLoadOrchestration.ts`, on DEM success populate all three DEM profiles:

1. `demRawNearestElevation` from nearest lookup output,
2. `demSmoothedMovingAverageElevation = smoothDemMovingAverage(demRawNearestElevation)`,
3. `demInterpolatedElevation` from interpolated DEM lookup output.

Set default comparison profile when DEM is active:

- `activeDisplayProfile = 'dem-raw-nearest'`
- `demProfilesAvailable = true`

On DEM failure/unavailable:

- keep `activeDisplayProfile = 'fit-raw'`
- clear all DEM profile arrays
- `demProfilesAvailable = false`

</action>

<acceptance_criteria>

- `frontend/src/analysis/demSmoothing.ts` contains `DEM_MOVING_AVERAGE_WINDOW = 9`
- `backend/src/dem_processor/sampler.rs` contains bilinear weight expression using `tx` and `ty`
- code path handles partial valid neighbors via renormalized weights
- `fileLoadOrchestration.ts` writes `demRawNearestElevation`, `demSmoothedMovingAverageElevation`, and `demInterpolatedElevation`
- `fileLoadOrchestration.ts` sets `activeDisplayProfile = 'dem-raw-nearest'` when DEM available

</acceptance_criteria>

---

### Task 3: Update shared resolver to support all 4 profiles

<read_first>

- `frontend/src/shell/analysis/elevationProfileResolver.ts`
- `frontend/src/shell/analysis/prepareAnalysisPayload.ts`
- `frontend/src/state/AppState.ts`

</read_first>

<action>
Update resolver API and profile selection rules.

`ResolvedElevationProfile.profile` must support:

- `'fit-raw'`
- `'dem-raw-nearest'`
- `'dem-smoothed-moving-average'`
- `'dem-interpolated'`

Resolver order:

1. honor selected `activeDisplayProfile` if corresponding array exists and length matches,
2. if selected DEM profile missing/mismatch and other DEM profiles exist, fallback order:
   - `dem-raw-nearest` -> `dem-smoothed-moving-average` -> `dem-interpolated`,
3. final fallback `fit-raw`.

Update `prepareAnalysisPayload.ts` to always consume resolver output instead of directly using `normalized.altitude`.

</action>

<acceptance_criteria>

- resolver file contains all 4 profile string literals
- resolver file contains fallback order comment/logic with `dem-raw-nearest`, `dem-smoothed-moving-average`, `dem-interpolated`
- `prepareAnalysisPayload.ts` imports and uses resolver for altitude source

</acceptance_criteria>

---

### Task 4: Add tests proving both methods are independent and not stacked

<read_first>

- `frontend/vitest.config.ts`
- `frontend/src/shell/analysis/elevationProfileResolver.ts`
- `backend/src/dem_processor/sampler.rs`

</read_first>

<action>
Create/extend tests:

- `frontend/src/shell/analysis/elevationProfiles.contract.test.ts`
- `backend/tests/dem_interpolation.rs`

Required tests:

1. `moving average profile is derived from demRawNearest only`
2. `interpolated profile is computed independently of moving average profile`
3. `resolver returns dem-raw-nearest by default when DEM profiles are available`
4. `resolver falls back to fit-raw when selected profile length mismatches`
5. `bilinear interpolation uses four-neighbor weighted average`

Run:

- `cd frontend && npm run test -- src/shell/analysis/elevationProfiles.contract.test.ts`
- `cd backend && cargo test dem_interpolation`

</action>

<acceptance_criteria>

- frontend contract test contains exact names `moving average profile is derived from demRawNearest only` and `interpolated profile is computed independently of moving average profile`
- backend test contains `bilinear interpolation uses four-neighbor weighted average`
- both listed test commands exit 0

</acceptance_criteria>

---

## Verification Criteria

| ID  | Criterion                                                                                         |
| --- | ------------------------------------------------------------------------------------------------- |
| V1  | State contract stores three DEM profiles side-by-side plus FIT raw fallback                       |
| V2  | Moving-average method and interpolation method are implemented as separate outputs                |
| V3  | Resolver supports `fit-raw`, `dem-raw-nearest`, `dem-smoothed-moving-average`, `dem-interpolated` |
| V4  | Tests prove methods are independent (not applied on top of each other)                            |

## Must-Haves for Goal-Backward Verification

1. Maintainer can explain both methods and where each is computed.
2. User can compare raw vs smoothing vs interpolation on same ride.
3. No implicit method stacking occurs.
4. FIT raw fallback remains unchanged when DEM is absent.
