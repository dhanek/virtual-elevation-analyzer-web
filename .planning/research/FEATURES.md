# Feature Research

**Domain:** Brownfield frontend UI-shell stabilization for a browser-first analysis app
**Researched:** 2026-04-12
**Confidence:** HIGH

## Feature Landscape

This is a little unusual because the “product” under research is not a brand-new end-user product. It is a stabilization phase for an already-working brownfield app. So the relevant feature landscape is: **what capabilities a good stabilization phase must deliver so the product remains trustworthy while the frontend shell becomes easier to change.**

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = the stabilization effort failed even if the code got “cleaner.”

| Feature | Why Expected | Complexity | Notes |
| ------- | ------------ | ---------- | ----- |
| Behavior-preserving refactor | Users do not care that files moved; they expect the app to keep working | HIGH | The key success measure is unchanged user-facing behavior in standard and GPS-based flows. |
| Regression protection for fragile workflows | This repo already has known regression-sensitive flows | HIGH | Auto-scroll, in-place GPS updates, tab preservation, and calibration behavior must stay intact. |
| Smaller, clearer `main.ts` responsibilities | The whole point of the phase is reducing risk concentrated in one giant file | MEDIUM | `main.ts` should become more of a composition root and less of a feature implementation file. |
| Extracted panel/controller seams | Future UI work needs stable places to land | MEDIUM | Section 3, standard VE, GPS-lap, and out-and-back shell logic should have narrower homes. |
| CI-safe validation after each checkpoint | Refactor confidence must be earned, not assumed | MEDIUM | Existing CI parity is already a validated capability and should remain the minimum safety bar. |

### Differentiators (Competitive Advantage)

For this phase, “competitive advantage” means engineering leverage beyond bare-minimum cleanup.

| Feature | Value Proposition | Complexity | Notes |
| ------- | ----------------- | ---------- | ----- |
| Measurable shell shrinkage targets | Prevents “refactor” from becoming hand-wavy | MEDIUM | Use file/function-level metrics, not just subjective cleanliness. |
| Shared DOM/template/event helpers | Reduces duplicated brittle logic across panels | MEDIUM | Especially useful for dynamic HTML blocks, tab wiring, and analysis-panel lifecycle code. |
| Browser smoke tests for high-risk flows | Catches regressions node-only tests miss | MEDIUM | Particularly valuable for upload → scroll → analyze → tab-preservation workflows. |
| Optional first-pass `MapVisualization.ts` cleanup | Extends safety improvements to the second hotspot without making it the project center | MEDIUM | Should only happen if it clearly supports main-shell extraction. |
| Stable testing hooks / selectors | Makes future UI work faster to validate | LOW/MEDIUM | Data-testids or similarly stable selectors are often worth adding during stabilization. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
| ------- | ------------- | --------------- | ----------- |
| Framework migration during stabilization | “If we’re touching the shell anyway, let’s move to React/Vue” | Turns targeted cleanup into a rewrite and destroys behavior-attribution clarity | Keep the current framework-free shell and extract narrower modules incrementally |
| UI redesign at the same time | Refactors feel more “worth it” if they also change the interface | Mixing structural and visual change makes regressions harder to isolate | Preserve current UX and only make tiny behavior tweaks when they directly enable safer extraction |
| Generic mega-abstraction for all analysis modes | Seems cleaner on paper | Usually erases real differences between standard, GPS-lap, and out-and-back flows | Use focused shared helpers plus mode-specific modules where semantics differ |
| Workerization as a refactor objective | Performance work feels adjacent to cleanup | The current bottleneck is structural complexity, not proven compute overload | Stabilize the shell first and re-profile later |
| Rewriting the map subsystem just because it is large | `MapVisualization.ts` is a hotspot, so it is tempting to tackle it fully | Splits attention away from the dominant `main.ts` risk and increases blast radius | Touch the map only when it cleanly enables the primary shell extraction |

## Feature Dependencies

```text
Regression-safe extraction
    └──requires──> Stable validation baseline
                           └──requires──> CI parity remains intact

Section 3 / VE / GPS panel extraction
    └──requires──> Shared DOM and event helper seams
                           └──requires──> main.ts becomes a composition root

Optional map cleanup
    └──requires──> Primary main.ts stabilization not being blocked

Browser smoke tests
    └──enhances──> Regression-safe extraction

UI redesign
    ──conflicts──> Behavior-preserving stabilization
```

