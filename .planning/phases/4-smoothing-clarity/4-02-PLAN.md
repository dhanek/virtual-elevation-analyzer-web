---
phase: 4
plan: 02
wave: 2
depends_on: [01]
requirements_addressed: [SMOOTH-01, SMOOTH-02]
files_modified:
  - frontend/src/shell/ve/renderStandardVe.ts
  - frontend/src/shell/ve/bindStandardSliders.ts
  - frontend/src/shell/gpsLap/renderGpsLap.ts
  - frontend/src/shell/gpsLap/updateGpsLap.ts
  - frontend/src/shell/outAndBack/renderOutAndBack.ts
  - frontend/src/shell/outAndBack/updateOutAndBack.ts
  - frontend/src/styles/index.css
  - frontend/src/shell/analysis/elevationProfileResolver.ts
  - frontend/src/shell/analysis/elevationToggle.integration.test.ts
  - .planning/phases/4-smoothing-clarity/4-METHOD-COMPARISON.md
  - .planning/phases/4-smoothing-clarity/4-SUMMARY.md
autonomous: true
---

# Phase 4: Smoothing Clarity - Plan 02 (3-state toggle + real-world method comparison)

**Phase:** 4  
**Plan:** 02  
**Wave:** 2  
**Depends on:** Plan 01  
**Goal:** Expose raw/smoothing/interpolated profiles in all modes, compare on real files, and defer cleanup until winner is chosen.

## Objective

Deliver explicit compare-and-decide workflow:

1. add 3-state display selector cycling `raw -> smoothing -> interpolated`,
2. wire all analysis modes to this selector via shared resolver,
3. run real-world comparisons and record outcomes,
4. keep both methods in code until final decision is made.

---

## Tasks

### Task 1: Replace binary toggle with 3-state profile selector

<read_first>

- `.planning/phases/4-smoothing-clarity/4-CONTEXT.md`
- `frontend/src/shell/ve/renderStandardVe.ts`
- `frontend/src/shell/gpsLap/renderGpsLap.ts`
- `frontend/src/shell/outAndBack/renderOutAndBack.ts`
- `frontend/src/styles/index.css`

</read_first>

<action>
Implement one shared UI control in all VE mode shells that cycles in this exact order:

- `raw` -> maps to `dem-raw-nearest`
- `smoothing` -> maps to `dem-smoothed-moving-average`
- `interpolated` -> maps to `dem-interpolated`

UI contract:

- label text: `Elevation profile`
- current state text must show one of: `raw`, `smoothing`, `interpolated`
- control id: `elevationProfileCycleButton`
- helper text exact: `Cycle profile: raw -> smoothing -> interpolated`

Visibility contract:

- show only when `demProfilesAvailable === true`
- hide when DEM is unavailable and resolver uses `fit-raw`

</action>

<acceptance_criteria>

- `renderStandardVe.ts` contains `elevationProfileCycleButton`
- `renderGpsLap.ts` contains `Cycle profile: raw -> smoothing -> interpolated`
- `renderOutAndBack.ts` contains `Elevation profile`
- `frontend/src/styles/index.css` contains `.ve-elevation-profile-cycle`

</acceptance_criteria>

---

### Task 2: Wire selector through all mode recompute paths

<read_first>

- `frontend/src/shell/analysis/elevationProfileResolver.ts`
- `frontend/src/shell/ve/bindStandardSliders.ts`
- `frontend/src/shell/gpsLap/updateGpsLap.ts`
- `frontend/src/shell/outAndBack/updateOutAndBack.ts`
- `frontend/src/shell/analysis/recomputeRunner.ts`

</read_first>

<action>
Wire cycle button click handler to update `activeDisplayProfile` and trigger existing mode recompute paths.

Required behavior:

1. Standard mode: click updates profile state and triggers same update path as CdA/Crr change.
2. GPS-lap mode: click updates profile state and triggers `scheduleGpsLapRecompute(...)`.
3. Out-and-back mode: click updates profile state and triggers `scheduleOutAndBackRecompute(...)`.
4. No mode applies smoothing/interpolation directly in render layer.

State transition mapping (mandatory):

