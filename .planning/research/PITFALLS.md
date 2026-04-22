# Pitfalls Research

**Domain:** VE analysis browser app enhancement pitfalls
**Researched:** 2026-04-22
**Confidence:** MEDIUM-HIGH

## Critical Pitfalls for v1.1

### Pitfall 1: Premature Workerization

**What goes wrong:**
Adding Web Worker complexity before profiling confirms the bottleneck is in the main thread. Results in more complex code with no measurable user benefit.

**Why it happens:**
"Multi-lap slider responsiveness" sounds like it needs workers. But existing profiling (`scripts/profile-slider-recompute.ts`) showed no strong worker case on current machine.

**Prevention:**
1. Profile before adding workers
2. Start with debounced main-thread updates (simplest)
3. Only add workers if profiling shows main thread blocking

**Warning signs:**
- Worker implementation starts before profiling data
- Code adds worker "preemptively"
- Complexity increases without measurable latency improvement

**Phase to address:** Worker implementation phase (likely Phase 3)

---

### Pitfall 2: Pipeline Unification Over-Abstraction

**What goes wrong:**
Creates a generic pipeline that abstracts away real differences between Standard, GPS-lap, and Out-and-back modes. Results in hidden mode-specific behavior that causes bugs.

**Why it happens:**
"Unification" sounds like consolidation. But each mode has genuinely different semantics that need different handling.

**Prevention:**
1. Keep mode-specific implementations with shared interface
2. Define boundaries at mode entry/exit, not deep in algorithm
3. Test each mode explicitly, not just through unified interface

**Warning signs:**
- Pipeline abstraction requires many mode-specific overrides
- Mode-specific logic scattered across "shared" code
- Bugs appear only in specific modes

**Phase to address:** Pipeline phase (likely Phase 1)

---

### Pitfall 3: Air-Speed Calibration Silent Behavior Change

**What goes wrong:**
Fixing "latent air-speed calibration bugs in Standard VE mode" silently changes results for rides that relied on the buggy behavior.

**Why it happens:**
"Bugs" that existed for a while may have been worked around or relied upon by users.

**Prevention:**
1. Document what the "bugs" are and why they were wrong
2. Get user confirmation before changing calculation behavior
3. Consider migration path or backward-compatibility option

**Warning signs:**
- Fix changes VE output values
- No migration path for affected rides
- Users complain results differ after update

**Phase to address:** Pipeline phase (Phase 1) with explicit go/no-go

---

### Pitfall 4: GPS UI State Divergence

**What goes wrong:**
Moving GPS mode selector from Analysis Parameters to Section 3 causes state synchronization issues. Mode selector and actual mode behavior get out of sync.

**Why it happens:**
UI state and analysis state live in different places. Moving UI without moving state wiring creates gaps.

**Prevention:**
1. Map state dependencies before UI move
2. Ensure single source of truth for GPS mode state
3. Add integration test for state sync

**Warning signs:**
- GPS mode works in one location but not other
- State updates don't propagate correctly
- Duplicate state for GPS mode

**Phase to address:** GPS consolidation phase (likely Phase 2)

---

### Pitfall 5: Smoothing Layer Ambiguity

**What goes wrong:**
Smoothing applied in multiple layers (data processing + visualization) with different parameters or algorithms, causing inconsistent results.

**Why it happens:**
Smoothing is needed in multiple places for different reasons. Without clarifying ownership, both layers implement it.

**Prevention:**
1. Make explicit decision: data layer owns smoothing
2. Document which smoothing parameters affect which outputs
3. Ensure single source of truth for smoothing config

**Warning signs:**
- Same smoothing parameter has different effects in different views
- Smoothing UI controls unclear about what they affect
- Results change unexpectedly based on visualization choice

**Phase to address:** Smoothing phase (likely Phase 4)

---

### Pitfall 6: Weather Spike Scope Creep

**What goes wrong:**
Exploratory spike for continuous weather sampling becomes full implementation before the spike proves success. Spike scope bleeds into v1.1 deliverable.

