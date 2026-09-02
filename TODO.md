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
| ~~**A**~~ | ~~Wind height factor k, end to end~~ | — | **Done** 2026-08-30, committed — in-app check still owed |
| ~~**B**~~ | ~~Make Store Result truthful~~ | — | **Done** 2026-08-31, checked in the app |
| ~~**C**~~ | ~~Elevation resolver, and the test that should have caught it~~ | — | **Done** 2026-08-30, committed — in-app check still owed |
| ~~**D**~~ | ~~Plot rendering and tab layout~~ | — | **Done** 2026-08-31, checked in the app |
| ~~**E**~~ | ~~Cheap sweep~~ | — | **Done** 2026-08-30, committed — in-app check still owed |
| **F** | Weather — the deferred WEATH-01 feature | L–XL | Strictly internal order — (a) done 2026-09-02 |
| ~~**G**~~ | ~~Test infrastructure~~ | — | **Done** 2026-09-02, scripts run end to end |
| ~~**H**~~ | ~~On-screen results view~~ | — | **Done** 2026-08-31, checked in the app |
| — | Standalone work | varies | — |

Every bundle above is now **committed** on `refactoring`; the per-bundle Done entries below still
open with the "not committed" wording they were written under, and that wording is stale rather than
a second claim. **B**, **D** and **H** were exercised in the running app and the Done entries say
what was measured. **A**, **C** and **E** have never been opened in the app — nothing since their
2026-08-30 entries records one — so they keep the debt. C1-01's own in-app check, at the end of
*Done*, was run on 2026-09-02 at `d586961` and passed on all five steps; it covers Section 3's
selection and map behaviour and nothing else, so **A**, **C** and **E** still keep theirs.

Suggested order from here: the standalone items. A, B, C, D, E, G and H are done. **F** has had
its condition (a) closed (2026-09-02) and now waits on condition (b) alone — a re-measurement, and
the long pole of that bundle. The one piece of B
deliberately NOT done is the analyze-leg retirement, now carried as a standalone item below; it is a
performance and structure cleanup, not a correctness gap.

---

## Decisions needed

These block work below. None of them is a coding question.

- [x] **D-a · Is the manual-wind re-seed a defect or the intended policy?**
      **Decided 2026-08-30, and the question was mis-framed by both sides.** Tracing it showed
      auto-rho sets `wind_speed` from the API *unconditionally* (`autoRho.ts:236`) without ever
      checking whether the user typed one; k only followed afterwards. So k following the wind was
      correct, and the wind being replaced was the defect. Maintainer ruling: **a reload of a
      previously analysed file must restore the exact conditions it was analysed under** — the
      wind, its provenance, and k. Shipped in bundle A.

- [x] **D-c · Does the Crr slider step follow the widened range?** **Decided 2026-08-30: no.**
      Range opens to **0.0015 – 0.030**, `step` stays **0.0001** — 285 slider positions, finer than
      a drag can resolve, and the number input stays the precise path. Shipped in bundle E.

---

## Bundle F · Weather — the deferred WEATH-01 feature

*Effort: L–XL. Why together, and why strictly in this order: Phase 6 spiked the feature and returned
a **GO**, scoped to riders **without** an air-speed sensor and **conditional on the two items
below**. (a) is met as of 2026-09-02; (b) is not, so the GO still does not authorise WEATH-01
itself. Nothing below (b) starts early.*

- [x] **[M] Condition (a): the weather cache is unbounded, and it is reachable today.**
      **Done 2026-09-02.** See *Bundle F · Condition (a)* under **Done**.

      Criteria (concretised 2026-09-02, PR #10 review round 9 — the item was prose, these were
      derived from it and confirmed by the maintainer, so a later round reads this as tier A
      rather than re-deriving it):

      - [x] The store has a removal path besides the manual `clearCache()` button —
            `evictOverflow`, `WeatherCache.ts:290-330`
      - [x] The bound is enforced on the path `autoRho` actually reaches, i.e. on write rather
            than on a manual action — eviction runs inside `store()` (`WeatherCache.ts:245`),
            which both `getWeatherData` and `updateCachedEntry` call
      - [x] Existing cached data survives: no migration, no `dbVersion` bump — the `cachedAt`
            index the cursor walks was in the original `onupgradeneeded`; verified in Chrome
            against a real 5-row store written by earlier sessions
      - [x] A guard covers the bound and is non-vacuous — six cases, nine mutations, each case
            killed by at least one and three by a mutation nothing else catches
      - [x] The removal policy is a deliberate choice with its reasoning recorded — FIFO-not-LRU
            and no-TTL, argued in the `evictOverflow` docstring and the Done entry

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

- [ ] **[S–M] The cache key is ~0.1 m wide and the data behind it is kilometres wide.**
      Ride-along with (b), and gated on it. `buildCacheKey` keys on the trim region's centroid at
      6 decimals while both endpoints serve a model grid of ~1–11 km (forecast) or 0.25° ≈ 28 km
      (ERA5 archive), at 15-minute slots. So the cache essentially never hits across trim windows:
      every slider move is a fresh Open-Meteo round-trip, and `autoRho`'s in-session
      `lastWeatherQueryKey` guard uses the same 6-decimal key, so it does not absorb it either.
      Rounding the key to ~2–3 decimals would make it hit.
      **Deliberately NOT done in condition (a):** coarsening rounds the location the wind is read
      at, which injects spatial error into exactly the budget (b) has to re-measure against its
      0.3 m/s bar. Doing it first would contaminate that measurement — so the radius is chosen and
      measured as part of (b), not before it. The cap shipped in (a) bounds the growth meanwhile.
      `frontend/src/utils/WeatherCache.ts:178-188`, `autoRho.ts:150-157`
      *origin: brainstorm for condition (a), 2026-09-02 — maintainer ruled bound-only*

- [ ] **[L–XL] WEATH-01 itself**, once (a) and (b) are settled: per-quarter-hour sampling with
      interpolation, wired into the production auto-rho/VE path. Research is already done and the
      per-sample plumbing (`rho_array`, `wind_speed: Vec<f64>`) exists end-to-end, so this
      produces arrays rather than touching VE maths.

## Bundle G · Test infrastructure

**Done 2026-09-02.** See *Bundle G · Test infrastructure* under **Done**.

Criteria (concretised 2026-09-02, PR #9 review round 7 — the item was prose, these were derived
from it and confirmed by the maintainer, so a later round reads this as tier A rather than
re-deriving it):

- [x] `npm run check` typechecks `frontend/scripts/**` — all five scripts confirmed in the
      program with `tsc --listFiles`, `build-golden-fixture.ts` among them
- [x] `npm run lint` lints `frontend/scripts/**`
- [x] Everything those two newly expose is fixed, so both commands pass — 7 errors, and the
      guard is non-vacuous (restoring the originals exits 2 on all 7)
- [x] A test directly covers the mode selector reaching `setGpsAnalysisMode` — four cases,
      each with a mutation that kills it
- [x] The scripts RUN, not merely typecheck — `profile:slider` and `profile:gps-lap-render`
      both exit 0

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

- [ ] **[S–M] `WeatherCache` never closes its IndexedDB connection, and `autoRho` builds a new
      one per weather query.** `initialize()` assigns `this.db` and nothing ever calls
      `db.close()`; `autoRho.ts:170` does `new WeatherCache()` inside the query path, so a long
      session accumulates one open connection per distinct trim window. `ResultsStorage` in the
      same directory DOES close its connections (`ResultsStorage.ts:319,338`), so this is below
      the repo's own standard rather than a general style opinion.
      Not folded into the cap work: the fix is a service-lifecycle change that `autoRho` owns —
      a shared instance, or a close after each use — and the cap bounds rows, which is a
      different resource. No user-visible failure has been reproduced; browsers hold idle
      connections cheaply and reclaim them on unload, which is why this is sized S–M and not
      urgent.
      `frontend/src/utils/WeatherCache.ts:60-85`, `autoRho.ts:170`
      *origin: PR #10 review round 9, F9-01*

- [ ] **[L] GPS gate detection: single gate vs A/B directional.** Reviewed during Phase 7 and
      deliberately not folded in — it is the detection layer, not the update pipeline. Needs its
      own investigation before it can be sized.
      `gateMarkers.ts`, `bindGpsDetection.ts`, `bindOutAndBackDetection.ts`

