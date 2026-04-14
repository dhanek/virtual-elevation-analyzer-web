# Project Research Summary

**Project:** Virtual Elevation Analyzer Web
**Domain:** Brownfield frontend UI-shell stabilization for a browser-first TypeScript + Rust/WASM analysis app
**Researched:** 2026-04-12
**Confidence:** HIGH

## Executive Summary

This project is not a greenfield product build. It is a **targeted stabilization initiative** for an already-working browser-based virtual elevation analyzer. Research strongly supports a conservative approach: keep the existing TypeScript/Vite + Rust/WASM stack, treat `frontend/src/main.ts` as a composition-root candidate rather than a rewrite trigger, and use incremental feature-shell extraction instead of a framework migration or broad architectural reset.

The recommended approach is to extract the remaining UI shell around explicit seams: Section 3 workflow wiring, standard VE panel rendering/updating, GPS-lap shell behavior, out-and-back shell behavior, and shared DOM/event/template helpers. `frontend/src/components/MapVisualization.ts` should remain secondary unless touching it clearly simplifies the primary `main.ts` reduction.

The main risks are not missing infrastructure or outdated fundamentals. They are **behavior drift**, **DOM/event lifecycle bugs**, and **false confidence from node-only tests**. The phase should therefore emphasize explicit regression-sensitive invariants, CI parity, and a small amount of browser-level smoke coverage if scope permits.

## Key Findings

### Recommended Stack

Research points to **stack continuity, not stack replacement**.

The current browser-first TypeScript/Vite frontend and Rust/WASM compute core remain the right foundation. Official Vite docs still support its role as the standard fast static frontend toolchain, and official Plotly/Leaflet docs reinforce that the right move here is better lifecycle usage, not chart/map replacement.

**Core technologies:**
- **TypeScript 6.0.x:** typed extraction seams and safer refactors
- **Vite 8.0.x:** stable static frontend dev/build pipeline
- **Rust 2021 + wasm-bindgen:** preserve the working compute core instead of re-opening backend scope
- **Leaflet 1.9.4 / existing Plotly integration:** keep current map/chart libraries and improve usage patterns where needed

### Expected Features

For this project, the “features” of the phase are stabilization capabilities rather than net-new product features.

**Must have (table stakes):**
- Behavior-preserving refactor - users should not pay for cleaner files with broken flows
- Smaller, clearer `main.ts` responsibilities - the primary risk reduction target
- Extracted shell seams for Section 3, standard VE, GPS-lap, and out-and-back workflows
- CI-safe validation after checkpoints - required to make the refactor trustworthy

**Should have (competitive):**
- Shared DOM/template/event helper seams
- A few browser smoke tests for fragile workflows
- Optional secondary `MapVisualization.ts` cleanup if clearly beneficial

**Defer (v2+):**
- Framework migration
- Worker/offload work without fresh profiling
- Broad UI redesign or unrelated feature expansion

### Architecture Approach

Research supports a four-layer mental model for the stabilized frontend:

1. **`main.ts` as composition root** - creates dependencies, delegates, and stops owning every workflow detail
2. **Feature shell modules** - own one area of browser-only lifecycle behavior each
3. **Thin adapter/helpers layer** - centralizes Plotly/Leaflet lifecycle policy plus repeated DOM glue
4. **Existing state/domain/services layer** - remains in `AppState`, `analysis/*`, `activity/*`, `modes/*`, and `utils/*`

**Major components:**
1. **Composition root** - app bootstrap and top-level wiring
2. **Feature shell controllers** - Section 3, standard VE, GPS-lap, out-and-back
3. **DOM/plot/map adapters** - repeated UI lifecycle logic and third-party boundaries
4. **State/domain/services** - existing typed state, analysis logic, storage, and WASM integration

### Critical Pitfalls

