# Feature Research

**Domain:** VE analysis browser app enhancement - performance, pipeline, GPS, weather, map
**Researched:** 2026-04-22
**Confidence:** MEDIUM-HIGH

## Feature Categories for v1.1

### Performance: Worker Offload

**Table Stakes:**
- Slider interactions remain responsive during multi-lap recompute
- No visible UI freeze during large ride processing
- Progress indication for long computations

**Differentiators:**
- Background computation with cancellation on new input
- Progressive result updates (first result fast, refinement later)
- Memory-efficient data transfer (transferables vs clones)

**Complexity:** MEDIUM-HIGH
- Requires profiling first to confirm bottleneck location
- Worker lifecycle management adds complexity
- WASM in worker context requires careful setup

### Pipeline Unification

**Table Stakes:**
- Consistent update behavior across Standard, GPS-lap, Out-and-back modes
- No divergent render/update paths that cause mode-specific bugs
- Air-speed calibration works correctly in Standard VE mode

**Differentiators:**
- Shared update pipeline reduces code duplication
- Easier to add new analysis modes in future
- Consistent state synchronization

**Complexity:** MEDIUM
- Primarily refactoring existing code paths
- Risk of behavior drift if not careful
- Requires thorough regression testing

### GPS Mode UI Consolidation

**Table Stakes:**
- GPS mode selector visible near lap-selection UI
- Mode state stays synchronized with section activation
- No duplicate or conflicting state management

**Differentiators:**
- Consistent UI layout regardless of analysis mode
- Logical workflow flow: select laps → choose GPS mode → configure

**Complexity:** LOW-MEDIUM
- UI element relocation
- State sync between relocated controls
- Existing shell modules provide integration points

### Elevation Smoothing

**Table Stakes:**
- Smoothing behavior is documented and consistent
- User understands where smoothing applies
- Results are reproducible

**Differentiators:**
- Single source of truth for smoothing parameters
- Consistent application across all analysis modes

**Complexity:** MEDIUM
- Requires clarifying existing code paths
- May need to standardize parameter naming
- Documentation updates

### Continuous Weather Sampling

**Table Stakes:**
- Weather data available for entire ride duration
- Interpolation between known data points
- Graceful degradation if weather API is unavailable

**Differentiators:**
- More accurate air density for longer rides
- Per-quarter-hour sampling as a spike (go/no-go decision)

**Complexity:** MEDIUM
- Exploratory spike first (as noted in milestone context)
- API integration, caching, interpolation logic
- May be deferred based on spike outcome

### Map Visualization Cleanup

**Table Stakes:**
- Map component is maintainable
- No behavior changes from current user perspective

**Differentiators:**
- Cleaner internal structure for future work
- Potentially improved rendering performance

**Complexity:** MEDIUM
- Structural refactor only (minimum)
- Visual polish is optional (ideal)
- MAP-01 deferred from v1.0

### CSS Cleanup

**Table Stakes:**
- Existing visual behavior preserved
- No layout regressions

**Differentiators:**
- More maintainable CSS structure
- Consistent naming/pattern usage

**Complexity:** LOW
- Pattern cleanup and organization
- No functional changes

## Feature Dependencies

```
Worker Offload
    └──requires──> Pipeline Unification (cleaner integration)
                          └──requires──> GPS UI Consolidation

Elevation Smoothing
    └──requires──> Pipeline Unification (where to apply smoothing)

Continuous Weather (spike)
    └──independent──> Can spike in parallel

Map Cleanup
    └──independent──> Can proceed in parallel
```

## MVP Recommendation for v1.1

**Prioritize:**
1. Pipeline Unification + Air-speed Fix (foundation for other work)
2. GPS UI Consolidation (clear user value, low risk)
3. Worker Offload (if profiling confirms need)
4. CSS Cleanup (can proceed in parallel)
5. Elevation Smoothing (clarify then implement)
6. Map Cleanup (structural minimum)
7. Weather Spike (exploratory, go/no-go)

**Defer:** Weather full implementation (await spike outcome)

## Sources

- Existing codebase patterns
- Milestone context document
- PROJECT.md requirements

---
*Feature research for: v1.1 Enhancement Wave*
*Researched: 2026-04-22*
