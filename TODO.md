# TODO

Open development work carried forward after milestone v1.1 (2026-08-30).

This file is the working backlog. It replaces the `.planning/` GSD structure for tracking
outstanding work — every item below was extracted from a phase verification, a milestone audit or
a deferred-items note before those were archived, and each carries its origin so the reasoning
behind it can still be found.

Line references were re-verified at commit `1d18867` unless marked otherwise. Items are ordered by
consequence, not by discovery date.

---

## Data integrity

Things that persist or export a value that is wrong. These come first because a bad stored record
outlives the session that made it, and the CSV is the end product.

- [ ] **Reopening a saved analysis silently re-fits a hand-typed wind.**
      `syncWindHeightFromWeather` returns `{}` for `wind_entry: "weather"` and `"unknown"`, but
      falls through for `"manual"` — returning `wind_entry: "weather"` and
      `wind_height_factor: DEFAULT_WIND_HEIGHT_FACTOR`. So loading a saved analysis that used a
      hand-typed wind, with `auto_calculate_rho: true`, overwrites the wind with the API value and
      seeds k = 0.5. The user's own number is replaced without a prompt.
      `frontend/src/shell/ve/windHeightControls.ts:235-244` · *origin: Phase 8 WR-05*

- [ ] **The height factor k is neither stored nor exported.**
      `wind_height_factor` round-trips correctly through `ParameterStorage`, but
      `ResultsStorage.saveResult` flattens `data.parameters` into cherry-picked named columns
      (`wind_speed`, `wind_direction`, `system_mass`, `rho`, `eta`) and never carries k across. It
      is absent from `StoredVEResult`, from `CSV_HEADERS` and from the CSV value row. Two results
      fitted at k = 0.50 and k = 1.00 are indistinguishable in the table and the export, and the
      stored `windSpeed` is the raw 10 m value while the physics used `wind_speed × k`. The file's
      own `crr` + `crrApplied` pair shows the intended shape.
      `frontend/src/utils/ResultsStorage.ts:525-560` · *origin: Phase 8 WR-02 = audit WR-8*

- [ ] **Store Result straight after Analyze records a wind source and virtual distances that no
      analyze ever wrote.** The only writers of `currentWindSource` and `currentVirtualDistances`
      live inside `summarize`, i.e. the update path. Press Store Result before touching a control
      and you persist `windSource: "none"` on a fresh session, or the *previous* analysis's values
      on a second analyze.
      `analyzeOrchestrator.ts:428-432`, `segmentSummary.ts:250,255`, `standardMode.ts:284,292`
      · *origin: audit WR-3*

- [ ] **Store Result straight after Analyze persists an r²/RMSE the screen never showed (GPS
      modes).** `analyzeOrchestrator` assigns `payload.initialResult` — one stitched calculator run
      over the concatenated selection — while the GPS-lap panel displays N per-lap fits and
      out-and-back 2N leg fits. The first control nudge replaces it.
      `analyzeOrchestrator.ts:428` · *origin: audit WR-4*

- [ ] **A persisted out-of-range k renders narrowed, and the first slider touch commits the
      narrowing.** Storage correctly never rewrites the persisted value, but a stored 1.5 renders
      as slider 1.00 / number 1.50 / readout ×1.50 — three disagreeing views — and moving the
      thumb commits 1.00.
      `frontend/src/shell/ve/windHeightControls.ts:398-425` · *origin: Phase 8 WR-07*

## Correctness

- [ ] **The two GPS analyze legs bypass the elevation resolver.** `renderGpsLap` and
      `renderOutAndBack` read `normalizedArrays.altitude` directly; `resolveElevationProfile` has
      four production callers and neither GPS analyze leg is among them. With a DEM applied, the
      smoothing toggle renders **ON** while the first paint is computed from unsmoothed DEM-raw
      data — the numbers then shift on the first control nudge when the primitive takes over. Not
      reachable without a DEM.
      `renderGpsLap.ts:107-114`, `renderOutAndBack.ts:99-106` · *origin: audit WR-1*

- [ ] **Section 3 destroys the map-trim slider bindings on every re-render.**
      `initializeMapTrimControlsForSelectedLaps` clones and replaces the four `mapTrim` nodes,
      stripping the listeners `MODE_CONTROL_TABLE` bound, and its replacements never call
      `requestModeUpdate`. Reached from any lap-checkbox change. Self-heals only on the next
      Analyze.
      `section3Orchestration.ts` (the `cloneNode`/`replaceChild` block) · *origin: audit WR-5*

- [ ] **`initializeVEAnalysis`'s placeholder calculator uses un-offset FIT wind.** Not observable
      today — recorded so it is not rediscovered from scratch.
      *origin: Phase 7 deferred-items*

- [ ] **The wind readout prints `Infinity m/s`.** The guard rejects `null`/`undefined`/`NaN` but
      not `±Infinity`.
      `frontend/src/shell/ve/windHeightControls.ts` · *origin: Phase 8 IN-02*

## Weather — the deferred WEATH-01 feature

Continuous per-quarter-hour weather sampling. Phase 6 spiked it and returned a **GO**, scoped to
riders **without** an air-speed sensor, and **conditional on the two items below**. Neither
condition is met, so the GO does not yet authorise the work.

- [ ] **Condition (a): the weather cache is unbounded, and it is reachable today.**
      No TTL, no size cap, no eviction; `clearCache()` is the only removal path and its sole caller
      is a manual button. This is not gated behind the deferred feature — `autoRho` uses the cache
      now, keyed on the mean lat/lon of the **trim region**, so every distinct trim window mints a
      fresh permanent IndexedDB row.
      `frontend/src/utils/WeatherCache.ts:3,205,326`, `autoRho.ts:170-175`