1. **Big-bang rewrite disguised as refactor** - avoid by using staged extraction and explicit scope boundaries
2. **Behavior drift while moving code** - avoid by naming regression-sensitive flows up front and checking them continuously
3. **Event-listener duplication and stale closures** - avoid by separating render/bind/update and using explicit lifecycle seams
4. **Plotly / Leaflet lifecycle leaks** - avoid by centralizing update and cleanup policy
5. **Node-only tests giving false confidence** - avoid with small browser-level smoke coverage where the ROI is highest

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Guardrails and Shell Seams
**Rationale:** Behavior preservation has to come before aggressive extraction.
**Delivers:** Explicit invariants, target shell boundaries, and the first decomposition of `main.ts` into clearer responsibilities.
**Addresses:** behavior-preserving refactor, regression protection, CI-safe stabilization
**Avoids:** big-bang rewrite drift and false confidence from weak verification

### Phase 2: Extract Analysis Panels and Shared UI Helpers
**Rationale:** Once guardrails exist, the main payoff comes from moving Section 3 / standard VE / GPS / out-and-back shell code into narrower modules.
**Delivers:** Most of the actual `main.ts` size/risk reduction plus reusable DOM/event/template seams.
**Uses:** existing TypeScript/Vite shell, analysis helpers, plot builders, and mode handlers
**Implements:** feature shell layer and thin adapter/helper boundaries

### Phase 3: Secondary Hotspot Follow-Up and Roadmap Sync
**Rationale:** Optional cleanup should only happen after the main shell is materially safer.
**Delivers:** selective `MapVisualization.ts` cleanup if justified, remaining browser smoke additions, and planning/doc sync such as `ROADMAP.md` updates.
**Uses:** the new shell boundaries created earlier
**Implements:** only the secondary work that clearly supports future UI-heavy changes

### Phase Ordering Rationale

- Guardrails come first because the main risk is regression, not lack of architecture ideas.
- Panel extraction comes second because it is the biggest structural payoff once invariants are known.
- Secondary hotspot cleanup comes last so it cannot hijack the primary stabilization goal.
- Browser smoke coverage should start as early as it becomes useful, but only for the highest-risk flows.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2:** exact module split for Section 3 / VE / GPS / out-and-back shell code should stay flexible and respond to code seams found during planning
- **Phase 3:** whether touching `MapVisualization.ts` is worth it depends on what remains after the main-shell extraction

Phases with standard patterns (skip research-phase):
- **Phase 1:** guardrails, invariants, validation, and composition-root narrowing are well-understood brownfield patterns

## Confidence Assessment

| Area | Confidence | Notes |
| ---- | ---------- | ----- |
| Stack | HIGH | Mostly continuity decisions, supported by official docs and current repo context |
| Features | HIGH | The required stabilization capabilities are clear from the repo state and recent regression history |
| Architecture | HIGH | The main architectural move is incremental shell extraction, not speculative redesign |
| Pitfalls | HIGH | The likely failure modes are strongly supported by the repo’s current hotspots and the nature of framework-free DOM orchestration |

**Overall confidence:** HIGH

### Gaps to Address

- **Browser test ROI:** decide during planning whether to add Playwright/browser-mode tests in this phase or rely on stricter manual + CI verification
- **Map secondary scope:** decide after Phase 2 planning whether `MapVisualization.ts` work clearly supports the main stabilization outcome
- **Exact shell module boundaries:** keep flexible during planning rather than locking an exact file map too early

## Sources

### Primary (HIGH confidence)
- `.planning/PROJECT.md` - active scope, invariants, and constraints
- `.planning/codebase/ARCHITECTURE.md` - current architecture and hotspot distribution
- `.planning/codebase/CONCERNS.md` - current risk profile
- `https://vite.dev/guide/why` - current Vite architecture rationale
- `https://vitest.dev/guide/browser/` - current browser-testing integration options
- `https://playwright.dev/docs/best-practices` - resilient browser regression testing guidance
- `https://plotly.com/javascript/plotlyjs-function-reference/` - plot lifecycle/update guidance
- `https://leafletjs.com/reference.html` - map lifecycle/listener cleanup guidance

### Secondary (MEDIUM confidence)
- npm registry version lookups for `vite`, `typescript`, `vitest`, `eslint`, `@playwright/test`, `@vitest/browser-playwright`, `leaflet`, `browser-fs-access`
- existing repo metrics and regression history captured during the brownfield audit

### Tertiary (LOW confidence)
- general brownfield frontend refactor practice based on accumulated engineering experience rather than a single official standard

---
*Research completed: 2026-04-12*
*Ready for roadmap: yes*
