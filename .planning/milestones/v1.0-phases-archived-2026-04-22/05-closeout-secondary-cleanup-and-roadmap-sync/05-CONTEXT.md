# Phase 5: Closeout, Secondary Cleanup, and Roadmap Sync - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 5 finishes the `frontend/src/main.ts` reduction so it functions primarily as a composition root (CLOS-01), applies only clearly-justified secondary cleanup to `frontend/src/components/MapVisualization.ts`, and syncs planning/project docs to reflect the stabilized shell boundaries and remaining hotspots (CLOS-02).

Two plans:
- **05-01** — residual `main.ts` cleanup + only justified secondary UI-shell touch-ups
- **05-02** — sync roadmap/project docs and remaining-hotspot guidance

This phase does **not** introduce new analysis features, new modes, UI redesign, framework migration, worker/offload work, or broad `MapVisualization.ts` decomposition. The four regression-sensitive behaviors (auto-scroll BEHV-01, standard VE BEHV-02, in-place GPS updates BEHV-03, GPS calibration BEHV-04) must survive verbatim.

**Baseline at phase start (post-Phase 4):** `frontend/src/main.ts` = 2213 lines, 50 `getElementById` calls, 28 `addEventListener` calls, 4 template-literal `innerHTML` blocks. Down from the 7641-line pre-milestone baseline recorded in the extraction inventory.

</domain>

<decisions>
## Implementation Decisions

### Residual main.ts extraction scope (Plan 05-01)
- **D-01:** Aggressive extraction. `frontend/src/main.ts` becomes a thin composition root: imports, DI/service composition, top-level `initializeApplication` dispatch, and the minimum wiring needed to connect extracted shell modules. No large functions, no inline DOM blocks, no formatters.
- **D-02:** All four residual buckets are in-scope for extraction:
  - **Section 3 detection/trim/lap-selection residuals** — `runGpsLapDetection`, `updateGpsDetectedLapsUI`, `handleGpsLapSelectionChange`, `runOutAndBackDetection`, `updateOutAndBackSectionsUI`, `handleOutAndBackSectionSelectionChange`, `updateOutAndBackButtonState`, `initializeMapTrimControls`, `updateGpsMarkerButtonState`, `updateSelectedLaps`, `initializeMapTrimControlsForSelectedLaps`, `initializeSection3`, plus small helpers `isGpsLapSelectionMode`, `getSelectedDataTimeRange`, `findDataIndexAtTimeOffset`.
  - **File load orchestration** — `handleFileSelection`, `processFitFile`, `processCsvFile`, `displayFileInfo`, `displayCsvResults`, `initializeSection3Csv`, `initializeFitProcessor`. Preserves BEHV-01 (auto-scroll to Analysis Parameters).
  - **DEM + results display** — `updateDEMSourceSelection`, `handleDEMFileSelection`, `clearDEMFile`, `displayResults`, `calculateAvgCda`, `calculateRhoArrayFromFitData`.
  - **Formatters + small UI helpers** — `formatFileSize`, `formatDuration`, `formatDistance`, `formatSpeed`, `formatPower`, `scrollToSection`, `activateSection`, `showLoading`, `hideLoading`, `showError`, `hideError`, `waitForPlotly`.
- **D-03:** Handoff for analyze wiring: `handleAnalyze`, `setupAnalyzeButton`, `updateAnalyzeButton`, `initializeAnalysisParameters`, `handleParametersChange`, `initializeApplication` are also in-scope for reduction. They may collapse into a small bootstrap + a shell-owned orchestration seam — exact shape at Claude's discretion as long as the composition-root outcome is preserved.

### Behavior policy
- **D-04:** Structural-only lifts. No behavior changes. Any visible drift during extraction is treated as a regression, not a "small adjustment." The project constraint allowing small behavior adjustments does **not** apply by default in Phase 5; if a specific adjustment looks necessary during execution, surface it as a checkpoint decision before committing.
- **D-05:** Preserve all four behavior contracts verbatim: BEHV-01 (auto-scroll after file load), BEHV-02 (standard VE output unchanged), BEHV-03 (in-place GPS tab/scroll retention), BEHV-04 (GPS air-speed calibration correctness).

