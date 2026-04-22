---
phase: 3
slug: section-3-and-standard-ve-shell-extraction
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 3 - Validation Strategy

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
| 03-01-01 | 01 | 1 | SHEL-03 | unit | `cd frontend && npm run check && npm run test` | ⬜ pending | ⬜ pending |
| 03-01-02 | 01 | 1 | SHEL-03 | integration | `cd frontend && npm run check && npm run test` | ⬜ pending | ⬜ pending |
| 03-02-01 | 02 | 2 | SHEL-04 | unit | `cd frontend && npm run check && npm run test` | ⬜ pending | ⬜ pending |
| 03-02-02 | 02 | 2 | SHEL-04 | integration | `cd frontend && npm run check && npm run test` | ⬜ pending | ⬜ pending |
| 03-03-01 | 03 | 3 | BEHV-01 | integration | `cd frontend && npm run check && npm run test` | ⬜ pending | ⬜ pending |
| 03-03-02 | 03 | 3 | BEHV-02 | integration | `bash scripts/validate-ui-shell-guardrails.sh --ci-only` | ⬜ pending | ⬜ pending |

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
| Auto-scroll to Analysis Parameters after FIT/CSV load | BEHV-01 | No browser automation for upload/scroll | Follow `docs/testing/ui-shell-manual-checklist.md` → `## FIT and CSV file-load navigation` |
| Standard VE analysis operates correctly | BEHV-02 | No browser automation for live Plotly/slider | Follow `docs/testing/ui-shell-manual-checklist.md` → `## Calibration checks` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 180s
- [ ] `nyquist_compliant: true` set in frontmatter after phase planning is approved

**Approval:** pending
