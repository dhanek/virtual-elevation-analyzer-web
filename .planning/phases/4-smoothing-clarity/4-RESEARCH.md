# Phase 4: Smoothing Clarity - Research

**Researched:** 2026-05-09  
**Phase:** 4 - Smoothing Clarity  
**Requirements:** SMOOTH-01, SMOOTH-02  
**Method:** Manual in-session research (planner/research subagent execution unavailable in this run)

---

## What I Need to Know to Plan This Phase Well

### 1) Elevation ownership is currently implicit and mutation-heavy

Current load flow mutates `fit_data.altitude` directly in `frontend/src/shell/fileLoad/fileLoadOrchestration.ts`:

- local DEM path applies `result.fit_data.set_altitude(correctionResult.elevations)`
- remote DEM path applies `result.fit_data.set_altitude(bestDEM.elevations)` when coverage gate passes
- fallback behavior keeps raw FIT altitude when DEM is missing/fails

This means there is no explicit dual-profile model (raw vs DEM-smoothed), and ownership is inferred from side effects.

### 2) All analysis modes read altitude from shared normalized arrays

Mode render/update paths consume `normalized.altitude` from activity data:

- Standard VE: `renderStandardVe.ts` + `bindStandardSliders.ts` pass `analysisInput.altitude` to plots/calculator
- GPS-lap: `renderGpsLap.ts` + `updateGpsLap.ts` build `actualElevation` from per-lap altitude slices
- Out-and-back: `renderOutAndBack.ts` + `updateOutAndBack.ts` build outbound/inbound actual elevation from segment altitude slices

So the consistency seam for SMOOTH-02 is **before** mode-specific slicing/rendering.

### 3) No existing user-facing smoothing controls in Analysis Parameters

`frontend/src/components/AnalysisParameters.ts` has no smoothing parameter inputs. That aligns with decision D-08 (internal fixed config) and reduces surface area.

### 4) DEM pipeline already has natural insertion points

Practical seams for adding deterministic smoothing ownership:

- `frontend/src/utils/DEMManager.ts` / `MultiDEMManager.ts`: place to apply fixed smoothing to DEM-derived elevation arrays
- `frontend/src/shell/fileLoad/fileLoadOrchestration.ts`: place to store raw FIT altitude plus DEM raw/smoothed variants and choose active profile
- `frontend/src/state/AppState.ts`: place to add explicit elevation-profile state contract consumed by all modes

---

## Recommended Technical Approach

### A) Make ownership explicit in state and docs (SMOOTH-01)

Introduce explicit elevation profile contract in `AppState`:

- `fitRawElevation` (never smoothed)
- `demRawElevation` (DEM corrected, unsmoothed)
- `demSmoothedElevation` (DEM corrected + fixed smoothing)
- `activeElevationSource` (`fit-raw` | `dem-smoothed` | `dem-raw-preview`)

Document this in phase artifacts and code comments so maintainers can explain ownership unambiguously.

### B) Apply smoothing only to DEM-derived arrays (D-02/D-03)

When DEM correction completes:

1. preserve FIT raw altitude snapshot
2. persist DEM raw corrected array
3. derive DEM smoothed array via one fixed internal algorithm and constants
4. set active analysis altitude to smoothed DEM by default

When no DEM is active, use FIT raw unchanged.

### C) Add UI toggle to swap display curve source (D-10..D-14)

Add a single "Raw elevation" toggle in VE analysis UI shells:

- shown only when DEM-derived arrays exist
- default off (show smoothed)
- on: plot/actual-elevation references switch to raw profile for current mode
- no parallel dual traces; only one actual-elevation curve shown at a time

### D) Enforce consistency through shared resolver

Create shared helper (e.g. `resolveDisplayElevationProfile(...)`) used by Standard, GPS-lap, and Out-and-back rendering paths so mode divergence does not reappear.

---

## Risks and Mitigations

| Risk                                 | Why it matters                                | Mitigation                                                                 |
| ------------------------------------ | --------------------------------------------- | -------------------------------------------------------------------------- |
| Hidden second smoothing pass         | Could violate D-01 ownership                  | Centralize DEM smoothing in one helper and ban smoothing in render modules |
| Mode drift                           | One mode could keep using old altitude source | Require all three mode paths to consume shared display-elevation resolver  |
| DEM-off edge case regression         | Could break raw FIT behavior                  | Add explicit no-DEM tests/assertions and manual check path                 |
| Toggle leaks into parameter contract | Would violate D-08                            | Keep toggle as display control only; no smoothing parameter values exposed |

---

## Verification Inputs for Planning

Plans should verify:

1. Maintainer-facing ownership docs explicitly state "data layer owns smoothing" and "FIT raw never smoothed".
2. Code path stores dual DEM profiles and raw FIT profile with deterministic naming.
3. Standard, GPS-lap, and Out-and-back all read display elevation from the same profile-selection helper.
4. Raw elevation toggle appears only when DEM data exists; hidden/disabled otherwise.
5. Full regression suite remains green.

---

## Validation Architecture

1. **State/contract checks**
   - Type-level and grep checks for explicit elevation-profile fields in `AppState`
   - deterministic source selector enum/value checks

2. **Mode-path consistency checks**
   - all three mode modules import/use one shared display-elevation resolver
   - no ad-hoc smoothing logic in `shell/ve`, `shell/gpsLap`, `shell/outAndBack`

3. **Behavior checks**
   - DEM on: default uses smoothed profile
   - toggle on: switches to raw DEM profile
   - DEM off: uses FIT raw profile only

4. **Regression checks**
   - `cd frontend && npm run check`
   - `cd frontend && npm run lint`
   - `cd frontend && npm run test`
   - `cd frontend && npm run build`

---

## Files Most Relevant to Planning

- `.planning/phases/4-smoothing-clarity/4-CONTEXT.md`
- `frontend/src/shell/fileLoad/fileLoadOrchestration.ts`
- `frontend/src/utils/DEMManager.ts`
- `frontend/src/utils/MultiDEMManager.ts`
- `frontend/src/state/AppState.ts`
- `frontend/src/shell/analysis/prepareAnalysisPayload.ts`
- `frontend/src/shell/ve/renderStandardVe.ts`
- `frontend/src/shell/gpsLap/renderGpsLap.ts`
- `frontend/src/shell/gpsLap/updateGpsLap.ts`
- `frontend/src/shell/outAndBack/renderOutAndBack.ts`
- `frontend/src/shell/outAndBack/updateOutAndBack.ts`

---

_Research complete: 2026-05-09_