- [ ] **[L] Retire the GPS analyze legs' own calculator pass.** With WR-4 done, one Analyze click
      still runs the physics twice in the GPS modes: the analyze leg computes N per-lap fits
      (`renderGpsLap.ts:219`) or 2N leg fits (`renderOutAndBack.ts:193,259`) for the first paint,
      and the post-bind kick then recomputes the same segments through `updateModeVEPlots`. So
      GPS-lap costs `1 + 2N` runs where `2N` would do, and out-and-back `1 + 4N`.
      Standard has the same shape (`renderStandardVe.ts:103`).

      The target: the analyze leg selects segments and renders nothing, the panel ships with empty
      stats the way Standard's header spans now do, and the kick's pass is the first and only paint.
      That would also make `seedSegmentModeAnalyzeState` unnecessary — the seed exists precisely
      because the analyze path had no writer, and it now has one.

      NOT bundled with WR-4 on purpose. It is a first-paint SEQUENCING change (the panel would
      render empty and fill on the next macrotask), which no test in this repo can settle — the
      risk is flicker, not numbers. It also wants the WR-4 in-app check done first: if the kick
      misbehaves visually, this builds on top of that.
      `renderGpsLap.ts`, `renderOutAndBack.ts`, `renderStandardVe.ts` · *origin: WR-4 follow-up,
      2026-08-31*

- [ ] **[S–M] Standard's header jumps on a multi-lap selection: two different quantities, one span.**
      The analyze leg paints `updateMetricsDisplay` from ONE fit over the concatenated selection
      (`renderStandardVe.ts:265`); the kick a macrotask later writes the MEAN of the per-lap fits
      (D-09 entry g). For a multi-lap selection those are different quantities, so the header
      visibly changes by itself even though both numbers are correct for what they measure.
      Measured in the app 2026-08-31 on `13.07.fit` laps 10+12: RMSE 26.22 m → 8.10 m, R²
      0.0002 → 0.0031. A single lap is exact after the rho fix, so this is the only remaining
      first-paint jump on a fresh load.

      Three ways out, and it needs a ruling: decompose the analyze leg per lap (correct, and the
      most work), paint the spans empty and let the kick fill them (cheapest, adds a flicker), or
      keep the combined figure and label it as such the way the VD header labels its combined line.
      **Retiring the analyze legs' own calculator pass (the item above) subsumes this** — if that is
      done first, this disappears with it.
      `frontend/src/shell/ve/renderStandardVe.ts:251-273` · *origin: in-app check of the PR #7
      review fixes, 2026-08-31*

- [ ] **[S] Re-analyzing a NARROWER lap selection paints a stale trim.** Analyze laps 10+12, untick
      12, analyze lap 10 alone: the header paints RMSE 11.51 m and settles at 7.62 m. A fresh page
      load of lap 10 alone paints 7.62 m once and never moves, so the jump is state carried over
      from the previous selection — the trim reset in `showVirtualElevationAnalysisInline` only runs
      inside the `if (appState.currentFileHash && parameterStorage)` branch and only when
      `loadLapSettings` returns nothing, so a saved trim from the WIDER selection can reach
      `initializeVEAnalysis` through `appState.presetTrimStart/End`. Not investigated beyond the
      observation; reproduce it before believing that explanation.
      `frontend/src/shell/ve/renderStandardVe.ts:318-345` · *origin: in-app check of the PR #7
      review fixes, 2026-08-31*

- [ ] **[S] `vite.config.ts` and `vitest.config.ts` are in neither tsc program, and neither is
      linted.** Bundle G closed this hole for `frontend/scripts/**`; the root config files still
      sit outside both `tsconfig.json` and `tsconfig.scripts.json` (verified with
      `tsc --listFiles`) and outside `eslint src scripts`. Same failure shape as the bundle's own
      item: a config file that cannot run still passes `npm run check`. Smaller stakes than the
      scripts — a broken vite config fails loudly at `dev`/`build` — which is why it was not
      folded in. *origin: PR #9 review round 7, F7-04*

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

### Bundle F · Condition (a) — the weather cache is bounded — 2026-09-02

Implemented on `bundle-f-weather-cache-bound`, branched from `origin/main` at `c985711`.
1058 tests pass (up 6 on the 1052 of the entry below), `npm run check` and `npm run lint` clean.
This clears the FIRST of bundle F's two conditions; (b) is untouched and remains the long pole.

- [x] **[M] Condition (a): the weather cache is unbounded, and it is reachable today.**
      Closed as a **size cap with oldest-first eviction, and no TTL** — a deliberate split, because
      the two halves of "unbounded" have different answers.

      **No TTL, and that is not an omission.** An entry is the weather at a fixed instant at a fixed
      place. Rides past `forecastMaxDays = 82` come from the ERA5 archive, which does not change, so
      an expiry would re-fetch immutable data forever to serve only the recent-ride case — and
      `autoRho.ts:178-190` already re-fetches the one case that matters, a cached row that came back
      without wind data.

      **The eviction is FIFO by insertion, and it is named that rather than LRU.** `cachedAt` is
      written once and never touched on a read, so evicting by it is oldest-INSERTED. True LRU would
      need a write on every cache hit, turning each read into a readwrite transaction, and it buys
      nothing here: re-reading a ride hits the same key, and a moved trim window is a new key either
      way. **No schema change and no `dbVersion` bump** — the `cachedAt` index the cursor walks has
      been in `onupgradeneeded` since the store was created.

      Cap is 5000 rows ≈ 1.5 MB; an entry is six numbers plus its key, ~300 bytes of JSON. The cap
      is a constructor parameter defaulting to the exported constant, so the tests can drive a cap
      of 3 instead of writing 5001 rows through `fake-indexeddb`.

      Eviction runs inside the put's own transaction, so the entry and its evictions commit
      together, and `store()` now resolves on `transaction.oncomplete` rather than on the put.
      Failures are logged and swallowed — each handler calls `preventDefault()` so a failed delete
      cannot abort the transaction and take the weather entry down with it. **A ride's analysis must
      not fail over a row the cache could not tidy up.**

      **What this does NOT do: coarsen the key.** Maintainer ruling, and the reasoning is filed as
      its own item under condition (b) above. The cache is not only unbounded but ineffective —
      6-decimal centroid against kilometre-scale data — and fixing that would round the wind value,
      contaminating the accuracy budget (b) exists to re-measure.

      **Six guards, every one mutation-verified** — applied, observed failing, reverted. Nine
      mutations were run, and three cases have a killer no other case catches:
        - *under the cap, nothing is evicted* — dies when the cap is read as "evict once the store
          REACHES it" rather than exceeds it.
        - *the count settles at exactly the cap* — dies on no eviction at all, on a cap+1
          off-by-one, and on a count taken before the put.
        - *the OLDEST-inserted row is the one taken* — the case that stops the one above it from
          being vacuous, since a settled count says nothing about which rows went. Insertion order
          and key order deliberately disagree, so an eviction walking the primary key or the index
          descending fails it.
        - *re-storing an existing key evicts nothing* — **uniquely** killed by evicting off a
          running put-counter instead of the store's size. Guards `updateCachedEntry`.
        - *a surviving row is still SERVED from cache after an eviction* — **uniquely** killed by a
          cache hit reporting `source: 'api'`, the field `autoRho.ts:178` branches on. **The first
          draft of this case asserted the newest row survived and was a restatement** of the case
          above it — the mutation pass killed both with the same cursor direction and nothing else
          touched it, so it was rewritten onto the read path.
        - *the shipped default is a real cap* — **uniquely** killed by a default of 1. Asserting the
          constant against itself would have been a tautology.

      One test-harness trap worth recording: `vi.useFakeTimers()` with vitest's default `toFake` set
      freezes the `setImmediate` that `fake-indexeddb` schedules every transaction on, so the whole
      file hangs and fails as 5-second timeouts rather than as assertions. Only `Date` may be faked
      here.

      **Checked in the app, 2026-09-02 — this entry carries no in-app debt.** `13.07.fit`, Standard
      mode, against Chrome's own IndexedDB rather than `fake-indexeddb`.
        - The store already held 5 rows written by earlier sessions and read back fine, so the cap
          needs no migration for a cache that predates it.
        - Lap 10 alone with auto-rho on: ρ 1.1285, RMSE 7.62 m — the same 7.62 m the *narrower lap
          selection* item below records for a fresh load of lap 10, so auto-rho is unregressed. The
          fetch was a cache HIT on a row from a previous session.
        - Eviction was then exercised for real: 5010 rows seeded at `cachedAt` far older than any
          real row, taking the store to 5015, then lap 3 analysed to force a genuine Open-Meteo
          fetch on a new key (ρ 1.1354). The store settled at **exactly 5000**, the log line read
          `🧹 Weather cache over cap, evicting 16 oldest entries` (5015 + 1 new = 5016), and the 16
          taken were `seed_00000`–`seed_00015` — the oldest by `cachedAt`, with `seed_00016` the
          lowest survivor. **All six real rows survived, including the one just written.** No
          console errors. The seed rows were deleted afterwards.
      `WeatherCache.ts` · test: `WeatherCache.test.ts` (new)

### Bundle G · Test infrastructure — 2026-09-02

Implemented in the working tree on `bundle-g-test-infrastructure`, branched from `origin/main` at
`1cc89e6`; **not committed**. 1052 tests pass (up 4 on the 1048 of the entry below),
`npm run check` and `npm run lint` clean. Every guard was mutation-verified — applied, observed
failing, reverted — because the origin note for the GPS-01 item names this as the area that
produced six vacuous guards, and one of the four cases here WAS vacuous on the first draft.

- [x] **[M] `frontend/scripts/**` is neither typechecked nor linted.** Both halves closed, and the
      backed-out attempt's diagnosis was half wrong.

      **`tsconfig.scripts.json`**, extending the base — no `baseUrl`, no project references, no
      restated `paths`. Three things had to be right, each measured rather than assumed:
      `types` must carry BOTH `node` and `vite/client`, because the scripts are Node programs that
      import `src` modules directly and those still need `import.meta.env` and the CSS side-effect
      import to resolve; the ambient declarations must be named in `include` explicitly, since a
      `.d.ts` nothing imports is reached through `include` rather than the import graph, and
      `plotlyLoader.ts` arrives via the graph without `src/types/plotly-basic-dist.d.ts`; and
      **the `@wasm/*` `paths` mapping DOES resolve through `extends`** on the TypeScript in this
      repo. The earlier note recorded that it does not — re-measured 2026-09-02, and it does.

      `npm run check` is now `tsc --noEmit && tsc -p tsconfig.scripts.json --noEmit`, and
      `npm run lint` is `eslint src scripts`. A new `scripts/**/*.ts` ESLint block carries the node
      globals and `no-console: error`, matched to `src` — none of the five scripts contains a single
      `console.` call, they all write results through `process.stdout.write`, and the rule keeps it
      that way so log lines cannot interleave with output a consumer parses.

      **The check caught 7 real errors, and it is not vacuous:** restoring the original files makes
      `npm run check` exit 2 on all 7, and a stray `console.log` in a script makes `npm run lint`
      exit 1.
        - `profile-slider-recompute.ts` (5) passed `params.cda` / `params.crr` — `number | null`,
          where `null` means "optimize" — straight into `calculate_virtual_elevation`, which takes
          numbers. Production never reaches that boundary unresolved
          (`renderStandardVe.ts:148`, `updateModeVEPlots.ts` resolve first). A `FixedParameters`
          type now names the precondition the script always had; no runtime behaviour changed.
        - `profile-gps-lap-render.ts` (2) rebuilt a `LapVEProfile` shape predating the three
          nullable fields `range`, `virtualElevationCompare` and `referenceElevation`. The update
          path leaves all three empty by design, so they are `null` here.
        - `@types/jsdom` added — the one genuinely missing dependency.
      `tsconfig.scripts.json`, `eslint.config.js`, `package.json`

- [x] **[S] `profile-gps-lap-render.ts` launched `main()` fire-and-forget, and that is a race.**
      *Not in the bundle, and NOT a defect on this branch — recorded because the fix is here.*

      Every `src` module in that script is imported DYNAMICALLY (the jsdom globals must exist before
      those modules evaluate), but `main()` was launched as `void main().then(...)`. The entry
      module's evaluation therefore completes with nine module requests in flight, and under
      `vite-node` that is the moment the dev server is torn down. Whether the requests land first is
      a race.

      **On `main` the script wins it** — the unmodified script runs to completion, exit 0. On
      `JB/week36-solve-plots`, where the same nine imports pull in the solver modules, it loses
      every time: `Error: The server is being restarted or closed. Request is outdated` before a
      single measurement. Swapping `void main()` for a top-level `await` was the single variable
      that fixed it there; four other hypotheses (jsdom itself, import concurrency, the dep cache,
      the `new URL(..., import.meta.url)` wasm asset) were each tested and refuted. So this is
      HARDENING on this branch and a fix on that one. `scripts/profile-gps-lap-render.ts:518`

- [x] **[S] GPS-01 has no direct test.** `bindGpsModeSelector` was imported by **zero** test files.
      Every existing test of this area calls `setGpsAnalysisMode(...)` directly — the pipeline half.
      Nothing asserted the half in front of it: that the `<select>` the user operates is wired to
      that function at all. A dropdown bound to nothing left every one of them green.

      **The re-render is the substance of it.** `bindGpsModeSelector` runs from
      `restoreSection3Controls`, which runs from `rerenderSection3`, which `setGpsAnalysisMode`
      calls on every invocation — so using the dropdown destroys and replaces the dropdown along
      with its listener. The binding has to be re-established by the very render its own change
      triggered, or the control works exactly once and then goes quietly inert. Same defect family
      as the map-trim item under *Standalone work*.

      Four cases, each with the mutation that kills it, all re-run on this base:
        - *selector rendered into Section 3, seeded* — dies when the template drops the `id`.
        - *the mode moves when the user picks one* — dies when `handleChange` stops calling
          `setGpsAnalysisMode`, and when the `change` listener is not attached.
        - *stays live after the re-render its own change triggers* — **the only case that dies**
          when `restoreSection3Controls` binds on the first render but not afterwards, so it is
          load-bearing rather than a restatement of the case above it.
        - *re-renders showing the mode the app is now in* — asserts `data-gps-mode`, which only a
          render can write, plus node identity. **The first draft asserted `.value` and was
          vacuous**: the helper assigns that itself, so it survived a mutation that stopped the mode
          moving at all. The mutation pass caught it and it was rewritten.
      `src/shell/section3/gpsModeSelector.test.ts` (new) · `bindLapSelection.ts:90-116`
      *origin: `2026-08-15-gps-state-sync-coverage-gap` todo, now closed for GPS-01*

### Section 3's invalidation rule, and the four review rounds on top of it — 2026-08-31 … 2026-09-02

Thirteen commits after `943c527`, through `d586961`, all on `refactoring`, all under PR #7. The
count names the SHA it is counted through so it stays checkable, and the documentation batch that
rewrote this line is deliberately not in it — it records the thirteen rather than being one of
them, so this is not an off-by-one. They share one through-line:
**the VE panel on screen must describe the ride the Section 3 controls currently describe.**
`tearDownVeAnalysisPanel` had stated that rule since bundle D, and a mode change was the only route
that used it. Everything below is another route to it, a guard that could not fire, or the fallout
of getting one of those wrong.

1048 tests pass after this documentation batch (up 93 on the 955 of the previous entry),
`npm run check` and `npm run lint` clean. Every new assertion in every commit was run against the
pre-fix code and observed to fail; from `a4c9101` the mutation and the proof that it changed the
file are recorded in the commit message.

**Two of these DELIBERATELY REVERSE an earlier decision.** They are called out as such below,
because a reversal that survives only as a commit message reads later as drift.

- [x] **[S] The below-axis legend is pinned to the figure, not the plot area.** The out-and-back VE
      legend sat on top of "Distance (km)". Measured in Chrome from 140 to 900 px: all three overlay
      figures overlapped their axis title at EVERY height, by 27–34 px. Bundle D's `clamp()` heights
      did not cause it — they removed the fixed height that had been hiding it. `legend.y` under the
      default `yref: 'paper'` is a fraction of the PLOT AREA while the axis title below is placed at
      a fixed pixel offset, so no single fraction reconciles the two. `yref: 'container'` measures
      from the figure's own bottom edge, leaving only `margin.b` — also pixels — to be large enough.
      Measured after: a constant 16 px gap at every height. `legend.x` is now explicit too; it
      defaults to 0, which the old layouts read as centred only because five entries filled the
      width. One helper and one margin constant replace three hand-tuned pairs.
      `plots/belowAxisLegend.ts` · test: `belowAxisLegend.test.ts` · commit `6b498a6`

