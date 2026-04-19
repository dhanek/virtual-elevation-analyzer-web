# Phase 5: Closeout, Secondary Cleanup, and Roadmap Sync - Research

**Researched:** 2026-04-19  
**Domain:** Frontend UI-shell closeout refactor (composition-root reduction + documentation synchronization)  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
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

### Deferred Ideas (OUT OF SCOPE)
- **MAP-01** — full `MapVisualization.ts` decomposition via explicit lifecycle helpers stays in v2 requirements; Phase 5 does not promote it.
- **TEST-01** — browser-level smoke coverage (Playwright / Vitest Browser Mode) for high-risk upload/scroll/tab-preservation/GPS flows stays in v2.
- **CSS-01** — further reduction of dynamic HTML and inline-style hotspots stays in v2.
- **PERF-01** — re-profiling UI update performance and revisiting worker/offload work stays in v2.
- Adding a hard numeric `main.ts` line ceiling to `scripts/validate-ui-shell-guardrails.sh` — rejected for Phase 5; size target stays qualitative. Can be revisited later if regressions appear.
- Broad `.planning/codebase/*.md` regeneration — only done if maps materially misrepresent the new shell layout.
- Sharpening MAP-01's trigger wording in REQUIREMENTS.md — leave as-is in Phase 5.
- Move GPS mode selection to Section 3 lap selection — deferred; workflow/UI capability change outside closeout-only scope.
- Check elevation smoothing strategy — deferred; analysis/visualization behavior decision, not Phase 5 structural closeout.
- Consider worker offload for multi-lap VE — deferred; performance architecture follow-up (v2/PERF scope).
- Evaluate continuous weather sampling — deferred; feature/analysis expansion outside CLOS-01/CLOS-02.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CLOS-01 | Maintainer ends the phase with `frontend/src/main.ts` functioning primarily as a composition root and materially smaller than the pre-phase baseline | Extraction pattern guidance, shell-module ownership rules, hotspot script usage (`scripts/report-ui-shell-hotspots.sh`), qualitative composition-root acceptance criteria, and guardrail + manual regression gate sequencing |
| CLOS-02 | Maintainer can understand the stabilized shell boundaries and remaining hotspots from updated planning/project documentation at phase close | Explicit doc-sync update contract for ROADMAP/PROJECT/REQUIREMENTS/architecture inventory, stale-field checklist, and hotspot-baseline refresh procedure |
</phase_requirements>

## Summary

Phase 5 is a **closeout refactor + documentation synchronization phase**, not a feature phase. Planning should treat the remaining work as disciplined extraction of residual orchestration out of `frontend/src/main.ts` so `main.ts` reads as a composition root (imports + dependency wiring + bootstrap dispatch) while preserving BEHV-01/02/03/04 exactly. The current baseline already reflects major progress (about 2213 lines in `main.ts`, down from 7641 historical baseline), so remaining work is concentrated in a few large functions and residual DOM-heavy wiring seams.

The safest planning posture is: reuse the established shell patterns from Phases 2–4 (per-domain modules, render/bind/update split, typed service seams), extract high-risk behavior-preserving buckets incrementally, and validate after each bucket using the existing guardrail workflow. Treat any visible UI/behavior change as regression unless explicitly checkpoint-approved.

Documentation closeout is a first-class deliverable for CLOS-02. The architecture inventory and planning docs currently have stale milestone-era fields that must be synchronized to the post-extraction shell boundaries and hotspot reality. This includes updating requirement traceability and progress tables so future milestones inherit an accurate map.

**Primary recommendation:** Plan 05-01 as incremental composition-root extraction with regression checks after each bucket, then Plan 05-02 as structured doc-state reconciliation driven by fresh hotspot script output.

## Project Constraints (from project instructions)

### CLAUDE.md
- `./CLAUDE.md` not present (no CLAUDE-specific directives found).

### GEMINI.md actionable directives
- Keep `AppState` state-only; do not move DOM nodes/services into it.
- Prefer function-oriented extracted modules and shell helpers.
- Keep analysis math/WASM interfaces/mode-handler behavior stable unless a thin seam requires change.
- Use `frontend/src/utils/log.ts` instead of raw `console.*`.
- Preserve invariants: file-load auto-scroll to Analysis Parameters, in-place GPS updates with tab/scroll retention, and correct GPS air-speed calibration behavior.
- Follow GSD validation baseline: `cargo test --lib`, `wasm-pack build`, `npm run check`, `npm run lint`, `npm run test`, `npm run build`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | Project: `^6.0.2` (npm latest: `6.0.3`, 2026-04-16) | Frontend typing + compile checks | Existing codebase and check pipeline are already built around strict TS |
| Vite | Project: `^8.0.7` (npm latest: `8.0.8`, 2026-04-09) | Frontend build pipeline | Existing production build path and deploy workflow depend on Vite |
| Vitest | Project: `^3.2.4` (npm latest: `4.1.4`, 2026-04-09) | Frontend unit tests | Existing test suite and config (`frontend/vitest.config.ts`) are Vitest-based |
| ESLint | Project: `^9.39.1` (npm latest: `10.2.1`, 2026-04-17) | Static lint gate | Existing zero-warning lint contract is part of guardrail script |
| Rust + cargo + wasm-pack | cargo `1.90.0`, rustc `1.90.0`, wasm-pack `0.13.1` | WASM core validation/build | Guardrail/CI parity requires backend unit tests + wasm build before frontend gates |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| jsdom | Project: `^29.0.2` (npm latest: `29.0.2`, 2026-04-07) | DOM-like test environment in frontend tests | For unit tests that need browser-like DOM behavior |
| typescript-eslint | Project: `^8.46.2` (npm latest: `8.58.2`, 2026-04-13) | TypeScript lint integration | Maintain existing lint semantics without introducing new tooling during closeout |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Existing framework-free shell extraction pattern | Framework migration or component rewrite | Violates v1 out-of-scope and destroys regression attribution in closeout |
| Existing guardrail/manual checklist flow | New browser E2E harness in this phase | Valuable but deferred as TEST-01 (v2), would expand scope |
| Existing project-pinned toolchain | Toolchain upgrades (Vitest 4 / ESLint 10) during closeout | Adds migration risk unrelated to CLOS-01/CLOS-02 |

**Installation:**
```bash
# No new dependencies recommended for Phase 5
cd frontend && npm ci
cd ../backend && cargo fetch
```

**Version verification (executed 2026-04-19):**
- `npm view typescript version` → `6.0.3` (published 2026-04-16)
- `npm view vite version` → `8.0.8` (published 2026-04-09)
- `npm view vitest version` → `4.1.4` (published 2026-04-09)
- `npm view eslint version` → `10.2.1` (published 2026-04-17)
- `npm view jsdom version` → `29.0.2` (published 2026-04-07)
- `npm view typescript-eslint version` → `8.58.2` (published 2026-04-13)

## Architecture Patterns

### Recommended Project Structure
```text
frontend/src/
├── main.ts                    # Composition root only (imports + DI + bootstrap dispatch)
├── shell/
│   ├── analysis/              # analyze wiring helpers, payload prep, delegates
│   ├── section3/              # Section 3 UI bind/render/detection seams
│   ├── gpsLap/                # GPS-lap mode shell
│   ├── outAndBack/            # out-and-back mode shell
│   ├── ve/                    # standard VE shell
│   ├── dom/                   # shared DOM helpers (tabs/cards/pairs/wind/footer)
│   └── [optional new bucket]  # only when clearer than forcing unrelated ownership
├── analysis/                  # pure analysis/math helpers
├── state/                     # AppState boundary (state-only)
└── utils/                     # shared non-DOM utility helpers (incl. log boundary)
```