### Dependency Notes

- **Regression-safe extraction requires stable validation baseline:** without reliable validation, “clean” moves become guesswork.
- **Panel extraction requires shared DOM/event seams:** otherwise code merely moves from one giant file into several giant files.
- **Browser smoke tests enhance regression-safe extraction:** they directly cover the kinds of tab/scroll/upload issues unit tests miss.
- **UI redesign conflicts with stabilization:** it changes the observable surface at the same time the structure changes underneath.
- **Optional map cleanup depends on not blocking primary shell work:** if map work starts dominating, the phase loses focus.

## MVP Definition

### Launch With (v1)

Minimum viable stabilization for this project.

- [ ] `frontend/src/main.ts` is materially smaller and no longer owns the bulk of Section 3 / VE / GPS / out-and-back shell implementation
- [ ] Regression-sensitive behavior is explicitly preserved in the refactored shell
- [ ] Shared DOM/event/template seams exist so future UI-heavy work does not have to re-open `main.ts` for every change
- [ ] CI parity still passes after the stabilization work

### Add After Validation (v1.x)

Features to add once the main shell extraction is proven stable.

- [ ] Optional `MapVisualization.ts` reduction if the new shell boundaries make the next step obvious
- [ ] Broader browser-level smoke coverage for secondary flows
- [ ] More template/style extraction from remaining dynamic HTML hotspots

### Future Consideration (v2+)

Features to defer until after stabilization proves its value.

- [ ] Framework migration reconsideration - only if future product direction explicitly justifies it
- [ ] Worker/offload revisiting - only if fresh profiling after shell cleanup shows remaining need
- [ ] Larger product feature expansion built on the new shell boundaries

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
| ------- | ---------- | ------------------- | -------- |
| Preserve behavior during refactor | HIGH | HIGH | P1 |
| Shrink `main.ts` materially | HIGH | MEDIUM | P1 |
| Extract Section 3 / VE / GPS / out-and-back shell modules | HIGH | MEDIUM | P1 |
| Keep CI parity green | HIGH | LOW/MEDIUM | P1 |
| Add browser smoke tests for fragile flows | HIGH | MEDIUM | P2 |
| Shared DOM/template/event helper layer | MEDIUM/HIGH | MEDIUM | P2 |
| Opportunistic `MapVisualization.ts` cleanup | MEDIUM | MEDIUM | P2 |
| Broad styling/template modernization | MEDIUM | MEDIUM/HIGH | P3 |
| Toolchain/framework migration | LOW for this phase | HIGH | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Competitor Feature Analysis

This is an internal stabilization initiative rather than a market-facing feature launch, so the more useful comparison is between common brownfield refactor approaches.

| Feature | Big-bang rewrite | Minimal file shuffling | Our Approach |
| ------- | ---------------- | ---------------------- | ------------ |
| Reduce `main.ts` risk | Fast theoretical reset, high regression risk | Usually not enough structural payoff | Incremental extraction with explicit behavioral invariants |
| Protect fragile UX flows | Often deferred until late | Usually under-specified | Preserve and test the known regressions first-class |
| Extract shared shell seams | Often replaced by new framework abstractions | Often skipped | Add narrow DOM/event/template helpers that fit the existing stack |
| Touch map hotspot | Temptation to rewrite with everything else | Avoided entirely even when useful | Secondary only; touch if it clearly supports the main extraction |

## Sources

- `.planning/PROJECT.md` - scope, invariants, and out-of-scope constraints for this brownfield phase
- `.planning/codebase/ARCHITECTURE.md` - current architecture and existing validated capabilities
- `.planning/codebase/CONCERNS.md` - confirmed remaining hotspots and risk areas
- `https://playwright.dev/docs/best-practices` - current guidance on resilient browser-level regression testing
- `https://vitest.dev/guide/browser/` - current browser-mode testing options for Vite/Vitest projects
- `https://plotly.com/javascript/plotlyjs-function-reference/` - current plot update performance guidance relevant to shell redraw behavior
- existing repo history and recent fixes already captured in current planning context

---
*Feature research for: brownfield frontend UI-shell stabilization*
*Researched: 2026-04-12*
