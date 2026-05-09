---
phase: 3
reviewers: [claude]
reviewed_at: 2026-05-09T15:08:00Z
plans_reviewed: [3-01-PLAN.md, 3-02-PLAN.md]
---

# Cross-AI Plan Review - Phase 3

## Gemini Review

Reviewer unavailable (`gemini` CLI not found on this system).

---

## Claude Review

# Cross-AI Plan Review: Phase 3 Worker Offload

## Summary

The two-plan structure correctly enforces the profile-first gate captured in CONTEXT (D-01..D-04), and the responsiveness-UX contract (debounce, latest-input-wins, preserved last result, inline status) is faithfully translated from decisions D-05..D-13 into concrete acceptance criteria. The plans are well-scoped, grep-friendly, and decoupled enough that the worker plan can be skipped cleanly. However, there is a **load-bearing gap around how WASM compute is hosted inside a worker** (the actual heavy work likely lives in `pkg/`, not pure TS), the gate evaluation timing is ambiguous (baseline vs post-debounce), and the conditional-execution mechanism for Plan 02 relies on a markdown sentinel that isn't a hard executor primitive. Resolve those three and the phase is in good shape.

---

## Plan 01 — Profiling Gate + Main-Thread Responsiveness

### Strengths
- Profile-gate artifact has machine-grep-able fields (`Decision: GATE_PASSED|GATE_FAILED`), making Plan 02's guard mechanically checkable.
- `HEAVY_RECOMPUTE_DEBOUNCE_MS = 200` is exposed as a named constant matching D-07 — easy to verify and tune.
- Latest-input-wins is enforced via tokening rather than ad-hoc cancellation flags, which is the right primitive.
- Acceptance criteria explicitly forbid clearing existing plot data on new run (preserves D-13).
- UI copy strings are locked verbatim, preventing drift from UI-SPEC.
- Tests use `vi.useFakeTimers()` — correct choice for deterministic debounce assertions.

### Concerns

- **HIGH — Gate evaluation timing is ambiguous.** Task 1 says "Populate the report with initial baseline entries before and after applying Task 2/3 changes." But the gate rule (`GATE_FAILED when sustained visible freezes…`) doesn't say *which* measurement it applies to. If 200ms debounce + latest-input-wins alone resolves perceived jank, GATE_PASSED is correct and Plan 02 is rightly skipped. If the gate is evaluated against the *baseline* (pre-debounce), Plan 02 always fires for heavy workloads. The current text could be read either way.

- **HIGH — "Visible freeze" is subjective.** The report schema asks for "Visible Freeze Observed (yes/no)" and "Max Stall (ms)" but doesn't prescribe a measurement method (Chrome DevTools long-task entries? `performance.now()` deltas around recompute? `requestAnimationFrame` frame-drop count?). Two reviewers running this gate could disagree.

- **MEDIUM — Standard mode debounce policy is unstated.** The constant is named `HEAVY_RECOMPUTE_DEBOUNCE_MS` and applied to gps-lap/out-and-back per D-06, but standard mode's behavior through the runner is not specified. Acceptance criteria should call out: standard mode uses 0ms (immediate) or a smaller window.

- **MEDIUM — `AppState.analysis.recomputeStatus` shape isn't typed.** The plan adds the field but doesn't specify the discriminated union or who owns it. AppState is documented as state-only — confirm the runner is the sole writer.

- **LOW — No ARIA live region for status strings.** "Recomputing…" / "Input updated — running latest values…" are visual-only. Screen reader users get nothing.

- **LOW — Test name "schedules only one recompute when multiple inputs arrive within 200ms window"** could be misread as "first wins" instead of "last wins." Suggest renaming to "schedules only the latest recompute…"

### Suggestions
1. Add an explicit step: **gate evaluation occurs after Tasks 2–3 are implemented.** This makes the "did debounce alone solve it?" question the gate question, which matches the phase's profile-first intent.
2. Prescribe a measurement method in Task 1: e.g., "use Chrome DevTools Performance recording; count tasks >50ms during a 5-second slider-drag interaction; record the longest." Subjectivity-free.
3. Specify standard-mode debounce explicitly (e.g., `STANDARD_RECOMPUTE_DEBOUNCE_MS = 0` or document that standard recompute bypasses the runner).
4. Add accessibility acceptance criterion: status element has `role="status"` and `aria-live="polite"`.
5. Add a behavioral test alongside the unit tests: "rapid 10-input drag results in exactly one rendered output."

---

## Plan 02 — Conditional Worker Path

### Strengths
- Execution guard pattern is well-defined and matches the gate output exactly.
- Worker message protocol is concrete (request/response type strings, token echo, mode discriminator).
- Acceptance criterion "file does not contain `document.` or `Plotly`" is a great defense against accidental DOM coupling in the worker.
- Fallback path is explicit (init failure → `false`, runtime error → main-thread).
- `terminateVeComputeWorker` is required, addressing CONTEXT lifecycle concern.

### Concerns

- **HIGH — WASM-in-worker is unaddressed.** This project's compute core is Rust/WASM (`frontend/pkg/`). `VeCalculatorFactory.ts` and `SegmentExtractor.ts` are listed as read_first inputs to the worker, but the plan never says how the WASM module initializes inside a worker context. WASM workers need their own `init()` (different fetch path, no shared module instance, sometimes different bundler config). If the heavy work is WASM-bound rather than JS-bound, the worker may need:
  - separate `wasm-pack` worker entry, or
  - `import.meta.url`-style worker construction with WASM bootstrapping inside, or
  - confirmation that the compute is pure-JS post-extraction and WASM is only used elsewhere.
  This is the single biggest unknown in the plan and will cause real friction during execution if not pre-resolved.

