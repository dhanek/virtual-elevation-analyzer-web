# TODO

The single source of truth for open, pending and done work. Milestone v1.1 shipped 2026-08-30; this
file is what carries forward from it.

Most items came out of a phase verification, a milestone audit or a deferred-items note before
`.planning/` was pruned, and each keeps its origin so the reasoning behind it can still be found.
The *Feature requests* items came from the maintainer directly. Line references were re-verified at
commit `53e556f` unless marked otherwise.

**Structure.** Work is grouped into **bundles** — sets of items that share a file, a root cause or a
decision, and are cheaper and safer to do in one pass than separately. Items inside a bundle are
listed in the order they should be done. Bundles themselves are not ordered by priority; the
dependency column below says what actually has to wait.

**Conventions.**

- `- [ ]` open · `- [x]` done. When an item is finished, move it to *Done* at the bottom with its
  commit and date rather than deleting it — the anchors are the record of what was changed and why.
- Effort tags: **XS** under an hour · **S** an hour or two · **M** half a day · **L** a day or two ·
  **XL** needs design before an estimate means anything.
- Anything that needs a maintainer ruling before it can be implemented is listed under
  *Decisions needed* and cross-referenced from the item.

---

## Bundle map

| Bundle | What it is | Effort | Waits on |
|---|---|---|---|
| **A** | Wind height factor k, end to end | S–M | Decisions D-a, D-b |
| **B** | Make Store Result truthful | M | — |
| ~~**C**~~ | ~~Elevation resolver, and the test that should have caught it~~ | — | **Done** 2026-08-30, awaiting in-app check |
| **D** | Plot rendering and tab layout | M | — |
| ~~**E**~~ | ~~Cheap sweep~~ | — | **Done** 2026-08-30, awaiting in-app check |
| **F** | Weather — the deferred WEATH-01 feature | L–XL | Strictly internal order |
| **G** | Test infrastructure | M | — |
| **H** | On-screen results view | M–L | **A** (k column), **B** |
| — | Standalone work | varies | — |

Suggested order from here: **A**, which unblocks both the k feature and bundle H. E and C are done.

---

## Decisions needed

These block work below. None of them is a coding question.

- [ ] **D-a · Is the manual-wind re-seed a defect or the intended policy?**
      Phase 8 WR-05 recorded it as harm. The code documents it as correct:
      *"A weather fill arriving after a manual entry does re-seed k to 0.5, which is correct: the
      API has just overwritten the typed number with its own 10 m value."*
      (`frontend/src/shell/ve/windHeightControls.ts:225-234`). One of the two is wrong. Blocks the
      first item of bundle **A**.

- [ ] **D-b · What does "expand k to 0–100" mean?** A 0–100 **%** scale over the existing factor
      (0.00–1.00), or a genuinely unbounded 0–100 multiplier. They imply different
      `WIND_HEIGHT_FACTOR_MAX` values and different storage semantics. Blocks bundle **A**, which
      cannot fix the out-of-range render until it knows what the range is.

- [x] **D-c · Does the Crr slider step follow the widened range?** **Decided 2026-08-30: no.**
      Range opens to **0.0015 – 0.030**, `step` stays **0.0001** — 285 slider positions, finer than
      a drag can resolve, and the number input stays the precise path. Shipped in bundle E.

---

## Bundle A · Wind height factor k, end to end

*Effort: S–M. Why together: four of the five live in `windHeightControls.ts` (448 lines) and all
five hang off one bounds decision. Fixing the out-of-range render against today's 0.3–1.0 bounds
and then widening them means doing the same work twice.*

- [ ] **[S] Expand the k slider to a 0–100 scale for constant wind.** *(needs D-b)*
      Today k is fixed at `WIND_HEIGHT_FACTOR_MIN = 0.3` … `MAX = 1.0`, step `0.05`
      (`frontend/src/analysis/WindHeightTransfer.ts:46-48`), which is the right window for a *10 m
      weather-API* wind being transferred down to rider height. A hand-typed constant wind is
      already at whatever height the user meant, so that window is the wrong one for it.
      *origin: maintainer, 2026-08-30*

