# Phase 2: Shell Infrastructure and Delegation - Research

**Researched:** 2026-04-14
**Domain:** Brownfield frontend UI-shell refactoring for a framework-free TypeScript + Rust/WASM web app
**Confidence:** HIGH

<user_constraints>
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
</user_constraints>

<phase_requirements>
- [ ] **SHEL-01**: Maintainer can delegate top-level UI-shell orchestration through explicit shell modules instead of embedding those responsibilities throughout `frontend/src/main.ts`
- [ ] **SHEL-02**: Maintainer has shared DOM, event, and template helpers for repeated dynamic shell patterns instead of re-implementing the same wiring per panel
</phase_requirements>

## Project Constraints (from GEMINI.md)

Actionable directives that should remain explicit in the phase plan:

- Keep `AppState` state-only; do not move DOM nodes or service singletons into it.
- Prefer extracted function-oriented modules for domain logic and shell helpers.
- Keep plot builders pure where possible; keep DOM/Plotly wiring thin.
- Use `frontend/src/utils/log.ts` instead of raw `console.*`.
- Preserve existing analysis math, WASM interfaces, and mode-handler behavior unless a thin seam absolutely requires change.
- Do not bypass the current stabilization invariants: auto-scroll after file load, in-place GPS updates with tab/scroll retention, and correct GPS air-speed calibration behavior.

## Summary

Phase 2 should plan around **shared shell infrastructure first**, not a full UI-shell extraction wave. The codebase already has the domain seams needed for safe delegation: typed `AppState`, extracted activity loading, analysis helpers, mode handlers, plot builders, and a committed Phase 1 guardrail contract. What is still missing is a shell-focused layer that gives repeated DOM/event/template work a stable home and lets `frontend/src/main.ts` stop acting as the implementation site for every top-level workflow.

The main planning insight is that `handleAnalyze`, `initializeSection3`, `showVirtualElevationAnalysisInline`/`initializeVEAnalysis`/`setupVESliders`, `showGpsLapVEPlot`/`updateGpsLapVEPlots`, and `showOutAndBackVEPlot`/`updateOutAndBackVEPlots` already expose the correct *behavioral* boundaries. Phase 2 should formalize those into shell seams and shared binders without changing the underlying analysis semantics.

## Current Code Findings

### Hotspot baseline

Current measured baseline from `bash scripts/report-ui-shell-hotspots.sh`:

- `frontend/src/main.ts` lines: `7641`
- `document.getElementById(` count: `230`
- `addEventListener(` count: `85`
- `innerHTML = \`` count: `12`
- `style="` count: `142`
- `: any` count: `21`
- `setTimeout(` count in `main.ts`: `21`

Primary anchors remain:

- `calculateAutoRho` — line `1027`
- `initializeSection3` — line `2543`
- `handleAnalyze` — line `2776`
- `showGpsLapVEPlot` — line `3276`
- `showVirtualElevationAnalysisInline` — line `4066`
- `setupVESliders` — line `4818`
- `updateGpsLapVEPlots` — line `5641`
- `showOutAndBackVEPlot` — line `6168`
- `updateOutAndBackVEPlots` — line `6909`

These numbers confirm that the planning target is still UI-shell orchestration and repeated binder/template logic, not missing domain modularity.

### Existing seams Phase 2 should build on

The repo already has several strong boundaries that Phase 2 should reuse rather than replace:

- `frontend/src/state/AppState.ts` already groups state by concern (`activity`, `selection`, `analysis`, `dem`, `ui`) and explicitly excludes DOM/service ownership.
- `frontend/src/modes/analysis/AnalysisModes.ts` already routes standard vs GPS-lap vs out-and-back behavior through `AnalysisModeHandler` interfaces.
- `frontend/src/activity/ActivityLoader.ts` already normalizes FIT/CSV loading into a shared activity model.
- `frontend/src/plots/PlotContext.ts` and `frontend/src/plots/StandardPlotBuilders.ts` already demonstrate the desired pattern: shell code gathers context, plot modules stay mostly pure.
- `frontend/src/analysis/AirSpeedCalibration.ts` and `frontend/src/analysis/MultiSegmentSettings.ts` already centralize the calibration semantics that Phase 2 must not disturb.
- `frontend/src/components/AnalysisParameters.ts` already owns parameter-form rendering and validation; Phase 2 should consume it as a component boundary, not reimplement it.