- **HIGH — Plan-skipping mechanism leans on markdown content.** "If file contains `Decision: GATE_PASSED`, mark this plan as intentionally skipped." This is fine if the executor honors it, but there's no machine-readable gate (frontmatter flag, exit code, etc.) and "intentionally skipped" isn't a defined state in the executor's vocabulary. Consider promoting the decision into the plan's frontmatter (e.g., `precondition: profile-report-gate-failed`) or having Plan 01's final task emit a sentinel file like `3-PROFILE-REPORT.md` containing only `GATE_FAILED` to short-circuit Plan 02.

- **MEDIUM — Worker cancellation strategy is implicit.** Token-checking on completion drops stale results, but the worker still *runs* the stale computation to completion. For a 15-lap recompute that takes 800ms in a worker, the user may queue 5 inputs while one runs. No cancellation = a queue of stale work blocks the next "real" run. Options: terminate-and-recreate worker on supersession, or send a cancel message and have worker check a flag between laps. Plan 02 should pick one.

- **MEDIUM — Transfer overhead vs benefit not budgeted.** The plan asserts transferable typed arrays from the start (good), but doesn't define a worker-overhead threshold. If gate fails by 150ms and worker setup + transfer is ~50ms each direction, residual blocking could remain. Add a post-implementation success metric: "p95 main-thread block during slider drag < 50ms."

- **MEDIUM — Task 3 partially duplicates Plan 01 Task 2.** Plan 01 already wires all three modes through `recomputeRunner`. Task 3 here repeats this — it should instead say "extend recompute runner to dispatch through worker client when `workerAvailable === true`."

- **LOW — Worker test environment.** `vitest` workers usually need explicit configuration (`environment: 'jsdom'` doesn't expose `Worker` natively from worker entry files, and `import.meta.url` worker construction is bundler-specific). The plan should call out that `veCompute.worker.test.ts` mocks the worker rather than instantiating it.

- **LOW — `AppState.workerAvailable` straddles state-only doctrine.** It's a runtime capability flag, not analysis state. Could live on the worker client itself with a getter, keeping AppState clean.

### Suggestions
1. **Spike the WASM-in-worker question before/during Task 1.** Either confirm compute is pure-JS post-extraction, or include explicit worker WASM bootstrap in the worker file requirements.
2. Replace the markdown-content guard with a more deterministic mechanism: write a tiny status file (`3-GATE-RESULT`) containing only the decision token, and frontmatter a `precondition` on Plan 02.
3. Add a cancellation strategy task: "On supersession, worker client either (a) sends `CANCEL` with new token and worker checks flag between segment iterations, or (b) terminates and respawns the worker." Pick one.
4. Add quantitative success criterion to Plan 02 verification: "post-implementation p95 main-thread long-task during slider drag < 50ms."
5. Reword Task 3 to avoid implying Plan 01 wiring is redone — frame it as "extend runner dispatch with worker branch."
6. Move `workerAvailable` out of `AppState` into the worker client module.
7. Add a worker-warm-up consideration: pre-init worker on app boot rather than on first slider drag, otherwise first interaction pays full setup cost.

---

## Cross-Cutting Observations

- **Profile-first gating is the correct discipline** and both plans honor it. The remaining work is making the gate measurement objective and the plan-skipping mechanism robust.
- **Goal-backward check passes for the responsiveness UX**, but the "no visible freeze" success criterion needs a measurable definition before execution begins, otherwise verification will be subjective.
- **No security implications** — worker is browser-local, no new network surfaces, no new persisted data.
- **No scope creep into adjacent phases** — SMOOTH-01, MAP-01, GPS-01 are all correctly excluded.
- **Validation suite coverage is solid** (cargo + wasm-pack + check + lint + test + build) and acceptance criteria are mostly automatable.

---

## Risk Assessment: **MEDIUM–HIGH**

Justification:
- **HIGH-risk items**: WASM-in-worker bootstrap is a real unknown that will surface at execution time as a 1–2 day detour if not pre-resolved; the gate evaluation timing ambiguity could lead to either always-skip or always-implement outcomes that don't match the phase intent.
- **MEDIUM-risk items**: subjective freeze measurement, in-flight worker cancellation strategy, conditional plan execution mechanism.
- **What lowers the risk**: tight, grep-able acceptance criteria; explicit token semantics; faithful translation of CONTEXT decisions; existing debounce patterns and profiling harness already in repo.

Recommend addressing the three HIGH items (WASM-in-worker plan, gate timing clarity, deterministic plan-skipping mechanism) before Plan 01 starts execution.

---

## Codex Review

Reviewer unavailable (`codex` CLI not found on this system).

---

## Consensus Summary

Only one reviewer (Claude) was available, so true cross-model consensus is limited.

### Agreed Strengths
- Not enough independent reviewer overlap (Gemini/Codex unavailable).
- Single-review signal indicates strong profile-first gating, clear tokenized cancellation semantics, and solid fallback/test intent.

### Agreed Concerns
- Not enough independent reviewer overlap (Gemini/Codex unavailable).
- Highest-priority concerns from available review:
  1. Worker plan does not explicitly address WASM initialization/execution inside worker context.
  2. Gate decision timing and freeze measurement criteria are ambiguous/subjective.
  3. Plan 02 skip guard relies on markdown text rather than deterministic machine gate.

### Divergent Views
- No divergent cross-model views can be computed with a single successful reviewer.