**Why it happens:**
Spike looks promising. Team starts implementing features before the go/no-go decision.

**Prevention:**
1. Define explicit spike success criteria upfront
2. Timebox the spike
3. Make go/no-go decision before Phase 6 planning

**Warning signs:**
- Spike continues past original timebox
- Full implementation features appear before spike approval
- No clear go/no-go criteria defined

**Phase to address:** Weather spike (if included, Phase 6 or deferred)

---

### Pitfall 7: Map Cleanup Scope Expansion

**What goes wrong:**
MapVisualization.ts structural cleanup becomes full rewrite or visual redesign. Secondary target consumes primary milestone focus.

**Why it happens:**
"Improving structure" becomes "making it better" which becomes "fixing everything."

**Prevention:**
1. Define minimum vs ideal for MAP-01
2. Hard stop at structural minimum unless explicitly approved
3. Track time spent on map work vs other v1.1 targets

**Warning signs:**
- Map work becomes milestone centerpiece
- Large percentage of changes in map code
- No clear boundary for when map work is "done"

**Phase to address:** Map cleanup (if included, parallel track)

---

### Pitfall 8: CSS Cleanup Behavior Drift

**What goes wrong:**
CSS cleanup changes visual behavior unintentionally. Layouts shift, spacing changes, responsive behavior breaks.

**Why it happens:**
CSS is easy to change but hard to verify. "Cleaning up" patterns accidentally changes layout.

**Prevention:**
1. Visual regression baseline before CSS work
2. Automated screenshot comparison if possible
3. Manual verification checklist

**Warning signs:**
- CSS changes affect layout geometry
- Responsive behavior changes
- Visual appearance differs in subtle ways

**Phase to address:** CSS cleanup (parallel track)

## Integration Gotchas

| Integration | Common Mistake | Prevention |
| ----------- | -------------- | ----------- |
| Worker + WASM | WASM module not available in worker context | Test WASM worker import early |
| Pipeline unification | Hiding mode differences in shared code | Keep mode-specific logic explicit |
| GPS state sync | UI state and analysis state diverge | Single source of truth, integration test |
| Smoothing | Multiple layers apply smoothing differently | Document ownership, single source |
| Map cleanup | Refactor becomes rewrite | Hard scope boundary |

## "Looks Done But Isn't" Checklist

- [ ] **Worker:** Profiling data shows main thread blocking before implementation
- [ ] **Pipeline:** All modes tested explicitly, not just via shared interface
- [ ] **Air-speed fix:** Migration path for affected rides documented
- [ ] **GPS consolidation:** State sync verified in both directions
- [ ] **Smoothing:** Documented ownership, single source of truth
- [ ] **Weather spike:** Timebox respected, go/no-go decision made
- [ ] **Map cleanup:** Structural minimum only, no visual drift
- [ ] **CSS cleanup:** Visual regression baseline established

## Recovery Strategies

| Pitfall | Recovery | Cost |
|---------|----------|------|
| Premature workerization | Revert to debounced main-thread | LOW |
| Over-abstracted pipeline | Add mode-specific seams back | MEDIUM |
| Silent air-speed change | Document breaking change, user communication | HIGH |
| GPS state divergence | Restore original location, re-evaluate | MEDIUM |
| Multiple smoothing layers | Refactor to single ownership | MEDIUM |
| Weather scope creep | Cut back to spike scope | LOW |
| Map rewrite | Revert to structural-only | MEDIUM |
| CSS visual drift | Establish baseline, verify manually | LOW |

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
| ----------- | -------------- | ---------- |
| Pipeline unification | Over-abstraction | Keep mode differences explicit |
| GPS consolidation | State sync gap | Map dependencies before move |
| Smoothing | Layer ambiguity | Document ownership before implement |
| Worker offload | Premature complexity | Profile first, simple first |
| Weather | Scope creep | Timebox + go/no-go gate |

## Sources

- Existing codebase patterns
- Milestone context document
- PROJECT.md requirements
- v1.0 regression patterns

---
*Pitfalls research for: v1.1 Enhancement Wave*
*Researched: 2026-04-22*
