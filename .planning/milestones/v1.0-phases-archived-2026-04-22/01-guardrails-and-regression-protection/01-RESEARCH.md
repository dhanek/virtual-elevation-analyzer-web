# Phase 1: Guardrails and Regression Protection - Research

**Researched:** 2026-04-12
**Domain:** Brownfield frontend UI-shell stabilization for a framework-free TypeScript + Rust/WASM web app
**Confidence:** HIGH

## User Constraints (from CONTEXT.md)

### Regression-sensitive behavior
- **D-01:** Preserve auto-scroll to Analysis Parameters after a successful FIT or CSV file load. This behavior must be explicitly named in the guardrails, not treated as an implied side effect.
- **D-02:** Preserve in-place GPS auto-adjust and slider updates without resetting the active tab or scroll position.
- **D-03:** Preserve correct GPS-based air-speed calibration behavior across GPS lap, GPS gate one-way, and out-and-back modes.

### Scope and architecture boundaries
- **D-04:** Keep this phase focused on guardrails, verification, and extraction inventory. Do **not** turn Phase 1 into the main `main.ts` extraction wave.
- **D-05:** Keep `AppState` state-only. Do not move DOM nodes or service singletons into it while preparing shell seams.
- **D-06:** Keep existing analysis math, WASM interfaces, plot builders, and mode-handler architecture stable unless a very thin seam absolutely requires a change.
- **D-07:** Treat `frontend/src/components/MapVisualization.ts` as secondary only. Touch it in this milestone only when it clearly supports the main shell stabilization path.

### Validation strategy
- **D-08:** CI parity remains the default checkpoint contract: `cargo test --lib`, `wasm-pack build`, `npm run check`, `npm run lint`, `npm run test`, and `npm run build`.
- **D-09:** A lightweight, repeatable regression path is preferred over a large new testing subsystem in Phase 1. Browser smoke coverage is allowed later if the manual/scripted path proves too brittle.

### the agent's Discretion
- Exact naming and placement of guardrail/inventory documents
- Whether the repeatable regression path is best expressed as docs only, docs plus scripts, or docs plus very lightweight helper tooling
- How to present the first shell extraction inventory so later phases can consume it cleanly

### Deferred Ideas
- Browser-level smoke coverage with Playwright or Vitest Browser Mode if the lightweight Phase 1 regression path proves insufficient
- Real `frontend/src/main.ts` shell extraction work (reserved for later phases)
- Larger `MapVisualization.ts` cleanup unless Phase 1 discovers a very small change that clearly unlocks later extraction work
- Broad docs sync across `ARCHITECTURE.md` / `ROADMAP.md` beyond what Phase 1 needs to make guardrails usable

## Project Constraints (from GEMINI.md)

- Keep `AppState` state-only; do not move DOM nodes or service singletons into it
- Prefer extracted function-oriented modules for domain logic and shell helpers
- Keep plot builders pure where possible; keep DOM/Plotly wiring thin
- Use `frontend/src/utils/log.ts` instead of raw `console.*`
- Preserve existing analysis math, WASM interfaces, and mode-handler behavior unless a thin seam absolutely requires change
- Do not bypass current stabilization invariants: auto-scroll after file load, in-place GPS updates with tab/scroll retention, correct GPS air-speed calibration behavior

## Summary

Phase 1 should **not** attempt the main `frontend/src/main.ts` extraction yet. Research supports a lower-risk first move: codify the fragile browser behaviors as an explicit regression contract, create a repeatable verification path that wraps the existing CI parity plus manual browser checks, and generate a durable hotspot/seam inventory that later extraction phases can consume.

The most important finding is that the repo already has the hard architectural preconditions for a focused stabilization phase: typed `AppState`, extracted analysis helpers, mode handlers, plot builders, lint/test/type/build gates, and a documented list of actual `main.ts` hotspots. What it still lacks is an easy, repeatable way to protect fragile UX behavior and a stable artifact that tells later phases exactly what to extract next.