- [ ] **[S] A persisted out-of-range k renders narrowed, and the first slider touch commits the
      narrowing.** Storage correctly never rewrites the persisted value, but a stored 1.5 renders
      as slider 1.00 / number 1.50 / readout ×1.50 — three disagreeing views — and moving the
      thumb commits 1.00.
      `frontend/src/shell/ve/windHeightControls.ts:398-425` · *origin: Phase 8 WR-07*
      Do this **after** the item above: widening the bounds changes which stored values are
      out of range at all.

- [ ] **[S] Reopening a saved analysis silently re-fits a hand-typed wind.** *(needs D-a)*
      `syncWindHeightFromWeather` returns `{}` for `wind_entry: "weather"` and `"unknown"`, but
      falls through for `"manual"` — returning `wind_entry: "weather"` and
      `wind_height_factor: DEFAULT_WIND_HEIGHT_FACTOR`. So loading a saved analysis that used a
      hand-typed wind, with `auto_calculate_rho: true`, overwrites the wind with the API value and
      seeds k = 0.5. The user's own number is replaced without a prompt.
      `frontend/src/shell/ve/windHeightControls.ts:235-244` · *origin: Phase 8 WR-05*

- [ ] **[S] The height factor k is neither stored nor exported.**
      `wind_height_factor` round-trips correctly through `ParameterStorage`, but
      `ResultsStorage.saveResult` flattens `data.parameters` into cherry-picked named columns
      (`wind_speed`, `wind_direction`, `system_mass`, `rho`, `eta`) and never carries k across. It
      is absent from `StoredVEResult`, from `CSV_HEADERS` and from the CSV value row. Two results
      fitted at k = 0.50 and k = 1.00 are indistinguishable in the table and the export, and the
      stored `windSpeed` is the raw 10 m value while the physics used `wind_speed × k`.
      `crrApplied` (`ResultsStorage.ts:99`) and `virtualDistances` (`:114`) are the exact
      optional-field pattern to copy: interface field, `CSV_HEADERS` entry, value cell, guarded
      read for old records.
      `frontend/src/utils/ResultsStorage.ts:525-560` · *origin: Phase 8 WR-02 = audit WR-8*
      **Bundle H depends on this** — do it before the results view exists, so the new table is not
      born with a known-missing column.

- [ ] **[S] `windFieldsBound` is a membership-only `WeakSet`**, so the wind-field listeners freeze
      onto the first binding. Latent — harmless only while all three modes pass an identical
      `getParams` closure.
      `frontend/src/shell/ve/windHeightControls.ts` · *origin: Phase 8 WR-06*

## Bundle B · Make Store Result truthful

*Effort: M. Why together: these are one bug, not two — the analyze path never writes the state that
`summarize` writes (`segmentSummary.ts:249-258`), so everything seeded at analyze time is either
absent or left over from the previous run. **Bundle H depends on this**: without it the new results
view displays the same wrong numbers in a new place.*

- [ ] **[M] Store Result straight after Analyze records a wind source and virtual distances that no
      analyze ever wrote.** The only writers of `currentWindSource` and `currentVirtualDistances`
      live inside `summarize`, i.e. the update path. Press Store Result before touching a control
      and you persist `windSource: "none"` on a fresh session, or the *previous* analysis's values
      on a second analyze.
      `analyzeOrchestrator.ts:428-432`, `segmentSummary.ts:250,255`, `standardMode.ts:284,292`
      · *origin: audit WR-3*

- [ ] **[M] Store Result straight after Analyze persists an r²/RMSE the screen never showed (GPS
      modes).** `analyzeOrchestrator` assigns `payload.initialResult` — one stitched calculator run
      over the concatenated selection — while the GPS-lap panel displays N per-lap fits and
      out-and-back 2N leg fits. The first control nudge replaces it.
      `analyzeOrchestrator.ts:428` · *origin: audit WR-4*

## Bundle D · Plot rendering and tab layout

*Effort: M. Why together: all four touch the plotting and rendering path. Order matters — the layout
fix is cheap and visible, and the axis switch rewrites draw calls, so doing it after the
`Plotly.react` migration avoids writing the new axis code twice.*

- [ ] **[S–M] Layout: the Wind, Power and VD tabs waste most of their width.** Observed in all three
      (maintainer screenshots, 2026-08-30): the plot renders at roughly two-thirds width with dead
      space either side, a full-width empty bordered strip sits above it, and in the Wind tab the
      air-speed-offset control is stranded in its own box far to the right of the plot rather than
      under it. The VE tab does not show this. Suspects, not yet a diagnosis: `.ve-plots` is a flex
      column whose `.ve-plot-container` children carry `flex: 1`
      (`frontend/src/styles/ve-results.css:150-165`) while `.ve-tab-content--active` is
      `display: block` (`ve-results.css:360-366`), so that `flex: 1` does nothing; and the three
      tab panes interleave the plot container with the offset-control block
      (`renderStandardVe.ts:472-500`). Reproduce in the browser first — this one is a layout
      inspection, not a code read. *origin: maintainer, 2026-08-30*

- [ ] **[M] Out-and-back still uses `Plotly.newPlot` for plots redrawn on every update.** GPS-lap
      moved to `Plotly.react` some time ago. The VE and residual plots are the significant ones —
      redrawn on every slider update — and out-and-back computes 2N segments, so it is the mode
      most likely to feel the teardown cost. Worth doing behind a draw-method test that stubs both
      methods, as `gpsLapPlotDrawMethod.test.ts` does.
      `frontend/src/shell/outAndBack/outAndBackPlots.ts:142,160,192,461-462`; five more in
      `renderStandardVe.ts:157-181`

- [ ] **[M] A time/distance switch on the x-axis for standard mode.** Cheaper than it looks: every
      standard plot takes its x from one place — `input.context.timePoints{Before,Main,After}` —
      and hardcodes `title: 'Time (seconds)'` at
      `frontend/src/plots/StandardPlotBuilders.ts:293,540,646,780` (VE, wind, power, VD). So the
      work is a second context builder plus an axis title, not four plot rewrites. Two things to
      watch: distance must be cumulative across the whole series rather than per-slice, or the
      before/main/after regions will not line up; and `findOptimalAnnotationPosition`
      (`StandardPlotBuilders.ts:800`) takes the time array explicitly. The switch belongs at the
      axis, per the request, not in the sidebar. *origin: maintainer, 2026-08-30*

- [ ] **[S–M] A torn-down VE panel keeps its DOM, listeners and Plotly instances.** `Plotly.purge`
      has zero callers anywhere in `frontend/src`, so each mode change leaves one fully-wired,
      fully plotted panel alive behind `display: none` until the next analyze replaces it. Does not
      accumulate across cycles; memory/GC only. One 250 ms status-flash timer can also fire
      post-teardown and create a `#veRecomputeStatus` node inside the hidden panel — cosmetic.
      *origin: audit NEW-2*

## Bundle F · Weather — the deferred WEATH-01 feature

*Effort: L–XL. Why together, and why strictly in this order: Phase 6 spiked the feature and returned
a **GO**, scoped to riders **without** an air-speed sensor and **conditional on the two items
below**. Neither condition is met, so the GO does not yet authorise the work. Nothing here starts
early.*

- [ ] **[M] Condition (a): the weather cache is unbounded, and it is reachable today.**
      No TTL, no size cap, no eviction; `clearCache()` is the only removal path and its sole caller
      is a manual button. This is not gated behind the deferred feature — `autoRho` uses the cache
      now, keyed on the mean lat/lon of the **trim region**, so every distinct trim window mints a
      fresh permanent IndexedDB row.
      `frontend/src/utils/WeatherCache.ts:3,205,326`, `autoRho.ts:170-175`

- [ ] **[L] Condition (b): the spike's headline accuracy figure was measured on an endpoint
      production never calls.** Axis 3's "100% of windows resolved" was measured against
      `historical-forecast-api.open-meteo.com`. That host appears nowhere in this repo;
      `WeatherAPI.ts` calls only `api.open-meteo.com/v1/forecast` and
      `archive-api.open-meteo.com/v1/archive`, and the CSP allows exactly those two. Production
      routes rides older than `forecastMaxDays = 82` to **Archive at hourly**, whose head/tail MAE
      is **0.342 m/s — past axis 2's 0.3 bar**.
      So this is a re-measurement, not a config edit. Either add the endpoint (code *and* CSP) and
      re-measure, or restrict the feature to rides inside the 82-day forecast window.
      **This is the long pole of the whole bundle.**
      *Note: an earlier audit framed this as "a CSP gap to close". That framing was wrong and is
      corrected here.*

