# Pitfalls Research

**Domain:** Brownfield frontend UI-shell stabilization for a framework-free browser app
**Researched:** 2026-04-12
**Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: Big-Bang Rewrite Disguised as Refactor

**What goes wrong:**
The team sets out to “clean up `main.ts`” but quickly turns the effort into a UI-platform rethink, folder reshuffle, and abstraction rewrite. Scope expands faster than confidence.

**Why it happens:**
Large files create emotional pressure to fix everything at once. Brownfield teams also underestimate how much behavior lives in messy orchestration code.

**How to avoid:**
Use a staged extraction plan. Keep `main.ts` as a temporary composition root. Extract one shell area at a time with explicit invariants and checkpoint validation.

**Warning signs:**
- New architecture diagrams appear before concrete seams
- The phase starts proposing framework migration or major state rewrites
- `main.ts` shrinks, but no single workflow is clearly safer to modify

**Phase to address:**
Phase 1 - Shell seams and regression guardrails

---

### Pitfall 2: Behavior Drift While Moving Code

**What goes wrong:**
The app still “works,” but subtle UX behavior changes: wrong tab stays active, scroll position resets, GPS auto-adjust behaves differently, or calibration values reload incorrectly.

**Why it happens:**
Fragile UI behavior often lives in ordering, timing, and lifecycle details rather than in obvious business rules. Those details get lost during extraction.

**How to avoid:**
Write down regression-sensitive invariants before moving code. Protect them with targeted smoke tests and explicit verification steps at each checkpoint.

**Warning signs:**
- Refactor PRs say “no behavior change” but do not list preserved flows
- GPS or multi-segment flows are only manually spot-checked once
- In-place update paths are replaced with full rerenders for convenience

**Phase to address:**
Phase 1 - Shell seams and regression guardrails

---

### Pitfall 3: Event-Listener Duplication and Stale Closures

**What goes wrong:**
Dynamic panels re-render, but old event listeners remain or new ones capture stale state. Users see double-triggered actions, wrong tabs, or updates targeting old DOM.

**Why it happens:**
Framework-free DOM code often mixes template generation, one-off `addEventListener`, and partial DOM replacement without a clear mount/unmount contract.

**How to avoid:**
Split render/bind/update steps. Prefer idempotent handler assignment or explicit cleanup. Keep closures short-lived and tied to one mounted DOM subtree.

**Warning signs:**
- Re-rendered panels require “initialized” flags everywhere
- Bugs appear only after using the same panel multiple times
- Developers fix duplicate events by adding more guard booleans

**Phase to address:**
Phase 2 - Panel extraction and lifecycle cleanup

---

### Pitfall 4: Plotly / Leaflet Lifecycle Leaks

**What goes wrong:**
Plots or map layers are recreated unnecessarily, old layers remain attached, listeners accumulate, or updates become expensive and unpredictable.

**Why it happens:**
Third-party UI libraries are stateful. When their lifecycle rules are scattered across many event handlers, cleanup and incremental updates become inconsistent.

**How to avoid:**
Add thin adapter boundaries or explicit lifecycle helpers. Prefer `Plotly.react` / incremental update patterns and explicit Leaflet listener/layer cleanup when panels change.

**Warning signs:**
- Repeated `newPlot` style recreation in update-heavy flows
- Map mode switches require ad hoc manual cleanup code in multiple places
- Bugs appear only after several mode changes in one session

**Phase to address:**
Phase 2 - Panel extraction and lifecycle cleanup

---

### Pitfall 5: Node-Only Tests Giving False Confidence

**What goes wrong:**
Unit tests pass and typecheck is green, but the real browser workflow breaks because the issue is in file uploads, dynamic DOM, scroll behavior, focus, or live widget lifecycle.

**Why it happens:**
The highest-risk code in this repo is browser orchestration, while current frontend tests mostly cover pure helpers.

**How to avoid:**
Add a very small number of browser-level smoke tests for the most fragile end-user flows. Do not aim for exhaustive e2e coverage in this phase.

**Warning signs:**
- Every regression discovered is “browser-only”
- Manual verification scripts keep growing but are not automated
- Refactor checkpoints depend entirely on developer memory

**Phase to address:**
Phase 1 and Phase 2

---

### Pitfall 6: Secondary Hotspot Steals the Project

**What goes wrong:**
`MapVisualization.ts` becomes so tempting to clean up that it starts dominating the phase, leaving `main.ts` only partially improved.

**Why it happens:**
Large secondary hotspots invite cleanup once contributors are already “in refactor mode.”

**How to avoid:**
Keep a hard rule: map work is only in-scope if it directly unblocks or clarifies the main shell extraction.

**Warning signs:**
- Map-specific abstractions multiply before Section 3 / VE shell work lands
- A large percentage of changed lines are in map code while `main.ts` remains huge
- Refactor progress is described mostly in terms of map internals

