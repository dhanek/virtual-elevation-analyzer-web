---
phase: 1
slug: guardrails-and-regression-protection
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-12
---

# Phase 1 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
| ---------------------- | --------------------------------------------------- |
| **Framework** | Mixed existing stack: Rust test harness + wasm-pack + TypeScript typecheck + ESLint + Vitest + Vite build |
| **Config file** | `frontend/vitest.config.ts`, `frontend/eslint.config.js`, `.github/workflows/deploy.yml` |
| **Quick run command** | `cd frontend && npm run test` |
| **Full suite command** | `cd backend && cargo test --lib && cd backend && wasm-pack build --target web --out-dir ../frontend/pkg && cd frontend && npm run check && npm run lint && npm run test && npm run build` |
| **Estimated runtime** | ~120 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd frontend && npm run test`
- **After every plan wave:** Run `cd backend && cargo test --lib && cd backend && wasm-pack build --target web --out-dir ../frontend/pkg && cd frontend && npm run check && npm run lint && npm run test && npm run build`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
| --------- | ---- | ---- | ----------- | --------- | ----------------- | ----------- | --------- |
| 01-01-01 | 01 | 1 | STAB-01 | docs | `rg "## File-load navigation|## GPS calibration behavior" docs/testing/ui-shell-regression-contract.md` | ❌ pre-plan | ⬜ pending |
| 01-01-02 | 01 | 1 | STAB-01 | docs | `rg "active tab remains unchanged|Analysis Parameters section becomes visible" docs/testing/ui-shell-manual-checklist.md` | ❌ pre-plan | ⬜ pending |
| 01-03-01 | 03 | 1 | STAB-01 | script | `bash -n scripts/report-ui-shell-hotspots.sh && bash scripts/report-ui-shell-hotspots.sh` | ❌ pre-plan | ⬜ pending |
| 01-03-02 | 03 | 1 | STAB-01 | docs | `rg "Section 3 shell|GPS-lap shell|MapVisualization.ts" docs/architecture/frontend-ui-shell-extraction-inventory.md` | ❌ pre-plan | ⬜ pending |
| 01-02-01 | 02 | 2 | STAB-02 | integration/script | `bash -n scripts/validate-ui-shell-guardrails.sh && bash scripts/validate-ui-shell-guardrails.sh --help` | ❌ pre-plan | ⬜ pending |
| 01-02-02 | 02 | 2 | STAB-01 | docs | `rg "bash scripts/validate-ui-shell-guardrails.sh|.github/workflows/deploy.yml" docs/testing/ui-shell-manual-checklist.md docs/testing/ui-shell-regression-contract.md` | ❌ pre-plan | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `docs/testing/ui-shell-regression-contract.md` - explicit regression contract for the fragile UI-shell behaviors
- [ ] `docs/testing/ui-shell-manual-checklist.md` - committed browser checklist with exact expectations
- [ ] `scripts/report-ui-shell-hotspots.sh` - regeneratable hotspot baseline script
- [ ] `docs/architecture/frontend-ui-shell-extraction-inventory.md` - committed extraction target inventory
- [ ] `scripts/validate-ui-shell-guardrails.sh` - repo-level validation entry point that mirrors CI parity

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
| ---------- | ----------- | ---------- | ----------------- |
| Auto-scroll to Analysis Parameters after local FIT load | STAB-01 | Current repo has no browser automation for uploaded-file scroll behavior | Run `bash scripts/validate-ui-shell-guardrails.sh`, then follow `docs/testing/ui-shell-manual-checklist.md` → `## FIT and CSV file-load navigation` |
| Auto-scroll to Analysis Parameters after local CSV load | STAB-01 | Same browser-only scroll behavior limitation | Run the same script and follow the checklist `## FIT and CSV file-load navigation` section |
| GPS lap in-place update preserves active tab + scroll | STAB-01 | Current repo has no browser automation for live Plotly/tab/scroll interactions | Follow `docs/testing/ui-shell-manual-checklist.md` → `## GPS lap in-place update checks` |
| Out-and-back in-place update preserves active tab + scroll | STAB-01 | Same browser-only limitation | Follow `docs/testing/ui-shell-manual-checklist.md` → `## Out-and-back in-place update checks` |
| GPS calibration behavior remains correct across GPS modes | STAB-01 | Requires end-user interaction and visible state confirmation in the live UI | Follow `docs/testing/ui-shell-manual-checklist.md` → `## Calibration checks` |

---

## Validation Sign-Off

- [ ] All tasks have automated verify commands or committed manual-only verification references
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 artifacts cover the phase guardrail path
- [ ] No watch-mode flags
- [ ] Feedback latency < 180s for automated checks
- [ ] `nyquist_compliant: true` set in frontmatter after phase planning is approved and artifacts exist

**Approval:** pending
