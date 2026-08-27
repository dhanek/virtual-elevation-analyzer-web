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

vi.mock("plotly.js-basic-dist", () => ({ default: BUNDLED_PLOTLY }));

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
});
