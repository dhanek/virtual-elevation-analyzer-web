# Stack Research

**Domain:** Brownfield frontend UI-shell stabilization for a browser-first TypeScript + Rust/WASM analysis app
**Researched:** 2026-04-12
**Confidence:** HIGH

## Recommended Stack

For this project, the recommendation is **continuity over churn**: keep the current browser-first TypeScript/Vite + Rust/WASM stack, and add only the minimum tooling needed to make UI-shell extraction safer.

The goal of this phase is not to modernize every dependency. It is to reduce UI-shell risk while preserving working behavior. That means the recommended stack is mostly the **existing stack**, with optional browser-level regression tooling added only if it materially protects fragile workflows.

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
| ---------- | ------- | ------- | --------------- |
| TypeScript | 6.0.x (`npm view typescript version` → `6.0.2`) | Typed frontend modules and safe extraction seams | This phase is dominated by moving logic across files; strong typing is the cheapest guardrail against accidental interface drift. |
| Vite | 8.0.x (`npm view vite version` → `8.0.8`) | Dev server and production build for the static frontend shell | Vite remains the right choice for a browser-only app; official docs continue to emphasize fast native-ESM development and a consistent plugin/build pipeline. |
| Rust 2021 + wasm-bindgen | current repo baseline | Stable compute core for FIT parsing, VE math, DEM processing, and air-density logic | The backend is not the problem this phase is solving. Keep the WASM boundary stable and avoid backend churn. |
| Leaflet | 1.9.4 (`npm view leaflet version` → `1.9.4`) | Interactive route/map UI | Already in use, mature, and sufficient. No value in changing mapping libraries during shell stabilization. |
| Plotly.js integration | keep current pinned integration during phase | VE and supplementary plots | Plotly’s own docs emphasize `Plotly.react` / `restyle` / `relayout` for efficient updates; the key improvement here is usage pattern, not library replacement. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
| ------- | ------- | ------- | ----------- |
| Vitest | 4.1.x latest (`npm view vitest version` → `4.1.4`) | Unit tests for extracted helpers and controllers | Keep the current Vitest baseline; upgrade only if needed. Use it for pure helpers and light controller logic that does not require a real browser. |
| `@playwright/test` | 1.59.x (`npm view @playwright/test version` → `1.59.1`) | Browser-level regression coverage for fragile flows | Add if the phase introduces smoke tests for file-load, tab preservation, scroll preservation, and GPS update flows. This is the highest-value optional addition for stabilization. |
| `@vitest/browser-playwright` | 4.1.x (`npm view @vitest/browser-playwright version` → `4.1.4`) | Vitest browser mode with Playwright provider | Use only if the team wants browser-mode tests within the Vitest ecosystem rather than separate Playwright suites. |
| ESLint | 10.2.x latest (`npm view eslint version` → `10.2.0`) | Policy enforcement for logging and structural hygiene | Do not make an ESLint-major upgrade a goal of this phase. Keep lint enforcement active; only upgrade if already needed for unrelated maintenance. |
| browser-fs-access | 0.38.0 (`npm view browser-fs-access version` → `0.38.0`) | Browser save/export flows | Existing integration is current enough and unrelated to the stabilization target. Keep as-is. |

### Development Tools

| Tool | Purpose | Notes |
| ---- | ------- | ----- |
| `tsc --noEmit` | Catch interface drift during extraction | Mandatory on every checkpoint because this phase creates many new module boundaries. |
| CI parity build pipeline | Protect runtime behavior while refactoring | Keep the current sequence: `cargo test`, `wasm-pack build`, `frontend check`, `lint`, `test`, `build`. |
| Playwright trace viewer | Diagnose browser-only regressions | If Playwright is added, traces are especially valuable for scroll/tab/file-upload regressions that are hard to infer from logs. |
| targeted profiling script | Prevent premature workerization | The repo already has `frontend/scripts/profile-slider-recompute.ts`; continue using measurement before concurrency changes. |

## Installation

