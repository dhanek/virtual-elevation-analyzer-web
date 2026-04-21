---
phase: 07
slug: phase-02-summary-frontmatter-repair
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
---

# Phase 07 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| **Framework**          | CLI metadata validation (`pi-gsd-tools` + `gsd-tools.cjs frontmatter`)                               |
| **Config file**        | `.planning/config.json`                                                                                |
| **Quick run command**  | `pi-gsd-tools summary-extract <summary> --fields requirements_completed --pick requirements_completed --raw` |
| **Full suite command** | `summary-extract on 02-01/02-02/02-03 + summary frontmatter validate + focused SHEL matrix gate`     |
| **Estimated runtime**  | ~10 seconds                                                                                            |

---

## Sampling Rate

- **After every task commit:** Run `summary-extract` on touched summary files
- **After every plan wave:** Run full extraction + schema validation for all three Phase-02 summaries
- **Before `/gsd-verify-work`:** Focused SHEL-01/SHEL-02 matrix gate must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID   | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status    |
| --------- | ---- | ---- | ----------- | --------- | ----------------- | ----------- | --------- |
| 07-01-01 | 01   | 1    | SHEL-02     | smoke     | `pi-gsd-tools summary-extract .planning/phases/02-shell-infrastructure-and-delegation/02-01-SUMMARY.md --fields requirements_completed --pick requirements_completed --raw` | ✅ | ⬜ pending |
| 07-02-01 | 02   | 1    | SHEL-01     | smoke     | `pi-gsd-tools summary-extract .planning/phases/02-shell-infrastructure-and-delegation/02-02-SUMMARY.md --fields requirements_completed --pick requirements_completed --raw` | ✅ | ⬜ pending |
| 07-02-02 | 02   | 1    | SHEL-01     | smoke     | `pi-gsd-tools summary-extract .planning/phases/02-shell-infrastructure-and-delegation/02-03-SUMMARY.md --fields requirements_completed --pick requirements_completed --raw` | ✅ | ⬜ pending |
| 07-03-01 | 03   | 2    | SHEL-01,SHEL-02 | smoke | `test "$(pi-gsd-tools summary-extract ...02-01... --pick requirements_completed --raw | tr -d '[:space:]')" = '["SHEL-02"]' && test "$(pi-gsd-tools summary-extract ...02-02... --pick requirements_completed --raw | tr -d '[:space:]')" = '["SHEL-01"]' && test "$(pi-gsd-tools summary-extract ...02-03... --pick requirements_completed --raw | tr -d '[:space:]')" = '["SHEL-01"]'` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `.planning/phases/07-phase-02-summary-frontmatter-repair/07-MATRIX-CHECK.md` - focused matrix evidence artifact

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
