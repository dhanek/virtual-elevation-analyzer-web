---
phase: 4
slug: gps-and-out-and-back-shell-extraction
status: verified
threats_open: 0
asvs_level: 1
created: 2026-04-19
---

# Phase 4 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

No new trust boundaries introduced. Phase 4 is a structural refactoring of client-side code: GPS-lap and out-and-back shell logic extracted from `main.ts` to dedicated modules, and `MultiSegmentSettings.ts` consolidated. No network calls, authentication, or persistence mechanisms were added, removed, or altered.

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Browser ↔ IndexedDB (same-origin) | Existing client-side persistence for per-file lap settings, accessed via `ParameterStorage` | Lap parameters (CdA, Crr, air-speed calibration) — non-sensitive, user-scoped |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-04-01 | Tampering | `MultiSegmentSettings.ts` persistence | accept | Settings persist to IndexedDB via `ParameterStorage` (client-only, same-origin). No server-side storage. Extraction from `main.ts` is pure code movement — no change to the persistence surface, serialization format, or access pattern. Verified at `frontend/src/utils/ParameterStorage.ts:55` and `frontend/src/analysis/MultiSegmentSettings.ts:60,104,128`. | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-04-01 | T-04-01 | Browser IndexedDB is inherently user-tamperable (DevTools, extensions). Settings stored are user-owned calibration parameters with no security value — a user tampering with their own CdA/Crr only affects their own analysis output. No cross-user or cross-origin exposure. The refactor does not widen this surface. | hannes (phase owner) | 2026-04-19 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-04-19 | 1 | 1 | 0 | /gsd-secure-phase (State B, auditor skipped — threats_open: 0 at discovery) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-04-19