### Validation / proof of reduction
- **D-06:** CI parity remains the default checkpoint contract: `cargo test --lib`, `wasm-pack build --target web --out-dir ../frontend/pkg`, `npm run check`, `npm run lint`, `npm run test`, `npm run build`.
- **D-07:** `bash scripts/validate-ui-shell-guardrails.sh` must remain green. Do **not** add a hard numeric ceiling to the guardrail script in Phase 5 — the size target stays qualitative (composition-root shape) rather than a CI-enforced line limit.
- **D-08:** `bash scripts/report-ui-shell-hotspots.sh` regenerates the baseline. `docs/architecture/frontend-ui-shell-extraction-inventory.md` is refreshed with the post-Phase-5 main.ts line count, DOM/event counts, and updated anchor list (ownership buckets collapse; remaining hotspots re-profiled).
- **D-09:** Manual browser checklist (`docs/testing/ui-shell-manual-checklist.md`) remains the authoritative regression gate for BEHV-01/02/03/04.

### MapVisualization.ts posture (Plan 05-01, secondary)
- **D-10:** Touch `frontend/src/components/MapVisualization.ts` **only** when a specific call site in an extracted shell module forces a seam (e.g., callback signature, cleanup hook, or export shape). No proactive decomposition and no standalone map refactor.
- **D-11:** Allowed change types: **interface narrowing** plus **limited internal cleanup only when directly required by that seam**. Internal cleanup remains behavior-neutral and as small as possible; broad lifecycle decomposition remains MAP-01 in v2.
- **D-12:** Traceability is mandatory in `05-01-SUMMARY.md` for every `MapVisualization.ts` touch: record the exact seam that required it and explicit no-behavior-change validation evidence. If no touches are needed, state that explicitly.

### Doc sync scope (Plan 05-02)
- **D-13:** `docs/architecture/frontend-ui-shell-extraction-inventory.md` — refresh baseline, collapse now-owned ownership buckets (Section 3 / standard VE / GPS-lap / out-and-back), rewrite "Secondary hotspot guidance" to state Phase 5's posture on `MapVisualization.ts` and flag MAP-01 as the v2 trigger. Update the anchor list against the new main.ts.
- **D-14:** `.planning/ROADMAP.md` — mark Phase 5 complete, update progress table, and update any remaining-hotspots guidance so the next milestone inherits accurate scope.
- **D-15:** `.planning/PROJECT.md` — move Active requirements that are now Validated, refresh the "Context" section to describe the stabilized shell, update "Last updated" date. No change to core value or constraints.
- **D-16:** `.planning/REQUIREMENTS.md` — update the traceability table to mark CLOS-01/CLOS-02 and all SHEL/BEHV requirements complete. MAP-01 stays in v2 with its current wording; do **not** sharpen or expand its triggers in Phase 5.
- **D-17:** Codebase map refresh (`.planning/codebase/STRUCTURE.md`, `ARCHITECTURE.md` if affected) is at Claude's discretion — regenerate only if the maps materially misrepresent the new shell layout.

### Claude's Discretion
- Exact file and directory names for extracted residuals (new `shell/app/`, `shell/fileLoad/`, `shell/dem/`, `shell/mapTrim/`, `shell/format/` buckets vs. absorbing into existing `shell/section3/`, `shell/analysis/`, `shell/dom/`). The established render/bind/update + per-domain-dir pattern from Phases 2–4 must be followed, but the bucket breakdown is flexible.
- Whether small pure helpers (e.g., `findDataIndexAtTimeOffset`, `calculateRhoArrayFromFitData`, `getSelectedDataTimeRange`) live in `shell/`, `analysis/`, or `utils/`. Correctness: pure math goes to `analysis/` or `utils/`; DOM-touching code goes to `shell/`.
- Whether to add targeted unit tests for newly-extracted pure logic (e.g., time-range helpers, rho array calculation). Add when the extraction looks risky; skip when it doesn't.
- Ordering within 05-01 (which bucket to extract first). Safer buckets first if it reduces blast radius during reviews.
- `main.ts` line-count target is qualitative: "reads as a composition root." No hard CI-enforced ceiling.
- Whether to regenerate `.planning/codebase/*.md` files as part of 05-02 doc sync.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone scope and requirements
- `.planning/PROJECT.md` — active stabilization scope, constraints, and locked architectural boundaries (AppState state-only, MapVisualization secondary, preserve analysis math/WASM/plot builders)
- `.planning/REQUIREMENTS.md` — Phase 5 requirements `CLOS-01`, `CLOS-02`; v2 requirement `MAP-01` stays parked
- `.planning/ROADMAP.md` — Phase 5 goal, success criteria, plan slots (05-01, 05-02)
- `.planning/STATE.md` — current project position after Phase 4 completion
- `.planning/research/SUMMARY.md` — milestone research (Phase 3 in that doc maps to this closeout phase)

