# Phase 2: Shell Infrastructure and Delegation - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning
**Source:** Phase-2 synthesis from roadmap scope, Phase 1 guardrails, hotspot inventory, and prior project decisions

<domain>
## Phase Boundary

Phase 2 exists to introduce the shared shell helpers, dependency seams, and delegation boundaries that let later extraction phases move `frontend/src/main.ts` responsibilities out safely. It should make `main.ts` more composition-root-like, but it should **not** try to complete the Section 3, standard VE, GPS-lap, or out-and-back shell extractions in one jump. Those deeper ownership moves belong to Phases 3 and 4.

This phase is therefore about **infrastructure and delegation**, not broad feature work and not UI redesign.

</domain>

<decisions>
## Implementation Decisions

### Scope and decomposition
- **D-01:** Keep Phase 2 focused on shared shell infrastructure and delegation seams. Do **not** turn it into the main Section 3, standard VE, GPS-lap, or out-and-back extraction wave.
- **D-02:** Prioritize repeated DOM, event, and template patterns that currently make `frontend/src/main.ts` hard to change safely.
- **D-03:** Move `frontend/src/main.ts` toward an explicit composition-root role by introducing shell module interfaces and dependency wiring rather than leaving orchestration buried inside large functions.
- **D-04:** Keep the exact file/module split somewhat flexible. The plans should be specific about goals, invariants, and proof of success, but should not over-prescribe one brittle decomposition if a cleaner seam appears during execution.

### Architecture guardrails
- **D-05:** Keep `AppState` state-only. Do **not** move DOM nodes, Plotly containers, Leaflet objects, or service singletons into `frontend/src/state/AppState.ts`.
- **D-06:** Preserve existing analysis math, WASM interfaces, plot builders, extracted analysis helpers, and mode-handler architecture unless only a thin shell seam absolutely requires a touch.
- **D-07:** Treat `frontend/src/components/MapVisualization.ts` as secondary only. Touch it in this phase only if a very small supporting seam clearly helps the main `frontend/src/main.ts` delegation work.

### Behavior preservation
- **D-08:** Preserve the Phase 1 regression contract while introducing shell seams. Specifically preserve: auto-scroll to Analysis Parameters after successful FIT/CSV load, in-place GPS updates that keep the active tab and scroll position, and correct GPS-based air-speed calibration behavior.
- **D-09:** Do not change visible analysis semantics just to make the shell extraction easier. If a small behavior adjustment is needed, it must directly enable or de-risk the structural move and stay inside the guardrail contract.

### Validation and execution
- **D-10:** CI parity plus the Phase 1 guardrail entry point remain the default validation contract: `cargo test --lib`, `wasm-pack build --target web --out-dir ../frontend/pkg`, `npm run check`, `npm run lint`, `npm run test`, and `npm run build`, plus the committed browser checklist for fragile shell flows.
- **D-11:** Prefer function-oriented shell helpers and thin adapters over a new heavyweight OO shell framework. The codebase already leans functional and should continue in that direction.

### the agent's Discretion
- Exact naming and placement of the shared shell helper modules
- How much of the top-level shell dependency graph should live in types/interfaces versus small factory/wiring helpers
- Whether a helper belongs in `frontend/src/main.ts`, a new `shell/` area, or an existing nearby module, so long as the result improves delegation and does not create a new god-module
- The most effective way to stage Phase 2 so Phase 3 and Phase 4 become more mechanical and less risky

</decisions>

<specifics>
## Specific Ideas

- Phase 2 should draw directly from the hotspot inventory instead of rediscovering the same pressure points.
- The most likely targets are the repeated DOM lookup/binding patterns around `handleAnalyze`, Section 3 setup, VE shell rendering, and live-update wiring.
- Good Phase 2 outcomes include shared DOM helpers, explicit shell dependency/context types, delegated orchestration entry points, and thinner top-level event wiring in `frontend/src/main.ts`.
- Avoid turning “shared helpers” into a dumping ground. Shared code should exist to remove duplication and clarify ownership, not to hide complexity in another giant utility file.
- The plans should keep enough freedom for execution to find the cleanest seam, but still state concrete files, verification commands, and acceptance criteria.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone scope and requirements
- `.planning/PROJECT.md` - active stabilization scope, constraints, and current phase intent
- `.planning/REQUIREMENTS.md` - Phase 2 requirements `SHEL-01` and `SHEL-02`
- `.planning/ROADMAP.md` - Phase 2 goal, success criteria, and plan slots
- `.planning/STATE.md` - current project position after Phase 1 completion and before Phase 2 planning
- `GEMINI.md` - condensed project conventions and stabilization invariants

