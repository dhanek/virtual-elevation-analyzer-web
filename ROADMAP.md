# Roadmap

Snapshot updated: 2026-04-12

## Guiding principles

- Keep ride processing local to the browser
- Prefer incremental refactors over rewrites
- Improve correctness and maintainability before adding expensive architecture
- Add concurrency only when profiling shows it is needed

## Near-term engineering roadmap

### 1. Finish the current refactoring checklist

The active cleanup plan is tracked in [REFACTORING_CHECKLIST.md](REFACTORING_CHECKLIST.md).

Remaining items after the current documentation refresh are:
- replace remaining magic numbers with named local constants
- remove leftover lifecycle guard flags and write-only globals once mode lifecycle is fully encapsulated
- profile slider recompute paths and only add a Web Worker if the data justifies it

### 2. Continue shrinking `frontend/src/main.ts`

The biggest remaining frontend issue is still concentration of UI composition and event wiring in `main.ts`.

Expected next direction:
- extract larger HTML/template sections into focused UI modules
- move repetitive event setup out of the root file
- reduce direct DOM querying from the top-level controller

### 3. Expand automated test coverage

High-value targets include:
- additional frontend tests around selection/mode behavior
- backend DEM parsing/projection regression tests
- more analysis regression cases beyond the current VE and utility coverage

## Product roadmap

### Improve analysis ergonomics

Potential next product-facing improvements:
- better result browsing and comparison workflows
- clearer storage/export UX for saved analyses
- improved feedback around DEM/weather source selection and fallbacks

### Improve documentation and contributor onboarding

Now that the top-level docs are split, the next improvements are:
- keep docs aligned with the real codebase after each major refactor
- add more contributor-focused examples where the architecture is non-obvious

## Deliberate non-goals right now

These are intentionally not current priorities:

- rewriting the frontend into a different framework
- adding a server backend for ride processing
- introducing a Web Worker before profiling confirms it is worth the complexity
- expanding the public feature list faster than the codebase can be stabilized

## Source of truth

For the current implementation snapshot, see [PROJECT_STATUS.md](PROJECT_STATUS.md).

For the detailed engineering review that shaped this roadmap, see [REFACTORING_REPORT.md](REFACTORING_REPORT.md).