```bash
# Keep current core stack (brownfield - no forced stack swap)
# Existing repo already has TypeScript, Vite, Vitest, ESLint, Leaflet

# Optional browser regression layer if added during stabilization
cd frontend
npm install -D @playwright/test
# or, if browser-mode Vitest is preferred
npm install -D @vitest/browser-playwright
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
| ----------- | ----------- | ----------------------- |
| Keep framework-free TypeScript shell | Migrate to React/Vue/Svelte | Only if the product is explicitly choosing a UI-platform rewrite. That is out of scope for this stabilization phase. |
| Add targeted Playwright smoke tests | Stay with node-only unit tests | Acceptable only if the roadmap keeps refactors very conservative. Browser-only regressions are otherwise too easy to miss in this repo. |
| Continue Vite build/dev flow | Switch bundlers/toolchains during refactor | Not recommended. Toolchain migration would make it harder to attribute regressions to shell refactors. |
| Keep current Plotly/Leaflet integrations and improve their adapters | Replace chart/map libraries | Only if the product is already planning a redesign. Not justified for a structural safety phase. |

## What NOT to Use

| Avoid | Why | Use Instead |
| ----- | --- | ----------- |
| Framework migration during this phase | It turns a targeted stabilization effort into a rewrite and muddies regression attribution | Keep `main.ts` as a composition root and extract smaller shell modules around it |
| Large DI/container framework | Adds ceremony without solving the actual problem, which is concentrated DOM/event/template logic | Use explicit factories, module-local helpers, and narrow controller constructors |
| Big-bang state rewrite | `AppState` is already a deliberate state-only seam; rewriting it now increases risk with little gain | Preserve `AppState` and extract UI responsibilities around it |
| Worker/offload work without fresh profiling | The repo already profiled the compute core and found no strong worker case on this machine | Finish UI-shell stabilization first, then re-profile if latency remains |
| Plot redraw-by-recreation everywhere | Plotly docs explicitly say `Plotly.react` is far more efficient than repeatedly replacing a plot with `newPlot` | Prefer `react`, `restyle`, and `relayout` style updates where lifecycle permits |

## Stack Patterns by Variant

**If the phase stays purely structural:**
- Keep the current dependency set
- Add no new runtime libraries
- Focus on file/module decomposition, DOM helper extraction, and CI parity validation

**If the phase adds browser regression protection:**
- Add Playwright or Vitest Browser Mode with Playwright provider
- Use a few high-value smoke flows only
- Focus on regression-sensitive workflows, not exhaustive end-to-end coverage

**If `MapVisualization.ts` becomes touched by necessity:**
- Keep Leaflet as-is
- Extract lifecycle helpers and cleanup utilities rather than replacing the map layer
- Prefer explicit mount/update/unmount seams over new abstraction layers

## Version Compatibility

| Package A | Compatible With | Notes |
| --------- | --------------- | ----- |
| `typescript@6.0.x` | `vite@8.0.x` | Current ecosystem pairing is healthy and already close to the repo’s baseline. |
| `vitest@4.1.x` | `vite@8.0.x` | Vitest continues to sit naturally on top of Vite’s config model. |
| `@vitest/browser-playwright@4.1.x` | `vitest@4.1.x`, Playwright provider | Useful if browser-mode tests are desired without switching test runner conventions. |
| `@playwright/test@1.59.x` | static Vite-served frontend | Good fit for true browser workflows, file uploads, and regression traces. |
| `leaflet@1.9.4` | current TypeScript setup | Existing repo dependency is current and should remain stable during this phase. |

## Sources

- `https://vite.dev/guide/why` - verified Vite’s current emphasis on native-ESM dev serving, plugin ecosystem continuity, and production bundling
- `https://vitest.dev/guide/` - verified Vitest’s current Vite-native workflow and config relationship
- `https://vitest.dev/guide/browser/` - verified current browser-mode + Playwright-provider support
- `https://playwright.dev/docs/best-practices` - verified current recommendations around isolation, resilient locators, and trace-based debugging
- `https://plotly.com/javascript/plotlyjs-function-reference/` - verified `Plotly.react` / `restyle` / `relayout` efficiency guidance
- `https://leafletjs.com/reference.html` - verified event/listener cleanup and layer-removal API surface
- npm registry lookups on 2026-04-12 for: `vite`, `typescript`, `vitest`, `eslint`, `@playwright/test`, `@vitest/browser-playwright`, `leaflet`, `browser-fs-access`
- `.planning/PROJECT.md` and `.planning/codebase/{ARCHITECTURE,STACK,CONCERNS}.md` - brownfield repo context and existing constraints

---
*Stack research for: brownfield frontend UI-shell stabilization*
*Researched: 2026-04-12*
