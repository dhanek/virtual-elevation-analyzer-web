# Architecture Research

**Domain:** VE analysis browser app enhancement architecture
**Researched:** 2026-04-22
**Confidence:** MEDIUM-HIGH

## Current Architecture (v1.0 baseline)

```
frontend/src/
├── main.ts                    # Composition root
├── shell/                     # UI shell modules
│   ├── app.ts
│   ├── analysis.ts
│   ├── fileLoad.ts
│   ├── section3.ts
│   ├── dem.ts
│   ├── ve.ts
│   ├── gpsLap.ts
│   └── outAndBack.ts
├── components/
│   └── MapVisualization.ts   # Secondary hotspot
├── analysis/
├── activity/
├── modes/
├── plots/
├── state/
└── utils/
```

## Architecture Changes for v1.1

### 1. Worker Integration

**Add:**
```
frontend/src/
├── workers/
│   └── ve-compute.worker.ts   # VE calculation in worker
├── shell/
│   └── [existing]            # Updated to use worker
```

**Integration Pattern:**
```typescript
// Shell delegates computation to worker
const worker = new VeComputeWorker()
worker.onmessage = (results) => updatePlots(results)
worker.postMessage({ rideData, parameters, mode })

// Cleanup on module destroy
worker.terminate()
```

### 2. Pipeline Unification

**Goal:** Unified update pipeline across modes

**Pattern:**
```typescript
interface AnalysisPipeline {
  compute(input: AnalysisInput): Promise<AnalysisResult>
  update(input: Partial<AnalysisInput>): Promise<Partial<AnalysisResult>>
  cancel(): void
}

// Each mode implements same interface
class StandardVePipeline implements AnalysisPipeline { ... }
class GpsLapPipeline implements AnalysisPipeline { ... }
class OutAndBackPipeline implements AnalysisPipeline { ... }
```

### 3. GPS UI Consolidation

**Move GPS mode selector from:**
- Current: Analysis Parameters section

**To:**
- Section 3: Near lap-selection UI (where GPS modes are used)

**State synchronization:**
```typescript
// Single source of truth in AppState
interface GpsModeState {
  selectedMode: 'gps-lap' | 'out-and-back' | 'gps-gate-one-way'
  autoAdjust: boolean
  // ...
}

// Shell reads/writes via state service
section3Shell.setGpsMode(state.gpsMode)
```

### 4. Smoothing Layer Ownership

**Decision needed:** Data layer vs visualization layer

**Option A: Data layer (recommended)**
```typescript
// In analysis/ or activity/
function applySmoothing(records: RideRecord[], smoothingParams: SmoothingParams): RideRecord[] {
  // Smooth elevation data before analysis
  return smooth(records, smoothingParams)
}
```

**Option B: Visualization layer**
```typescript
// In plots/ or shell/
function buildSmoothingPlot(rawData: RideRecord[], smoothedData: RideRecord[]): PlotFigure {
  // Show both for comparison
  return buildComparisonPlot(rawData, smoothedData)
}
```

**Recommendation:** Option A - smooth at data layer for consistency, show both in visualization if needed.

## Key Architecture Decisions

| Decision | Recommendation | Rationale |
| -------- | -------------- | --------- |
| Worker approach | Start with debounced main-thread, upgrade if needed | Simpler initial implementation |
| Pipeline unification | Shared interface, mode-specific implementations | Consistency without over-abstraction |
| Smoothing ownership | Data layer | Single source of truth, consistent results |
| GPS UI move | Section 3, near lap selection | Logical workflow proximity |

## Suggested Build Order

1. **Phase 1:** Pipeline foundation + air-speed fix
2. **Phase 2:** GPS UI consolidation
3. **Phase 3:** Worker offload (if profiling confirms need)
4. **Phase 4:** Smoothing clarification + implementation
5. **Phase 5:** CSS + Map cleanup
6. **Phase 6:** Weather spike or closeout

## Sources

- Existing shell modules under `frontend/src/shell/`
- PROJECT.md current milestone section
- MILESTONE-CONTEXT.md goals

---
*Architecture research for: v1.1 Enhancement Wave*
*Researched: 2026-04-22*