- [ ] **Condition (b): the spike's headline accuracy figure was measured on an endpoint production
      never calls.** Axis 3's "100% of windows resolved" was measured against
      `historical-forecast-api.open-meteo.com`. That host appears nowhere in this repo;
      `WeatherAPI.ts` calls only `api.open-meteo.com/v1/forecast` and
      `archive-api.open-meteo.com/v1/archive`, and the CSP allows exactly those two. Production
      routes rides older than `forecastMaxDays = 82` to **Archive at hourly**, whose head/tail MAE
      is **0.342 m/s — past axis 2's 0.3 bar**.
      So this is a re-measurement, not a config edit. Either add the endpoint (code *and* CSP) and
      re-measure, or restrict the feature to rides inside the 82-day forecast window.
      **Budget for this when scoping the work — it is the long pole.**
      *Note: an earlier audit framed this as "a CSP gap to close". That framing was wrong and is
      corrected here.*

- [ ] **WEATH-01 itself**, once (a) and (b) are settled: per-quarter-hour sampling with
      interpolation, wired into the production auto-rho/VE path. Research is already done and the
      per-sample plumbing (`rho_array`, `wind_speed: Vec<f64>`) exists end-to-end, so this
      produces arrays rather than touching VE maths.

## Test quality

- [ ] **The "three modes" elevation-smoothing test is one guard named three times.** The cases
      called "standard mode", "gps-lap mode" and "out-and-back mode" all call
      `resolveElevationProfile` directly with the same `fitData`; no mode module is imported. This
      is exactly why the GPS analyze-leg bypass above went uncaught.
      `frontend/src/shell/analysis/elevationToggle.integration.test.ts:52-83` · *origin: audit WR-2*

- [ ] **`frontend/scripts/**` is neither typechecked nor linted.** `tsconfig.json` includes only
      `src/**/*` and `npm run lint` runs `eslint src`, so `npm run check` and `npm run lint` both
      pass on a scripts file that cannot run. It has already shipped two runtime defects.
      `build-golden-fixture.ts` decides what becomes permanently public in a public repo.
      *Attempted and backed out:* a `tsconfig.scripts.json` extending the base fails two ways — the
      `@wasm/*` `paths` mapping does not resolve through `extends`, and it pulls all of `src/**`
      into a second check with different `types` resolution. Doing it properly means `baseUrl` +
      explicit `paths`, or project references.

- [ ] **GPS-01 has no direct test.** GPS-02 is now closed and covered; GPS-01 (the mode selector
      reaching `setGpsAnalysisMode`) still has none.
      *origin: `2026-08-15-gps-state-sync-coverage-gap` todo, partially closed*

## Performance

- [ ] **Out-and-back still uses `Plotly.newPlot` for plots redrawn on every update.** GPS-lap moved
      to `Plotly.react` some time ago. The VE and residual plots are the significant ones — redrawn
      on every slider update — and out-and-back computes 2N segments, so it is the mode most likely
      to feel the teardown cost. Worth doing behind a draw-method test that stubs both methods, as
      `gpsLapPlotDrawMethod.test.ts` does.
      `frontend/src/shell/outAndBack/outAndBackPlots.ts:142,160,192,461-462`; five more in
      `renderStandardVe.ts:157-181`

- [ ] **Out-and-back's aggregation helpers have never been profiled.** GPS-lap's two equivalents
      each hid an O(targets × samples) rescan worth ~10 ms of a ~22 ms update. Out-and-back's
      `calculateOutAndBackStats` has the same shape and twice the segments. Not covered by the
      golden literals, which pin calculator output rather than downstream aggregation.
      `renderOutAndBack.ts` · *origin: Phase 7 deferred-items*

## Housekeeping

- [ ] **A torn-down VE panel keeps its DOM, listeners and Plotly instances.** `Plotly.purge` has
      zero callers anywhere in `frontend/src`, so each mode change leaves one fully-wired, fully
      plotted panel alive behind `display: none` until the next analyze replaces it. Does not
      accumulate across cycles; memory/GC only. One 250 ms status-flash timer can also fire
      post-teardown and create a `#veRecomputeStatus` node inside the hidden panel — cosmetic.
      *origin: audit NEW-2*

- [ ] **`windFieldsBound` is a membership-only `WeakSet`**, so the wind-field listeners freeze onto
      the first binding. Latent — harmless only while all three modes pass an identical `getParams`
      closure.
      `frontend/src/shell/ve/windHeightControls.ts` · *origin: Phase 8 WR-06*

- [ ] **Dead CSS rule** for a label that does not exist: the markup puts its only label outside the
      targeted row.
      `frontend/src/styles/analysis-params.css:342` · *origin: Phase 8 IN-01*

## Open questions

- [ ] **GPS gate detection: single gate vs A/B directional.** Reviewed during Phase 7 and
      deliberately not folded in — it is the detection layer, not the update pipeline. Needs its
      own investigation.
      `gateMarkers.ts`, `bindGpsDetection.ts`, `bindOutAndBackDetection.ts`

---

## Where the history lives

`.planning/` holds the GSD record for v1.0 and v1.1 — phase plans, verifications, milestone audits
and the decision log. It is gitignored and stays on disk; nothing above depends on it, but the
reasoning behind any item can be traced through the *origin* notes.

Not carried over, deliberately: items that only concern the accuracy of `.planning/` documents
themselves (a stale paragraph in a Phase 7 baseline doc, and a Phase 3 verification citing
constants that no longer exist). They describe retired artifacts, not shipped code.
