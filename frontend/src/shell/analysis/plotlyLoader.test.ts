/**
 * @vitest-environment jsdom
 *
 * WR-05. Plotly used to be fetched at runtime from `https://cdn.plot.ly`, which
 * put a third party inside the trust boundary of an app whose whole privacy
 * claim is that ride data never leaves the browser: a compromised or
 * DNS-hijacked CDN would have executed arbitrary script in this origin, with
 * access to the IndexedDB stores holding that data.
 *
 * Pinning an SRI hash only narrows that window. These tests lock in the actual
 * removal — the bundle is a build-time dependency, so there is no network fetch
 * to subvert and no CDN entry left in the CSP.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const BUNDLED_PLOTLY = { newPlot: () => {}, __bundled: true };

/**
 * Flipped by the retry test to make the chunk fetch fail.
 *
 * A GETTER rather than a throwing factory: `vi.mock` factories are evaluated
 * once and cached by the module registry, so toggling a flag around them does
 * nothing. The loader reads `module.default` inside its `.then`, so a getter
 * that throws rejects exactly the promise under test, on every access.
 */
let chunkFails = false;

vi.mock("plotly.js-cartesian-dist", () => ({
	get default() {
		if (chunkFails) {
			throw new Error("Failed to fetch dynamically imported module");
		}
		return BUNDLED_PLOTLY;
	},
}));

describe("waitForPlotly", () => {
	beforeEach(async () => {
		vi.resetModules();
		const { resetPlotlyLoader } = await import("./plotlyLoader");
		resetPlotlyLoader();
		delete (window as unknown as Record<string, unknown>).Plotly;
		document.head.replaceChildren();
		document.body.replaceChildren();
	});

	it("fetches the bundle chunk once across concurrent callers", async () => {
		const { waitForPlotly } = await import("./plotlyLoader");

		const [first, second] = await Promise.all([
			waitForPlotly(),
			waitForPlotly(),
		]);

		expect(first).toBe(second);
		expect(first).toBe(BUNDLED_PLOTLY);
	});

	it("resolves with the bundled Plotly without fetching anything", async () => {
		const { waitForPlotly } = await import("./plotlyLoader");

		const plotly = await waitForPlotly();

		expect(plotly).toBe(BUNDLED_PLOTLY);
	});

	it("injects no script element", async () => {
		const { waitForPlotly } = await import("./plotlyLoader");

		await waitForPlotly();

		expect(document.querySelectorAll("script")).toHaveLength(0);
	});

	/**
	 * `gpsLapPlots.ts` and friends read `(window as any).Plotly` directly rather
	 * than taking the resolved handle, so the global has to keep being populated
	 * or every one of those call sites breaks.
	 */
	it("populates window.Plotly for the call sites that read the global", async () => {
		const { waitForPlotly } = await import("./plotlyLoader");

		await waitForPlotly();

		expect((window as unknown as Record<string, unknown>).Plotly).toBe(
			BUNDLED_PLOTLY,
		);
	});

	it("does not overwrite a Plotly the page already provides", async () => {
		const preexisting = { newPlot: () => {}, __preexisting: true };
		(window as unknown as Record<string, unknown>).Plotly = preexisting;
		const { waitForPlotly } = await import("./plotlyLoader");

		const plotly = await waitForPlotly();

		expect(plotly).toBe(preexisting);
	});

	/**
	 * WR-02. The cached promise is what makes concurrent callers share one
	 * chunk fetch, but caching a REJECTED one turned a transient failure into a
	 * permanent one — a hashed chunk 404 after a redeploy, with the tab still
	 * open, would fail every later Analyze until reload.
	 */
	it("retries after a failed chunk fetch instead of caching the rejection", async () => {
		chunkFails = true;
		const { waitForPlotly, resetPlotlyLoader } = await import("./plotlyLoader");
		resetPlotlyLoader();

		await expect(waitForPlotly()).rejects.toThrow();

		// The next attempt must go back to the chunk, not replay the rejection.
		chunkFails = false;
		await expect(waitForPlotly()).resolves.toBe(BUNDLED_PLOTLY);
	});
});