### Repeated shell patterns that directly justify SHEL-02

#### 1. Selection-list rendering and checkbox-card binding are duplicated

`initializeSection3`, `updateGpsDetectedLapsUI`, and `updateOutAndBackSectionsUI` all render checkbox-card lists via template strings and then bind nearly identical checkbox/change/click behavior.

Direct evidence in `frontend/src/main.ts`:

- `updateGpsDetectedLapsUI` / `handleGpsLapSelectionChange`
- `updateOutAndBackSectionsUI` / `handleOutAndBackSectionSelectionChange`
- FIT lap selection rendering inside `initializeSection3`

This is a strong Phase 2 shared-helper target.

#### 2. VE tab switching is implemented three times

The same active-tab wiring pattern exists in:

- `initializeVEAnalysis`
- `setupGpsLapTabSwitching`
- `setupOutAndBackTabSwitching`

All three:

- find `.ve-tab-button`
- remove/add `active`
- switch `.ve-tab-content`
- conditionally render tab-specific plots

This is a clean shared event-helper seam that can be extracted without touching analysis math.

#### 3. Slider/range + numeric-input synchronization is implemented repeatedly

Three distinct shell paths contain similar slider/value binding logic:

- `setupVESliders`
- `setupGpsLapSliderHandlers`
- `setupOutAndBackSliderSync`

The standard VE path is larger because it also coordinates trim sliders, wind-source changes, auto-rho, map-trim sync, and persistence, but the repeated control patterns are obvious.

#### 4. Wind-source and footer action binding is repeated across VE shells

The same shell actions are rebound in multiple render flows:

- `document.querySelectorAll('input[name="windSource"]')` in standard, GPS-lap, and out-and-back renderers
- `getElementById('saveScreenshot')`, `getElementById('storeResult')`, `getElementById('exportAllResults')` in standard, GPS-lap, and out-and-back renderers

The behavior differs slightly by mode, but the shell structure is similar enough to justify shared binders or a shared action-footer helper.

#### 5. Large HTML template strings remain concentrated in shell-render functions

Current `innerHTML = \`` assignments are concentrated in UI-shell hotspots, especially:

- `initializeSection3`
- `showGpsLapVEPlot`
- `showVirtualElevationAnalysisInline`
- `showOutAndBackVEPlot`

For this codebase, the lowest-risk move is not a framework migration or a full DOM API rewrite; it is extracting these templates into small, pure template-builder functions with separate bind steps.

#### 6. Post-render timing is still fragile and shell-owned

`main.ts` uses `setTimeout(...)` 21 times, frequently to:

- wait for dynamic HTML to exist before binding
- wait for Plotly/UI readiness
- trigger delayed auto-rho or delayed plot resizing

Phase 2 should centralize or at least isolate these timing boundaries so later extraction does not scatter more delayed orchestration across modules.

### Orchestration findings that directly justify SHEL-01

#### `main.ts` is already half composition root, half implementation bucket

At the top of `main.ts`, the file already owns composition-root concerns:

- static DOM lookups
- `AppState` construction
- service construction (`FitFileProcessor`, `ParameterStorage`, `ResultsStorage`, DEM services, `MapVisualization`)
- top-level event registration

But it still also owns deep implementation details for Section 3 rendering, analysis preparation, VE-shell rendering, multi-segment update behavior, and persistence-triggered UI recalculation.

#### `handleAnalyze` already exposes a natural delegation seam

`handleAnalyze` currently does all of the following in one function:

- reads the selected mode from parameters
- delegates selection semantics to `AnalysisModes`
- validates UI state
- collects filtered indices and arrays
- resolves wind/default air-speed offset
- conditionally builds rho inputs
- creates the VE calculator
- computes the initial result
- syncs global state
- constructs a mode-specific callback map
- invokes a mode-specific shell renderer

This is the clearest Phase 2 target for explicit shell-module delegation.

#### The mode system already provides the interface shape for delegated shells

