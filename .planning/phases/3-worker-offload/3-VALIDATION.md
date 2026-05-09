---
phase: 3
slug: worker-offload
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-09
---

# Phase 3 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Framework**          | vitest + rust cargo tests + wasm-pack build                                                                                                                                    |
| **Config file**        | `frontend/vitest.config.ts`, `backend/Cargo.toml`                                                                                                                              |
| **Quick run command**  | `cd frontend && npm run test -- src/shell/analysis/parameterChangeHandler.test.ts`                                                                                             |
| **Full suite command** | `cd backend && cargo test --lib && wasm-pack build --target web --out-dir ../frontend/pkg && cd ../frontend && npm run check && npm run lint && npm run test && npm run build` |
| **Estimated runtime**  | ~180 seconds                                                                                                                                                                   |

---

## Sampling Rate

- **After every task commit:** Run `cd frontend && npm run test -- src/shell/analysis/parameterChangeHandler.test.ts`
- **After every plan wave:** Run `cd backend && cargo test --lib && wasm-pack build --target web --out-dir ../frontend/pkg && cd ../frontend && npm run check && npm run lint && npm run test && npm run build`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type               | Automated Command                                                                                                                                                              | File Exists | Status     |
| ------- | ---- | ---- | ----------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | ---------- |
| 3-01-01 | 01   | 1    | PERF-01     | profiling + integration | `cd frontend && npm run test -- src/shell/analysis/parameterChangeHandler.test.ts`                                                                                             | ✅          | ⬜ pending |
| 3-01-02 | 01   | 1    | PERF-01     | profiling evidence      | `cd frontend && npm run profile:slider`                                                                                                                                        | ✅          | ⬜ pending |
| 3-02-01 | 02   | 2    | PERF-01     | regression suite        | `cd backend && cargo test --lib && wasm-pack build --target web --out-dir ../frontend/pkg && cd ../frontend && npm run check && npm run lint && npm run test && npm run build` | ✅          | ⬜ pending |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

- [ ] `frontend/src/shell/analysis/recomputeRunner.test.ts` - add/expand tests for debounce + latest-input-wins + cancellation fallback behavior
- [ ] `frontend/src/workers/veCompute.worker.test.ts` - add worker message contract tests (if worker path is implemented)

---

## Manual-Only Verifications

| Behavior                                          | Requirement | Why Manual                                                          | Test Instructions                                                                                                                                     |
| ------------------------------------------------- | ----------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slider feels responsive at 15–20 laps             | PERF-01     | User-visible jank assessment is browser/interaction dependent       | Load heavy multi-lap ride, drag CdA/Crr/trim sliders continuously, verify no visible freeze and inline recompute status appears/disappears correctly. |
| Auto-cancel semantics preserve latest result only | PERF-01     | Requires interaction timing difficult to assert fully in unit tests | Drag slider rapidly, confirm stale recomputes do not overwrite final slider position output and last completed plot remains visible during recompute. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 180s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
