/**
 * WHERE PLOTLY COMES FROM — a build-time dependency, not a runtime fetch.
 *
 * This used to build a `<script>` pointing at `https://cdn.plot.ly` and wait for
 * it to land. That put a third party inside the trust boundary of an app whose
 * whole privacy claim is that ride data never leaves the browser: anything that
 * executed from that origin could read the IndexedDB stores (`ParameterStorage`,
 * `ResultsStorage`) holding the user's rides. An SRI hash narrows that window
 * but does not close it, and it has to be re-derived by hand on every version
 * bump — so the dependency is bundled instead, the same move `67bc5fc` made for
 * Leaflet's CSS when it dropped unpkg from the CSP.
 *
 * `plotly.js-basic-dist` is pinned to 2.27.0, the exact bundle the CDN tag
 * named, so this is a sourcing change and not a version bump. Basic is
 * deliberate: it needs no `eval`, which is what lets the CSP stay free of
 * `unsafe-eval`.
 *
 * The global assignment is not decoration. `gpsLapPlots.ts` and its siblings
 * read `(window as any).Plotly` directly rather than taking the resolved handle,
 * so the global has to keep being populated until those call sites are
 * converted to imports.
 *
 * DYNAMIC `import()`, not a static one. Plotly is ~1 MB minified — a static
 * import puts it in the entry chunk and triples first load (448 kB -> 1445 kB
 * raw, 119 kB -> 460 kB gzipped, measured). Splitting it out keeps the original
 * design intent of the CDN tag — nothing is fetched until an analysis actually
 * needs to plot — while sourcing it from the build instead of a third party.
 * The promise is cached so concurrent callers share one chunk fetch.
 */

type PlotlyHandle = unknown;

let pending: Promise<PlotlyHandle> | null = null;

/** Test seam: drop the cached chunk promise between cases. */
export function resetPlotlyLoader(): void {
	pending = null;
}

export function waitForPlotly(): Promise<PlotlyHandle> {
	const existing = (window as unknown as Record<string, unknown>).Plotly;
	if (existing) {
		return Promise.resolve(existing as PlotlyHandle);
	}

	if (!pending) {
		pending = import("plotly.js-basic-dist")
			.then((module) => {
				const Plotly = module.default;
				(window as unknown as Record<string, unknown>).Plotly = Plotly;
				return Plotly;
			})
			.catch((error) => {
				// A REJECTION IS NOT MEMOISED. Caching the promise is what makes
				// concurrent callers share one chunk fetch, but caching a
				// REJECTED one turns a transient failure into a permanent one:
				// the common case for a static deploy is a hashed chunk 404
				// after the site is redeployed while a tab is open, and every
				// later Analyze would then fail with reload as the only
				// recovery. Clearing the slot lets the next call retry.
				pending = null;
				throw error;
			});
	}

	return pending;
}