`AnalysisModes.ts` already yields `AnalysisModeHandler` objects plus typed render callbacks. That means Phase 2 does **not** need a new framework or a second routing abstraction. It can extract named shell adapters that satisfy the existing callback interface and shrink `handleAnalyze` to orchestration.

#### `MapVisualization` is already acting like an adapter surface

`main.ts` uses a finite public method surface from `MapVisualization` (`initialize`, `setData`, `setSelectedLaps`, `fitBoundsToTrimRegion`, `setGpsMarker*`, `showDetectedLaps`, `showOutAndBackSections`, `showWindIndicator`, `hideWindIndicator`, `clear*`, `destroy`).

That is enough to introduce a Phase 2 shell-facing map adapter interface without decomposing `MapVisualization.ts` itself.

## Validation Architecture

Phase 2 should preserve the Phase 1 guardrail contract as the default proof path and add only targeted helper-level tests where extraction creates pure logic worth unit testing.

### Automated baseline remains unchanged

Default automated entry points:

```bash
bash scripts/validate-ui-shell-guardrails.sh
bash scripts/validate-ui-shell-guardrails.sh --ci-only
```

Automated chain mirrored from CI:

```bash
cd backend && cargo test --lib
cd backend && wasm-pack build --target web --out-dir ../frontend/pkg
cd frontend && npm run check
cd frontend && npm run lint
cd frontend && npm run test
cd frontend && npm run build
```

### Manual guardrail contract remains mandatory

Phase 2 must continue to use:

- `docs/testing/ui-shell-regression-contract.md`
- `docs/testing/ui-shell-manual-checklist.md`

The fragile browser-only checks still remain:

- FIT/CSV auto-scroll to Analysis Parameters
- GPS lap in-place update preserving active tab + scroll position
- out-and-back in-place update preserving active tab + scroll position
- calibration behavior across GPS-based modes

### Recommended Phase 2 test additions

Add unit tests **only** for extracted pure or mostly-pure helpers, for example:

- selection-list item normalization / selection-state helpers
- tab-state helpers that choose which renderer to invoke
- slider clamp/format helpers extracted from large binder functions
- shell template view-model builders that do not touch the real DOM
- dependency-free orchestration helpers extracted from `handleAnalyze`

Keep these under the existing Vitest pattern already used by `frontend/src/analysis/*.test.ts`.

### Validation mapping to requirements

- **SHEL-01**
  - Type safety and wiring: `cd frontend && npm run check`
  - Helper/orchestration tests: `cd frontend && npm run test`
  - Regression gate: `bash scripts/validate-ui-shell-guardrails.sh`
  - Browser proof: `docs/testing/ui-shell-manual-checklist.md`

- **SHEL-02**
  - Shared helper correctness: `cd frontend && npm run test`
  - Structural safety: `cd frontend && npm run check && npm run lint`
  - Regression gate: `bash scripts/validate-ui-shell-guardrails.sh`
  - Browser proof: `docs/testing/ui-shell-manual-checklist.md`

### Planning implication

Do **not** plan Phase 2 around new browser automation by default. The committed Phase 1 script + manual checklist is already the required contract. Phase 2 should strengthen unit-testable shell helpers where possible, but not replace the browser guardrails with narrower node-only checks.

## Prescriptive Architecture Recommendations

### 1. Introduce a dedicated `frontend/src/shell/` area

Use a shell-specific folder rather than `utils/` so ownership stays clear and the repo does not grow a new generic helper dump.

Recommended initial shape:

```text
frontend/src/shell/
├── dom/
│   ├── elements.ts              # typed lookup helpers / static refs
│   ├── selectableCards.ts       # checkbox-card list render/bind helpers
│   ├── tabs.ts                  # VE tab binding helpers
│   ├── rangeNumberPair.ts       # slider <-> number synchronization helpers
│   └── actionFooter.ts          # save/store/export button binding helpers
├── analysis/
│   ├── prepareAnalysisPayload.ts
│   ├── analysisShellController.ts
│   └── types.ts
├── section3/
│   ├── renderSection3Shell.ts
│   ├── bindLapSelection.ts
│   ├── bindGpsLapDetection.ts
│   └── bindOutAndBackDetection.ts
└── map/
    └── MapShellAdapter.ts       # interface only unless a tiny seam is needed
```

