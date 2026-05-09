# Phase 3: Worker Offload - Context

**Gathered:** 2026-05-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Improve slider responsiveness during multi-lap VE analysis via a profile-first approach. Implement worker offload only if profiling confirms main-thread blocking at representative heavy usage.

</domain>

<decisions>
## Implementation Decisions

### Profiling gate definition

- **D-01:** Primary gate uses **real browser multi-lap interaction path**, not synthetic-only profiling.
- **D-02:** Blocking threshold uses **frame-budget/user-visible stalls** (sustained >100ms visible freezes) during slider interaction.
- **D-03:** Heavy-use gate dataset is **15–20 laps**.
- **D-04:** If profiling at this workload does **not** show blocking, skip worker implementation for this phase and document results.

### Interaction behavior under load

- **D-05:** Use **debounced live preview** for heavy multi-lap recomputes.
- **D-06:** Behavior is **mode-aware**: stronger debounce policy for heavy GPS-lap / out-and-back paths.
- **D-07:** Target debounce window is **~200ms**.
- **D-08:** Slider/numeric controls update immediately even while plot recompute is pending.
- **D-09:** Recompute scheduling is **latest-input-wins** (drop intermediate recomputes while dragging).

### Progress + cancellation UX

- **D-10:** Show **inline lightweight status** during long recomputes (non-blocking; no full-screen overlay).
- **D-11:** Cancellation is **automatic on new input**.
- **D-12:** No explicit user-facing Cancel button in this phase.
- **D-13:** Keep last completed result visible until latest recompute finishes.

### Offload boundary (if gate fails)

- **D-14:** First workerized boundary: **VE computation + segment extraction**.
- **D-15:** Initial worker rollout target: **all modes at once**.
- **D-16:** Worker messaging should use **transferable typed arrays from the start**.
- **D-17:** If worker init/runtime fails, gracefully fallback to main-thread debounced path.

### Folded Todos

- **Consider worker offload for multi-lap VE** (`.planning/todos/pending/2026-04-13-consider-worker-offload-for-multi-lap-ve.md`) is folded into this phase as a scope-confirming input for PERF-01 profiling and worker go/no-go.

### the agent's Discretion

- Exact profiling instrumentation details and trace capture format
- Exact inline status text/style implementation
- Internal cancellation primitive (token/version/abort pattern) as long as latest-input-wins behavior is preserved

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirement contract

- `.planning/ROADMAP.md` (Phase 3: Worker Offload) - profile-first gate, responsiveness goal, cancellation/progress success criteria
- `.planning/REQUIREMENTS.md` (`PERF-01`) - requirement definition for responsiveness and profile-first behavior
- `.planning/PROJECT.md` (Current Milestone + Constraints) - no breaking VE logic, browser-local architecture constraints

### Profiling and responsiveness evidence

- `frontend/scripts/profile-slider-recompute.ts` - existing synthetic recompute profiling harness and current threshold language
- `.planning/todos/pending/2026-04-13-consider-worker-offload-for-multi-lap-ve.md` - known pain report and rationale for real-path re-evaluation

### Current integration points

- `frontend/src/shell/analysis/analyzeOrchestrator.ts` - central parameter-change and recalc trigger orchestration
- `frontend/src/shell/gpsLap/updateGpsLap.ts` - heavy GPS-lap recompute path
- `frontend/src/shell/outAndBack/updateOutAndBack.ts` - heavy out-and-back recompute path
- `frontend/src/shell/ve/bindStandardSliders.ts` - existing slider handling and debounce-related patterns
- `frontend/src/state/AppState.ts` - state model for analysis lifecycle flags and selected mode/lap data

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `frontend/scripts/profile-slider-recompute.ts`: existing benchmark harness for recompute core; can complement browser trace runs.
- `frontend/src/shell/analysis/analyzeOrchestrator.ts`: existing centralized parameter update path to hook mode-aware recompute policy.
- Existing debounce patterns in `frontend/src/shell/ve/bindStandardSliders.ts` and `frontend/src/shell/section3/section3Orchestration.ts`.

### Established Patterns

- Mode-specific compute/update remains explicit (`gpsLap`, `outAndBack`, standard paths).
- Loading/status patterns already exist in shell services (`showLoading` / `hideLoading`) and can inform inline progress adaptation.
- AppState remains state-only; service/DOM wiring stays in shell/orchestrator modules.

### Integration Points

- Slider input handlers and parameter change dispatch path
- GPS-lap and out-and-back recompute loops (segment extraction + VE calculations)
- Plot update handoff boundaries (main thread remains owner of DOM/Plotly rendering)

</code_context>

<specifics>
## Specific Ideas

- Heavy-use validation should represent **15–20 lap** real interaction, not only synthetic core timing.
- Keep interactions feeling live: immediate control feedback + debounced recompute.
- Preserve visual stability by keeping previous result visible until replacement is ready.

</specifics>

<deferred>
## Deferred Ideas

### Reviewed Todos (not folded)

- **Move GPS mode selection to section 3 lap selection** - already handled by Phase 2 scope.
- **Unify calculation and plot update pipeline across analysis modes** - Phase 1/7 scope, not PERF-01 scope.
- **Check elevation smoothing strategy** - belongs to Phase 4.
- **Evaluate continuous weather sampling** - belongs to Phase 6.

</deferred>

---

_Phase: 03-worker-offload_
_Context gathered: 2026-05-09_
