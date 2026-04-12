# Historical Implementation Notes (Archived)

This file is intentionally retained as a historical marker, not as current project documentation.

## Important

The early implementation notes and phase-by-phase migration planning that once lived in the top-level docs no longer describe the current codebase accurately.

Use these files instead:

- [README.md](README.md) — current project overview
- [ARCHITECTURE.md](ARCHITECTURE.md) — current module layout and runtime boundary
- [PROJECT_STATUS.md](PROJECT_STATUS.md) — implementation snapshot
- [ROADMAP.md](ROADMAP.md) — current direction
- [REFACTORING_REPORT.md](REFACTORING_REPORT.md) — engineering review
- [REFACTORING_CHECKLIST.md](REFACTORING_CHECKLIST.md) — active refactor execution list

## What changed since the early implementation phase

The project has moved well beyond the original “first implementation” stage:

- real FIT parsing replaced early demo-oriented scaffolding
- VE analysis now includes standard, GPS-lap, and out-and-back workflows
- DEM correction and local persistence are implemented
- frontend linting, tests, and CI checks are in place
- the frontend and backend have both undergone substantial refactoring

If you need the exact historical state, use the Git history rather than treating old prose docs as a source of truth.