- [ ] **[L–XL] WEATH-01 itself**, once (a) and (b) are settled: per-quarter-hour sampling with
      interpolation, wired into the production auto-rho/VE path. Research is already done and the
      per-sample plumbing (`rho_array`, `wind_speed: Vec<f64>`) exists end-to-end, so this
      produces arrays rather than touching VE maths.

## Bundle G · Test infrastructure

*Effort: M. Why together: both are gaps in what the test and check commands actually cover, and both
are best judged against the same question — what does `npm run check` currently let through.*

- [ ] **[M] `frontend/scripts/**` is neither typechecked nor linted.** `tsconfig.json` includes only
      `src/**/*` and `npm run lint` runs `eslint src`, so `npm run check` and `npm run lint` both
      pass on a scripts file that cannot run. It has already shipped two runtime defects.
      `build-golden-fixture.ts` decides what becomes permanently public in a public repo.
      *Attempted and backed out:* a `tsconfig.scripts.json` extending the base fails two ways — the
      `@wasm/*` `paths` mapping does not resolve through `extends`, and it pulls all of `src/**`
      into a second check with different `types` resolution. Doing it properly means `baseUrl` +
      explicit `paths`, or project references.

- [ ] **[S] GPS-01 has no direct test.** GPS-02 is now closed and covered; GPS-01 (the mode selector
      reaching `setGpsAnalysisMode`) still has none.
      *origin: `2026-08-15-gps-state-sync-coverage-gap` todo, partially closed*

## Bundle H · On-screen results view

*Effort: M–L. **Gated on bundle A's k column and on bundle B** — build it after those and it shows
the right columns with the right values from day one; build it before and it inherits both defects
in a new surface.*

- [ ] **[M–L] An on-screen "show all results" view, with per-entry delete.** The only way to see
      stored results today is to download the CSV — `exportAllResultsToCSV`
      (`frontend/src/utils/ResultsStorage.ts:581`), wired to the one button each sidebar carries
      (`renderStandardVe.ts:417`, `renderGpsLap.ts:673`, `renderOutAndBack.ts:484`, handler
      `storageHandlers.ts:351`). `getAllResults()` (`ResultsStorage.ts:641`) already returns
      everything a table would need, so the reading half is free. Deleting is not: the store has
      `clearAllResults()` (`ResultsStorage.ts:666`) and `deleteDatabase()` only — all-or-nothing —
      so a single-entry delete needs a new keyed-delete method plus a decision about what the key
      is (`lapKey` is `fileName`-scoped, not unique on its own).
      *origin: maintainer, 2026-08-30*

## Standalone work

*Not bundled: each of these is isolated, or needs its own scoping before it can be sized honestly.*

- [ ] **[M–L] Section 3 destroys the map-trim slider bindings on every re-render.**
      `initializeMapTrimControlsForSelectedLaps` clones and replaces the four `mapTrim` nodes
      (`section3Orchestration.ts:1110-1138`), stripping the listeners `MODE_CONTROL_TABLE` bound,
      and its replacements never call `requestModeUpdate`. Reached from any lap-checkbox change.
      Self-heals only on the next Analyze. The clone-to-unbind idiom is what fights the mode
      control table, so the fix is structural — bind once and read live state — which is why this
      carries real regression risk and should **not** ride along with other work.
      `frontend/src/shell/section3/section3Orchestration.ts:1103-1200` · *origin: audit WR-5*

- [ ] **[XL] Outdoor velodrome auto-calibration.** `velodrome: true` today does exactly one thing —
      zero the actual elevation (`VeCalculatorFactory.ts:76`, `renderGpsLap.ts:232`,
      `renderOutAndBack.ts:219`). An outdoor velodrome sweeps every heading within a lap, which is
      what makes wind speed/direction (and k, and the air-speed calibration) jointly identifiable
      from the ride itself instead of from the weather API. The manual counterpart already exists:
      `appState.airSpeedCalibrationPercent` and its sidebar control
      (`WindSourceResolver.ts:71-72`, `airSpeedCalibrationControlMarkup`). Needs a brainstorm on
      what is fitted and how the fit is gated before any code — the vw-demo heading/air-speed
      calibration work is the closest prior art and its gating lesson (gate on the gust index, not
      on R²) applies here. *origin: maintainer, 2026-08-30*

