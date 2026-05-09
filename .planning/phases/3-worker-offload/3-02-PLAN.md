---
phase: 3
plan: 02
wave: 2
depends_on: [01]
requirements_addressed: [PERF-01]
files_modified:
  - .planning/phases/3-worker-offload/3-GATE-RESULT
  - .planning/phases/3-worker-offload/3-PROFILE-REPORT.md
  - frontend/src/workers/veCompute.worker.ts
  - frontend/src/workers/veCompute.worker.test.ts
  - frontend/src/shell/analysis/veComputeWorkerClient.ts
  - frontend/src/shell/analysis/recomputeRunner.ts
  - frontend/src/shell/analysis/recomputeRunner.test.ts
  - frontend/src/shell/ve/bindStandardSliders.ts
  - frontend/src/shell/gpsLap/updateGpsLap.ts
  - frontend/src/shell/outAndBack/updateOutAndBack.ts
autonomous: true
---

# Phase 3: Worker Offload - Plan 02 (Conditional Worker Path)

**Phase:** 3  
**Plan:** 02  
**Wave:** 2  
**Goal:** Execute worker offload only when Plan 01 gate fails; preserve Plan 01 UX contracts while reducing main-thread stalls.

## Objective

Implement worker offload only when deterministic gate result says `GATE_FAILED`, and keep behavior identical from user perspective (latest-input-wins, inline status, old plot visibility).

---

## Execution Guard

- Read `.planning/phases/3-worker-offload/3-GATE-RESULT`.
- If file content is exactly `GATE_PASSED`: skip all implementation tasks in this plan and add a skip note under `## Post-Implementation Validation` in `3-PROFILE-REPORT.md`.
- If file content is exactly `GATE_FAILED`: execute all tasks below.
- If file missing or content not one of `GATE_PASSED` / `GATE_FAILED`: stop execution and mark plan blocked.

---

## Tasks

### Task 1: Implement worker compute contract with explicit WASM bootstrap

<read_first>

- .planning/phases/3-worker-offload/3-CONTEXT.md
- .planning/phases/3-worker-offload/3-RESEARCH.md
- frontend/pkg/virtual_elevation_analyzer.js
- frontend/src/analysis/SegmentExtractor.ts
- frontend/src/analysis/VeCalculatorFactory.ts
- frontend/src/shell/gpsLap/updateGpsLap.ts
- frontend/src/shell/outAndBack/updateOutAndBack.ts

</read_first>

<action>
Create `frontend/src/workers/veCompute.worker.ts`.

Implement message protocol constants:

- request types: `STANDARD_RECOMPUTE`, `GPS_LAP_RECOMPUTE`, `OUT_AND_BACK_RECOMPUTE`, `CANCEL_RECOMPUTE`
- response types: `RECOMPUTE_SUCCESS`, `RECOMPUTE_ERROR`, `RECOMPUTE_CANCELED`

Implement worker bootstrap and compute behavior:

1. import wasm module with explicit init:
   - `import initWasm, { init as initBindings } from '../../pkg/virtual_elevation_analyzer.js'`
2. initialize once inside worker before handling recompute requests:
   - `await initWasm(new URL('../../pkg/virtual_elevation_analyzer_bg.wasm', import.meta.url))`
   - then call `initBindings()`
3. request payload includes:
   - `token` number
   - `mode` (`standard | gps-lap | out-and-back`)
   - typed arrays for timestamps/power/velocity/position/altitude/distance/wind
   - mode-specific segment descriptors
4. run segment extraction + VE compute only (no DOM/Plotly)
5. include request `token` in every success/error/canceled response
6. return large typed-array buffers with transferable list

</action>

<acceptance_criteria>

- `frontend/src/workers/veCompute.worker.ts` exists
- file contains `STANDARD_RECOMPUTE`, `GPS_LAP_RECOMPUTE`, `OUT_AND_BACK_RECOMPUTE`, and `CANCEL_RECOMPUTE`
- file contains `RECOMPUTE_SUCCESS`, `RECOMPUTE_ERROR`, and `RECOMPUTE_CANCELED`
- file contains `await initWasm(new URL('../../pkg/virtual_elevation_analyzer_bg.wasm', import.meta.url))`
- file contains `initBindings()` call after wasm init
- file does not contain `document.` or `Plotly`

</acceptance_criteria>

---

### Task 2: Implement worker client with fallback and supersession cancellation strategy

<read_first>

- frontend/src/workers/veCompute.worker.ts
- frontend/src/shell/analysis/recomputeRunner.ts
- frontend/src/state/AppState.ts

</read_first>

<action>
Create `frontend/src/shell/analysis/veComputeWorkerClient.ts` with:

- `initVeComputeWorker(): Promise<boolean>`
- `runWorkerRecompute(request): Promise<WorkerRecomputeResult>`
- `cancelWorkerRecompute(token: number): void`
- `terminateVeComputeWorker(): void`

Required runtime behavior:

1. init failure returns `false` and enables fallback mode
2. runtime error logs explicit fallback message and switches to main-thread compute
3. superseded input cancellation policy:
   - send `CANCEL_RECOMPUTE` for active token
   - if worker does not acknowledge cancellation within one event loop turn, terminate and recreate worker
4. expose worker availability from client module; do not require AppState persistence for capability flag
5. always terminate worker during teardown/re-init path

</action>

<acceptance_criteria>

