# Research Summary: Virtual Elevation Analyzer Web v1.1

**Domain:** Browser-based VE analysis enhancement
**Researched:** 2026-04-22
**Overall confidence:** MEDIUM-HIGH

## Executive Summary

The v1.1 Enhancement Wave focuses on improving performance, unifying pipelines, consolidating UI, and cleaning up the codebase. Research confirms that the existing TypeScript + Vite + Rust/WASM stack should be preserved, with browser-native APIs (Web Workers) added only if profiling confirms main-thread blocking.

**Key findings:**
1. Worker offload is not automatically needed—profile first, start with debounced updates
2. Pipeline unification should preserve mode-specific semantics rather than over-abstract
3. GPS UI consolidation is low-risk with clear state sync patterns
4. Smoothing ownership should be clarified at data layer (recommended) vs visualization layer
5. Weather sampling is exploratory—spike with explicit go/no-go criteria
6. Map cleanup is secondary—minimum structural improvement, no visual changes

The critical risk areas are premature workerization and over-abstracted pipeline unification. Both can be prevented by profiling first and keeping mode-specific logic explicit.

## Key Findings

**Stack:**
- Keep existing TypeScript/Vite/Rust/WASM stack
- Web Workers API for background computation (only if profiling confirms need)
- Comlink library for simplified worker communication
- No new dependencies for GPS consolidation, smoothing, CSS cleanup

**Features:**
- Worker offload: Table stakes = responsive sliders, differentiator = cancellation + progressive updates
- Pipeline unification: Table stakes = consistent behavior, risk = over-abstraction
- GPS consolidation: Low complexity UI move with state sync requirements
- Smoothing: Clarify ownership before implementation
- Weather spike: Exploratory with go/no-go gate

**Architecture:**
- Worker integration: `frontend/src/workers/ve-compute.worker.ts`
- Pipeline: Shared interface with mode-specific implementations
- GPS state: Single source of truth in AppState
- Smoothing: Data layer ownership recommended

**Critical pitfall:** Premature workerization without profiling data. Common mistake is adding workers "preemptively" before confirming main-thread blocking.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Pipeline Foundation + Air-Speed Fix
- **Rationale:** Foundation work that enables other changes; fix air-speed bug while unifying update paths
- **Addresses:** PIPE-01, air-speed calibration fixes
- **Avoids:** Over-abstracting mode differences (keep semantics explicit)

### Phase 2: GPS UI Consolidation
- **Rationale:** Clear user value, low technical risk, logical workflow proximity
- **Addresses:** GPS-01
- **Avoids:** State synchronization gaps (map dependencies before move)

### Phase 3: Worker Offload (if profiling confirms)
- **Rationale:** Only if profiling shows main thread blocking during multi-lap recompute
- **Addresses:** PERF-01
- **Avoids:** Premature complexity (simple debounce first)

### Phase 4: Smoothing Clarification + Implementation
- **Rationale:** Clarify ownership before coding; enables consistent behavior
- **Addresses:** SMOOTH-01
- **Avoids:** Multiple layers applying smoothing differently

### Phase 5: CSS + Map Cleanup
- **Rationale:** Parallel tracks, structural minimum for map
- **Addresses:** CSS-01, MAP-01
- **Avoids:** Scope expansion (map: structural only, no visual drift)

### Phase 6: Weather Spike or Closeout
- **Rationale:** Exploratory spike with timebox; go/no-go decision
- **Addresses:** WEATH-01 (if spike succeeds)
- **Avoids:** Scope creep (timebox + explicit decision gate)

**Phase ordering rationale:**
1. Pipeline first (foundation for other work)
2. GPS consolidation next (clear win, low risk)
3. Worker offload only if profiling confirms
4. Smoothing after pipeline is stable
5. CSS/Map in parallel
6. Weather as optional Phase 6 or defer

**Research flags for phases:**
- Phase 1 (Pipeline): Standard patterns, careful of over-abstraction
- Phase 2 (GPS): Likely smooth, state sync is key
- Phase 3 (Worker): May need deeper research if profiling is inconclusive
- Phase 4 (Smoothing): Straightforward if ownership clarified
- Phase 5 (CSS/Map): Standard cleanup patterns
- Phase 6 (Weather): Needs explicit go/no-go criteria defined

## Confidence Assessment

| Area         | Confidence | Notes                                          |
| ------------ | ---------- | ---------------------------------------------- |
| Stack        | HIGH       | Browser-native APIs, no new dependencies       |
| Features     | MEDIUM-HIGH| Well-understood from existing codebase        |
| Architecture | HIGH       | Clear integration with existing shell modules  |
| Pitfalls     | HIGH       | Based on v1.0 experience patterns            |

## Gaps to Address

- **Worker need:** Need profiling data before Phase 3 planning
- **Air-speed bug specifics:** Document what the "bugs" are and impact
- **Weather go/no-go criteria:** Define before Phase 6
- **Map cleanup scope:** Define structural minimum vs visual polish

## Sources

- `.planning/PROJECT.md` - current project state
- `.planning/MILESTONE-CONTEXT.md` - v1.1 goals and constraints
- Existing shell modules under `frontend/src/shell/`
- MDN Web Workers API documentation
- Comlink library documentation

---
*Research summary for: v1.1 Enhancement Wave*
*Synthesized: 2026-04-22*
