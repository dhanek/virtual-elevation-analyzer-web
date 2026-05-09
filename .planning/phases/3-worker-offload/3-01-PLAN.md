---
phase: 3
plan: 01
wave: 1
depends_on: []
requirements_addressed: [PERF-01]
files_modified:
  - .planning/phases/3-worker-offload/3-PROFILE-REPORT.md
  - .planning/phases/3-worker-offload/3-GATE-RESULT
  - frontend/src/shell/analysis/recomputeRunner.ts
  - frontend/src/shell/analysis/recomputeRunner.test.ts
  - frontend/src/shell/analysis/analyzeOrchestrator.ts
  - frontend/src/shell/ve/bindStandardSliders.ts
  - frontend/src/shell/gpsLap/updateGpsLap.ts
  - frontend/src/shell/outAndBack/updateOutAndBack.ts
  - frontend/src/state/AppState.ts
  - frontend/src/styles/index.css
autonomous: true
---

# Phase 3: Worker Offload - Plan 01 (Profiling Gate + Main-Thread Responsiveness)

**Phase:** 3  
**Plan:** 01  
**Wave:** 1  
**Goal:** Ship a profile-first, objective responsiveness baseline; only escalate to workerization if post-mitigation gate still fails.

## Objective

Deliver PERF-01 baseline with profile-first enforcement:

1. create objective browser profiling evidence for 15-20 lap workloads,
2. implement mode-aware debounce, latest-input-wins scheduling, and inline non-blocking status,
3. preserve last completed plots while recompute is in-flight,
4. emit deterministic gate artifacts consumed by Plan 02.

---

## Tasks

### Task 1: Create objective profiling gate artifacts

<read_first>

- .planning/phases/3-worker-offload/3-CONTEXT.md
- .planning/phases/3-worker-offload/3-RESEARCH.md
- frontend/scripts/profile-slider-recompute.ts
- frontend/src/shell/gpsLap/updateGpsLap.ts
- frontend/src/shell/outAndBack/updateOutAndBack.ts

</read_first>

<action>
Create `.planning/phases/3-worker-offload/3-PROFILE-REPORT.md` and `.planning/phases/3-worker-offload/3-GATE-RESULT`.

`3-PROFILE-REPORT.md` must contain:

1. `## Workload Definition`
   - exact text `15-20 laps`
   - mode list: `standard`, `gps-lap`, `out-and-back`

2. `## Measurement Method`
   - exact sentence: `Use Chrome DevTools Performance trace while continuously dragging a VE slider for 5 seconds.`
   - exact sentence: `Record Max Stall (ms) as the longest main-thread task during drag.`
   - exact sentence: `Record Long Tasks (>50ms) count during drag.`

3. `## Browser Profiling Runs (Baseline - Pre Mitigation)`
   - at least 3 runs with columns: Run ID, Mode, Dataset, Max Stall (ms), Long Tasks (>50ms), Visible Freeze Observed (yes/no), Notes

4. `## Browser Profiling Runs (Post Mitigation - Gate Input)`
   - at least 3 runs with same columns

5. `## Gate Rule`
   - exact rule text: `GATE_FAILED when post-mitigation runs show sustained visible freezes or Max Stall (ms) exceeds 100 in the 15-20 lap workload.`

6. `## Gate Decision`
   - exact field: `Decision: GATE_PASSED` or `Decision: GATE_FAILED`

7. `## Next Step`
   - if passed: `Proceed with debounced main-thread path only; skip Plan 02 implementation tasks.`
   - if failed: `Execute Plan 02 worker offload tasks.`

Write `.planning/phases/3-worker-offload/3-GATE-RESULT` with one line only: `GATE_PASSED` or `GATE_FAILED` (must match `Decision:` field in profile report).
</action>

<acceptance_criteria>

- `.planning/phases/3-worker-offload/3-PROFILE-REPORT.md` exists
- `.planning/phases/3-worker-offload/3-GATE-RESULT` exists
- `3-GATE-RESULT` content is exactly `GATE_PASSED` or `GATE_FAILED`
- `3-PROFILE-REPORT.md` contains `## Measurement Method`
- `3-PROFILE-REPORT.md` contains `## Browser Profiling Runs (Post Mitigation - Gate Input)`
- `3-PROFILE-REPORT.md` contains exact gate rule string with `post-mitigation`, `100`, and `15-20 lap workload`

</acceptance_criteria>

---

### Task 2: Implement shared recompute runner with explicit debounce policy

<read_first>

- frontend/src/shell/analysis/analyzeOrchestrator.ts
- frontend/src/shell/ve/bindStandardSliders.ts
- frontend/src/shell/gpsLap/updateGpsLap.ts
- frontend/src/shell/outAndBack/updateOutAndBack.ts
- frontend/src/state/AppState.ts

</read_first>

