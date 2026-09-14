/**
 * @vitest-environment jsdom
 *
 * THE WARM-RELOAD CACHE, round-tripped against a real IndexedDB.
 *
 * Two things here can fail silently in a way you would only notice as "the
 * dev loop stopped restoring", which is exactly the kind of paper cut this
 * feature exists to remove:
 *
 *  - the activity round trip has to come back as a `File` with its NAME
 *    intact, because `processSelectedFile` dispatches on the extension and a
 *    nameless blob would take the "unknown file type" branch;
 *  - `recallSelection` has to REFUSE malformed localStorage rather than hand
 *    a half-parsed object to `restoreSection3Selection`, whose lap numbers
 *    index into the loaded ride.
 *
 * `fake-indexeddb` is the store's own engine, not a stub of it — same
 * transaction and key semantics the browser applies.
 */
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
	clearDevSession,
	devSessionEnabled,
	recallActivityFile,
	recallSelection,
	rememberActivityFile,
	rememberSelection,
} from "./devSessionStore";

function fitFile(name = "ride.fit"): File {
	return new File([new Uint8Array([12, 16, 32, 0])], name, {
		lastModified: 1_700_000_000_000,
	});
}

describe("dev session cache", () => {
	beforeEach(() => {
		globalThis.indexedDB = new IDBFactory();
		localStorage.clear();
		window.history.replaceState({}, "", "/");
	});

	it("is on under vitest's dev-mode env, and `?fresh` opts out", () => {
		expect(devSessionEnabled()).toBe(true);

		window.history.replaceState({}, "", "/?fresh");
		expect(devSessionEnabled()).toBe(false);
	});

	it("round-trips an activity file with its name and bytes", async () => {
		await rememberActivityFile(fitFile("morning-loop.fit"));

		const restored = await recallActivityFile();
		expect(restored).not.toBeNull();
		expect(restored!.name).toBe("morning-loop.fit");
		expect(new Uint8Array(await restored!.arrayBuffer())).toEqual(
			new Uint8Array([12, 16, 32, 0]),
		);
	});

	it("keeps only the most recent activity", async () => {
		await rememberActivityFile(fitFile("first.fit"));
		await rememberActivityFile(fitFile("second.fit"));

		expect((await recallActivityFile())!.name).toBe("second.fit");
	});

	it("returns null with nothing cached, and after a clear", async () => {
		expect(await recallActivityFile()).toBeNull();

		await rememberActivityFile(fitFile());
		rememberSelection({
			fileName: "ride.fit",
			gpsAnalysisMode: "GPS based out and back",
			selectedLaps: [2, 3],
		});
		await clearDevSession();

		expect(await recallActivityFile()).toBeNull();
		expect(recallSelection()).toBeNull();
	});

	it("round-trips the Section-3 selection", () => {
		rememberSelection({
			fileName: "ride.fit",
			gpsAnalysisMode: "GPS based out and back",
			selectedLaps: [2, 3],
		});

		expect(recallSelection()).toEqual({
			fileName: "ride.fit",
			gpsAnalysisMode: "GPS based out and back",
			selectedLaps: [2, 3],
		});
	});

	it.each([
		["not JSON at all", "{nope"],
		["a bare array", "[1,2,3]"],
		["a missing file name", '{"gpsAnalysisMode":"None","selectedLaps":[]}'],
		[
			"laps that are not numbers",
			'{"fileName":"a.fit","gpsAnalysisMode":"None","selectedLaps":["1"]}',
		],
	])("refuses a stored selection that is %s", (_label, stored) => {
		localStorage.setItem("ve-dev-session-selection", stored);

		expect(recallSelection()).toBeNull();
	});

	it("stays silent when IndexedDB is unavailable", async () => {
		// Private-window and locked-down-profile behaviour: the cache is a
		// convenience, so a throwing `open` must not reach the file-load path.
		globalThis.indexedDB = {
			open: () => {
				throw new Error("IndexedDB is disabled");
			},
		} as unknown as IDBFactory;

		await expect(rememberActivityFile(fitFile())).resolves.toBeUndefined();
		await expect(recallActivityFile()).resolves.toBeNull();
	});
});