Exact filenames can vary, but the separation should be by shell responsibility, not by one monolithic helper file.

### 2. Keep `main.ts` as composition root only

After Phase 2, `main.ts` should still own:

- static bootstrapping
- construction of `AppState` and service instances
- top-level startup sequencing
- high-level wiring between shell modules and existing extracted logic

It should stop owning:

- large HTML templates
- repeated control binding bodies
- panel-specific event registration details
- anonymous mode-render callback implementations
- ad hoc DOM query logic embedded deep inside workflow functions

### 3. Define explicit shell dependency objects instead of expanding `AppState`

Use small dependency/context types such as:

- `ShellServices` — `appState`, `parameterStorage`, `resultsStorage`, `waitForPlotly`, `showLoading`, `hideLoading`, `showError`, `log`
- `Section3ShellDeps` — `ShellServices` plus a narrow map adapter surface
- `StandardVeShellDeps` / `MultiSegmentShellDeps` — only the shell services actually needed by those binders

Important constraint: these should be **separate from `AppState`**, not merged into it.

### 4. Keep framework-free template strings, but split render from bind

For this codebase, the least risky recommendation is:

- keep template-string rendering where it is already dominant
- move template generation into pure `render*` functions returning strings
- mount once with `innerHTML`
- bind behavior in a separate `bind*` function

That preserves the current implementation style while still satisfying SHEL-02.

Do **not** plan a JSX, Web Components, or virtual-DOM insertion as part of Phase 2.

### 5. Extract `handleAnalyze` by workflow responsibility, not by mode first

A good Phase 2 decomposition for `handleAnalyze` is:

1. `prepareSelectionAndInputs(appState)`
2. `buildFilteredAnalysisPayload(...)`
3. `resolveShellEnvironment(...)` for wind/rho/default offset inputs
4. `runInitialVeCalculation(...)`
5. `delegateRender(...)` using the existing `AnalysisModeHandler` + named shell renderers

This uses the current `AnalysisModes` seam instead of replacing it.

### 6. Build shared multi-segment helpers now, but defer full GPS/out-and-back extraction

GPS-lap and out-and-back shells are structurally similar already. Phase 2 should extract only the shared infrastructure they both need, such as:

- tab binding
- CdA/Crr slider binding
- wind-source radio binding
- calibration control binding
- screenshot/store/export footer binding
- selected wind-source preservation across rerender

It should **not** try to finish the full module ownership transfer for both shells yet.

### 7. Treat `MapVisualization.ts` through an adapter seam, not a refactor target

Because `main.ts` already calls a narrow set of map methods, Phase 2 can define a shell-facing adapter interface around that method surface and keep `MapVisualization.ts` unchanged unless a tiny supporting seam is clearly justified.

That keeps the phase aligned with D-07 and avoids scope bleed.

### 8. Preserve the existing in-place update contract by distinguishing full render vs incremental update helpers

The current codebase already distinguishes between:

- initial shell render functions (`showGpsLapVEPlot`, `showOutAndBackVEPlot`, standard VE render path)
- incremental update functions (`updateGpsLapVEPlots`, `updateOutAndBackVEPlots`, standard slider-driven `updateVEPlots` flow)

Phase 2 should keep that distinction explicit in extracted modules. In particular:

- slider-driven and auto-adjust updates must continue to use incremental update paths
- active-tab checks (`wind`, `power`, `vd`) must stay local to the update flow
- full shell rerender helpers should remain separate and deliberate

### 9. Avoid these anti-patterns

- A single `frontend/src/shell/helpers.ts` or `uiHelpers.ts` god module
- Moving DOM refs, Plotly objects, or services into `AppState`
- Replacing existing mode handlers with a second shell-routing abstraction
- Full rerender on every update path just to simplify extraction
- `console.*` reintroduction instead of `frontend/src/utils/log.ts`
- Turning Phase 2 into a hidden Phase 3/4 extraction wave

## Recommended plan decomposition

### 02-01: Extract shared DOM, event, and template helper seams for shell code

Recommended scope:

