---
phase: 5
slug: closeout-secondary-cleanup-and-roadmap-sync
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-19
---

# Phase 5 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
| ---------------------- | --------------------------------------------------- |
| **Framework** | Vitest 3.x + Rust cargo test |
| **Config file** | `frontend/vitest.config.ts` |
| **Quick run command** | `cd frontend && npm run test -- --run` |
| **Full suite command** | `bash scripts/validate-ui-shell-guardrails.sh --ci-only` |
| **Estimated runtime** | ~120 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd frontend && npm run test -- --run`
- **After every plan wave:** Run `bash scripts/validate-ui-shell-guardrails.sh --ci-only`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID   | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status    |
| --------- | ---- | ---- | ----------- | --------- | ----------------- | ----------- | --------- |
| 05-01-01 | 01   | 1    | CLOS-01    | structural | `bash scripts/report-ui-shell-hotspots.sh` | ✅ | ⬜ pending |
| 05-01-02 | 01   | 1    | CLOS-01    | build | `cd frontend && npm run check && npm run build` | ✅ | ⬜ pending |
| 05-01-03 | 01   | 2    | CLOS-01    | regression | `bash scripts/validate-ui-shell-guardrails.sh --ci-only` | ✅ | ⬜ pending |
| 05-02-01 | 02   | 2    | CLOS-02    | docs-audit | `git diff .planning/ROADMAP.md .planning/PROJECT.md .planning/REQUIREMENTS.md docs/architecture/frontend-ui-shell-extraction-inventory.md` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Optional: add a lightweight docs-consistency checker script for CLOS-02 fields (ROADMAP progress row, PROJECT context/date, REQUIREMENTS traceability statuses)
- [ ] Optional: add focused unit tests for newly extracted non-trivial pure helpers (time-range/index/rho) if risk emerges

---

## Manual-Only Verifications

| Behavior   | Requirement | Why Manual | Test Instructions |
| ---------- | ----------- | ---------- | ----------------- |
| Auto-scroll to Analysis Parameters after successful FIT/CSV load | CLOS-01 | Browser interaction timing and scroll behavior are not fully covered in unit tests | Follow `docs/testing/ui-shell-manual-checklist.md` upload flow and confirm scroll target behavior |
| GPS in-place updates preserve active tab + scroll position | CLOS-01 | Requires interactive mode toggles and slider actions across plot tabs | Follow `docs/testing/ui-shell-manual-checklist.md` GPS-lap update checks |
| GPS calibration behavior remains correct across GPS modes | CLOS-01 | End-to-end mode + data calibration chain is browser/manual contract | Follow `docs/testing/ui-shell-manual-checklist.md` calibration checks for GPS lap, GPS gate one-way, and out-and-back |
| Planning docs accurately reflect stabilized shell boundaries/hotspots | CLOS-02 | Semantic accuracy of architecture/roadmap text needs reviewer judgment | Review changed docs against `scripts/report-ui-shell-hotspots.sh` output and phase summary evidence |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 180s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending