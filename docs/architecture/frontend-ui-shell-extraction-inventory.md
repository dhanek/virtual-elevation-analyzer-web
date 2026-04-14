# Frontend UI Shell Extraction Inventory

This document freezes the current `frontend/src/main.ts` hotspot baseline for the targeted UI-shell stabilization roadmap. It is intentionally more specific than “main.ts is large” so later phases can move code without re-discovering the same ownership questions.

## Current baseline

Regeneration command:

```bash
bash scripts/report-ui-shell-hotspots.sh
```

Most recent baseline captured during Phase 1 execution:

- `frontend/src/main.ts` lines: `7641`
- `document.getElementById(` count: `230`
- `addEventListener(` count: `85`
- `innerHTML = \`` count: `12`
- `style="` count: `142`
- `: any` count: `21`

Hotspot function anchors from `bash scripts/report-ui-shell-hotspots.sh`:

- `calculateAutoRho` — line `1027`
- `initializeSection3` — line `2543`
- `handleAnalyze` — line `2776`
- `showGpsLapVEPlot` — line `3276`
- `showVirtualElevationAnalysisInline` — line `4066`
- `setupVESliders` — line `4818`
- `updateGpsLapVEPlots` — line `5641`
- `showOutAndBackVEPlot` — line `6168`
- `updateOutAndBackVEPlots` — line `6909`

Interpretation:
- The remaining risk is concentrated in UI-shell rendering, DOM wiring, and live-update orchestration.
- The extracted domain helpers in `activity/`, `analysis/`, `modes/analysis/`, `plots/`, and `state/` already exist; the main remaining work is ownership transfer of shell behavior.
- Measurements can drift over time, so use `bash scripts/report-ui-shell-hotspots.sh` instead of quoting stale line-count anecdotes.

## Priority ownership buckets

### Section 3 shell

Primary future owner for:
- `initializeSection3`

Related responsibilities that belong with this bucket when later phases extract it:
- lap-selection rendering
- GPS detection panel rendering
- map/lap shell wiring
- analyze-button enablement rules

Notes:
- This bucket should own the DOM shell for Section 3 without absorbing analysis math or long-lived service state.
- It is the natural home for the current `initializeSection3` template and event setup work.

### Standard VE shell

Primary future owner for:
- `showVirtualElevationAnalysisInline`
- `setupVESliders`
- `calculateAutoRho`

Related responsibilities that belong with this bucket when later phases extract it:
- standard VE panel render/bind/update flow
- standard-mode slider wiring
- standard-mode trim/parameter interaction
- standard-mode VE panel refresh without touching GPS-specific shells

Notes:
- `setupVESliders` may later split internally into a standard VE binder plus smaller shared slider helpers, but its primary responsibility still belongs to the standard VE shell.
- `calculateAutoRho` is currently cross-cutting, but it sits closest to the standard parameter/trim shell and should be extracted with care so the existing behavior remains stable.

### GPS-lap shell

Primary future owner for:
- `showGpsLapVEPlot`
- `updateGpsLapVEPlots`

Related responsibilities that belong with this bucket when later phases extract it:
- GPS-lap VE panel render/update behavior
- tab wiring for GPS-lap result views
- in-place GPS recalculation behavior
- GPS-lap shell preservation of active tab and scroll position

Notes:
- This bucket must preserve the regression contract around in-place updates and GPS calibration behavior.
- `GPS gate one way` remains part of this frontend path through the existing analysis-mode routing.

### Out-and-back shell

Primary future owner for:
- `showOutAndBackVEPlot`
- `updateOutAndBackVEPlots`

Related responsibilities that belong with this bucket when later phases extract it:
- out-and-back VE panel render/update behavior
- out-and-back tab wiring
- in-place out-and-back recalculation behavior
- out-and-back shell preservation of active tab and scroll position

Notes:
- This bucket should stay focused on the out-and-back shell path rather than becoming a second composition root.
- It shares the same calibration and in-place update sensitivity as the GPS-lap shell, but with its own UI/render lifecycle.

### Shared DOM/event/template helpers

Primary future owner for:
- `handleAnalyze`

Related responsibilities that belong with this bucket when later phases extract it:
- top-level DOM/event delegation helpers
- repeatable shell template helpers
- shared button/radio/slider binding patterns
- composition-root-friendly orchestration helpers used by Section 3 and the VE shells

Notes:
- `handleAnalyze` is the main bridge between selection UI, mode handlers, and the rendered shell paths. It should move toward a narrower orchestration seam rather than stay buried in `main.ts`.
- This bucket should help shrink duplicated event/template code without collapsing everything back into one new helper god-module.

## Phase mapping

### Phase 2: Shell Infrastructure and Delegation

Primary targets:
- Shared DOM/event/template helpers
- early delegation seams used by `handleAnalyze`
- any helper extraction needed to let later shell modules take ownership cleanly

Expected effect:
- make later shell extraction more mechanical and less dependent on ad hoc DOM rewrites

### Phase 3: Section 3 and Standard VE Shell Extraction

Primary targets:
- Section 3 shell
- Standard VE shell

Expected effect:
- move the standard analysis setup and standard VE panel shell behavior out of `frontend/src/main.ts`
- preserve the file-load navigation and standard-mode behavior guarded in the regression contract

### Phase 4: GPS and Out-and-Back Shell Extraction

Primary targets:
- GPS-lap shell
- Out-and-back shell

Expected effect:
- move the GPS-specific panel render/update shell behavior out of `frontend/src/main.ts`
- preserve in-place updates, tab/scroll retention, and GPS calibration correctness

## Secondary hotspot guidance

`frontend/src/components/MapVisualization.ts` remains secondary.

Current guidance:
- treat `MapVisualization.ts` as a context file, not a co-equal Phase 1 target
- only touch `MapVisualization.ts` when the change clearly supports the main shell extraction path
- do not expand the milestone by trying to fully decompose Leaflet lifecycle behavior before the `frontend/src/main.ts` shell is materially smaller

Why this is secondary:
- `MapVisualization.ts` is still large and stateful, but Phase 1 research and concerns both show that the highest-value reduction is still concentrated in `frontend/src/main.ts`
- the roadmap intentionally prioritizes shell ownership transfer first, then only justified secondary cleanup

## How to use this inventory

Before later extraction work:
1. run `bash scripts/report-ui-shell-hotspots.sh`
2. compare the new numbers and line anchors to this baseline
3. confirm the planned move still matches one of the ownership buckets above
4. keep the regression contract and manual checklist in sync with any anchor moves

If the hotspot list changes materially during later phases, update this inventory in the same change so roadmap consumers inherit fresh ownership guidance instead of stale measurements.