### Phase 1 guardrails and handoff artifacts
- `.planning/phases/01-guardrails-and-regression-protection/01-CONTEXT.md` - locked Phase 1 guardrail decisions that still constrain shell work
- `.planning/phases/01-guardrails-and-regression-protection/01-RESEARCH.md` - research conclusions on guardrails-first stabilization and low-risk tooling
- `.planning/phases/01-guardrails-and-regression-protection/01-VALIDATION.md` - current validation cadence and manual-only checks
- `docs/testing/ui-shell-regression-contract.md` - regression-sensitive behaviors that Phase 2 must not break
- `docs/testing/ui-shell-manual-checklist.md` - browser checks for auto-scroll, GPS in-place updates, and calibration behavior
- `docs/architecture/frontend-ui-shell-extraction-inventory.md` - hotspot ownership map and phase-to-hotspot guidance
- `scripts/report-ui-shell-hotspots.sh` - regeneratable hotspot baseline command
- `scripts/validate-ui-shell-guardrails.sh` - default Phase 1+ validation entry point

### Primary code boundaries for Phase 2
- `frontend/src/main.ts` - main shell hotspot and current orchestration boundary
- `frontend/src/state/AppState.ts` - state-only boundary that must remain state-only
- `frontend/src/components/AnalysisParameters.ts` - existing parameter-shell component context
- `frontend/src/plots/PlotContext.ts` - example of extracted UI-adjacent context typing
- `frontend/src/plots/StandardPlotBuilders.ts` - plot builder boundary that should remain thinly wired from shell code
- `frontend/src/modes/analysis/AnalysisModes.ts` - mode routing boundary already extracted from `main.ts`
- `frontend/src/activity/ActivityLoader.ts` - normalized activity loading boundary already extracted from `main.ts`
- `frontend/src/utils/log.ts` - logging boundary; do not reintroduce raw `console.*`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- The repo already has extracted logic in `activity/`, `analysis/`, `modes/analysis/`, `plots/`, and `state/`. Phase 2 should lean on those boundaries instead of recreating domain logic inside new shell modules.
- The Phase 1 hotspot inventory already groups likely ownership buckets into Section 3 shell, standard VE shell, GPS-lap shell, out-and-back shell, and shared DOM/event/template helpers. Phase 2 should build the shared seams that make those later moves cleaner.
- `scripts/validate-ui-shell-guardrails.sh` and the manual checklist already provide the proof contract for fragile browser behavior; Phase 2 should use them rather than inventing a new validation story.

### Established Patterns
- The codebase favors extracted, function-oriented modules over heavy class hierarchies.
- Typed boundaries such as `AppState`, `PlotContext`, and the analysis helpers already show the preferred direction: explicit data/context seams, thin wiring, and isolated logic.
- The remaining large risk is concentrated in UI-shell rendering, DOM querying, event binding, and orchestration timing inside `frontend/src/main.ts`.

### Integration Points
- Likely Phase 2 integration pressure centers on `handleAnalyze`, `initializeSection3`, and the top-level flow that decides which shell path renders or updates.
- Shared helper extraction should support later owners for standard VE, GPS-lap, and out-and-back panels without forcing those full extractions prematurely.
- Any new shell interfaces should make it easier to test or verify delegated wiring boundaries without having to re-read the whole of `frontend/src/main.ts`.

</code_context>

<deferred>
## Deferred Ideas

- Full Section 3 shell extraction (Phase 3)
- Full standard VE shell extraction (Phase 3)
- Full GPS-lap and out-and-back shell extraction (Phase 4)
- Broad `MapVisualization.ts` decomposition unless a very small support seam is clearly justified
- Worker/offload work, framework migration, UI redesign, or unrelated feature expansion
- Browser automation expansion unless later execution shows the current guardrail/manual strategy is insufficient

</deferred>

---
*Phase: 02-shell-infrastructure-and-delegation*
*Context gathered: 2026-04-14*
