---
phase: 4
slug: smoothing-clarity
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-09
---

# Phase 4 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------ |
| **Framework**          | vitest + TypeScript + ESLint                                                         |
| **Config file**        | `frontend/vitest.config.ts`, `frontend/tsconfig.json`, `frontend/eslint.config.js`   |
| **Quick run command**  | `cd frontend && npm run test -- src/shell/analysis/elevationProfileResolver.test.ts` |
| **Full suite command** | `cd frontend && npm run check && npm run lint && npm run test && npm run build`      |
| **Estimated runtime**  | ~120 seconds                                                                         |

---

## Sampling Rate

- **After every task commit:** Run `cd frontend && npm run test -- src/shell/analysis/elevationProfileResolver.test.ts`
- **After every plan wave:** Run `cd frontend && npm run check && npm run lint && npm run test && npm run build`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement          | Test Type      | Automated Command                                                                      | File Exists | Status     |
| ------- | ---- | ---- | -------------------- | -------------- | -------------------------------------------------------------------------------------- | ----------- | ---------- |
| 4-01-01 | 01   | 1    | SMOOTH-01            | contract/unit  | `cd frontend && npm run test -- src/shell/analysis/elevationProfiles.contract.test.ts` | ❌ W0       | ⬜ pending |
| 4-01-02 | 01   | 1    | SMOOTH-02            | integration    | `cd frontend && npm run test -- src/shell/fileLoad/fileLoadOrchestration.test.ts`      | ❌ W0       | ⬜ pending |
| 4-02-01 | 02   | 2    | SMOOTH-02            | UI/integration | `cd frontend && npm run test -- src/shell/ve/elevationToggle.integration.test.ts`      | ❌ W0       | ⬜ pending |
| 4-02-02 | 02   | 2    | SMOOTH-01, SMOOTH-02 | regression     | `cd frontend && npm run check && npm run lint && npm run test && npm run build`        | ✅          | ⬜ pending |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

- [ ] `frontend/src/shell/analysis/elevationProfiles.contract.test.ts` - enforce raw/DEM-smoothed ownership contract
- [ ] `frontend/src/shell/analysis/elevationProfileResolver.test.ts` - cross-mode profile selection behavior
- [ ] `frontend/src/shell/ve/elevationToggle.integration.test.ts` - DEM-on/off + toggle visibility/selection behavior

---

## Manual-Only Verifications

| Behavior                                                          | Requirement | Why Manual                                                  | Test Instructions                                                                                                                         |
| ----------------------------------------------------------------- | ----------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Default visual curve uses smoothed DEM when DEM active            | SMOOTH-02   | Plot-level rendering state is easiest to verify visually    | Load FIT + DEM, open Standard/GPS-lap/Out-and-back VE view, confirm displayed actual elevation curve matches smoothed profile by default. |
| Raw elevation toggle swaps curve source and is hidden without DEM | SMOOTH-02   | UI control visibility and plotted-series source are coupled | With DEM active: toggle raw on/off and confirm curve changes. Without DEM: verify toggle is hidden/disabled and FIT raw is used.          |
| Maintainer can explain ownership boundary from docs               | SMOOTH-01   | Documentation comprehension is human-evaluated              | Review phase summary and inline ownership docs; confirm statement "smoothing is data-layer-only; FIT raw never smoothed" is explicit.     |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
