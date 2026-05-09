# Phase 3: Worker Offload - Research

**Researched:** 2026-05-09
**Phase:** 3 - Worker Offload
**Requirements:** PERF-01
**Method:** Manual in-session research (research subagent unavailable due provider auth)

---

## What I Need to Know to Plan This Phase Well

### 1) Current heavy recompute paths are mode-specific and synchronous on main thread

The expensive paths are already explicit per mode and run in direct loops:

- `frontend/src/shell/gpsLap/updateGpsLap.ts`
  - loops selected laps
  - per lap: segment extraction + VE calculation + supplementary series
- `frontend/src/shell/outAndBack/updateOutAndBack.ts`
  - loops sections
  - per section: outbound + inbound extraction + VE calculation + supplementary series
- `frontend/src/shell/ve/renderStandardVe.ts` + `frontend/src/shell/ve/bindStandardSliders.ts`
  - standard mode recalculates on slider-triggered updates

This architecture is a good seam for worker offload because compute is already grouped into reusable per-mode units.

### 2) There is existing profiling, but it is synthetic-core focused

- `frontend/scripts/profile-slider-recompute.ts` profiles cached-array recompute scenarios and gives median/p95 timing.
- The script currently helps isolate compute cost but does not fully represent user-perceived browser jank (DOM + Plotly + event churn).

Given Phase 3 decisions, this script should be retained as supporting evidence, but primary go/no-go must come from real browser multi-lap interaction profiling.

### 3) Existing code already uses debounce patterns we can extend

Debounce patterns are present in:

- `frontend/src/shell/ve/bindStandardSliders.ts`
- `frontend/src/shell/section3/section3Orchestration.ts`

This allows an incremental plan:
1. enforce mode-aware debounce (~200ms for heavy multi-segment paths),
2. add latest-input-wins cancellation semantics,
3. only add worker path if profiling gate fails.

### 4) Phase constraints and conventions shape design

From project constraints and conventions:

- Preserve VE math behavior (no algorithmic drift).
- Keep `AppState` state-only.
- Keep mode-specific semantics explicit (avoid over-abstraction).
- Keep Plotly/DOM ownership on main thread.

Implication: worker should own pure compute payload processing and return data for main-thread rendering.

---

## Recommended Technical Approach (Aligned to Captured Context)

### Step A: Profiling Gate (required before workerization)

Primary gate should measure real browser slider drag in 15–20 lap scenarios and classify blocking by visible stalls (>100ms sustained/jank).

If gate passes (no meaningful blocking):
- stop at debounced main-thread path and document skip decision.

If gate fails:
- proceed to worker implementation.

### Step B: Main-thread responsiveness baseline

Implement/standardize these before worker offload:

- mode-aware debounce (~200ms in heavy multi-segment modes),
- immediate slider/value feedback while recompute is pending,
- latest-input-wins scheduling (drop stale intermediate runs),
- inline non-blocking “recomputing” indicator,
- keep last completed plot visible until new result is ready.

### Step C: Worker boundary (if gate fails)

Offload boundary for first worker pass:

- segment extraction + VE computation payload processing
- keep DOM/Plotly update on main thread
- use transferable typed arrays in worker messaging
- fallback to debounced main-thread path on worker init/runtime failure

Per context decisions, rollout target is all modes at once, but implementation should still preserve explicit mode branches in orchestrator-level control flow.

---

## Suggested Module Boundaries for Planning

Potential new seams (naming illustrative; planner should pick exact names):

- `frontend/src/workers/veCompute.worker.ts`
  - receives compute request payload
  - returns mode-specific result payloads
- `frontend/src/shell/analysis/veComputeRunner.ts`
  - chooses worker vs fallback path
  - tracks run tokens (latest-input-wins)
- `frontend/src/shell/analysis/recomputeStatus.ts`
  - lightweight status lifecycle for inline UX state

Integration points:

- parameter-change and slider-trigger pathways in shell modules
- mode-specific update paths in `gpsLap`, `outAndBack`, and standard VE shell

---

## Risks and Mitigations

| Risk | Why it matters | Mitigation |
| ---- | -------------- | ---------- |
| Premature worker complexity | Phase may not need worker | Enforce profile-first gate |
| Transfer overhead | Large arrays can negate worker benefit | Transferable typed arrays from first worker iteration |
| Visual regressions/flicker | Frequent recomputes can destabilize UI | Keep last completed plot visible until replacement ready |
| Race conditions/stale results | Rapid slider input can produce out-of-order completion | Latest-input-wins tokening and stale-result drop |
| Behavior drift across modes | Multi-mode path can diverge | Preserve explicit per-mode semantics while sharing runner infrastructure |

---

## Verification Inputs for Planner

To satisfy PERF-01 and phase success criteria, plans should verify:

1. **Profiling evidence exists** for real browser 15–20 lap workload with a documented go/no-go conclusion.
2. **Slider interaction remains responsive** under heavy multi-lap load (no visible freeze threshold breach after mitigation).
3. **Progress/cancellation behavior exists**:
   - inline non-blocking status,
   - auto-cancel by new input,
   - stale runs discarded,
   - prior result preserved until replacement.
4. **Fallback behavior exists** if worker init/runtime fails.
5. **Validation suite passes**:
   - `cd backend && cargo test --lib`
   - `cd backend && wasm-pack build --target web --out-dir ../frontend/pkg`
   - `cd frontend && npm run check`
   - `cd frontend && npm run lint`
   - `cd frontend && npm run test`
   - `cd frontend && npm run build`

---

## Validation Architecture

Validation should be layered so planning can map each requirement to specific test evidence:

1. **Behavioral contract checks (unit/integration):**
   - debounce scheduling semantics,
   - latest-input-wins cancellation token behavior,
   - fallback path activation when worker is unavailable.

2. **Mode-path coverage checks:**
   - standard, GPS-lap, and out-and-back each route through the chosen recompute runner path.

3. **User-visible responsiveness checks:**
   - browser-level profiling traces or reproducible measurements for 15–20 lap workloads.

4. **Regression safety checks:**
   - existing full validation command suite remains green.

---

## Files Most Relevant to Planning

- `.planning/phases/3-worker-offload/3-CONTEXT.md`
- `frontend/scripts/profile-slider-recompute.ts`
- `frontend/src/shell/analysis/analyzeOrchestrator.ts`
- `frontend/src/shell/ve/bindStandardSliders.ts`
- `frontend/src/shell/ve/renderStandardVe.ts`
- `frontend/src/shell/gpsLap/updateGpsLap.ts`
- `frontend/src/shell/outAndBack/updateOutAndBack.ts`
- `frontend/src/state/AppState.ts`
- `GEMINI.md`

---

*Research complete: 2026-05-09*