- [ ] **[L] GPS gate detection: single gate vs A/B directional.** Reviewed during Phase 7 and
      deliberately not folded in — it is the detection layer, not the update pipeline. Needs its
      own investigation before it can be sized.
      `gateMarkers.ts`, `bindGpsDetection.ts`, `bindOutAndBackDetection.ts`

- [ ] **[M] Out-and-back's aggregation helpers have never been profiled.** GPS-lap's two
      equivalents each hid an O(targets × samples) rescan worth ~10 ms of a ~22 ms update.
      Out-and-back's `calculateOutAndBackStats` has the same shape and twice the segments. Not
      covered by the golden literals, which pin calculator output rather than downstream
      aggregation. Measuring is cheap; the fix cost is unknown until it is measured.
      `renderOutAndBack.ts` · *origin: Phase 7 deferred-items*

---

## Done

Completed items move here with their commit and date, keeping their anchors — the record of what
changed and why.

### Bundle C · Elevation resolver, and the test that should have caught it — 2026-08-30

Implemented in the working tree on branch `bundle-c-elevation-resolver`; **not yet committed**,
pending an in-app check. 824 tests pass (up 8), `npm run check` and `npm run lint` clean.

- [x] **[S] The two GPS analyze legs bypassed the elevation resolver.** Both now resolve exactly as
      the update path does: `allAltitude = resolveElevationProfile(appState, fitData,
      normalizedArrays.altitude).altitude`.
      `renderGpsLap.ts:113-124`, `renderOutAndBack.ts:105-116` · *origin: audit WR-1*

      The guard is in `gpsModeRealChain.test.ts` — "the analyze leg honours the active elevation
      profile", three cases per mode. That file was the right home because it already exists to
      answer vacuous guards, and because the analyze leg is **not** `showGpsLapVEPlot`: that entry
      point is handed profiles already computed and never reaches a calculator. The real leg is
      `showGpsLapVEAnalysis` / `showOutAndBackVEAnalysis`, now driven directly. The probe is the
      `altitude` array recorded by the harness's calculator mock — the one place the choice of
      profile is observable.

      Watched fail, and re-checked per mode after the fixture changed: reverting only the GPS-lap
      fix fails exactly the two GPS-lap DEM cases and leaves out-and-back green.

- [x] **[S] The "three modes" elevation-smoothing test was one guard named three times.** Rewritten
      as what it always was — unit tests for the toggle and the resolver — with a header naming
      where the mode-level guards actually live. The three mode-named cases collapsed into an
      `it.each` over the three profiles that asserts the **array**, not just the profile label: a
      resolver returning the right name with another profile's samples would have satisfied the old
      label-only assertion and still fed the physics the wrong elevation.
      `elevationToggle.integration.test.ts` · *origin: audit WR-2*

- [x] **Standard's leg was unguarded too** — not in the bundle, found while closing it. Standard
      resolves in `prepareAnalysisPayload`, and that file's tests only ever exercised the no-DEM
      path, so all three modes were in fact uncovered rather than two. Added "slices the ACTIVE
      elevation profile, not the raw FIT channel". It passed on first run, so it is a
      characterization test, not a TDD one — stated plainly; its value was confirmed by stubbing
      the resolver out and watching it fail with the raw-channel values.
      `prepareAnalysisPayload.test.ts`

### Bundle E · Cheap sweep — 2026-08-30

Implemented in the working tree; **not yet committed**, pending an in-app check. Test-first
throughout: 816 tests pass (up 6), `npm run check` and `npm run lint` clean.

- [x] **[XS] The wind readout prints `Infinity m/s`.** The guard named `null`/`undefined`/`NaN`
      explicitly and let `±Infinity` through to `toFixed`, printing `Rider-height wind: Infinity
      m/s`. Now `!Number.isFinite(raw)`, with the null/undefined arms kept because
      `Number.isFinite` is typed `(value: unknown) => boolean` and narrows nothing — dropping them
      fails `tsc` at the `raw.toFixed` below.
      `frontend/src/shell/ve/windHeightControls.ts:66-78` · test: `windHeightControls.test.ts`
      "empty when the configured wind is not finite" · *origin: Phase 8 IN-02*

