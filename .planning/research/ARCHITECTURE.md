# Architecture Research

**Domain:** Brownfield frontend UI-shell stabilization for a framework-free TypeScript + Rust/WASM app
**Researched:** 2026-04-12
**Confidence:** HIGH

## Standard Architecture

### System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                    Composition Root Layer                   │
├─────────────────────────────────────────────────────────────┤
│  main.ts                                                   │
│  - bootstraps app                                          │
│  - wires top-level dependencies                            │
│  - delegates to shell modules                              │
├─────────────────────────────────────────────────────────────┤
│                   Feature Shell Layer                       │
├─────────────────────────────────────────────────────────────┤
│  Section 3 shell   Standard VE shell   GPS shell   OAB shell│
│  - render/bind     - render/update     - tabs      - tabs   │
│  - lifecycle       - slider wiring     - updates   - updates│
├─────────────────────────────────────────────────────────────┤
│                Adapter / Integration Layer                  │
├─────────────────────────────────────────────────────────────┤
│  Plotly adapter         Map adapter         DOM helpers      │
│  - update strategy      - Leaflet cleanup   - query/bind     │
│  - trace/layout seam    - marker lifecycle  - templates      │
├─────────────────────────────────────────────────────────────┤
│               State / Domain / Service Layer                │
├─────────────────────────────────────────────────────────────┤
│  AppState   analysis/*   modes/*   activity/*   utils/*     │
│  wasm API   storage      weather   DEM         map data      │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
| --------- | -------------- | ---------------------- |
| `main.ts` composition root | Bootstrap and top-level orchestration only | Small entry module that constructs services and delegates to narrower shell modules |
| Feature shell controllers | Own one area of UI behavior and lifecycle | Module or small class with `mount`, `bind`, `update`, `destroy` style seams |
| DOM helpers | Centralize repeated lookup/binding/template utilities | Small utility modules, not a framework substitute |
| Plot adapter | Encapsulate plot creation vs update policy | Thin wrapper over Plotly `react` / `restyle` / `relayout` patterns |
| Map adapter/controller | Encapsulate Leaflet-specific lifecycle and cleanup | Stateful class/module with explicit listener and layer cleanup |
| `AppState` | Store typed state only | No DOM nodes, no long-lived service singletons |
| analysis/state/services modules | Domain logic and side-effect services | Existing extracted modules remain the primary home for non-UI behavior |

## Recommended Project Structure

A successful stabilization phase usually turns the old god-module into a composition root and introduces a feature-shell area without rewriting the whole project shape.

```text
frontend/src/
├── main.ts                    # composition root only
├── ui/
│   ├── shell/                 # workflow/section orchestration
│   │   ├── Section3Shell.ts   # lap/GPS selection shell
│   │   ├── StandardVEShell.ts # standard VE panel shell
│   │   ├── GpsLapShell.ts     # GPS-lap panel shell
│   │   └── OutAndBackShell.ts # out-and-back shell
│   ├── dom/                   # shared DOM/query/bind helpers
│   │   ├── elements.ts
│   │   ├── events.ts
│   │   └── templates.ts
│   └── plot/                  # optional thin Plotly adapter layer
│       └── PlotlyAdapter.ts
├── components/
│   └── MapVisualization.ts    # kept or trimmed only if needed
├── analysis/                  # existing domain helpers
├── activity/                  # existing load/normalize layer
├── modes/analysis/            # existing mode abstraction
├── plots/                     # existing pure builders
├── state/                     # AppState remains state-only
└── utils/                     # storage/weather/DEM/log/etc.
```

### Structure Rationale

- **`main.ts`:** should become a top-level composition root, not the implementation site for every workflow.
- **`ui/shell/`:** creates a home for browser-only orchestration that is too UI-specific for `analysis/` but too important to leave in `main.ts`.
- **`ui/dom/`:** prevents repeated `getElementById`, event rebinding boilerplate, and HTML-template glue from spreading across new files.
- **`ui/plot/`:** useful only if the current shell still mixes plot lifecycle policy with feature logic.
- **`components/MapVisualization.ts`:** remains intact unless a smaller extraction obviously helps the shell work.

## Architectural Patterns

### Pattern 1: Composition Root + Feature Controllers

**What:** Keep the entry file as the place where dependencies are created, but delegate each feature area to a narrower controller/module.
**When to use:** When one entry file is doing too much orchestration and implementation work.
**Trade-offs:** Adds more files and interfaces, but makes responsibilities much clearer and regression blast radius smaller.

**Example:**
```typescript
// main.ts
const section3Shell = createSection3Shell({ appState, mapVisualization, parameterStorage })
const standardVeShell = createStandardVeShell({ appState, plotly, parameterStorage })

section3Shell.mount()
standardVeShell.mount()
```

### Pattern 2: Render / Bind / Update Separation

**What:** Split dynamic UI work into explicit rendering, event binding, and incremental update steps.
**When to use:** When one function both generates HTML, registers listeners, and performs state updates.
**Trade-offs:** Slightly more ceremony, but it makes DOM lifecycle bugs easier to reason about and test.

**Example:**
```typescript
function renderGpsPanel(model: GpsPanelViewModel): string {
  return buildGpsPanelHtml(model)
}

function bindGpsPanelHandlers(root: HTMLElement, actions: GpsPanelActions): void {
  root.querySelector('[data-action="auto-adjust"]')?.addEventListener('click', actions.autoAdjust)
}

function updateGpsPanel(root: HTMLElement, model: GpsPanelViewModel): void {
  updateGpsSummary(root, model)
  updateGpsPlots(root, model)
}
```

### Pattern 3: Adapter Boundary Around Third-Party UI Libraries

**What:** Put Plotly/Leaflet lifecycle choices behind a thin local boundary instead of scattering direct calls throughout controllers.
**When to use:** When third-party APIs are stateful and easy to misuse during incremental updates.
**Trade-offs:** One more layer to maintain, but far less duplicated lifecycle knowledge.

**Example:**
```typescript
export function updateVePlot(target: HTMLElement, figure: PlotFigure): Promise<void> {
  return Plotly.react(target, figure.data, figure.layout, figure.config)
}

export function resetMapLayer(layer?: L.Layer, map?: L.Map): void {
  if (layer && map) {
    map.removeLayer(layer)
  }
}
```

### Pattern 4: State-Only Store, UI-Local Runtime Objects

**What:** Keep serializable or domain state in `AppState`; keep DOM nodes, map instances, and service singletons outside it.
**When to use:** Always in this repo; this is already an explicit project constraint.
**Trade-offs:** Requires passing dependencies more explicitly, but prevents state from becoming a god-object.

## Data Flow

### Request Flow

```text
[User Action]
    ↓
[Feature shell controller]
    ↓
[Domain helper / mode handler / service]
    ↓
[AppState update or WASM call]
    ↓
[Plot/Map adapter update]
    ↓
[DOM update visible to user]
```

### State Management

```text
[AppState]
    ↓ (read)
[Feature shell controller] ←→ [UI events]
    ↓ (delegates)
[analysis/*, modes/*, storage, wasm APIs]
    ↓ (result)
[AppState + view model]
    ↓
[render/update functions]
```

### Key Data Flows

1. **File-load to parameters flow:** upload -> parse/normalize -> `AppState` update -> section activation -> auto-scroll to parameters.
2. **Standard VE flow:** selection/trim changes -> analysis input resolution -> WASM calculator -> plot builders -> standard VE panel update.
3. **GPS in-place update flow:** GPS settings/auto-adjust -> multi-segment settings resolution -> recalculation -> active-tab-preserving panel refresh.
4. **Map-assisted selection flow:** map interaction -> selection state update -> shell module refresh -> optional plot refresh.

## Scaling Considerations

This project is not server-scale constrained. The relevant scale axis is **UI complexity and regression surface**, not backend traffic.

| Scale | Architecture Adjustments |
| ----- | ------------------------ |
| Current single-shell hotspot | Composition root + feature shell extraction is enough |
| Multiple UI-heavy feature waves | Add browser smoke coverage and stricter DOM/helper conventions |
| Large future UI expansion | Consider a larger shell/module architecture review only after the current stabilization proves itself |

### Scaling Priorities

1. **First bottleneck:** one file (`main.ts`) owning too much lifecycle logic - fix by extracting feature shell controllers and shared DOM helpers.
2. **Second bottleneck:** stateful third-party UI integrations (`Plotly`, `Leaflet`) leaking lifecycle details everywhere - fix by adding thin adapters or explicit lifecycle helpers.

## Anti-Patterns

### Anti-Pattern 1: God-Controller Entry File

**What people do:** keep `main.ts` as bootstrapper, renderer, event hub, template owner, plot orchestrator, and workflow implementation file.
**Why it's wrong:** every small change becomes high-risk and hard to reason about.
**Do this instead:** turn `main.ts` into a composition root with delegated shell modules.

### Anti-Pattern 2: File Splitting Without Responsibility Splitting

**What people do:** move chunks of code into new files but keep the same mixed render/bind/update responsibilities.
**Why it's wrong:** complexity is renamed, not reduced.
**Do this instead:** extract around responsibilities and lifecycle seams, not line-count alone.

### Anti-Pattern 3: Domain Logic Moving with UI Extraction

**What people do:** refactor UI and silently change calculator wiring or analysis semantics in the same move.
**Why it's wrong:** behavior drift becomes hard to detect and hard to attribute.
**Do this instead:** keep analysis math, WASM interfaces, and mode semantics stable unless a thin seam absolutely requires a small behavior adjustment.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
| ------- | ------------------- | ----- |
| Plotly | thin local adapter over update APIs | Prefer efficient update paths over redraw-by-recreation when possible |
| Leaflet | explicit controller/lifecycle wrapper | Clean up listeners and layers on mode switches or panel rebuilds |
| WASM exports | typed wrapper/factory functions | Keep the public shape stable during shell refactors |
| Browser storage | service classes outside state | Persistence remains important, but should not leak into every shell controller |

### Internal Boundaries

| Boundary | Communication | Notes |
| -------- | ------------- | ----- |
| `main.ts ↔ ui/shell/*` | direct construction and method calls | Keep explicit, no global event bus required |
| `ui/shell/* ↔ state/AppState.ts` | direct reads/writes through typed state access | Preserve state-only boundary |
| `ui/shell/* ↔ analysis/*` | function calls with typed inputs/results | Prefer pure helpers where possible |
| `ui/shell/* ↔ plots/*` | view-model/figure data handoff | Keep builders pure and shell DOM-specific |
| `ui/shell/* ↔ MapVisualization.ts` | narrow imperative calls | Touch only the map behavior each shell truly needs |

## Sources

- `.planning/PROJECT.md` - stabilization scope and invariants
- `.planning/codebase/ARCHITECTURE.md` - current module graph and shell hotspots
- `.planning/codebase/CONCERNS.md` - remaining architectural pressure points
- `https://vite.dev/guide/why` - current Vite architecture rationale and plugin/build continuity
- `https://vitest.dev/guide/browser/` - current browser-testing integration patterns for Vite/Vitest projects
- `https://plotly.com/javascript/plotlyjs-function-reference/` - update-vs-redraw lifecycle guidance
- `https://leafletjs.com/reference.html` - listener/layer cleanup surface relevant to map lifecycle management

---
*Architecture research for: brownfield frontend UI-shell stabilization*
*Researched: 2026-04-12*