- [x] **[M] The VE panel drops whenever its basis goes — not only on a mode change.** Three routes
      replaced the panel's input and none touched it. (1) SELECTION CHANGES: ticking laps or
      sections, or moving a gate, left the plot showing the old selection. Guarded on both halves,
      because `updateSelectedLaps` is also Section 3's post-render hook and an unconditional
      teardown would destroy a valid panel on an ordinary re-render. (2) A NEW ACTIVITY:
      `setLoadedActivity` swapped the FIT data and stopped, so laps 2/4/6 picked for one ride were
      still ticked — and still `currentAnalyzedLaps` — for the next one, which made (1)'s guard find
      selection == analyzed and keep the previous file's panel over the new file's data.
      Deliberately not routed through `setGpsAnalysisMode("None")`, every branch of which is gated on
      `previousMode !== mode`. (3) THE DERIVED STATE: a surviving `filteredLapData` carried
      `calculateAutoRho` past its own early return into trim sliders just re-rendered for the new
      file, which is where the "Auto-rho calculation failed" toast on every file switch came from.
      The lead test asserts the whole `selection` block equals a freshly constructed one, so a field
      added to `SelectionState` later cannot be missed here again. Verified in Chrome with two rides.
      `section3Orchestration.ts`, `appState` selection block · commit `2a0b6ac`

- [x] **[M] Round 1 of review: seven findings, two of them guards that could not fire.** The gate
      re-detection compared `currentCoveredItems` against `outAndBackSelectedSections`, which the
      same function had just assigned from the detector's own sequential 1..N — [1,2,3] against
      [1,2,3], so a gate nudge never invalidated. Now compared on the four index bounds of
      `currentOutAndBackSections`. And `updateSelectedLaps` compared `currentAnalyzedLaps` against
      `selectedLaps`, which are DIFFERENT NAMESPACES in the GPS modes (virtual laps or section
      numbers against the FIT lap list, all counting 1..N), so it both skipped due invalidations and
      tore down valid panels; it now runs only in the FIT-lap modes. The rest: the compare builder
      was the last one hardcoding 'Time Point' and drew kilometres under it; `stitchStandardProfiles`
      advanced its offset by the last element of `distancesKm` while placing samples over
      `virtualElevation.length`, making the axis non-monotonic for a short channel; `initialize()`
      is memoised so the footer's "Show All Results" no longer reads `[]` over a populated store;
      `openResultsModal` is latched against a double-click appending two modals under one id; and
      both GPS analyze legs sliced `allRho` on `allTimestamps.length`, pushing `undefined` into a
      `number[]` for a channel a device stopped emitting mid-ride. `c2a9a15` was **not** verified in
      the browser, which is what the next two commits are.
      `bindOutAndBackDetection.ts`, `section3Orchestration.ts`, `MultiSegmentPlotBuilders.ts`,
      `ResultsStorage.ts`, `resultsModal.ts` · commit `c2a9a15`

- [x] **[S] GPS-lap mode got the two guards out-and-back already had.** `runGpsLapDetection` had no
      invalidation at all, and neither did `handleGpsLapSelectionChange`, so a gate nudge or an
      untick left the panel over the previous cut. The gap had been MASKED, not covered: before
      `c2a9a15` the wrong-namespace comparison tore the panel down whenever two unrelated lap lists
      happened to differ, and removing that left the mode with nothing. Re-detection is compared on
      the RANGES for the same reason out-and-back is; the checkbox handler compares
      `currentCoveredItems` against `gpsSelectedLaps`, which are the same namespace here.
      `invalidateVePanelIfSectionCutChanged` became `invalidateVePanelIfCutChanged` over
      caller-built keys, since a section has two legs and a GPS lap one range.
      `bindGpsDetection.ts`, `gpsLapMode.ts:70` · commit `997b17a`

- [x] **[S] The compare x axis stopped clipping, and the FIT window re-runs detection.** Both
      reported from the running app. Dropping the title from the upper plot of the stacked pair was
      right but incomplete — `showticklabels: false` is what keeps Plotly from drawing the numbers
      through the `b: 5` gutter, and the compare builder now says it too. Separately: in the GPS
      modes the FIT lap selection is the DETECTION WINDOW, not the analysis unit, and nothing re-ran
      the detectors when it changed. With lap 8 selected the gate found 5 laps; ticking lap 10 left
      the counter at 5 until a gate was nudged. Each binder now publishes a "re-detect where the
      gates are now" closure — the offset re-resolved against the CURRENT selection's time range,
      exactly as a drag does — and the slot is cleared wherever Section 3 rebinds. The teardown
      falls out of the re-detection rather than being ordered separately; the empty selection is the
      one case the detectors cannot answer, since they bail before detecting.
      `bindGpsDetection.ts`, `bindOutAndBackDetection.ts` · commit `ff98c6a`

- [x] **[S] The compare pair shares a horizontal band, and ANY detection change invalidates.**
      Hiding the tick labels exposed the real misalignment underneath: the compare builder left its
      legends at Plotly's default, outside on the right, shrinking each plot area by the width of its
      own longest entry — "VE (FIT Air Speed)" against "Residuals (FIT Air Speed)" — so the two
      stacked plots came out different widths, and neither axis pinned a range. Both now match
      `buildVirtualElevationFigures`. And the re-detection guard had spared a detection that only
      ADDED items, on the reasoning that what was on screen still described the ride: it does not,
      because the plot's lap NUMBERS are the key Store Result and the saved CdA/Crr live under.
      The comparison is now the detected list before against the detected list after, in order.
      `MultiSegmentPlotBuilders.ts`, `bindGpsDetection.ts` · commit `b6c4778`

- [x] **[M] REVERSAL — unticking one detected item now NARROWS the VE panel instead of killing it.**
      The previous commit left it open, as a behaviour change wanting a decision rather than a quiet
      fix: unticking one of six detected GPS laps tore the whole panel down and charged the user
      another Analyze, which is more destructive than the change warrants. The detection underneath
      is untouched — the checkbox narrows the QUESTION, it does not re-cut the ride — so both segment
      modes rewrite the on-screen segment list to the ticked subset and ask the funnel for a
      recompute. The other direction is unchanged: a gate move, or a FIT window that finds a
      different set of laps, still tears down; an EMPTY selection is not a narrower question but no
      question, so that tears down too.

      **What this reverses, and why the seam it defended is intact.**
      `activeOutAndBackSections.ts` deliberately preferred the on-screen list over the selection so
      that a checkbox could not SILENTLY change what the next slider drag computes. It still cannot:
      the toggle moves that list and requests the redraw in the same breath, rather than behind the
      panel's back. The comment there records both halves. `currentAnalyzedLaps` is untouched, per
      WR-01 — it keys the saved CdA/Crr and trim, and a narrowed VIEW must not re-key them; coverage
      moves instead, through `summarize` rewriting `currentCoveredItems`, so Store Result and the CSV
      stay truthful. Two details that would have been quiet bugs: `currentOverlayLapNumbers` is
      indexed by RANGE ordinal and has to move in lockstep, and `segmentSelection` is a new
      `ModeUpdateReason` with no `MODE_CONTROL_TABLE` row because it is not a control inside the mode
      panel. Four tests that asserted the old teardown were rewritten rather than deleted, and two of
      them had fixtures that no longer reached the code path at all.
      `activeOutAndBackSections.ts`, `gpsLapMode.ts:17` · commit `c1d6808`

- [x] **[M] Round 2 of review: four findings, and REVERSAL — a gate belongs to the FIT selection it
      was placed under.** `clearGpsRedetect()` ran one line too late:
      `restoreSection3Controls` ENDS IN `updateSelectedLaps()`, so a mode switch fired the PREVIOUS
      mode's closure against detached sliders and persisted offsets for a mode the user had left.
      A re-detection auto-selected every item unconditionally, silently contradicting a panel that
      `recomputePanelForSelection` had just narrowed; it now auto-selects only when the detection
      actually moved. The compare figures pinned `[xMin, xMax]` while drawing only `xPointsMain`,
      adding dead margin at each end.

      **The fourth finding was the smaller half of a data-loss bug, and the fix reverses how gates
      were treated.** The finding was that the redetect closure reused the slider value against a new
      window without re-clamping it or updating `slider.max`. True — but gates are keyed on
      `(fileHash, selectedLaps)`, so a FIT selection change is a DIFFERENT KEY, not the same gate in
      a resized window, and reusing the outgoing offset was wrong even when it happened to fit.
      Worse: the save at the foot of each gate handler reads `selectedLaps` at call time, so the
      redetect pass wrote the OUTGOING combination's offsets under the INCOMING combination's key,
      destroying the gate the user had saved for those laps before they touched anything —
      introduced by the re-detect wiring in `ff98c6a`. Both binders now RESOLVE the gate for the
      current selection (new window length, the offset saved under THIS key, clamped with A strictly
      before B) at bind time and again on every selection change, and persist only when the user
      actually moves a gate.
      `bindGpsDetection.ts`, `bindOutAndBackDetection.ts` · test: `gateSettingsPerSelection.test.ts`,
      which drives both binders directly · commit `03de804`