### Pattern 1: Composition Root Slimming
**What:** Keep `main.ts` as orchestration seam only; move feature/domain logic and DOM-heavy handlers into shell modules.
**When to use:** For any residual function in `main.ts` that performs mode-specific behavior, templating, or large DOM/event wiring.
**Example:**
```ts
// Source: frontend/src/main.ts
import { showGpsLapVEAnalysis } from './shell/gpsLap';
import { showOutAndBackVEAnalysis } from './shell/outAndBack';
import { prepareAnalysisPayload } from './shell/analysis/prepareAnalysisPayload';
```

### Pattern 2: Typed Shell Services (DI seam)
**What:** Pass explicitly typed service boundaries instead of reaching global mutable state from extracted modules.
**When to use:** Any extraction requiring app state + shared UI callbacks.
**Example:**
```ts
// Source: frontend/src/shell/analysis/types.ts
export interface ShellServices {
  appState: AppState;
  showLoading: (message: string) => void;
  hideLoading: () => void;
  showError: (message: string) => void;
}
```

### Pattern 3: Pure Logic Isolation
**What:** Move non-DOM calculations into pure helpers (`analysis/` or `utils/`) and keep shell functions thin.
**When to use:** Helper extraction candidates like `calculateRhoArrayFromFitData`, time-range/index logic, formatting helpers.
**Example:**
```ts
// Source: frontend/src/shell/analysis/prepareAnalysisPayload.ts
export function prepareAnalysisPayload(...) {
  // no AppState mutation, no DOM dependency
}
```

### Anti-Patterns to Avoid
- **Big-function drift in `main.ts`:** Leaving extracted seams half-done keeps `main.ts` as hotspot; require bucket completion before moving on.
- **Behavior tweaks disguised as cleanup:** In this phase, visible behavior changes are regressions unless explicitly checkpoint-approved.
- **Proactive MapVisualization rewrite:** Only seam-forced, minimal, behavior-neutral touches are allowed.
- **Boundary leakage into `AppState`:** Do not move DOM/services into state boundary.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Regression verification chain | New ad-hoc custom script chain | `scripts/validate-ui-shell-guardrails.sh` + manual checklist | Existing chain mirrors CI and already encodes phase safety gates |
| Hotspot baseline metrics | Manual counting/spreadsheet tracking | `scripts/report-ui-shell-hotspots.sh` | Reproducible metrics + anchor reporting already exist |
| Shared tab/card/pair wiring | Per-feature DOM rewrites | `frontend/src/shell/dom/*` helpers | Prevents duplicated event/DOM bugs across extracted modules |
| Activity load parsing path | New parsing orchestration in shell | `frontend/src/activity/ActivityLoader.ts` | Keeps parsing semantics stable while refactoring UI orchestration |

**Key insight:** This phase wins by **finishing extraction on existing seams**, not by introducing new infrastructure.

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | IndexedDB stores: `VirtualElevationAnalyzer/fileParameters`, `VirtualElevationResults/veResults`, `ve-elevation-profiles`, `ve-weather-cache`; localStorage DEM config keys | **None (code edit only)** — structural refactor does not change key/schema names; no data migration required |
| Live service config | GitHub Pages source setting exists outside git | **None** for Phase 5 scope |
| OS-registered state | None — verified by repo scan for systemd/launchd/cron/pm2 registration patterns | **None** |
| Secrets/env vars | `VITE_OPENTOPO_API_KEY`, `VITE_GITHUB_PAGES`, `VITE_LOG_LEVEL`; `.env*` gitignored | **None** — no env key rename/migration required |
| Build artifacts | Local artifacts (`frontend/node_modules`, `frontend/pkg`, `backend/target`, `dist`) | **Rebuild only (code edit)** — no runtime data migration |

## Common Pitfalls

### Pitfall 1: Treating “composition root” as line-count-only
**What goes wrong:** Teams optimize for fewer lines but keep hidden orchestration complexity and domain logic in `main.ts`.
**Why it happens:** Numeric targets are easier than ownership review.
**How to avoid:** Use qualitative acceptance: imports + DI + bootstrap dispatch only; no large mode-specific functions.
**Warning signs:** `main.ts` still owns mode-specific UI update paths after extraction.