**Phase to address:**
Phase 3 - Secondary hotspot follow-up only if justified

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
| -------- | ----------------- | -------------- | --------------- |
| Giant `innerHTML` blocks in orchestration code | Quick to ship UI changes | Hard-to-track listeners, selectors, and inline styles | Only temporarily while extracting toward render/bind/update seams |
| Direct third-party calls everywhere | Fast local fixes | Lifecycle policy gets duplicated and inconsistent | Rarely; prefer a thin local adapter where updates are repeated |
| Guard-flag proliferation for event setup | Masks duplicate binding bugs quickly | Makes lifecycle harder to reason about and test | Only as a temporary stopgap during incremental extraction |
| Mixed UI + domain refactors in one commit | Fewer passes through the code | Regression attribution becomes unclear | Never ideal; split behavioral fixes from structural refactors when possible |
| “Any” at UI boundaries | Fast interop | Drift spreads through controllers and view models | Acceptable only at narrow interop seams with explicit containment |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
| ----------- | -------------- | ---------------- |
| Plotly | Recreate plots with `newPlot` during every update path | Prefer `react`, `restyle`, and `relayout` where the plot identity should stay stable |
| Leaflet | Remove visible layers but forget listener/event cleanup | Pair layer changes with explicit listener cleanup and lifecycle ownership |
| Browser file inputs | Validate happy path only | Test real upload flows and downstream section activation/scroll behavior |
| IndexedDB/localStorage-backed UI state | Refactor UI without checking persistence semantics | Verify saved settings still restore correctly across mode changes and selection changes |
| CDN-loaded assets + CSP | Introduce new runtime assets casually during refactor | Keep CSP-compatible assets and avoid widening network surface unnecessarily |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
| ---- | -------- | ---------- | -------------- |
| Full plot recreation on every slider or mode update | Janky updates, flicker, growing latency | Keep update policy explicit and incremental where possible | Breaks quickly in update-heavy VE workflows |
| Rebinding whole DOM subtrees repeatedly | Duplicate events, poor responsiveness, confusing lifecycle bugs | Separate render from update and keep handler setup idempotent | Breaks once panels are revisited often in one session |
| Re-cloning large arrays in UI code | Sluggish recompute-adjacent flows | Continue using the extracted cache and keep array churn out of shell code | Breaks on longer rides and multi-segment workflows |
| Premature workerization | More moving pieces, harder debugging | Profile after shell cleanup before changing concurrency model | Breaks team focus more than runtime at current scale |

## Security Mistakes

| Mistake | Risk | Prevention |
| ------- | ---- | ---------- |
| Expanding remote asset usage during refactor | CSP drift and larger external attack surface | Keep the existing privacy-first/browser-local stance and static CSP model |
| Logging or exporting ride-sensitive data during debugging | Privacy regressions in a privacy-first product | Keep lightweight centralized logging and avoid casual debug dumps of ride data |
| UI changes that silently alter local persistence semantics | Wrong settings/results restored from browser storage | Verify migration behavior and restoration paths when changing shell wiring |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
| ------- | ----------- | --------------- |
| Lost scroll position or unexpected top-of-page jumps | Makes the UI feel broken or disorienting | Preserve known scroll behavior explicitly and test it after extraction |
| Tab resets on in-place GPS updates | Users lose context while tuning settings | Preserve active tab and only update the data/plots that changed |
| Hidden state changes during mode switch | Users cannot predict what the app will do | Make shell ownership and update flows clearer and more local |
| Extracted UI with unchanged inline-style/template sprawl | Code is “moved” but still hard to reason about | Extract responsibility, not just lines of code |

## "Looks Done But Isn't" Checklist

- [ ] **`main.ts` shrinkage:** Often missing real responsibility transfer - verify extracted modules own render/bind/update logic, not just wrappers
- [ ] **GPS mode safety:** Often missing tab/scroll preservation - verify in-place updates keep current UX behavior
- [ ] **Regression protection:** Often missing browser-level validation - verify at least the fragile flows are exercised end-to-end
- [ ] **Map safety:** Often missing cleanup discipline - verify listener/layer teardown after mode changes
- [ ] **Behavior preservation:** Often missing persistence checks - verify saved settings/calibration still restore correctly
- [ ] **Refactor focus:** Often missing scope discipline - verify `MapVisualization.ts` work stayed secondary to `main.ts`

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
| ------- | ------------- | -------------- |
| Big-bang rewrite drift | HIGH | Cut scope, re-establish explicit invariants, and land smaller extraction slices |
| Behavior drift in fragile flows | MEDIUM/HIGH | Reproduce in browser, add smoke coverage, then split behavior fix from structural move |
| Event-listener duplication | MEDIUM | Rework the affected shell around mount/update/unmount or idempotent binding |
| Plot/map lifecycle leak | MEDIUM | Introduce thin adapter/helper layer and centralize cleanup ownership |
| Map hotspot taking over | MEDIUM | Freeze map work, finish primary shell extraction, revisit secondary cleanup later |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
| ------- | ---------------- | ------------ |
| Big-bang rewrite disguised as refactor | Phase 1 | `main.ts` extraction plan is staged, scoped, and preserves current architecture constraints |
| Behavior drift while moving code | Phase 1 | Fragile flows are enumerated and explicitly checked after checkpoints |
| Event-listener duplication and stale closures | Phase 2 | Re-render/revisit flows do not duplicate actions or lose current state |
| Plotly / Leaflet lifecycle leaks | Phase 2 | Multi-update sessions remain stable without tab/layer/listener regressions |
| Node-only tests giving false confidence | Phase 1 / 2 | At least a small browser smoke layer exists or equivalent browser verification is formalized |
| Secondary hotspot steals the project | Phase 3 | `main.ts` materially improved before optional map work expands |

## Sources

- `.planning/PROJECT.md` - current scope, constraints, and regression-sensitive behavior
- `.planning/codebase/CONCERNS.md` - confirmed remaining hotspots and risk concentrations
- `.planning/codebase/TESTING.md` - current test coverage shape and missing browser-level coverage
- `https://playwright.dev/docs/best-practices` - isolation, locators, and trace-based debugging guidance relevant to regression protection
- `https://plotly.com/javascript/plotlyjs-function-reference/` - update-vs-recreate guidance relevant to plot lifecycle traps
- `https://leafletjs.com/reference.html` - event/listener/layer cleanup API reference relevant to map lifecycle traps
- repo context and recent bugfix history already captured during the brownfield audit

---
*Pitfalls research for: brownfield frontend UI-shell stabilization*
*Researched: 2026-04-12*