- [x] **[S] Round 3 of review: keep the placed gate, order the redetects, guard out-and-back's
      initial detection.** All four findings were in the binder rework immediately above.
      `resolveGateForSelection` fell back to the hard-coded 5 s default whenever the INCOMING key
      held nothing, throwing away the gate the user had just placed — and ticking a LATER lap does
      not move the window's start, so the carried offset still named the same point on the course.
      The default belongs at bind time, where there is no user intent to preserve; a selection change
      now carries the current slider position and a SAVED gate for the incoming key still wins over
      it. The published closure had become async when it started awaiting IndexedDB, and
      `updateSelectedLaps` fires it and forgets, so two quick clicks could resolve out of order — a
      generation token is captured before the await and every write happens after the check. And
      out-and-back's initial detection was unconditional where its GPS-lap twin guards on
      `selectedLaps.length > 0`: with no FIT lap ticked it detected whole-track sections, which the
      auto-select then wrote into `outAndBackSelectedSections`, which is what
      `analyzeOrchestrator.ts:245` reads — so Analyze came up enabled over the entire ride before the
      user had chosen anything. `bindGpsDetection.ts`, `bindOutAndBackDetection.ts` · commit `40bbc64`

- [x] **[S] An empty FIT selection is no basis, in both GPS modes.** Review round 4, findings F1-01
      and F1-02. `runOutAndBackDetection` fell back to the whole activity when nothing was ticked,
      cutting sections over a window the user never asked for, while `runGpsLapDetection` had refused
      that input since `40bbc64`; it now bails the same way, and the binder guard stays because that
      one suppresses the initial detection at bind time while this one suppresses the four gate
      handlers. Six existing out-and-back tests ran on a fixture that deliberately left
      `selectedLaps` empty and would every one have gone vacuous — they now take a FIT lap spanning
      the whole activity, which keeps the trim branch a no-op so the assertions keep their meaning.
      Separately, emptying the selection in a GPS mode tore the panel down and stopped:
      `updateAnalyzeButton` does not read the panel, so Analyze stayed enabled over the previous
      window's detection while the panel said there was nothing to analyse. The branch now clears the
      detection for both GPS mode families alongside the teardown; the A/B gate markers are
      deliberately kept, because a gate is the user's placement and survives a window change by
      design. `runOutAndBackDetection`, `section3Orchestration.ts` · commit `a4c9101`

- [x] **[S] A FIT file with exactly one lap ticks that lap by default, in all three modes.**
      `resetAnalysisForNewActivity` cleared `selectedLaps` unconditionally, charging the user a click
      for a choice that does not exist — and that click is what made the empty selection an
      attractive state to sit in, which is what made the "no basis" branches above reachable in
      ordinary use. Fixed at the source, with no second writer of `selectedLaps` added: the render
      sites end in `restoreSection3Controls`, which ends in `updateSelectedLaps()`, and that
      re-derives the selection from the checked boxes and fires every downstream effect.
      `resetAnalysisForNewActivity` · test: three cases in `section3ModeSwitch.test.ts` ·
      commit `0ae92a7` · *origin: PR #7 review round 1, C1-01 — a criterion from the maintainer
      directly, not from any item above*

      - [x] `resetAnalysisForNewActivity` ticks lap 1 when, and only when, `currentLaps.length === 1`
      - [x] the render round-trips it: `#lap-1` comes back checked and `updateSelectedLaps()`
            re-derives `[1]`
      - [x] the persistence key moves from "all" to "1" on such files — intended, no migration
      - [x] the analysis window moves from `timestamps[0]..timestamps[last]` to
            `min(start_time)..max(end_time)` — intended
      - [x] **MANUAL, RUN 2026-09-02 at `d586961`:** confirmed in the running app by the maintainer,
            on `~/Downloads/13.07-lap10-single.fit` — one lap, 5928 records with 274 inside the lap
            and 5654 outside, which is what makes the window change observable rather than a no-op —
            and on `~/Downloads/13.07.fit`. All five steps passed. **(a)** lap 1 ticked with no
            click, trim controls visible, Analyze reading `Analyze 1 Selected Lap` and
            `Trim Range: 0 to 273`; **(a2)** that same first paint drew the lap and its trim markers;
            **(b)** switching to "GPS based out and back" ran detection off that selection without
            waiting for a tick; **(c)** unticking lap 1 disabled Analyze and emptied the detected
            list; **(d)** `~/Downloads/13.07.fit` came up with nothing ticked and ran no detection
            until a lap was ticked.

- [x] **[S] The results export carries the k the physics actually used, and one conversion for it.**
      Review round 1's three quality findings, landed together. `resultColumns.ts` had
      re-implemented `Math.round(factor * 100)` beside the `factorToPercent` that exists so that
      rounding rule lives in one place; it now calls it, with no behaviour change — the byte-for-byte
      CSV pin (0.72 → 72) passes untouched. `saveResult` stored `parameters.wind_height_factor`
      verbatim while the analysis had asked `resolveWindHeightFactor` and been handed something else
      for every corrupt value — NaN, Infinity and negatives all degrade to
      `LEGACY_WIND_HEIGHT_FACTOR` before a single wind sample is scaled — so the WindHeightPct column
      could print a factor the run never applied. A **present** value now goes through the resolver,
      the same rule `crrApplied` beside it already follows; the presence check is load-bearing rather
      than defensive, because the resolver maps an absent factor onto 1.0 too and the column must
      stay blank for a record written before the column existed. Both guards save through the real
      `ResultsStorage` on `fake-indexeddb` and read back, so neither can pass over a hand-built
      record. The third finding was the documentation pass itself — the Done section above, written
      in one dated sitting. `resultColumns.ts`, `ResultsStorage.ts` ·
      test: `resultColumns.test.ts` · commit `1a64c06`

- [x] **[S] The selection reaches the map at the moment the map exists.** Review round 4, F2-01. On
      a single-lap file's first load the map drew the whole ride instead of the ticked lap, and
      neither trim marker appeared until a slider was nudged and put back. `initializeSection3` runs
      `restoreSection3Controls` before the map is constructed — deliberately, so a map that fails to
      initialize cannot leave Section 3 inert — and that function ends in `updateSelectedLaps()`,
      whose two map-dependent branches are both guarded on a `getMapVisualization()` that is still
      null there. Since `0ae92a7` that call has a non-empty selection at first paint, so both
      branches were skipped: the map went into `setData` with its constructor's `[]` and took
      `drawFullRoute`, and the marker block was never reached. Fixed without reordering the two —
      each ordering buys determinism with a new failure mode — by making the moment the map is
      published the moment selection-derived state is applied to it: `setSelectedLaps` between
      `setData` and `setMapVisualization`, and the marker block extracted to `drawTrimRegionOnMap`
      and called from both places, with the guard making the loser a no-op. Its manual check was
      subsequently run and passed, on 2026-09-02 — see C1-01's box above.
      `section3Orchestration.ts` · test: two cases in `section3ModeSwitch.test.ts` ·
      commit `d586961`

### Review follow-ups on PR #7 — 2026-08-31

A code review of the whole `refactoring` diff found five defects across the bundles above. All five
are fixed here; 955 tests pass (up 14), `npm run check` clean. Every new assertion was checked
against the pre-fix code and observed to fail. **Checked in the running app** (dev server + Chrome,
`13.07.fit`, which carries per-point air density), not only under vitest.

