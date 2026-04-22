---
phase: 08-regression-contract-anchor-sync
plan: 08-01
status: complete
date: 2026-04-22
---

# Summary: Update regression-contract anchors to current shell ownership files

## Objective
Restore the quality of regression-contract documentation by re-anchoring behavior definitions to the current modular shell architecture.

## Changes
- **Regression Contract**: Redesigned `docs/testing/ui-shell-regression-contract.md` into a "Guided Tour" format. Replaced all `main.ts` anchors with modular paths in `frontend/src/shell/` (e.g., `fileLoad.ts`, `gps.ts`, `section3.ts`). Added "Migration Notes" to each section to explain the shift.
- **Manual Checklist**: Reorganized `docs/testing/ui-shell-manual-checklist.md` from a flat list into module-based groups (File Load, Analysis Orchestration, GPS Behavior, Calibration, General Shell) aligned with the new contract.
- **Guardrail Script**: Updated `scripts/validate-ui-shell-guardrails.sh` to reflect the Modular Shell Architecture in its usage text and logs.

## Key Files Modified
- `docs/testing/ui-shell-regression-contract.md`
- `docs/testing/ui-shell-manual-checklist.md`
- `scripts/validate-ui-shell-guardrails.sh`

## Verification
- [x] Grep verified that `main.ts` is no longer the primary anchor for shell behavior in the contract.
- [x] Verified all new anchors point to existing files in `frontend/src/shell/`.
- [x] Verified the manual checklist is logically grouped by module.
- [x] Verified guardrail script output is synchronized.

## Self-Check
- [x] Every behavior previously anchored to `main.ts` now has a specific anchor in `frontend/src/shell/`.
- [x] Documentation explains the transition (Guided Tour).
