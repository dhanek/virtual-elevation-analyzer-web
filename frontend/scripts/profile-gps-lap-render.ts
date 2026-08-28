/**
 * GPS-lap END-TO-END slider-update profiler, and the debounce arithmetic.
 *
 * WHY THIS EXISTS. `profile-slider-recompute.ts` reports `gps-lap-6` at ~1.0 ms
 * median / ~1.2 ms p95 and its own decision line says the remaining latency is
 * "more likely dominated by DOM / Plotly work". That sentence names the thing
 * the pre-screen cannot see: it stops at `calculate_virtual_elevation` and
 * `Array.from`, so EVERY layer between the WASM result and the pixel is missing
 * from the number — the lap mapping, the mean-elevation profile, the aggregate
 * statistics, the residual trace construction and the summary-table DOM writes.
 * A 1.2 ms figure that excludes the expensive half is true and useless, which is
 * the same failure class as a vacuous guard.
 *
 * WHAT IS REAL HERE. The whole production update path: `updateModeVEPlots` (the
 * D-01 primitive) driven with the real `gpsLapMode` handler, the real
 * `createGpsLapUpdateCallbacks`, the real WASM calculator and the real
 * `renderGpsLapVEPlots` / `renderGpsLapWindPlot` / ... render functions, against
 * a jsdom document. Nothing in the measured path is re-implemented here; this
 * script only builds the inputs and holds a stopwatch.
 *
 * WHAT IS NOT MEASURED, AND WHY. Plotly itself. Plotly is loaded from
 * `cdn.plot.ly` at runtime and is not an npm dependency (see `index.html` CSP
 * and `package.json`), and jsdom supplies neither the SVG text metrics nor the
 * layout boxes Plotly's autorange needs, so a headless number for it would be a
 * fiction. The `Plotly` global is therefore stubbed with a recorder, and the
 * script reports the trace/point COUNTS handed to it so the browser-side cost
 * has a documented workload. The remaining Plotly time is what the D-16 DevTools
 * protocol in `07-DEBOUNCE-HANDOFF.md` §4 measures; this script deliberately
 * does not invent a second protocol for it.
 *
 * So the reported "render" column is a LOWER BOUND on per-update cost:
 *   measured here  = compute + mapping + stats + trace building + DOM writes
 *   not measured   = Plotly's own diff/layout/paint, on the counts printed below
 *
 * SECTION 2 is the debounce arithmetic. `scheduleRecompute` is a RESETTING
 * TRAILING debounce, not a throttle, and the two behave completely differently
 * under a sustained drag. The model used for the sweep is validated against the
 * real exported `scheduleRecompute` at the shipped constant before it is trusted
 * at any other value, because the module constant is not parameterisable.
 *
 * Run: `npm run profile:gps-lap-render` from `frontend/`.
 */
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { JSDOM } from 'jsdom'

const WARMUP_ITERATIONS = 3
const MEASURED_ITERATIONS = 20
const SAMPLE_COUNT = 7_200
/** The maintainer's case, and the pre-screen's `gps-lap-6` scenario. */
const MAINTAINER_LAP_COUNT = 6
/** The D-16 gate workload (`3-PROFILE-REPORT.md:5` used 18 laps). */
const GATE_LAP_COUNT = 18

function formatMsLocal(value: number): string {
    return `${value.toFixed(1)}ms`
}

/** Every draw call the update path made, with the payload it handed Plotly. */
interface PlotlyCall {
    method: 'react' | 'newPlot'
    divId: string
    traceCount: number
    pointCount: number
}

let plotlyCalls: PlotlyCall[] = []