- [x] **[S] Standard's analyze leg had no `rhoArray` — and the header now reads that fit.** Bundle
      D's WR-4 pass gave `renderGpsLap` and `renderOutAndBack` the shared resolver and left the
      third leg on the constant `params.rho`, because Standard slices a CONCATENATED selection and
      so could not copy the per-segment `indices.map(...)` line. Filed as unobservable while the
      paint only drew plots; bundle B's `updateMetricsDisplay` made it visible.

      New `resolveSelectionRhoArray` beside `resolveRhoArray`, slicing with the same
      `selectedIndices.map` that built the payload arrays, and returning `null` (constant rho, as
      before) when the ride has no usable density, when an index falls outside the series, or when
      the slice is not the length of the calculator's other series.

      **A/B in the app, lap 10 of `13.07.fit`, MutationObserver on the header spans:** without the
      fix R² 0.0052 / RMSE 7.94 m / VE 16.17 m at the analyze paint, flipping to 0.0060 / 7.62 m /
      15.57 m a macrotask later; with it, 0.0060 / 7.62 m / 15.57 m written once and never changed.
      `rhoArrayResolver.ts`, `renderStandardVe.ts:110` · test: `selectionRhoArray.test.ts`, whose
      last case is source-level on purpose — the defect is an OMISSION, which no test of the leg's
      own module can observe

- [x] **[XS] `closeResultsModal()` leaked the view's keydown handler.** The listener is on
      `document`, so removing the element did not remove it — and the exported close runs at the top
      of every open. Escape afterwards ran the dead view's `close()` and threw focus back to
      whatever had it when that view was opened. Now a module-level teardown ref that every close
      path routes through. `resultsModal.ts:87` · test: two cases in `resultsModal.test.ts`

- [x] **[XS] `deleteResult` reported success when the database was never opened.** `if (!this.db)
      return;` resolved, and `resultsModal` acts on that: row removed, "Stored results (N)"
      decremented, nothing deleted. Now throws, as `saveResult` already did.
      `ResultsStorage.ts:684`

- [x] **[XS] `deleteResult` resolved on `request.onsuccess`, not on the transaction.** An IndexedDB
      write can succeed at request level and still be rolled back (quota, an explicit abort, the
      connection closing); the row would reappear on the next open with nothing having reported a
      failure. Now `oncomplete`/`onabort`/`onerror`. `ResultsStorage.ts:684` · test: two cases in
      `resultsStorageDelete.test.ts`, the second aborting from the delete request's own success
      handler

- [x] **[XS] The tab resize took in graphs its own call sites disagreed about.**
      `resizePlotlyGraphsIn(pane)` reached every `.js-plotly-plot` in the activated pane, including
      the out-and-back compare graphs, which live inside the VE pane behind `.hidden` — the exact
      thing the scoped call at `outAndBackPlots.ts:703` documents avoiding. The guard now lives in
      the helper, so both sites agree.

      **Stated plainly: the harm the review predicted does not reproduce.** Replaying the pre-fix
      helper verbatim in the app against the hidden compare graphs left them at 1032 px, because the
      graph div is `display: block` inside a `display: none` parent — Plotly's own hidden-guard does
      not reject, and its autosize falls back to the current `fullLayout.width` rather than
      measuring 0. So this is a consistency guard, not a bug fix, kept because the sizing convention
      note is explicit that a re-introduced `layout.height` makes that call destructive again.
      Confirmed not to break the real path: Power and Wind still measure 1032 px against their
      1032 px containers after activation. `plotlyResize.ts:6` · test: two cases in
      `tabPlotResize.test.ts`

Also confirmed in the app, none of it changed by this work: Store Result persists the number the
header shows (RMSE 7.624 stored against 7.62 m on screen), the results view deletes exactly the
addressed row and the delete survives a reopen, and no console errors anywhere in the session. Two
first-paint jumps that are NOT this work are filed under *Standalone work* above.

### Bundle D · Plot rendering and tab layout — 2026-08-31

Implemented in the working tree; **not committed**. 941 tests pass (up 48), `npm run check` and
`npm run lint` clean. Every new assertion was checked against the pre-fix code and observed to fail,
so none of them is vacuous.

**A first attempt at the layout item shipped a worse bug and was corrected.** Adding the
`Plots.resize` call without changing the sizing convention collapsed Standard's plots to 26 px
(maintainer screenshots). The write-up below is of the corrected work; the correction is item 0.

- [x] **[M] One sizing convention for every plot in every mode.** *Not in the original bundle —
      found by the maintainer when the first attempt at the layout item broke the panel, and it is
      the real root cause underneath it.*

      **Two conventions coexisted.** GPS-lap and out-and-back size a plot from CSS: the graph div
      is nested inside the bordered box, carries a height class, and the figure sets no
      `layout.height`. Standard inverted it — the figure carried `height: 350`/`200` and the
      container carried no height at all, so the BOX was sized by the plot. Standard's wind, power
      and VD figures were on neither convention: no CSS height *and* no `layout.height`, so they had
      no height source whatsoever and only ever looked right because being drawn into a hidden pane
      handed them Plotly's 700×450 fallback. **That accident was load-bearing**, which is the real
      answer to "why do plot dimensions change after an update or a tab switch": the four draw paths
      re-measured by different amounts, and any path that measured honestly destroyed the default.

      **Why the pinned height was actively harmful.** `Plots.resize` guards on
      `layout.width && layout.height` (`plotly-basic.js:48331`) and then *deletes both* and
      re-autosizes. A height-only layout sails past that guard. Measured in Chrome: 350 px → 26 px,
      and 26 px again on every subsequent resize — a ratchet, not a one-off. Same 26 px for the
      wind plot. That is exactly the maintainer's two screenshots.

      **Unified on the CSS convention**, which is what two of the three modes already had and the
      only one compatible with `config.responsive` and `Plots.resize`. All 13 plot divs across the
      three templates are now `.ve-plot-container > .ve-plot-container__plot--{ve,residuals,tall}`;
      the four `layout.height` entries are gone; `.ve-plot` / `.ve-plot--tall` are retired. Nesting
      rather than sizing the box itself also removes a slow drift — the box carries padding and a
      border, so as a graph div its `offsetHeight` included them and it grew on every re-measure.

      Heights moved to `clamp()` (`40vh`/`20vh`/`58vh` with floors and ceilings), so the plots fill
      the space on a laptop and a tall monitor alike; this replaced the `@media` override in
      `responsive.css`, which only ever reached the now-retired `.ve-plot`. Verified in Chrome:
      `svg === box` on every plot, and stable across five parameter updates, a tab switch and
      repeated resizes.

      `oneSizingConvention.test.ts` pins it — the failure is invisible at the unit level, since a
      figure with a pinned height looks perfectly reasonable on its own.
      *origin: maintainer, 2026-08-31*

- [x] **[S–M] Layout: the Wind, Power and VD tabs waste most of their width.** Reproduced in Chrome
      against the real markup and stylesheet before any code was changed, as the item asked.

      **Neither suspect in the item was the cause.** `.ve-plot-container`'s `flex: 1` is inert — its
      parent is always a `.ve-tab-content` pane, which is `display: block` or `display: none` and
      never a flex container (measured: computed `flex-grow: 1`, parent display `block`/`none`, on
      every instance). The interleaved offset-control block is a plain sibling. Both were red
      herrings.

      **The actual cause is that the plots are drawn while their pane is hidden.**
      `initializeVEAnalysis` draws all five plots up front, when every pane but VE is
      `display: none`. Plotly's autosize reads `gd.offsetWidth`, gets 0 and falls back to its
      default `layout.width` of **700 px**. Nothing rescues it afterwards: `config.responsive`
      hooks only the window `resize` event, which un-hiding does not fire, and `Plotly.react` does
      not re-run autosize on a graph that already carries a width — so the tab render callbacks
      re-plot at 700 px too. Measured: an 808 px container holding a 700 px svg after activation
      **and** react; 808 px only after `Plots.resize`. That is the "roughly two-thirds width with
      dead space either side", and it is exactly why the VE tab was exempt — its pane is the active
      one when the first draw happens. The same measurement on the GPS-lap / out-and-back shape
      (`.ve-plot--tall`) gave 700×300 in an 808×300 box, so height was wrong there too.

      Fixed centrally in `resizePlotlyGraphsIn` (`shell/dom/plotlyResize.ts`), called from
      `activateTab` after the render callback — one call point covering all three modes and every
      tab. **That call is only safe on top of the sizing unification above**, and shipping it
      without that is what broke the panel: `Plots.resize` deletes a height-only layout. The
      original verification measured width for the height-less container and height only for the
      fixed-height one, so it never asked the question that would have caught it. The dead `flex: 1` is removed with a note saying why it never applied, and the
      `StandardPlotBuilders` comment that cited it as the reason for the explicit `layout.height`
      is corrected: the height is load-bearing, but not for that reason.
      *origin: maintainer, 2026-08-30*