<action>
Implement `frontend/src/shell/analysis/recomputeRunner.ts` and route all mode recompute entry points through it.

Required API surface:

- `scheduleRecompute(request: RecomputeRequest): void`
- `cancelActiveRecompute(reason: 'new-input' | 'mode-switch'): void`
- `setRecomputeStatus(status: 'idle' | 'running' | 'handoff'): void`

Required constants and mode policy:

- `HEAVY_RECOMPUTE_DEBOUNCE_MS = 200` for `gps-lap` and `out-and-back`
- `STANDARD_RECOMPUTE_DEBOUNCE_MS = 0` for `standard`

Required behavior:

1. latest-input-wins tokening (increment token per schedule; ignore stale completions)
2. never clear existing plot data on run start
3. slider numeric/control values update immediately; only compute is delayed
4. new input during active run sets status `handoff`, cancels prior run, then runs latest token
5. if AppState is updated, use explicit union type for status: `'idle' | 'running' | 'handoff'`

</action>

<acceptance_criteria>

- `frontend/src/shell/analysis/recomputeRunner.ts` exists
- file contains `HEAVY_RECOMPUTE_DEBOUNCE_MS = 200`
- file contains `STANDARD_RECOMPUTE_DEBOUNCE_MS = 0`
- file contains `scheduleRecompute(` and `cancelActiveRecompute(`
- file contains stale-token guard comparing completion token to active token
- `frontend/src/shell/gpsLap/updateGpsLap.ts` references recompute runner
- `frontend/src/shell/outAndBack/updateOutAndBack.ts` references recompute runner

</acceptance_criteria>

---

### Task 3: Implement inline status UX contract

<read_first>

- .planning/phases/3-worker-offload/3-UI-SPEC.md
- frontend/src/shell/ve/renderStandardVe.ts
- frontend/src/shell/section3/section3Orchestration.ts
- frontend/src/styles/index.css

</read_first>

<action>
Implement inline status UI for recompute states.

Required copy strings:

- `Recomputing…`
- `Input updated — running latest values…`
- optional completion flash `Updated`

Required style requirements in `frontend/src/styles/index.css`:

- status accent color `#4363d8`
- inline spinner/text `gap: 4px`
- status block vertical spacing `8px`
- no full-screen overlay or modal classes for recompute

Required behavior:

1. status visible for `running` and `handoff`
2. status hidden for `idle`
3. last completed plots stay visible while status is shown
4. status node includes `role="status"` and `aria-live="polite"`

</action>

<acceptance_criteria>

- `frontend/src/styles/index.css` contains recompute status selector with `#4363d8` and `gap: 4px`
- UI source contains exact strings `Recomputing…` and `Input updated — running latest values…`
- UI source contains `role="status"` and `aria-live="polite"` for recompute status element
- no new full-screen recompute overlay class/id exists

</acceptance_criteria>

---

### Task 4: Add deterministic tests for debounce, tokening, and status transitions

<read_first>

- frontend/vitest.config.ts
- frontend/src/shell/analysis/recomputeRunner.ts
- frontend/src/shell/analysis/parameterChangeHandler.test.ts

</read_first>

<action>
Create `frontend/src/shell/analysis/recomputeRunner.test.ts` using `vi.useFakeTimers()`.

Required tests:

1. `debounce schedules only latest recompute within 200ms window`
2. `latest-input-wins ignores stale completion token`
3. `new input during running transitions status handoff then running for latest token`
4. `latest completion returns status to idle`
5. `standard mode uses zero debounce while heavy modes use 200ms`

</action>

<acceptance_criteria>

- `frontend/src/shell/analysis/recomputeRunner.test.ts` exists
- file contains test names with `latest-input-wins` and `debounce`
- file contains assertion coverage for standard-mode zero debounce and heavy-mode 200ms debounce
- `cd frontend && npm run test -- src/shell/analysis/recomputeRunner.test.ts` exits 0

</acceptance_criteria>

---

## Verification Criteria

| ID | Criterion |
| --- | --- |
| V1 | `3-PROFILE-REPORT.md` and `3-GATE-RESULT` exist with aligned decision values |
| V2 | Gate uses post-mitigation profiling as explicit decision input |
| V3 | Recompute runner enforces mode-aware debounce policy (`200ms` heavy, `0ms` standard) |
| V4 | Latest-input-wins + handoff status + preserved prior plots are implemented |
| V5 | Inline status copy/styles/accessibility contract is implemented without full-screen overlay |
| V6 | `recomputeRunner.test.ts` passes |

## Must-Haves for Goal-Backward Verification

1. Objective profiling method is documented and reproducible.
2. Gate decision is deterministic and machine-readable.
3. Slider interactions remain responsive in 15-20 lap workloads after mitigation.
4. Progress indication and automatic cancel-on-new-input behavior are visible and correct.