### Pitfall 2: Scope creep into MAP-01
**What goes wrong:** `MapVisualization.ts` gets broad decomposition during closeout.
**Why it happens:** Nearby complexity invites opportunistic cleanup.
**How to avoid:** Enforce seam-required-only rule with per-touch justification in summary.
**Warning signs:** Multiple unrelated lifecycle edits with no direct extracted seam dependency.

### Pitfall 3: Behavioral drift during “structural-only” moves
**What goes wrong:** Auto-scroll/tab retention/calibration changes unintentionally.
**Why it happens:** Event ordering and callback wiring change while extracting.
**How to avoid:** Run guardrail chain + manual BEHV checklist after each risky bucket.
**Warning signs:** Active tab resets, scroll jumps, calibration percentages differ from pre-extraction behavior.

### Pitfall 4: Doc sync treated as optional cleanup
**What goes wrong:** Roadmap/project/requirements remain stale, harming next milestone planning.
**Why it happens:** Teams stop at code green and postpone documentation.
**How to avoid:** Make 05-02 a planned, required closeout deliverable with explicit field-level checklist.
**Warning signs:** ROADMAP progress row still “Not started”, PROJECT context still references earlier phases.

## Code Examples

Verified patterns from repository sources:

### Existing shell delegation from main orchestrator
```ts
// Source: frontend/src/main.ts
import { showGpsLapVEAnalysis } from './shell/gpsLap';
import { showOutAndBackVEAnalysis } from './shell/outAndBack';
import { prepareAnalysisPayload } from './shell/analysis/prepareAnalysisPayload';
```

### Typed DI seam for shell modules
```ts
// Source: frontend/src/shell/analysis/types.ts
export interface ShellServices {
  appState: AppState;
  showLoading: (message: string) => void;
  hideLoading: () => void;
  showError: (message: string) => void;
}
```