function installDom(): void {
    const dom = new JSDOM(
        `<!doctype html><html><body>
            <div id="gpsLapVePlot"></div>
            <div id="gpsLapResidualPlot"></div>
            <div id="gpsLapWindPlot"></div>
            <div id="gpsLapPowerPlot"></div>
            <div id="gpsLapVdPlot"></div>
            <span id="gpsLapR2Value"></span>
            <span id="gpsLapRmseValue"></span>
            <span id="gpsLapClosingErrorValue"></span>
            <div id="gpsLapSummaryTable"></div>
            <div id="vdHeader"></div>
            <div class="ve-tabs">
                <button class="ve-tab-button ve-tab-button--active" data-tab="ve"></button>
                <button class="ve-tab-button" data-tab="wind"></button>
                <button class="ve-tab-button" data-tab="power"></button>
                <button class="ve-tab-button" data-tab="vd"></button>
            </div>
            <div id="ve-tab" class="ve-tab-content ve-tab-content--active"></div>
            <div id="wind-tab" class="ve-tab-content"></div>
            <div id="power-tab" class="ve-tab-content"></div>
            <div id="vd-tab" class="ve-tab-content"></div>
        </body></html>`,
    )

    const anyGlobal = globalThis as Record<string, unknown>
    anyGlobal.window = dom.window
    anyGlobal.document = dom.window.document
    // `navigator` is a getter-only global on modern node, so it is defined
    // rather than assigned. Nothing in the measured path reads it, but jsdom
    // internals can.
    Object.defineProperty(globalThis, 'navigator', {
        value: dom.window.navigator,
        configurable: true,
    })
    anyGlobal.HTMLElement = dom.window.HTMLElement
    anyGlobal.Element = dom.window.Element
    anyGlobal.Node = dom.window.Node

    function record(method: 'react' | 'newPlot') {
        return (divId: string, data: unknown) => {
            const traces = Array.isArray(data) ? data : []
            let points = 0
            for (const trace of traces) {
                const x = (trace as { x?: unknown[] }).x
                points += Array.isArray(x) ? x.length : 0
            }
            plotlyCalls.push({ method, divId, traceCount: traces.length, pointCount: points })
        }
    }

    ;(dom.window as unknown as Record<string, unknown>).Plotly = {
        react: record('react'),
        newPlot: record('newPlot'),
    }
}

interface PhaseTimings {
    total: number
    aggregate: number
    renderVe: number
    renderTabs: number
}

interface RenderMeasurement {
    name: string
    lapCount: number
    samples: PhaseTimings[]
    plotlyCalls: PlotlyCall[]
}

