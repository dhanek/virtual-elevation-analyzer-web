# Milestone Context

**Gathered:** 2026-04-22
**Status:** Ready for /gsd-new-milestone

<milestone_goal>
## Goal

Users can use the same VE analysis tool with identical results, better performance, enhanced features, and a cleaned design.

</milestone_goal>

<scope>
## Scope

### In this milestone

- **Performance**: Evaluate and implement worker offload for multi-lap VE analysis to improve slider interaction responsiveness; combine with PERF-01 evaluation

- **Pipeline unification**: Fix latent air-speed calibration bugs in Standard VE mode; unify render/update pipeline across Standard, GPS-lap, and Out-and-back modes to prevent future divergence

- **GPS mode UI consolidation**: Move the GPS analysis mode selector from Analysis Parameters into Section 3 near the lap-selection UI it controls; keep state in sync

- **Elevation smoothing**: Clarify where smoothing belongs — data processing layer or visualization layer — and implement consistently

- **Continuous weather sampling**: Exploratory spike evaluating per-quarter-hour weather sampling with interpolation for longer rides; implement as full feature if spike succeeds

- **Map cleanup**: Address MapVisualization.ts complexity; minimum is better structure, ideal is structure + visual polish (MAP-01)

- **Testing improvements**: Add/improve tests as makes sense for each individual feature area (TEST-01)

- **CSS cleanup**: Address CSS debt identified during v1.0 stabilization (CSS-01)

### Explicitly out of scope

No explicit exclusions — boundary is the in-scope list above

</scope>

<constraints>
## Constraints

- No breaking changes to existing analysis behavior — calculation logic must maintain unchanged
- Must maintain browser-local privacy model — ride data stays in the browser

</constraints>

<success>
## Success Definition

This milestone is successful when:
- Users get identical VE analysis output (same calculation results verified)
- Slider interactions in multi-lap analysis feel noticeably faster
- GPS mode selection is accessible from the lap-selection workflow
- Elevation smoothing behavior is documented and consistent
- Weather sampling has been evaluated with a clear go/no-go decision
- MapVisualization.ts structure is improved and optionally polished
- Test coverage reflects the new/changed code
- UI styling is cleaner and more consistent

</success>

<open_questions>
## Open Questions for Planning

- **Continuous weather**: Exploratory spike first — implement as full feature only if spike succeeds
- **MAP-01**: Minimum is structural improvement; ideal includes visual polish
- **Testing approach**: Per-feature decisions — unit, integration, or e2e as makes sense for each item
- **Pipeline + Performance synergy**: Consider whether pipeline unification should precede worker offload for cleaner implementation path, but no hard dependency

</open_questions>

---

*Milestone context gathered: 2026-04-22*
*Run /gsd-new-milestone to start planning*