- `dem-raw-nearest` -> `dem-smoothed-moving-average`
- `dem-smoothed-moving-average` -> `dem-interpolated`
- `dem-interpolated` -> `dem-raw-nearest`

</action>

<acceptance_criteria>

- `bindStandardSliders.ts` contains transition mapping between all three DEM profile states
- `updateGpsLap.ts` contains `scheduleGpsLapRecompute(` in profile-cycle handler path
- `updateOutAndBack.ts` contains `scheduleOutAndBackRecompute(` in profile-cycle handler path
- no `smoothDemMovingAverage` call appears in `shell/ve`, `shell/gpsLap`, or `shell/outAndBack`

</acceptance_criteria>

---

### Task 3: Add integration tests for cycle behavior and profile consistency

<read_first>

- `frontend/src/shell/analysis/elevationProfileResolver.ts`
- `frontend/src/shell/ve/renderStandardVe.ts`
- `frontend/src/shell/gpsLap/renderGpsLap.ts`
- `frontend/src/shell/outAndBack/renderOutAndBack.ts`

</read_first>

<action>
Create `frontend/src/shell/analysis/elevationToggle.integration.test.ts` with required tests:

1. `cycle order is raw to smoothing to interpolated and wraps back to raw`
2. `standard mode updates plot source when cycle advances`
3. `gps-lap mode uses dem-smoothed-moving-average when cycle state is smoothing`
4. `out-and-back mode uses dem-interpolated when cycle state is interpolated`
5. `cycle control is hidden when DEM profiles are unavailable`

Run:

- `cd frontend && npm run test -- src/shell/analysis/elevationToggle.integration.test.ts`

</action>

<acceptance_criteria>

- integration test file exists
- file contains exact test name `cycle order is raw to smoothing to interpolated and wraps back to raw`
- test command exits 0

</acceptance_criteria>

---

### Task 4: Real-world A/B comparison report and deferred cleanup gate

<read_first>

- `.planning/phases/4-smoothing-clarity/4-CONTEXT.md`
- `.planning/ROADMAP.md`
- `.planning/REQUIREMENTS.md`

</read_first>

<action>
Create `.planning/phases/4-smoothing-clarity/4-METHOD-COMPARISON.md` and fill with real ride evaluations.

Required sections:

- `## Test Files`
- `## Comparison Results`
- `## Decision`
- `## Deferred Cleanup`

`## Comparison Results` must include a table with columns:

- `file`
- `mode`
- `raw artifacts`
- `moving-average artifacts`
- `interpolated artifacts`
- `preferred`

`## Decision` must contain exactly one of:

- `Winner: moving-average`
- `Winner: interpolated`
- `Winner: undecided`

`## Deferred Cleanup` must include exact sentence:

`Do not remove either method in this phase; cleanup happens only after winner confirmation.`

Create/update `.planning/phases/4-smoothing-clarity/4-SUMMARY.md` with section `## Method Comparison Outcome` linking to `4-METHOD-COMPARISON.md`.

</action>

<acceptance_criteria>

- `4-METHOD-COMPARISON.md` exists with required four section headers
- comparison table includes columns `moving-average artifacts` and `interpolated artifacts`
- file contains one valid `Winner:` line
- file contains exact deferred cleanup sentence
- `4-SUMMARY.md` contains `## Method Comparison Outcome`

</acceptance_criteria>

---

## Verification Criteria

| ID  | Criterion                                                                |
| --- | ------------------------------------------------------------------------ |
| V1  | 3-state cycle control exists and cycles raw -> smoothing -> interpolated |
| V2  | All modes honor selected profile through shared resolver                 |
| V3  | Integration tests validate cycle order and per-mode profile usage        |
| V4  | Real-world comparison artifact records method outcomes                   |
| V5  | Cleanup is explicitly deferred until method winner is confirmed          |

## Must-Haves for Goal-Backward Verification

1. User can switch quickly between the three profile methods on the same ride.
2. Comparison is performed with real files, not only synthetic checks.
3. Winner decision is documented before any removal of alternate method.
4. FIT raw fallback and DEM-off behavior remain safe and unchanged.