**Primary recommendation:** In Phase 1, prefer **guardrail docs + lightweight validation/inventory scripts** over adding a large new browser-testing stack. Keep browser smoke automation explicitly optional unless the scripted/manual verification path proves insufficient during execution.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 6.0.2 | Typed implementation of lightweight helper scripts or shell-prep utilities | Existing repo baseline; ideal for low-risk refactor support tooling |
| Vite | 8.0.8 | Existing frontend dev/build pipeline | Already the repo standard and sufficient for Phase 1 tooling |
| Vitest | 4.1.4 | Existing lightweight unit-test runner | Good for helper-level validation if Phase 1 adds any pure utility logic |
| Rust + wasm-pack | cargo 1.90.0 / wasm-pack 0.13.1 | Existing backend/WASM validation boundary | CI parity already depends on this path; Phase 1 should wrap it, not replace it |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ESLint | 10.2.0 (latest) / repo on 9.39.1 | Static guardrail on frontend code | Keep current repo baseline; Phase 1 should use lint, not upgrade lint stack |
| Bash shell script | system | Low-cost orchestration of cross-tool validation | Best fit for a single command that chains backend + frontend validation and then prints manual verification steps |
| Node built-ins | Node 22.20.0 | Optional low-dependency file/report generation | Useful if a report script is easier in JS/TS than in shell, but avoid adding packages just for inventory reporting |
| `@playwright/test` | 1.59.1 | Optional browser smoke automation | Defer unless execution shows the scripted/manual verification path is too brittle |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Lightweight shell/docs guardrails | Add Playwright immediately | Stronger browser automation, but adds toolchain overhead before proving need |
| Repo script + docs | Pure manual checklist only | Lowest implementation cost, but more likely to drift or be skipped |
| Simple shell/Node hotspot report | Full AST/code-mod planning tool | More automation, but too heavy for a guardrail-only first phase |

**Installation:**
```bash
# No new dependency is required for the primary Phase 1 recommendation.
# Optional future browser smoke path:
cd frontend
npm install -D @playwright/test
```

**Version verification:**
- `npm view typescript version` → `6.0.2`
- `npm view vite version` → `8.0.8`
- `npm view vitest version` → `4.1.4`
- `npm view eslint version` → `10.2.0`
- `npm view @playwright/test version` → `1.59.1`

## Architecture Patterns

### Recommended Project Structure

```text
.planning/phases/01-guardrails-and-regression-protection/
├── 01-CONTEXT.md
├── 01-RESEARCH.md
├── 01-VALIDATION.md
└── 01-0X-PLAN.md

docs/
├── testing/
│   ├── ui-shell-regression-contract.md
│   └── ui-shell-manual-checklist.md
└── architecture/
    └── frontend-ui-shell-extraction-inventory.md

scripts/
├── validate-ui-shell-guardrails.sh
└── report-ui-shell-hotspots.sh
```

### Pattern 1: Contract Before Movement
**What:** Document the exact behaviors that later refactors must preserve before starting the real extraction work.
**When to use:** When the most expensive failures are subtle behavior regressions rather than missing implementation ideas.
**Example:** Create a guardrail doc that explicitly names the auto-scroll flow, GPS in-place tab/scroll preservation, and GPS calibration semantics, with links back to the source files/functions currently implementing them.

### Pattern 2: Scripted CI + Manual Browser Checks
**What:** Wrap the already-trusted automated validation commands in a single repeatable script, then pair that with a short manual browser checklist for the fragile flows automation does not yet cover.
**When to use:** When browser smoke automation would be useful eventually, but a low-cost repeatable path is needed first.
**Example:** A repo-level validation script that runs backend tests, wasm build, frontend check/lint/test/build, then prints or points to a manual checklist for auto-scroll and GPS in-place behaviors.

### Pattern 3: Inventory as a Planning Artifact
**What:** Capture the current hotspot map and target ownership boundaries in a durable artifact before extraction starts.
**When to use:** When later phases would otherwise keep re-measuring and re-discovering the same large functions and DOM-heavy areas.
**Example:** A hotspot script/report that records current `main.ts` size, DOM wiring counts, and the exact functions slated for later extraction.

### Anti-Patterns to Avoid
- **Big-bang extraction in Phase 1:** defeats the purpose of guardrails-first sequencing
- **Playwright-by-default before proving need:** adds toolchain cost before determining whether docs/scripts are sufficient
- **Checklist hidden only in chat memory:** violates `STAB-01`; the verification path must live in committed artifacts
- **Inventory phrased as “main.ts is too big”:** too vague to guide later extraction work

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-tool validation runner | Custom JS task runner with its own dependency graph | Simple shell script wrapping existing repo commands | The repo already trusts bash scripts like `build.sh`; no need for a new orchestration subsystem |
| Browser automation immediately | Full new e2e framework setup by default | Scripted CI parity + documented browser checks first | Lower cost and aligned with the user's structural-first scope |
| Extraction planning memory | Implicit hotspot knowledge in chat or commit messages | Regenerated hotspot/inventory artifact | Future phases need a stable reference they can read directly |