### Guardrail chain command (CI parity)
```bash
# Source: scripts/validate-ui-shell-guardrails.sh
bash scripts/validate-ui-shell-guardrails.sh --ci-only
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Monolithic `main.ts` shell orchestration baseline (historical 7641-line hotspot inventory) | Incremental per-domain shell extraction with DI seams; current measured baseline around 2213 lines pre-Phase-5 completion | Phases 2–4 (2026-04) | Phase 5 can focus on residual closeout instead of foundational architecture |
| Informal behavior memory checks | Formal guardrail script + regression contract + manual checklist | Phase 1 (2026-04) | Safer extraction with repeatable verification |
| Roadmap/progress state lagging implementation | Closeout requires explicit planning/doc sync as deliverable (CLOS-02) | Phase 5 scope | Reduces planning drift for next milestone |

**Deprecated/outdated for this phase:**
- Broad `MapVisualization.ts` refactor in closeout scope (deferred to MAP-01, v2).
- Adding hard numeric `main.ts` ceiling in guardrail CI for Phase 5.

## Open Questions

1. **Final bucket ownership for residual helpers (`shell/*` vs `analysis/` vs `utils/`)**
   - What we know: Context allows discretion but requires purity/domain boundaries.
   - What's unclear: Best final placement for a few small helpers.
   - Recommendation: Decide per-helper using strict rule: DOM-touching → `shell/`, pure math/data → `analysis/`/`utils/`.

2. **Need for targeted new unit tests during extraction**
   - What we know: Existing test infra is healthy; context allows discretionary tests for risky pure extractions.
   - What's unclear: Whether specific helper moves are risky enough to justify new tests.
   - Recommendation: Add focused unit tests only for helpers with tricky indexing/time-range/calculation logic.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Frontend check/lint/test/build | ✓ | v22.20.0 | — |
| npm | Frontend scripts | ✓ | 10.9.3 | — |
| cargo | Backend lib tests | ✓ | 1.90.0 | — |
| rustc | wasm build toolchain | ✓ | 1.90.0 | — |
| wasm-pack | WASM artifact build | ✓ | 0.13.1 | Install via `cargo install wasm-pack` if missing |
| bash | Guardrail/report scripts | ✓ | 3.2.57 | Use newer Homebrew bash only if script features require it |
| rg (ripgrep) | Hotspot/report script searches | ✓ | 15.1.0 | install `ripgrep` if missing |
| wc/grep/sed/awk | Script utilities | ✓ | system tools | — |

**Missing dependencies with no fallback:**
- None.

**Missing dependencies with fallback:**
- None currently missing.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Frontend: Vitest `^3.2.4` (configured in `frontend/vitest.config.ts`); Backend: Rust `cargo test --lib` |
| Config file | `frontend/vitest.config.ts` |
| Quick run command | `cd frontend && npm run test -- src/utils/FileValidation.test.ts` |
| Full suite command | `bash scripts/validate-ui-shell-guardrails.sh --ci-only` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CLOS-01 | `main.ts` becomes composition-root-like and smaller while preserving functionality | Structural + regression (automated + manual architecture review) | `bash scripts/report-ui-shell-hotspots.sh` and `bash scripts/validate-ui-shell-guardrails.sh --ci-only` | ✅ scripts exist |
| CLOS-02 | Docs reflect stabilized shell boundaries/hotspots and requirement traceability | Documentation audit (manual + diff review) | `git diff .planning/ROADMAP.md .planning/PROJECT.md .planning/REQUIREMENTS.md docs/architecture/frontend-ui-shell-extraction-inventory.md` | ❌ dedicated automated doc-lint gate |

### Sampling Rate
- **Per task commit:** `cd frontend && npm run test -- src/utils/FileValidation.test.ts`
- **Per wave merge:** `bash scripts/validate-ui-shell-guardrails.sh --ci-only`
- **Phase gate:** Full suite green + manual `docs/testing/ui-shell-manual-checklist.md` completion for BEHV-01/02/03/04

### Wave 0 Gaps
- [ ] Optional: add a lightweight docs consistency check script for CLOS-02 fields (ROADMAP progress row, PROJECT context/date, REQUIREMENTS traceability statuses)
- [ ] Optional: add focused unit tests for any newly extracted non-trivial pure helper (time-range/index/rho) when risk is identified

## Sources

### Primary (HIGH confidence)
- `.planning/phases/05-closeout-secondary-cleanup-and-roadmap-sync/05-CONTEXT.md` — locked decisions, discretion boundaries, deferred scope
- `.planning/REQUIREMENTS.md` — requirement definitions for CLOS-01/CLOS-02
- `.planning/STATE.md` — current project phase state
- `./GEMINI.md` — project conventions and invariants
- `frontend/src/main.ts` — current residual hotspot anchors and extraction targets
- `frontend/src/shell/**` — established shell patterns (DI seams, modular structure)
- `scripts/validate-ui-shell-guardrails.sh` — CI parity validation chain
- `scripts/report-ui-shell-hotspots.sh` — hotspot baseline metric source
- `docs/testing/ui-shell-manual-checklist.md` and `docs/testing/ui-shell-regression-contract.md` — behavior-preservation contract
- `docs/architecture/frontend-ui-shell-extraction-inventory.md` — stale baseline and expected refresh fields
- `.planning/ROADMAP.md`, `.planning/PROJECT.md` — doc sync targets and current stale sections

### Secondary (MEDIUM confidence)
- npm registry CLI verification via `npm view <pkg> version` and `npm view <pkg> time` for TypeScript/Vite/Vitest/ESLint/jsdom/typescript-eslint (executed 2026-04-19)

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — based on repo-locked tooling + live npm registry checks.
- Architecture: **HIGH** — based on explicit phase decisions and current module/script evidence.
- Pitfalls: **HIGH** — directly derived from locked constraints, regression docs, and known stale-doc risk.

**Research date:** 2026-04-19  
**Valid until:** 2026-05-19 (30 days, unless toolchain/docs shift earlier)
