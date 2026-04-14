---
phase: 01-guardrails-and-regression-protection
plan: 03
subsystem: ui
tags: [docs, scripts, hotspot-report, ui-shell]
requires: []
provides:
  - Regeneratable hotspot report for the current frontend UI shell
  - Committed extraction inventory that maps remaining hotspots to future shell ownership buckets
affects: [phase-02, phase-03, phase-04, ui-shell]
tech-stack:
  added: []
  patterns: [baseline-report-script, extraction-inventory]
key-files:
  created:
    - scripts/report-ui-shell-hotspots.sh
    - docs/architecture/frontend-ui-shell-extraction-inventory.md
  modified: []
key-decisions:
  - "Keep the hotspot report dependency-free and explicitly scoped to frontend/src/main.ts"
  - "Assign hotspots to future ownership buckets instead of recording size metrics alone"
patterns-established:
  - "Measurement before movement: later phases can regenerate the shell baseline instead of reusing stale anecdotes"
  - "Ownership-bucket planning: hotspot functions are grouped by the shell module that should eventually own them"
requirements-completed: [STAB-01]
duration: 4min
completed: 2026-04-14
---

# Phase 1: Guardrails and Regression Protection Summary

**UI-shell hotspot reporting and extraction inventory now give later phases a reproducible baseline and explicit future owners for the remaining `main.ts` shell hotspots**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-14T09:20:24Z
- **Completed:** 2026-04-14T09:21:46Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added a runnable hotspot report script that measures the current `frontend/src/main.ts` shell baseline without extra dependencies
- Captured the current `main.ts` counts and hotspot anchors in a committed extraction inventory
- Mapped the remaining hotspots to Section 3, standard VE, GPS-lap, out-and-back, and shared helper ownership buckets for later phases

## Task Commits

Each task was committed atomically:

1. **Task 1: Create a regeneratable hotspot report script for the current shell** - `1d94dec` (chore)
2. **Task 2: Freeze the current extraction inventory and planned ownership buckets** - `35f7545` (docs)

**Plan metadata:** included in the summary/tracking commit for plan `01-03`

## Files Created/Modified
- `scripts/report-ui-shell-hotspots.sh` - Dependency-free shell report for `frontend/src/main.ts` line count, DOM wiring counts, and hotspot function anchors
- `docs/architecture/frontend-ui-shell-extraction-inventory.md` - Baseline and ownership map for later shell extraction phases

## Decisions Made
- Make the report script narrowly target `frontend/src/main.ts` instead of trying to build a generic repo analyzer
- Treat `MapVisualization.ts` as secondary in the inventory so the roadmap stays centered on the main shell reduction goal

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 2 now has a regeneratable hotspot baseline instead of relying on stale metrics from earlier audits
- Later shell extraction phases have an explicit ownership map for the largest remaining `main.ts` UI responsibilities

---
*Phase: 01-guardrails-and-regression-protection*
*Completed: 2026-04-14*
