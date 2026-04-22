---
phase: 6
slug: verification-artifact-backfill-phases-03-05
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-19
---

# Phase 6 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
| ---------------------- | --------------------------------------------------- |
| **Framework** | Markdown artifact verification + shell command checks |
| **Config file** | none |
| **Quick run command** | `rg -n "\\|\\s*(SHEL-03|SHEL-04|BEHV-01|BEHV-02|SHEL-05|SHEL-06|BEHV-03|BEHV-04|CLOS-01|CLOS-02)\\s*\\|" .planning/phases/{03,04,05}-*/**/*-VERIFICATION.md` |
| **Full suite command** | `bash scripts/validate-ui-shell-guardrails.sh --ci-only` |
| **Estimated runtime** | ~180 seconds |

---

## Sampling Rate

- **After every task commit:** Run targeted `rg` checks on the updated verification artifact and requirement IDs.
- **After every plan wave:** Run `bash scripts/validate-ui-shell-guardrails.sh --ci-only`.
- **Before `/gsd-verify-work`:** All 03/04/05 verification docs must exist and matrix checks must pass.
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID   | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status    |
| --------- | ---- | ---- | ----------- | --------- | ----------------- | ----------- | --------- |
| 06-01-01 | 01   | 1    | SHEL-03/SHEL-04/BEHV-01/BEHV-02 | artifact schema | `rg -n "^## Requirements Coverage$" .planning/phases/03-section-3-and-standard-ve-shell-extraction/03-VERIFICATION.md` | ✅ | ⬜ pending |
| 06-01-02 | 01   | 1    | BEHV-02 | parity evidence | `rg -n "validate-ui-shell-guardrails.sh --ci-only|npm run build" .planning/phases/03-section-3-and-standard-ve-shell-extraction/03-VERIFICATION.md` | ✅ | ⬜ pending |
| 06-02-01 | 02   | 1    | SHEL-05/SHEL-06/BEHV-03/BEHV-04 | artifact schema | `rg -n "^## Requirements Coverage$" .planning/phases/04-gps-and-out-and-back-shell-extraction/04-VERIFICATION.md` | ✅ | ⬜ pending |
| 06-02-02 | 02   | 1    | BEHV-03/BEHV-04 | behavior evidence | `rg -n "04-03-SUMMARY.md|docs/testing/ui-shell-manual-checklist.md" .planning/phases/04-gps-and-out-and-back-shell-extraction/04-VERIFICATION.md` | ✅ | ⬜ pending |
| 06-03-01 | 03   | 1    | CLOS-01/CLOS-02 | artifact schema | `rg -n "\|\s*(CLOS-01|CLOS-02)\s*\|" .planning/phases/05-closeout-secondary-cleanup-and-roadmap-sync/05-VERIFICATION.md` | ✅ | ⬜ pending |
| 06-04-01 | 04   | 2    | BEHV-02 | matrix consistency | `rg -n "Overall: PASS" .planning/phases/06-verification-artifact-backfill-phases-03-05/06-MATRIX-CONSISTENCY.md` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Ensure all target verification files exist before matrix pass claims:
  - `.planning/phases/03-section-3-and-standard-ve-shell-extraction/03-VERIFICATION.md`
  - `.planning/phases/04-gps-and-out-and-back-shell-extraction/04-VERIFICATION.md`
  - `.planning/phases/05-closeout-secondary-cleanup-and-roadmap-sync/05-VERIFICATION.md`
- [ ] Add `.planning/phases/06-verification-artifact-backfill-phases-03-05/06-MATRIX-CONSISTENCY.md` in plan 06-04 before marking `Overall: PASS`

---

## Manual-Only Verifications

| Behavior   | Requirement | Why Manual | Test Instructions |
| ---------- | ----------- | ---------- | ----------------- |
| Standard VE parity evidence depth reflects actual preserved behavior | BEHV-02 | Evidence quality judgment cannot be fully automated | Compare `03-VERIFICATION.md` BEHV-02 section against `docs/testing/ui-shell-regression-contract.md` and `03-03-SUMMARY.md`; verify anchors and expected outcomes are explicit and equivalent in depth to BEHV-03/BEHV-04 sections |
| Verification narratives stay within v1 scope | CLOS-02 | Scope compliance in prose requires reviewer judgment | Review 03/04/05 verification docs to ensure no unplanned feature/v2 claims are introduced while closing audit gaps |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 180s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