- [x] **[XS] Dead CSS rule.** Confirmed dead before deleting: the control has exactly one markup
      site (`windHeightControls.ts:206`) and its only `<label>` is a SIBLING of
      `.wind-height-controls__row`, never a descendant, so the selector matched nothing.
      **The TODO's line reference was stale** — the dead rule was at `analysis-params.css:352-357`;
      line 342 is a live rule for the range input. A markup-shape guard now pins the premise
      (`windHeightControls.test.ts` "the k row contains no label of its own"); stated plainly, that
      test passed before the deletion too — it records why the rule went, it does not prove the
      removal. *origin: Phase 8 IN-01*

- [x] **[XS] Expand the Crr range.** `crr_min: 0.002 → 0.0015`, `crr_max: 0.015 → 0.03`
      (`frontend/src/components/AnalysisParameters.ts:67-71`), step unchanged per D-c. Defaults
      only — the bounds inputs already accepted 0.001–0.1, and all three sidebar sliders plus the
      `bindModeControls.ts:351` clamp derive from these, so it propagates on its own. Tests assert
      the *intent* (the range reaches gravel; the step still places a value inside it) rather than
      restating the constants: `AnalysisParameters.test.ts` "DEFAULT_PARAMETERS Crr bounds".
      *origin: maintainer, 2026-08-30*

- [x] **[S] `initializeVEAnalysis`'s placeholder calculator used un-offset FIT wind.** Confirmed
      real: the calculator read the raw FIT channel while the plots drawn directly beneath it read
      `resolveSelectionWindSeries` (offset + calibration), so the placeholder fit and the wind
      shown under it described different winds. Confirmed unobservable for two independent reasons
      — the result is never written to `appState`, and a synthetic `input` on `#trimStartSlider`
      replaces the paint at once — but both are properties of the CALLER that a future edit could
      remove. The resolve now happens once, above the calculator, and is shared with the plots.
      New pure helper `resolvePlaceholderWindSpeed` (`standardSegments.ts`) carries the decision so
      it is assertable without jsdom or Plotly; it keeps the NaN fill under constant wind and falls
      back to the raw series on any length mismatch, since a short array under the calculator would
      be a worse bug than an un-offset one.
      `renderStandardVe.ts:88-115` · tests: `standardSegments.test.ts` "resolvePlaceholderWindSpeed"
      · *origin: Phase 7 deferred-items*

---

## Where the history lives

`.planning/` was pruned on 2026-08-30 from 308 files to 24 — only what the items above actually
cite, plus the closing record. It is gitignored, so it lives on disk and not in git. What remains:

| Path | Why it was kept |
|---|---|
| `phases/06-weather-spike/06-FINDINGS.md` | The measurement data behind both bundle F conditions — axis results, method, the k = 0.5 fitting and its single-venue caveat. The re-measurement starts here. |
| `phases/08-wind-height-transfer/08-VERIFICATION.md` | Origin of six items (WR-02/05/06/07, IN-01/02) with the evidence for each — most of bundle A. |
| `phases/07-mode-pipeline-unification/deferred-items.md` | Origin of the scripts/, out-and-back plotting and aggregation items. |
| `milestones/v1.1-MILESTONE-AUDIT.md` | Origin of WR-1..WR-9 and NEW-2, with the corrected bundle F condition (b) framing. |
| `phases/*/​*-CONTEXT.md` | The decision log (D-01..D-20) — why `compare` collapses in GPS modes, why the debounce is 20 ms, the Option B trim ruling. Answers "why is it like this" when you touch the code. |
| `todos/pending/` | The three carried-forward investigations, in full. |
| `PROJECT.md`, `ROADMAP.md`, `STATE.md`, `MILESTONES.md`, `milestones/v1.0*`, `v1.1-{ROADMAP,REQUIREMENTS}.md` | Closing record for v1.0 and v1.1. |

Removed: all phase plans and summaries, research, plan-checks, validations, gate artifacts,
codebase maps, intel, graphs, UI reviews, debug sessions and the v1.0 phase archive. Superseded by
the shipped code and by git history.

**Full pre-prune copy:** `~/archive/vea-planning-full-2026-08-30.tar.gz` (308 files, 1.1 MB,
verified readable). Nothing was lost irreversibly — restore with
`tar -xzf ~/archive/vea-planning-full-2026-08-30.tar.gz`.

Not carried over, deliberately: items that only concern the accuracy of `.planning/` documents
themselves (a stale paragraph in a Phase 7 baseline doc, and a Phase 3 verification citing
constants that no longer exist). They describe retired artifacts, not shipped code.