### Prior phase artifacts
- `.planning/phases/01-guardrails-and-regression-protection/01-CONTEXT.md` — guardrail decisions still constraining shell work
- `.planning/phases/02-shell-infrastructure-and-delegation/02-CONTEXT.md` — `ShellServices` DI pattern, composition-root direction, function-oriented shell helpers
- `.planning/phases/03-section-3-and-standard-ve-shell-extraction/03-CONTEXT.md` — Phase 3 extraction pattern (`shell/ve/` and partial `shell/section3/` structure); BEHV-01/BEHV-02 contracts
- `.planning/phases/04-gps-and-out-and-back-shell-extraction/04-CONTEXT.md` — `shell/gpsLap/` and `shell/outAndBack/` structure; BEHV-03/BEHV-04 contracts

### Regression contract and validation
- `docs/testing/ui-shell-regression-contract.md` — regression-sensitive behaviors Phase 5 must not break
- `docs/testing/ui-shell-manual-checklist.md` — browser checks for auto-scroll, GPS in-place updates, calibration
- `docs/architecture/frontend-ui-shell-extraction-inventory.md` — hotspot ownership map; target for 05-02 refresh
- `scripts/validate-ui-shell-guardrails.sh` — validation entry point; stays qualitative (no numeric ceiling added)
- `scripts/report-ui-shell-hotspots.sh` — regeneratable hotspot baseline

### Primary code boundaries for Phase 5
- `frontend/src/main.ts` — residual orchestration to extract into a composition root
- `frontend/src/shell/` — existing extraction home; new sub-buckets land here
  - `frontend/src/shell/analysis/` — analysis delegation (renderDelegates.ts, storageHandlers.ts, prepareAnalysisPayload.ts)
  - `frontend/src/shell/section3/` — bindGpsDetection.ts, bindLapSelection.ts, bindOutAndBackDetection.ts, renderSection3Template.ts
  - `frontend/src/shell/dom/` — shared DOM helpers (tabs.ts, selectableCards.ts, rangeNumberPair.ts, windSource.ts, actionFooter.ts)
  - `frontend/src/shell/ve/` — standard VE shell (Phase 3 pattern)
  - `frontend/src/shell/gpsLap/`, `frontend/src/shell/outAndBack/` — per-mode shell modules (Phase 4 pattern)
  - `frontend/src/shell/multiSegment/` — shared multi-segment helpers (Phase 4)
- `frontend/src/components/MapVisualization.ts` — secondary hotspot; seam-required, limited behavior-neutral internal cleanup is allowed with explicit traceability; otherwise no touch
- `frontend/src/state/AppState.ts` — state-only boundary; must not absorb DOM/services
- `frontend/src/activity/ActivityLoader.ts` — existing activity loader boundary that file-load extractions should lean on
- `frontend/src/analysis/AirSpeedCalibration.ts`, `frontend/src/analysis/MultiSegmentSettings.ts` — stable; import only
- `frontend/src/modes/analysis/AnalysisModes.ts`, `frontend/src/modes/analysis/standardMode.ts`, `frontend/src/modes/analysis/gpsLapMode.ts`, `frontend/src/modes/analysis/outAndBackMode.ts` — mode handlers; stable
- `frontend/src/utils/log.ts` — logging boundary; do not reintroduce raw `console.*`