- [x] **[M] Out-and-back still uses `Plotly.newPlot` for plots redrawn on every update.** All seven
      out-and-back calls and the five in `renderStandardVe` now use `Plotly.react`; `Plotly.newPlot`
      has no callers left anywhere in `src`. Pinned by a new `outAndBackPlotDrawMethod.test.ts`
      (modelled on `gpsLapPlotDrawMethod.test.ts`, both methods stubbed so `newPlot` stays available
      and is simply not taken) and by two new cases in `standardModeRealChain.test.ts`, whose fake
      now records WHICH method each draw went through — it used to `void name`, which is why the
      five Standard `newPlot` calls were invisible to that chain.

      **One interaction worth recording.** `renderOutAndBackPlots` unhides `#oabCompareView` before
      plotting, with a comment explaining that Plotly measures the container at draw time. That is
      true of `newPlot` and NOT of `react`, so the migration would have introduced the same stale
      width the layout item above is about; the compare view is now re-measured after the draw.
      Two existing tests (`outAndBackCompareFigures`, `outAndBackVdHeader`) stubbed only `newPlot`
      and so were quietly a second pin on the draw method — their stubs now offer both.

- [x] **[M] A time/distance switch on the x-axis for standard mode.** Two maintainer rulings taken
      first (2026-08-31): **one shared setting**, with a copy of the control under each of the four
      plots, over four independent per-plot settings; and **cumulative distance** accumulated across
      lap boundaries, over the raw FIT odometer — Standard stitches several laps, so the recorded
      channel jumps backwards at every boundary.

      The item's estimate held. `PlotContext` gained the x-axis identity (`xPoints*` renamed from
      `timePoints*`, plus `xAxisTitle` and `axis`), `createDistancePlotContext` sits beside
      `createPlotContext` with identical index bookkeeping, and the four hardcoded `'Time (seconds)'`
      titles read from the context. All four figures take their x from the context, so the switch is
      a context swap and no figure builder knows which axis it draws.

      **One thing the item did not name.** `buildTrimBoundaryShapes` used `context.trimStart` /
      `trimEnd` — SAMPLE INDICES — directly as x coordinates. That is invisible under a time axis,
      where the axis IS the index, and would have put the dashed trim lines at kilometre 30 000 of a
      40 km ride. `xTrimStart` / `xTrimEnd` are the same boundaries in x units and are what the
      shapes read now. `findOptimalAnnotationPosition` needed nothing: it normalises whatever array
      it is handed.

      The control follows the `lapViewToggle` pattern and the codebase's presence-not-visibility
      rule — emitted unconditionally, hidden until a draw reports a usable distance channel, so it
      is never absent at bind time. `ve` joined the tab render map, which it had never been in: the
      recompute path was the only thing that redrew the VE pair, and the toggle changes no parameter
      and runs no fit, so without an entry a flip on the VE tab would have moved the other three and
      left the one on screen behind. *origin: maintainer, 2026-08-30*

- [x] **[S–M] A torn-down VE panel keeps its DOM, listeners and Plotly instances.**
      `purgePlotlyGraphsIn` (`shell/dom/plotlyPurge.ts`) is called from `tearDownVeAnalysisPanel`.
      The markup still stays — the next render replaces it wholesale, as that function's own comment
      says — but what Plotly hung off it does not.

      The status-flash half is fixed at the root rather than only at the teardown: going idle now
      never CREATES the pill. `ensureStatusNode` builds one wherever it fails to find one, so the
      250 ms timer firing into a torn-down panel meant "hide the pill" MINTED a fresh
      `#veRecomputeStatus` inside the panel it was hiding something in. The teardown also clears the
      flash timer, which `resetRecomputeThrottle` never touched. *origin: audit NEW-2*

### Bundle H · On-screen results view — 2026-08-31

Implemented in the working tree; **not committed**. 878 tests pass (up 24), `npm run check`,
`npm run lint` and `npm run build` clean.

- [x] **[M] "Show All Results", with per-entry delete.** New modal
      (`shell/dom/resultsModal.ts`), reached from a fourth button in all three sidebar footers
      through `bindActionFooter`'s new optional `onShowAllResults`. Reads the existing
      `getAllResults()`; deletes through the new `ResultsStorage.deleteResult`.
      *origin: maintainer, 2026-08-30*

      **The open question in this item was already answered by the schema.** It asked for "a
      decision about what the key is (`lapKey` is `fileName`-scoped, not unique on its own)". The
      object store's `keyPath` has been the composite `['fileName', 'lapKey', 'notes']` all along,
      so a row was already uniquely addressable: `objectStore.delete([fileName, lapKey, notes])`,
      no new index, no schema version, no migration. That dropped the item from M–L to M.

- [x] **[S] The results view is reachable with no file loaded.** A second entry point in the app
      footer (`showAllResultsFooter`), bound in `initializeApplication` where `resultsStorage` is
      already in scope, placed BEFORE "Clear Results" so the reading order is look-then-destroy.
      The sidebar button stays as the convenient path right after Store Result; both go through
      `handleShowAllResults`, so the two cannot drift.

      The asymmetry that motivated it: the footer has always carried "Clear Results & Saved
      Parameters" against the same global store with no file loaded, so every stored result could be
      DESTROYED from a cold start but not READ. `handleShowAllResults` now takes a narrow
      `ResultsViewStorage` (the two functions the view uses) rather than the whole class — which is
      also what lets `showAllResultsEntry.test.ts` drive the entry point with no IndexedDB.
      *origin: maintainer, 2026-08-31*

- [x] **[S] One column table for the CSV and the view.** `CSV_HEADERS` and the value list inside
      `generateCSVFromResults` were two parallel arrays of 32 entries related only by position —
      add a field to one and every cell after it shifts, silently, for every consumer. They are now
      one `RESULT_COLUMNS` array (`utils/resultColumns.ts`) that both the export and the table
      render from, so the on-screen view could not become the THIRD such list. `resultColumns.test.ts`
      pins the CSV byte for byte across the extraction, and its own value was confirmed by mutating
      a column and watching it fail.

      Also closes a latent hole: only `Notes` was ever quoted, so a FIT file whose NAME contained a
      comma shifted every column after `FileName` in that row. Escaping is now the CSV writer's job
      rather than a per-column concern.

      **The columns were then reordered** (maintainer, 2026-08-31) to read most-important-first:
      date, file, notes, CdA, Crr, avg power, avg speed, RMSE, R², temp, timestamp, laps, then the
      rest by how much they change the reading of those. One array edit moved BOTH surfaces, which
      is the payoff of merging the two lists. **The exported CSV's column order therefore changed** —
      breaking for anything reading it positionally rather than by header name. The characterization
      pin failed on the reorder, as intended, and was re-baselined deliberately with the cell formats
      still pinned.

- [x] **[S] The IndexedDB half of `ResultsStorage` has tests at all.** jsdom ships no IndexedDB, so
      `saveResult`, `getAllResults` and `clearAllResults` had never been exercised by anything but
      hand. Tolerable for an append and an all-or-nothing clear; not for a keyed DELETE, where the
      assertion that matters is "only that row went". `fake-indexeddb` (new devDependency, maintainer
      approved) is the store's own engine rather than a stub, so the key-comparison semantics under
      test are the browser's.

### Bundle B · Store Result is truthful — the analyze path stopped computing its own answer — 2026-08-31

Implemented in the working tree; **not committed**. 854 tests pass, `npm run check` and `npm run
lint` clean. Four obsolete guards went out with the code they pinned (two golden analyze-leg cases,
two `rhoArray` payload tests) and seven came in.

The load-bearing one is `analyzeStoredResult.wasm.test.ts`: the real GPS-lap analyze entry point
over the anonymised golden ride (1436 samples, 7 laps) with the REAL Rust calculator, asserting that
what Store Result would persist is the number the panel was painted with. It exists because
`gpsModeRealChain.test.ts`'s calculator is a stub returning a constant `r2: 0.5`, against which
"the seed equals the first update" cannot distinguish a shared code path from any two code paths.
On real physics the gap is stark and is recorded in the test: the old stitched fit reports
**RMSE 55.33 m** where the panel shows **7.81 m**.