async function main(): Promise<void> {
    installDom()

    // Imported AFTER the DOM globals exist, so no module can capture an
    // undefined `document` at evaluation time.
    const [
        { default: init },
        { DEFAULT_PARAMETERS },
        { createSyntheticActivity, createSegmentRanges, percentile, formatMs },
        { AppState },
        { getAnalysisModeHandlerById },
        { updateModeVEPlots },
        { createGpsLapUpdateCallbacks },
        { calculateMeanElevationProfile, calculateGpsLapStats },
        { scheduleRecompute, RECOMPUTE_THROTTLE_MS },
    ] = await Promise.all([
        import('../pkg/virtual_elevation_analyzer.js'),
        import('../src/components/AnalysisParameters'),
        import('./syntheticActivity'),
        import('../src/state/AppState'),
        import('../src/modes/analysis/AnalysisModes'),
        import('../src/shell/analysis/updateModeVEPlots'),
        import('../src/shell/gpsLap/updateGpsLap'),
        import('../src/shell/gpsLap/gpsLapPlots'),
        import('../src/shell/analysis/recomputeRunner'),
    ])

    const wasm = await readFile(new URL('../pkg/virtual_elevation_analyzer_bg.wasm', import.meta.url))
    await init({ module_or_path: wasm })

    const activity = createSyntheticActivity(SAMPLE_COUNT)
    const params = {
        ...DEFAULT_PARAMETERS,
        cda: 0.23,
        crr: 0.004,
        wind_speed: 3,
        wind_direction: 270,
    }

    /** One full production update, exactly as a slider event produces it. */
    async function measureUpdate(lapCount: number, activeTab: string): Promise<RenderMeasurement> {
        const appState = new AppState()
        appState.activity.currentFitData = activity
        appState.analysis.currentParameters = params
        appState.selection.currentGpsLapIndexRanges = createSegmentRanges(SAMPLE_COUNT, lapCount)
        appState.ui.isGpsLapModeActive = true

        const handler = getAnalysisModeHandlerById('gpsLap')
        const phases: PhaseTimings[] = []
        let lastCalls: PlotlyCall[] = []

        for (let i = 0; i < WARMUP_ITERATIONS + MEASURED_ITERATIONS; i++) {
            // Fresh callbacks per update, matching the funnel: `requestModeUpdate`
            // calls `getModeUpdateCallbacks` on every event, so the memo inside
            // `createGpsLapUpdateCallbacks` never survives an update in production.
            const real = createGpsLapUpdateCallbacks(appState)
            let aggregateMs = 0
            let renderVeMs = 0
            let renderTabsMs = 0

            const timed = {
                aggregate: (profiles: never) => {
                    const t = performance.now()
                    const out = real.aggregate(profiles)
                    aggregateMs += performance.now() - t
                    return out
                },
                renderVe: async (profiles: never, aggregate: never) => {
                    const t = performance.now()
                    await real.renderVe(profiles, aggregate)
                    renderVeMs += performance.now() - t
                },
                renderMetrics: real.renderMetrics,
                renderWind: async (profiles: never) => {
                    const t = performance.now()
                    await real.renderWind(profiles)
                    renderTabsMs += performance.now() - t
                },
                renderPower: async (profiles: never) => {
                    const t = performance.now()
                    await real.renderPower(profiles)
                    renderTabsMs += performance.now() - t
                },
                renderVd: async (profiles: never) => {
                    const t = performance.now()
                    await real.renderVd(profiles)
                    renderTabsMs += performance.now() - t
                },
            }

            plotlyCalls = []
            const start = performance.now()
            await updateModeVEPlots({
                appState,
                handler,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                callbacks: timed as any,
                windSource: 'fit',
                // A drag moves CdA, so vary it the way a drag does; an identical
                // value every iteration would let a downstream memo answer for
                // free and understate the cost.
                cda: 0.2 + (i % 10) * 0.005,
                crr: 0.004,
                isTabActive: (tabId: string) => tabId === activeTab,
            })
            const total = performance.now() - start

            if (i >= WARMUP_ITERATIONS) {
                phases.push({ total, aggregate: aggregateMs, renderVe: renderVeMs, renderTabs: renderTabsMs })
            }
            lastCalls = plotlyCalls
        }

        return { name: `gps-lap-${lapCount} / ${activeTab}`, lapCount, samples: phases, plotlyCalls: lastCalls }
    }

    const measurements: RenderMeasurement[] = [
        await measureUpdate(MAINTAINER_LAP_COUNT, 've-tab'),
        await measureUpdate(MAINTAINER_LAP_COUNT, 'wind-tab'),
        await measureUpdate(GATE_LAP_COUNT, 've-tab'),
    ]

    // ---------------------------------------------------------------- report 1
    process.stdout.write('\nGPS-lap end-to-end slider update (synthetic, jsdom, Plotly stubbed)\n')
    process.stdout.write(`Samples: ${SAMPLE_COUNT} @ 1 Hz, warmup=${WARMUP_ITERATIONS}, measured=${MEASURED_ITERATIONS}\n`)
    process.stdout.write('Columns: total = whole updateModeVEPlots pass. compute = total minus the\n')
    process.stdout.write('measured callbacks, i.e. the part the existing pre-screen already covers.\n\n')
    process.stdout.write('Scenario                    total(med)  total(p95)   compute   aggregate    renderVe   renderTab\n')
    process.stdout.write('-------------------------------------------------------------------------------------------------\n')

    for (const m of measurements) {
        const totals = m.samples.map(s => s.total).sort((a, b) => a - b)
        const aggregates = m.samples.map(s => s.aggregate).sort((a, b) => a - b)
        const renderVes = m.samples.map(s => s.renderVe).sort((a, b) => a - b)
        const renderTabs = m.samples.map(s => s.renderTabs).sort((a, b) => a - b)
        const computes = m.samples
            .map(s => s.total - s.aggregate - s.renderVe - s.renderTabs)
            .sort((a, b) => a - b)

        process.stdout.write(
            `${m.name.padEnd(26)} ${formatMs(percentile(totals, 0.5)).padStart(10)}  ${formatMs(percentile(totals, 0.95)).padStart(10)}` +
            `  ${formatMs(percentile(computes, 0.5)).padStart(8)}  ${formatMs(percentile(aggregates, 0.5)).padStart(10)}` +
            `  ${formatMs(percentile(renderVes, 0.5)).padStart(10)}  ${formatMs(percentile(renderTabs, 0.5)).padStart(10)}\n`,
        )
    }

    process.stdout.write('\nPlotly workload handed over per update (NOT included in the times above):\n')
    for (const m of measurements) {
        const summary = m.plotlyCalls
            .map(c => `${c.method}(${c.divId}) ${c.traceCount} traces / ${c.pointCount} pts`)
            .join('\n      ')
        process.stdout.write(`  ${m.name}:\n      ${summary || '(none)'}\n`)
    }

    // ------------------------------------------------- report 1b: double stats
    {
        const appState = new AppState()
        appState.activity.currentFitData = activity
        appState.analysis.currentParameters = params
        appState.selection.currentGpsLapIndexRanges = createSegmentRanges(SAMPLE_COUNT, MAINTAINER_LAP_COUNT)
        appState.ui.isGpsLapModeActive = true

        const handler = getAnalysisModeHandlerById('gpsLap')
        const callbacks = createGpsLapUpdateCallbacks(appState)
        let captured: unknown[] = []
        const outcome = await updateModeVEPlots({
            appState,
            handler,
            callbacks: {
                ...callbacks,
                renderVe: (profiles: never) => { captured = profiles },
                renderMetrics: () => {},
                renderWind: () => {},
                renderPower: () => {},
                renderVd: () => {},
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
            windSource: 'fit',
            cda: 0.23,
            crr: 0.004,
            isTabActive: () => false,
        })

        if (outcome && captured.length > 0) {
            // Rebuild the lap shape the way the callbacks do, then time the two
            // helpers `renderGpsLapVEPlots` re-runs on top of `aggregate`.
            const laps = createGpsLapUpdateCallbacks(appState)
            laps.aggregate(captured as never)
            const lapProfiles = (captured as Array<{ distancesKm: number[]; virtualElevation: number[]; actualElevation: number[]; supplementarySeries: unknown }>)
                .map((p, i) => ({
                    lapNumber: i + 1,
                    distances: p.distancesKm,
                    virtualElevation: p.virtualElevation,
                    actualElevation: p.actualElevation,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    supplementarySeries: p.supplementarySeries as any,
                    duration: 600,
                    totalDistance: p.distancesKm[p.distancesKm.length - 1] ?? 0,
                }))

            const meanTimings: number[] = []
            const statTimings: number[] = []
            for (let i = 0; i < WARMUP_ITERATIONS + MEASURED_ITERATIONS; i++) {
                const t0 = performance.now()
                const mean = calculateMeanElevationProfile(lapProfiles)
                const t1 = performance.now()
                calculateGpsLapStats(lapProfiles, mean)
                const t2 = performance.now()
                if (i >= WARMUP_ITERATIONS) {
                    meanTimings.push(t1 - t0)
                    statTimings.push(t2 - t1)
                }
            }
            meanTimings.sort((a, b) => a - b)
            statTimings.sort((a, b) => a - b)

            process.stdout.write('\nPost-compute helpers, in isolation (gps-lap-6):\n')
            process.stdout.write(`  calculateMeanElevationProfile  median ${formatMs(percentile(meanTimings, 0.5))}\n`)
            process.stdout.write(`  calculateGpsLapStats           median ${formatMs(percentile(statTimings, 0.5))}\n`)
            process.stdout.write('  Both were rewritten as two-pointer walks (D3), from ~3.8ms and\n')
            process.stdout.write('  ~5.9ms respectively. calculateGpsLapStats no longer runs twice per\n')
            process.stdout.write('  update: renderGpsLapVEPlots takes the aggregate as a parameter (D1),\n')
            process.stdout.write('  and the mean profile is cached across updates (D2).\n')
        }
    }

    // ---------------------------------------------------------------- report 2
    await reportDebounce(scheduleRecompute, RECOMPUTE_THROTTLE_MS, measurements)
}

/**
 * SECTION 2 -- what the SCHEDULER does to a sustained drag.
 *
 * HISTORY, because this section is the reason the scheduler changed. Until
 * 2026-08-16 `scheduleRecompute` cleared and re-armed its timer on EVERY call:
 * a resetting trailing debounce. While input events arrived closer together
 * than the window, the timer never reached zero and NOT ONE update ran. This
 * script measured exactly that -- 0 updates at 8/16/33 ms spacing against the
 * shipped 50 ms -- and it is what the maintainer was feeling as a frozen plot.
 *
 * The scheduler is now a LEADING-EDGE THROTTLE with a guaranteed trailing run,
 * so the model below is the throttle rule: one update immediately, then one per
 * interval, capped by how long an update actually takes. It is validated
 * against the REAL `scheduleRecompute` at the shipped constant before being
 * used at any other value, because `RECOMPUTE_THROTTLE_MS` is a module constant
 * with no injection seam and re-tuning it is explicitly plan 04's D-16 decision.
 */
function modelUpdatesDuringDrag(
    intervalMs: number,
    eventSpacingMs: number,
    dragMs: number,
    perUpdateMs = 0,
): number {
    const eventCount = Math.floor(dragMs / eventSpacingMs)
    // One at the leading edge, then one per interval -- but an update cannot
    // start before the previous one has finished, so the effective spacing is
    // whichever of the two is larger. At interval 0 the cost is the ONLY limit,
    // which is why 0 is not free: it pins the main thread.
    const effectiveSpacing = Math.max(intervalMs, perUpdateMs)
    const rateCap = effectiveSpacing > 0 ? Math.floor(dragMs / effectiveSpacing) : eventCount
    return Math.min(eventCount, rateCap)
}

async function reportDebounce(
    scheduleRecompute: (request: { mode: 'gps-lap'; run: () => void }) => void,
    shippedIntervalMs: number,
    measurements: RenderMeasurement[],
): Promise<void> {
    const DRAG_MS = 2_000
    const SPACINGS = [8, 16, 33, 60, 120]

    // --- validation against the real runner, at the shipped value only -------
    process.stdout.write('\n\nScheduler behaviour under a sustained drag\n')
    process.stdout.write(`Real runner check: RECOMPUTE_THROTTLE_MS = ${shippedIntervalMs} ms\n`)
    process.stdout.write('This is the number that was 0 across the top three rows under the\n')
    process.stdout.write('resetting debounce -- a frozen plot for the whole drag.\n\n')
    process.stdout.write('spacing   real updates   model updates   agree\n')
    process.stdout.write('---------------------------------------------\n')

    for (const spacing of SPACINGS) {
        let ran = 0
        const started = performance.now()
        await new Promise<void>(resolve => {
            const tick = () => {
                if (performance.now() - started >= DRAG_MS) {
                    resolve()
                    return
                }
                scheduleRecompute({ mode: 'gps-lap', run: () => { ran++ } })
                setTimeout(tick, spacing)
            }
            tick()
        })
        // Count only what fired DURING the drag; the trailing update that lands
        // after the finger lifts is not what "laggy while dragging" means.
        const during = ran
        // No cost cap here on purpose: the `run` this drives is a counter, so the
        // real runner in this check has a per-update cost of ~0 and the model
        // must be evaluated at the same cost to be comparable.
        const predicted = modelUpdatesDuringDrag(shippedIntervalMs, spacing, DRAG_MS)
        // Now that both deliver updates mid-drag, agreement on the COUNT matters,
        // not merely on whether it is zero. Timer scheduling in node is not exact,
        // so allow a small slack rather than demanding equality.
        const agree = Math.abs(during - predicted) <= Math.max(2, predicted * 0.15) ? 'yes' : 'NO'
        process.stdout.write(
            `${`${spacing}ms`.padStart(7)}   ${String(during).padStart(12)}   ${String(predicted).padStart(13)}   ${agree.padStart(5)}\n`,
        )
    }

    // --- the sweep the maintainer asked for ---------------------------------
    const veTab = measurements.find(m => m.name.endsWith('/ ve-tab'))
    const perUpdate = veTab
        ? veTab.samples.map(s => s.total).sort((a, b) => a - b)[Math.floor(veTab.samples.length / 2)]
        : Number.NaN

    process.stdout.write(
        `\nMeasured per-update cost used below (gps-lap-6, VE tab, Plotly EXCLUDED): ${perUpdate.toFixed(1)}ms\n`,
    )
    const CANDIDATES = [16, 20, 25, 33, 50]

    process.stdout.write(`\nUpdates delivered DURING a ${DRAG_MS / 1000}s drag, by throttle interval:\n`)
    process.stdout.write('(cost-capped: an update cannot start before the previous one finishes)\n\n')
    process.stdout.write(`spacing  ${CANDIDATES.map(c => `${c}ms`.padStart(8)).join('')}\n`)
    process.stdout.write('-------------------------------------------------\n')
    for (const spacing of SPACINGS) {
        const cells = CANDIDATES
            .map(d => String(modelUpdatesDuringDrag(d, spacing, DRAG_MS, perUpdate)).padStart(8))
            .join('')
        process.stdout.write(`${`${spacing}ms`.padStart(7)}${cells}\n`)
    }

    process.stdout.write('\nLatency from the LAST input event to the repaint that answers it:\n')
    process.stdout.write('(worst case: the input lands just after a run starts, so it waits out\n')
    process.stdout.write('the interval and then costs one update)\n\n')
    process.stdout.write('interval   settle latency (excl. Plotly)\n')
    process.stdout.write('---------------------------------------\n')
    for (const d of CANDIDATES) {
        process.stdout.write(`${`${d}ms`.padStart(8)}   ${formatMsLocal(d + perUpdate).padStart(28)}\n`)
    }

    process.stdout.write(
        '\nMain-thread duty cycle while dragging (fraction of wall time spent in the\n' +
        'update, Plotly EXCLUDED). Under the throttle this is the real duty cycle,\n' +
        'not a hypothetical: updates now actually run mid-drag.\n\n',
    )
    for (const d of CANDIDATES) {
        const effective = Math.max(d, perUpdate)
        const duty = perUpdate / effective
        process.stdout.write(`  ${`${d}ms`.padStart(5)}  ${(duty * 100).toFixed(0)}% busy, ${(1000 / effective).toFixed(0)} updates/sec\n`)
    }

    process.stdout.write(
        '\nNOTE: every duty figure above EXCLUDES Plotly, which is handed the trace\n' +
        'and point counts printed earlier. The shipped interval budgets half of\n' +
        'itself for that unmeasured work; see the arithmetic in recomputeRunner.ts.\n',
    )
}

void main()
    .then(() => {
        // jsdom installs timers and a live `window`, which keep the node event
        // loop alive forever once the measurements are done. Exit explicitly so
        // the script terminates instead of hanging after printing its report.
        process.exit(0)
    })
    .catch(error => {
        process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
        process.exit(1)
    })