### Docs targeted by Plan 05-02
- `.planning/ROADMAP.md` — mark phase complete, refresh progress table, update next-milestone hotspots guidance
- `.planning/PROJECT.md` — promote Active → Validated for stabilization requirements, refresh Context section
- `.planning/REQUIREMENTS.md` — update traceability; MAP-01 stays in v2 unchanged
- `docs/architecture/frontend-ui-shell-extraction-inventory.md` — refresh baseline and secondary-hotspot posture
- `.planning/codebase/STRUCTURE.md`, `ARCHITECTURE.md` — regenerate only if materially out-of-date (Claude's discretion)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `frontend/src/shell/` with established sub-buckets (analysis, section3, ve, gpsLap, outAndBack, dom, multiSegment) — residual extractions either absorb into these or create parallel per-domain buckets following the same render/bind/update pattern
- `frontend/src/shell/dom/tabs.ts`, `selectableCards.ts`, `rangeNumberPair.ts`, `windSource.ts`, `actionFooter.ts` — shared DOM helpers that file-load, DEM, and map-trim residuals can reuse
- `frontend/src/activity/ActivityLoader.ts` — normalized activity loader that file-load orchestration already delegates to; extracted `processFitFile`/`processCsvFile` should keep using it
- `frontend/src/shell/analysis/renderDelegates.ts`, `storageHandlers.ts` — delegation patterns to mirror for any remaining analyze-button / parameter wiring
- `scripts/validate-ui-shell-guardrails.sh` and `scripts/report-ui-shell-hotspots.sh` — validation + baseline regeneration tooling

### Established Patterns
- Per-domain shell directories with render / bind / update separation and co-located plot or screenshot files where applicable
- `ShellServices` dependency injection keeps `AppState` state-only while passing dependencies to shell modules
- Function-oriented modules preferred over class hierarchies
- Analysis math lives in `analysis/`; DOM/render lives in `shell/`; general utilities live in `utils/`
- Small shared helpers land in the closest existing bucket before a new bucket is created

### Integration Points
- `initializeApplication` is the current top-level bootstrap and the natural last thing to leave `main.ts`
- `handleAnalyze` / `setupAnalyzeButton` already delegate heavily into `shell/analysis/renderDelegates.ts` — a final wrap into a narrow bootstrap seam is the target
- File load entry (`handleFileSelection` → `processFitFile`/`processCsvFile`) connects browser file input to `ActivityLoader` and then into Section 3 / VE shells
- DEM inputs feed into analysis parameter state via `handleDEMFileSelection` — extraction should keep the existing DEM cache/persistence boundary
- Section 3 detection residuals (`runGpsLapDetection`, `runOutAndBackDetection`, etc.) connect to `frontend/src/utils/GpsLapDetection.ts` and the map controls in `MapVisualization.ts` — this is where the only permitted MapVisualization touches may surface

</code_context>

<specifics>
## Specific Ideas

- The user's consistent preference across Phases 1–4 is conservative, structural-only moves with explicit guardrails. Phase 5 keeps that posture — "aggressive" here means *scope of extraction*, not *aggressive behavior changes*.
- `main.ts` target is the composition-root shape, not a line number. Success looks like: imports + DI composition + `initializeApplication` dispatch + thin bootstrap wiring, with no large functions or inline DOM blocks.
- The Phase 5 extraction inventory refresh should flag remaining hotspots for the *next* milestone (most likely `MapVisualization.ts` per MAP-01, and possibly the v2 TEST-01 / CSS-01 / PERF-01 items) so post-milestone work starts from a clean map.
- Any `MapVisualization.ts` touch is an exception, not the rule. If 05-01 finishes without touching it, that is the preferred outcome. If touches happen, they must be seam-required, minimal, behavior-neutral, and explicitly justified in 05-01 SUMMARY.
- Doc sync (05-02) is the last plan of the milestone, so it can consume the actual post-extraction numbers and anchors rather than guessing at them.

</specifics>

<deferred>
## Deferred Ideas

- **MAP-01** — full `MapVisualization.ts` decomposition via explicit lifecycle helpers stays in v2 requirements; Phase 5 does not promote it.
- **TEST-01** — browser-level smoke coverage (Playwright / Vitest Browser Mode) for high-risk upload/scroll/tab-preservation/GPS flows stays in v2.
- **CSS-01** — further reduction of dynamic HTML and inline-style hotspots stays in v2.
- **PERF-01** — re-profiling UI update performance and revisiting worker/offload work stays in v2.
- Adding a hard numeric `main.ts` line ceiling to `scripts/validate-ui-shell-guardrails.sh` — rejected for Phase 5; size target stays qualitative. Can be revisited later if regressions appear.
- Broad `.planning/codebase/*.md` regeneration — only done if maps materially misrepresent the new shell layout.
- Sharpening MAP-01's trigger wording in REQUIREMENTS.md — leave as-is in Phase 5.

### Reviewed Todos (not folded into Phase 5)
- Move GPS mode selection to Section 3 lap selection — deferred; workflow/UI capability change outside closeout-only scope.
- Check elevation smoothing strategy — deferred; analysis/visualization behavior decision, not Phase 5 structural closeout.
- Consider worker offload for multi-lap VE — deferred; performance architecture follow-up (v2/PERF scope).
- Evaluate continuous weather sampling — deferred; feature/analysis expansion outside CLOS-01/CLOS-02.

</deferred>

---

*Phase: 05-closeout-secondary-cleanup-and-roadmap-sync*
*Context gathered: 2026-04-19*
