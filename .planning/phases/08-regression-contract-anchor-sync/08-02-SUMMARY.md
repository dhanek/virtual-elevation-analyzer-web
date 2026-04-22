---
phase: 08-regression-contract-anchor-sync
plan: 08-02
status: complete
date: 2026-04-22
---

# Summary: Validate and document anchor integrity against current shell module structure

## Objective
Perform a final audit of the updated regression contract to ensure 100% path accuracy and that the STAB-01 verification path is explicitly actionable for any developer.

## Changes
- **Path Audit**: Verified all relative file paths in `docs/testing/ui-shell-regression-contract.md`. Corrected `frontend/src/shell/gps.ts` to `frontend/src/shell/gpsLap/index.ts` and `frontend/src/shell/section3.ts` to `frontend/src/shell/section3/index.ts` to match the actual directory-based module structure.
- **STAB-01 Hardening**: Added a dedicated `## STAB-01: UI Shell Stability Verification Path` section to the regression contract. This provides a concrete 4-step verification guide (Audit -> Automated -> Manual -> Behavioral) that any developer can follow to validate shell stability.

## Key Files Modified
- `docs/testing/ui-shell-regression-contract.md`

## Verification
- [x] Grep confirmed no broken links or "main.ts" references in the final contract.
- [x] All anchors resolve to existing `index.ts` files in `frontend/src/shell/*`.
- [x] STAB-01 section is present and provides explicit Read -> Action -> Verify steps.

## Self-Check
- [x] No dead links in the regression contract.
- [x] STAB-01 path is actionable.