- [x] **[M–L] Store Result straight after Analyze no longer persists an r²/RMSE the screen never
      showed (WR-4).** Both GPS renderers now call `requestModeUpdate("parameters")` after
      `bindModeControls`, which is the kick Standard has had since before the phase
      (`renderStandardVe.ts:562`). The seeded value is produced by the SAME code path a control
      gesture uses, so "the seed disagrees with the first update" is unwritable rather than merely
      tested — which is what the re-scoping note asked for and what hand-rolling the aggregation
      would have broken (CR-02).
      `renderGpsLap.ts`, `renderOutAndBack.ts` · *origin: audit WR-4*

      **The previous attempt's diagnosis was wrong, and it is worth recording why.** It concluded
      the runner's running/handoff state suppressed the following pass — "an app-level risk, not a
      test one". It is the opposite: a **fake-timer leak in the harness**. `scheduleRecompute`
      guards on a module-level `throttleTimer` that is nulled only inside its own callback
      (`recomputeRunner.ts:239`), and `vi.useRealTimers()` DISCARDS a pending fake timer without
      running it. Any test ending with a recompute armed leaves that handle set forever, and every
      later test then returns at the guard, arms nothing, and observes no recompute at all. The
      kick is what first armed a timer in `beforeEach`. `standardModeRealChain.test.ts:387-398`
      already carried the fix and the explanation — which is the real reason Standard's kick was
      testable and this one was not. Adding `resetRecomputeThrottle()` to the three `afterEach`
      hooks that lacked it took the failures from 20 to 0 with no production change.

- [x] **[S] The GPS analyze legs pass the rho array.** Found by asking a question the eye cannot
      answer -- does the kick's repaint change anything? -- and measuring it instead. All three
      analyze-leg calculators (`renderGpsLap.ts`, `renderOutAndBack.ts` outbound and inbound) were
      built with NO `rhoArray`, while `updateModeVEPlots.ts:251` passes a per-segment slice. On any
      ride carrying usable air density the first paint therefore integrated constant `params.rho`
      and the kick's repaint the real per-point series: **mean RMSE 7.809 m at the analyze paint
      against 7.555 m a macrotask later**, with the analyze number the wrong one. Both now call the
      shared `resolveRhoArray` (D-06).

      Pre-existing and older than WR-4 — the kick did not cause it, it made it observable. Before
      this the GPS modes simply never ran the primitive at analyze time, so nothing was there to
      disagree with the wrong number. `analyzeStoredResult.wasm.test.ts` now holds the first
      paint and the repaint to agree, with rho installed on the axis that separates them.

- [x] **[S] `currentVEResult` has one writer.** `analyzeOrchestrator.ts` no longer assigns
      `payload.initialResult` — one stitched fit over the concatenated selection, which
      `gpsLapMode.render` and `outAndBackMode.render` never forwarded to anything. `handler.summarize`
      is the sole writer now, for all three modes. The field is also **cleared at the start of every
      analyze**, so a failed one cannot leave the previous ride's result for Store Result to persist
      under this ride's name. New `analyzeResultLifecycle.test.ts` holds that.

- [x] **[S] Standard's header spans agree with the plot beneath them.** They were interpolated from
      `initialResult` (no trim, wind forced to `"fit"`, offset off) while the curve directly below
      came from `initializeVEAnalysis`'s own fit (trimmed, selected source) — two fits of one ride,
      stacked, until the kick replaced both. The template now ships them empty and
      `updateMetricsDisplay` fills them from the integration that drew the curve, on the same rule
      the virtual-distance header already followed (`renderStandardVe.ts:205`).

- [x] **[S] `prepareAnalysisPayload` runs no physics.** With its last consumer gone, the calculator,
      `initialResult`, `rhoArray` and the `calculateRhoArray` injection are deleted; it filters the
      selection and returns arrays. Production calculator sites drop from 6 to 5, and the two golden
      analyze-leg cases go with the calculator they existed to pin — the D-10 mutation they closed
      has no target left, which the golden file records in their place.

### Bundle B (part) · The analyze-time wind source and virtual distances — 2026-08-30

Implemented in the working tree; **not committed**. 850 tests pass (up 4), `npm run check` and
`npm run lint` clean. WR-4 is closed in the entry above.

- [x] **[M] Store Result straight after Analyze no longer records a wind source and virtual
      distances that no analyze ever wrote.** New `seedSegmentModeAnalyzeState`
      (`segmentSummary.ts`) extends the CR-01 samples seed to the other two fields Store Result
      reads. It delegates to `seedSegmentModeFilteredData` and routes the source through
      `resolveRecordedWindSource`, so "compare" survives exactly as on the update path rather than
      through a second copy of the rule. Both GPS panels now compute `selectedWindSource` *before*
      the seed and pass that one value to both, so the recorded source and the rendered panel
      cannot disagree. GPS-lap stacks one VD entry per lap; out-and-back reuses
      `sectionVirtualDistances` for one entry per SECTION, per the standing ruling — reusing the
      same builders is what keeps an analyze-time export identical to a post-update one.
      `renderGpsLap.ts`, `renderOutAndBack.ts`, `segmentSummary.ts` · *origin: audit WR-3*

      **The harness was lying, and that came first.** `gpsModeRealChain.test.ts`'s `makeAppState` is
      a plain object cast to `AppState`, so `currentWindSource` was `undefined` and the first
      version of this guard passed vacuously against `undefined !== "none"` — the exact shape that
      file exists to answer. The fixture now carries the real defaults
      (`currentWindSource: "none"`, `currentVirtualDistances: []`). Its two profile fixtures also
      set `supplementarySeries`/leg series to `null`, a state the analyze leg never produces and
      the `LapVEProfile` type does not even permit; they now carry well-formed series.

### Bundle A · Wind height factor k, end to end — 2026-08-30

Implemented in the working tree; **not yet committed**, pending an in-app check. 846 tests pass
(up 19), `npm run check` and `npm run lint` clean.

- [x] **[S] The k control now speaks 0–100%** (D-b). `WIND_HEIGHT_PERCENT_{MIN,MAX,STEP}` plus
      `factorToPercent`/`percentToFactor` in `WindHeightTransfer.ts`; both inputs, the readout, the
      fitted-range caveat and the info tooltip all converted. Storage stays the 0–1 factor, so no
      record changes meaning and no migration is owed. Both converters round, because 0.01 steps
      are not representable in IEEE754 and an unrounded round trip yields a readout of
      "7.000000000000001%".

      **One consequence worth your eye:** `resolveWindHeightFactor` mapped `factor <= 0` onto 1.0,
      treating 0 as corruption. Once the slider reaches 0% that guard inverts the control — dragging
      to zero would apply the FULL wind. The guard is now `factor < 0`, so a stored 0 means what it
      reads as: no wind reaches the rider. A pre-existing record holding exactly 0 therefore changes
      meaning; the UI could never write one (the floor was 0.3 and the number input clamped to it),
      so this reaches only a corrupt or hand-edited row.

- [x] **[S] A persisted out-of-range k no longer commits its own narrowing.** Not fixed by clamping
      — clamping storage is the bug D-03 exists to prevent. The readout now names the stored value,
      says the slider is parked at its limit because it cannot represent it, states that the stored
      value is what the physics uses, and warns that moving the slider will replace it. It is styled
      as a warning, and takes precedence over the manual/unknown prompts because it is the one that
      has to arrive *before* the next gesture. `windHeightControls.ts` · *origin: Phase 8 WR-07*

- [x] **[S] A stored wind is never overwritten by a weather fill** (D-a). New
      `weatherMayFillWind` — one decision site, provenance not value: the API fills a wind that is
      absent or that it wrote itself, and never one whose `wind_entry` is `"manual"` or
      `"unknown"`. Note the bug was **wider than recorded**: the legacy `"unknown"` case was
      protected for k but its *wind* was replaced too, so a legacy analysis was re-fitted on every
      reload regardless. `autoRho.ts:230-245`, `windHeightControls.ts` · *origin: Phase 8 WR-05*

- [x] **[S] k is stored and exported.** `windHeightFactor` on `StoredVEResult`, carried in
      `saveResult`, and a new `WindHeightPct` column sited next to the wind it scales. Optional and
      guarded exactly like `crrApplied`: a pre-column record exports an empty cell rather than a
      fabricated 100 claiming it was fitted at no transfer.
      `ResultsStorage.ts` · *origin: Phase 8 WR-02 = audit WR-8*

- [x] **[S] The wind fields follow the current binding.** `windFieldsBound` was a membership-only
      `WeakSet`, so the listener it guarded closed over the FIRST binding's `getParams` forever. Now
      a `WeakMap` doing both jobs: membership still attaches the listener once per node, and the
      value — overwritten on every bind, read back inside the listener — keeps it pointed at the
      current binding. The test re-binds the same nodes with a second closure and asserts the
      readout follows it. `windHeightControls.ts` · *origin: Phase 8 WR-06*

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