- `frontend/src/shell/analysis/veComputeWorkerClient.ts` exists
- file contains `initVeComputeWorker(`, `cancelWorkerRecompute(`, and `terminateVeComputeWorker(`
- file contains explicit fallback log text including `falling back to main-thread recompute`
- file contains terminate-and-recreate branch for cancellation timeout/supersession

</acceptance_criteria>

---

### Task 3: Extend shared recompute runner to dispatch worker or fallback path

<read_first>

- frontend/src/shell/analysis/recomputeRunner.ts
- frontend/src/shell/analysis/veComputeWorkerClient.ts
- frontend/src/shell/ve/bindStandardSliders.ts
- frontend/src/shell/gpsLap/updateGpsLap.ts
- frontend/src/shell/outAndBack/updateOutAndBack.ts
- .planning/phases/3-worker-offload/3-UI-SPEC.md

</read_first>

<action>
Extend existing shared runner from Plan 01; do not create parallel mode-specific schedulers.

Required behavior:

1. preserve debounce policy from Plan 01:
   - `STANDARD_RECOMPUTE_DEBOUNCE_MS = 0`
   - `HEAVY_RECOMPUTE_DEBOUNCE_MS = 200`
2. preserve inline status strings:
   - `Recomputing…`
   - `Input updated — running latest values…`
3. preserve latest-input-wins token checks for both worker and fallback branches
4. preserve prior plot visibility during running/handoff
5. choose worker branch only when worker client reports healthy availability; otherwise fallback branch

</action>

<acceptance_criteria>

- each entry point (`bindStandardSliders.ts`, `updateGpsLap.ts`, `updateOutAndBack.ts`) routes through shared runner
- `recomputeRunner.ts` contains both worker dispatch and main-thread fallback branches
- `recomputeRunner.ts` contains token checks guarding stale worker responses
- exact status strings from UI-SPEC remain present

</acceptance_criteria>

---

### Task 4: Add worker contract + fallback tests

<read_first>

- frontend/src/workers/veCompute.worker.ts
- frontend/src/shell/analysis/veComputeWorkerClient.ts
- frontend/src/shell/analysis/recomputeRunner.ts
- frontend/src/shell/analysis/recomputeRunner.test.ts
- frontend/vitest.config.ts

</read_first>

<action>
Create/extend tests:

1. `frontend/src/workers/veCompute.worker.test.ts`
   - validates accepted request types include `STANDARD_RECOMPUTE`, `GPS_LAP_RECOMPUTE`, `OUT_AND_BACK_RECOMPUTE`, `CANCEL_RECOMPUTE`
   - validates responses include matching `token`
2. `frontend/src/shell/analysis/recomputeRunner.test.ts`
   - validates worker failure falls back to main-thread compute
   - validates stale worker token response is ignored
   - validates superseded input triggers cancellation path (`CANCEL_RECOMPUTE` or worker recycle)

Use deterministic Worker mocks; do not require real browser worker runtime in unit tests.

</action>

<acceptance_criteria>

- `frontend/src/workers/veCompute.worker.test.ts` exists
- tests assert token echo and all request type constants
- tests assert fallback behavior and supersession cancellation behavior
- `cd frontend && npm run test -- src/workers/veCompute.worker.test.ts src/shell/analysis/recomputeRunner.test.ts` exits 0

</acceptance_criteria>

---

### Task 5: Update profile report with post-implementation outcome and quantitative target

<read_first>

- .planning/phases/3-worker-offload/3-PROFILE-REPORT.md
- .planning/phases/3-worker-offload/3-GATE-RESULT
- frontend/scripts/profile-slider-recompute.ts

</read_first>

<action>
Append `## Post-Implementation Validation` to `3-PROFILE-REPORT.md`.

Required content:

1. before/after table for 15-20 lap workloads with columns:
   - Mode
   - Max Stall (ms)
   - Long Tasks (>50ms)
   - Gate Decision
2. quantitative success line:
   - `Target: p95 main-thread stall during slider drag < 50ms`
3. final outcome line:
   - `Final Outcome: PERF-01 satisfied` or `Final Outcome: PERF-01 not yet satisfied`
4. if `3-GATE-RESULT` is `GATE_PASSED`, include explicit sentence:
   - `Worker implementation skipped because deterministic gate result was GATE_PASSED.`

</action>

<acceptance_criteria>

- `3-PROFILE-REPORT.md` contains `## Post-Implementation Validation`
- file contains `Target: p95 main-thread stall during slider drag < 50ms`
- file contains `Final Outcome:` line
- file explicitly states executed vs skipped worker path

</acceptance_criteria>

---

## Verification Criteria

| ID  | Criterion                                                                                          |
| --- | -------------------------------------------------------------------------------------------------- |
| V1  | Plan execution is gated by deterministic `3-GATE-RESULT` token                                     |
| V2  | Worker contract includes explicit wasm bootstrap and tokenized request/response protocol           |
| V3  | Worker cancellation strategy is implemented for superseded inputs                                  |
| V4  | Worker init/runtime failures fallback gracefully to main-thread runner                             |
| V5  | Shared runner preserves debounce, status, latest-input-wins, and prior-result visibility contracts |
| V6  | Worker and fallback tests pass                                                                     |

## Must-Haves for Goal-Backward Verification

1. No worker complexity is introduced when gate passes.
2. If gate fails, heavy compute no longer causes unacceptable main-thread stalls.
3. User-visible responsiveness behavior from Plan 01 remains stable.
4. Cancellation behavior remains reliable under rapid repeated inputs.