- typed DOM lookup helpers for shell modules
- shared checkbox-card rendering/binding for FIT laps, GPS laps, and out-and-back sections
- shared VE tab binding helper
- shared range/number input binding helper
- shared footer action binding helper
- pure template builders for Section 3 and VE-shell sidebars where practical

Recommended proof:

- helper unit tests for extracted pure logic
- `npm run check`, `npm run test`, `npm run lint`

### 02-02: Define shell module interfaces and dependency wiring from `main.ts`

Recommended scope:

- introduce `shell/` dependency/context types
- extract named shell render delegates from anonymous `handleAnalyze` callback objects
- define a narrow map adapter surface without broad `MapVisualization.ts` changes
- make service wiring explicit in `main.ts`

Recommended proof:

- `handleAnalyze` becomes smaller and names imported delegates instead of inline implementations
- `AppState` remains unchanged as a state-only boundary

### 02-03: Move top-level workflow orchestration toward delegated shell modules

Recommended scope:

- split `handleAnalyze` into orchestration + payload preparation + delegated render steps
- split `initializeSection3` into template render + lap selection binding + GPS/out-and-back binding + map bootstrap helpers
- reduce deep DOM work in `main.ts` so the file reads like a composition root

Recommended proof:

- materially less shell implementation detail in `frontend/src/main.ts`
- unchanged Phase 1 guardrail behavior under `scripts/validate-ui-shell-guardrails.sh` and the manual checklist

## Open Questions

1. **Should shell helpers live under `shell/` or `utils/`?**
   - Recommendation: `shell/`.
   - Reason: these helpers are UI-shell-specific and should not look reusable outside the shell.

2. **Should template extraction use strings or `DocumentFragment` builders?**
   - Recommendation: keep string templates first.
   - Reason: the current code already uses `innerHTML` heavily, so string-based render/bind separation is the lowest-risk brownfield move.

3. **How much GPS/out-and-back code should Phase 2 extract now?**
   - Recommendation: extract only shared infrastructure now.
   - Reason: full module ownership moves are explicitly deferred to Phases 3 and 4.

## Sources

### Primary (HIGH confidence)
- `.planning/phases/02-shell-infrastructure-and-delegation/02-CONTEXT.md`
- `.planning/PROJECT.md`
- `.planning/ROADMAP.md`
- `.planning/REQUIREMENTS.md`
- `.planning/STATE.md`
- `.planning/phases/01-guardrails-and-regression-protection/01-CONTEXT.md`
- `.planning/phases/01-guardrails-and-regression-protection/01-RESEARCH.md`
- `.planning/phases/01-guardrails-and-regression-protection/01-VALIDATION.md`
- `docs/architecture/frontend-ui-shell-extraction-inventory.md`
- `docs/testing/ui-shell-regression-contract.md`
- `docs/testing/ui-shell-manual-checklist.md`
- `scripts/validate-ui-shell-guardrails.sh`
- `scripts/report-ui-shell-hotspots.sh`
- `GEMINI.md`
- `frontend/src/main.ts`
- `frontend/src/state/AppState.ts`
- `frontend/src/components/AnalysisParameters.ts`
- `frontend/src/plots/PlotContext.ts`
- `frontend/src/plots/StandardPlotBuilders.ts`
- `frontend/src/modes/analysis/AnalysisModes.ts`
- `frontend/src/modes/analysis/types.ts`
- `frontend/src/modes/analysis/standardMode.ts`
- `frontend/src/modes/analysis/gpsLapMode.ts`
- `frontend/src/modes/analysis/outAndBackMode.ts`
- `frontend/src/activity/ActivityLoader.ts`
- `frontend/src/analysis/AirSpeedCalibration.ts`
- `frontend/src/analysis/MultiSegmentSettings.ts`
- `frontend/src/components/MapVisualization.ts`
- `frontend/src/utils/log.ts`
- `frontend/package.json`
- `package.json`

## Metadata

**Confidence breakdown:**
- Constraints and requirements: HIGH
- Validation architecture: HIGH
- Recommended shell seams: HIGH
- Exact eventual file split: MEDIUM by design; Phase 2 should stay goal-specific but implementation-flexible

**Research date:** 2026-04-14
**Valid until:** 2026-05-14
