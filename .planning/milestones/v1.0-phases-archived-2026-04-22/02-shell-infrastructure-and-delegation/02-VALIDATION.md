---
phase: 2
slug: shell-infrastructure-and-delegation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-14
---

# Phase 2 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
| ---------------------- | --------------------------------------------------- |
| **Framework** | Vitest 4.1.4 + TypeScript typecheck + ESLint |
| **Config file** | `frontend/vitest.config.ts`, `frontend/eslint.config.js`, `.github/workflows/deploy.yml` |
| **Quick run command** | `cd frontend && npm run test` |
| **Full suite command** | `cd backend && cargo test --lib && cd backend && wasm-pack build --target web --out-dir ../frontend/pkg && cd frontend && npm run check && npm run lint && npm run test && npm run build` |
| **Estimated runtime** | ~120 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd frontend && npm run test`
- **After every plan wave:** Run `bash scripts/validate-ui-shell-guardrails.sh --ci-only`
- **Before `/gsd-verify-work`:** Full suite must be green plus manual browser checks
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
| --------- | ---- | ---- | ----------- | --------- | ----------------- | ----------- | --------- |
| 02-01-01 | 01 | 1 | SHEL-02 | unit | `cd frontend && npm run test` | ⬜ pending | ⬜ pending |
| 02-01-02 | 01 | 1 | SHEL-02 | unit | `cd frontend && npm run test` | ⬜ pending | ⬜ pending |
| 02-01-03 | 01 | 1 | SHEL-02 | integration | `cd frontend && npm run check && npm run test` | ⬜ pending | ⬜ pending |
| 02-02-01 | 02 | 2 | SHEL-01 | integration | `cd frontend && npm run check && npm run test` | ⬜ pending | ⬜ pending |
| 02-02-02 | 02 | 2 | SHEL-01 | integration | `cd frontend && npm run check` | ⬜ pending | ⬜ pending |
| 02-03-01 | 03 | 2 | SHEL-01 | integration | `cd frontend && npm run check && npm run test` | ⬜ pending | ⬜ pending |
| 02-03-02 | 03 | 2 | SHEL-01 | integration | `cd frontend && npm run check && npm run test` | ⬜ pending | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No new framework install needed.

- [x] `frontend/vitest.config.ts` - existing test runner config
- [x] `frontend/eslint.config.js` - existing lint config
- [x] `scripts/validate-ui-shell-guardrails.sh` - Phase 1 guardrail entry point
- [x] `docs/testing/ui-shell-manual-checklist.md` - browser regression checklist

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
| ---------- | ----------- | ---------- | ----------------- |
| Auto-scroll to Analysis Parameters after FIT/CSV load | SHEL-01 | No browser automation for upload/scroll | Follow `docs/testing/ui-shell-manual-checklist.md` → `## FIT and CSV file-load navigation` |
| GPS lap in-place update preserves active tab + scroll | SHEL-01 | No browser automation for live Plotly/tab/scroll | Follow `docs/testing/ui-shell-manual-checklist.md` → `## GPS lap in-place update checks` |
| Out-and-back in-place update preserves active tab + scroll | SHEL-01 | Same browser-only limitation | Follow `docs/testing/ui-shell-manual-checklist.md` → `## Out-and-back in-place update checks` |
| GPS calibration remains correct across GPS modes | SHEL-01 | Requires live UI interaction and visible state | Follow `docs/testing/ui-shell-manual-checklist.md` → `## Calibration checks` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 180s
- [ ] `nyquist_compliant: true` set in frontmatter after phase planning is approved

**Approval:** pending