**Key insight:** Phase 1 should reuse the repo’s current validation/build surface and add thin wrappers/documents around it, not invent new systems.

## Runtime State Inventory

> This phase is a refactor-preparation phase, so runtime-state categories were checked explicitly.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 1 does not rename persisted keys, collections, or browser storage schema | None |
| Live service config | None — no external dashboard/service configuration needs to change for guardrail docs/scripts | None |
| OS-registered state | None — no launchd/systemd/pm2/task-scheduler state is affected by this phase | None |
| Secrets/env vars | None — Phase 1 does not change secret names or environment variable contracts | None |
| Build artifacts | None beyond normal repo builds — validation scripts should use existing commands and not require renamed installed artifacts | None |

## Common Pitfalls

### Pitfall 1: Guardrails That Are Too Vague
**What goes wrong:** The docs say “preserve GPS behavior” without naming which modes, which actions, or what visible behavior matters.
**Why it happens:** Teams assume everyone remembers the fragile paths.
**How to avoid:** Name the exact flows and point to current source anchors.
**Warning signs:** Guardrail docs contain generic phrasing and no function/file anchors.

### Pitfall 2: Validation Path Nobody Runs
**What goes wrong:** The contract exists, but the validation sequence is long, inconsistent, or scattered across too many docs.
**Why it happens:** Validation is documented but not operationalized.
**How to avoid:** Provide one command and one short checklist.
**Warning signs:** Contributors keep asking “what should I run before refactor?”

### Pitfall 3: Inventory Without Ownership Guidance
**What goes wrong:** A hotspot report measures size but doesn’t say which future module should own what.
**Why it happens:** Metrics are easier to gather than decomposition guidance.
**How to avoid:** Pair quantitative hotspots with proposed ownership buckets like Section 3, standard VE, GPS-lap, out-and-back, and shared DOM helpers.
**Warning signs:** Later phases still need a fresh discussion to decide basic extraction targets.

## Code Examples

Verified patterns from current repo conventions:

### Existing CI parity chain
```bash
cd backend && cargo test --lib
cd backend && wasm-pack build --target web --out-dir ../frontend/pkg
cd frontend && npm run check
cd frontend && npm run lint
cd frontend && npm run test
cd frontend && npm run build
```
Source: `.github/workflows/deploy.yml`

### Existing lightweight engineering script precedent
```typescript
// Existing repo precedent:
// frontend/scripts/profile-slider-recompute.ts
// - runs from package scripts
// - reuses existing app modules
// - exists to make a future architectural decision concrete
```
Source: `frontend/scripts/profile-slider-recompute.ts`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| “Refactor first, test later” | Guardrails/invariants before high-risk extraction | current repo strategy after the major refactor wave | Reduces regression churn in large brownfield shells |
| Raw console/debugging sprawl | Centralized logging + lint enforcement | completed in earlier refactor checklist work | Phase 1 can assume a cleaner diagnostic baseline |
| One-file analysis shell | Partial modularization with remaining `main.ts` hotspot | already underway in current repo | Phase 1 should finish the preparation layer before deeper moves |

**Deprecated/outdated:**
- Treating `REFACTORING_REPORT.md` as the live ground truth — current planning artifacts and codebase map are now more accurate
- Assuming browser-only regressions can be inferred from node-only tests — current repo evidence says they need explicit treatment

## Open Questions

1. **Should Phase 1 add browser smoke automation now or defer it?**
   - What we know: Playwright would improve confidence, but the current user scope prefers lightweight structural work first
   - What's unclear: whether the scripted/manual path will prove sufficient once execution begins
   - Recommendation: Defer full browser automation unless the Phase 1 execution reveals the manual/scripted path is too fragile

2. **Should the hotspot inventory be a doc only or a doc plus regenerating script?**
   - What we know: the repo already values measurement scripts when they guide architectural decisions
   - What's unclear: how often the inventory will need regeneration during this milestone
   - Recommendation: Prefer doc + simple report script so later phases can re-check progress objectively

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | root/frontend scripts | ✓ | `v22.20.0` | — |
| npm | frontend validation and any new scripts | ✓ | `10.9.3` | — |
| cargo | backend test gate | ✓ | `cargo 1.90.0` | — |
| wasm-pack | wasm build gate | ✓ | `0.13.1` | — |
| Vitest config | frontend quick validation | ✓ | `frontend/vitest.config.ts` | — |
| ESLint config | frontend lint gate | ✓ | `frontend/eslint.config.js` | — |
| Browser smoke framework | optional future automation | ✗ | — | use scripted/manual browser checks first |

**Missing dependencies with no fallback:**
- None for the primary Phase 1 recommendation

**Missing dependencies with fallback:**
- Playwright/browser smoke tooling → fallback is scripted CI parity + manual checklist path

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Existing mixed validation stack: Rust test harness + wasm-pack + TypeScript typecheck + ESLint + Vitest + Vite build |
| Config file | `frontend/vitest.config.ts`, `frontend/eslint.config.js`, `.github/workflows/deploy.yml` |
| Quick run command | `cd frontend && npm run test` |
| Full suite command | `cd backend && cargo test --lib && cd backend && wasm-pack build --target web --out-dir ../frontend/pkg && cd frontend && npm run check && npm run lint && npm run test && npm run build` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| STAB-01 | Repeatable regression verification path exists for fragile UI-shell flows | script + manual checklist | `MISSING — Plan 01-02 should create scripts/validate-ui-shell-guardrails.sh` | ❌ Wave 2 |
| STAB-02 | CI parity remains the default checkpoint contract | integration/build | `cd backend && cargo test --lib && cd backend && wasm-pack build --target web --out-dir ../frontend/pkg && cd frontend && npm run check && npm run lint && npm run test && npm run build` | ✅ |

### Sampling Rate
- **Per task commit:** `cd frontend && npm run test`
- **Per wave merge:** `cd backend && cargo test --lib && cd backend && wasm-pack build --target web --out-dir ../frontend/pkg && cd frontend && npm run check && npm run lint && npm run test && npm run build`
- **Phase gate:** full suite green plus explicit manual checks for auto-scroll, GPS in-place updates, and GPS calibration behavior

### Wave 0 Gaps
- [ ] `scripts/validate-ui-shell-guardrails.sh` — reusable regression path wrapper for `STAB-01`
- [ ] Guardrail checklist doc — manual browser checks should be explicit and committed, not left in chat memory
- [ ] Hotspot inventory artifact — later extraction phases need a committed extraction target map

## Sources

### Primary (HIGH confidence)
- `.planning/phases/01-guardrails-and-regression-protection/01-CONTEXT.md` - locked phase decisions and scope
- `.planning/PROJECT.md` - milestone constraints and active goals
- `.planning/ROADMAP.md` - Phase 1 goal, success criteria, and planned slots
- `.planning/REQUIREMENTS.md` - `STAB-01`, `STAB-02`
- `.planning/STATE.md` - current milestone context and concerns
- `.planning/research/SUMMARY.md` - project-level stabilization research
- `.planning/codebase/CONCERNS.md` - measured hotspots and testing weakness
- `.github/workflows/deploy.yml` - actual CI parity commands
- `package.json` and `frontend/package.json` - current script surface
- `frontend/src/main.ts` - fragile browser flow implementation anchors
- `frontend/src/analysis/AirSpeedCalibration.ts` - GPS calibration behavior anchor
- `frontend/src/analysis/MultiSegmentSettings.ts` - GPS settings persistence anchor
- `frontend/src/modes/analysis/AnalysisModes.ts` - mode-routing anchor
- `frontend/scripts/profile-slider-recompute.ts` - precedent for lightweight decision-support tooling

### Secondary (MEDIUM confidence)
- `https://playwright.dev/docs/best-practices` - browser smoke testing guidance if automation becomes necessary later
- `https://vitest.dev/guide/browser/` - browser mode option if the repo wants to stay close to Vitest later

### Tertiary (LOW confidence)
- general brownfield refactor guardrail practice derived from prior project experience

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - mostly continuity and verified versions/availability
- Architecture: HIGH - directly grounded in repo-specific hotspot data
- Pitfalls: HIGH - strongly aligned with current repo risks and prior regression history

**Research date:** 2026-04-12
**Valid until:** 2026-05-12
