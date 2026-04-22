---
phase: 4
slug: gps-and-out-and-back-shell-extraction
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | `frontend/vitest.config.ts` |
| **Quick run command** | `cd frontend && npm run test -- --run` |
| **Full suite command** | `cd frontend && npm run test -- --run && npm run check && npm run lint && npm run build` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd frontend && npm run test -- --run`
- **After every plan wave:** Run `cd frontend && npm run test -- --run && npm run check && npm run lint && npm run build`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | SHEL-05 | — | N/A | build | `cd frontend && npm run check && npm run build` | ✅ | ⬜ pending |
| 04-01-02 | 01 | 1 | SHEL-05 | — | N/A | build | `cd frontend && npm run check && npm run build` | ✅ | ⬜ pending |
| 04-02-01 | 02 | 1 | SHEL-06 | — | N/A | build | `cd frontend && npm run check && npm run build` | ✅ | ⬜ pending |
| 04-02-02 | 02 | 1 | SHEL-06 | — | N/A | build | `cd frontend && npm run check && npm run build` | ✅ | ⬜ pending |
| 04-03-01 | 03 | 2 | BEHV-03 | — | N/A | integration | `bash scripts/validate-ui-shell-guardrails.sh` | ✅ | ⬜ pending |
| 04-03-02 | 03 | 2 | BEHV-04 | — | N/A | manual | Manual browser checklist | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Tab/scroll preservation during GPS auto-adjust and slider changes | BEHV-03 | DOM interaction with Plotly.js and tab state requires browser environment | 1. Load GPS-lap analysis 2. Switch to wind tab 3. Adjust slider 4. Verify tab stays on wind, scroll position unchanged |
| Air-speed calibration correctness across GPS lap, GPS gate one-way, out-and-back | BEHV-04 | End-to-end calibration math through WASM calculator requires real data | 1. Load each GPS mode with known test file 2. Enable auto-calibration 3. Verify calibration % matches pre-extraction values |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
