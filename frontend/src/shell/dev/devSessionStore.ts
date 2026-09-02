/**
 * DEV-ONLY: the bytes of the last activity file, kept so a Vite reload lands
 * back on the ride you were looking at.
 *
 * The app has no module-level HMR — every edit to a `.ts` file is a full page
 * reload — and a reload loses the one thing IndexedDB was not already keeping:
 * `appState.selectedFile`, which came from a file picker and cannot be
 * re-obtained without the user clicking. Parameters, lap/gate settings, DEM
 * tiles and stored results all survive already (`ParameterStorage`,
 * `ResultsStorage`, `DEMManager`, `WeatherCache`), so caching the activity
 * bytes plus the Section-3 selection is the whole of what a warm reload needs.
 *
 * A LEAF MODULE ON PURPOSE: storage only, no shell imports, so
 * `fileLoadOrchestration` can call `rememberActivityFile` without a cycle.
 * The restore side lives in `devSessionRestore`.
 *
 * Every entry point no-ops unless `import.meta.env.DEV`, so a production
 * build never writes a rider's activity into an extra store — the bytes are
 * a debugging convenience, not a feature.
 */
import { log } from "../../utils/log";

const DB_NAME = "ve-dev-session";
const DB_VERSION = 1;
const STORE_NAME = "activity";
const ACTIVITY_KEY = "last";
const SELECTION_KEY = "ve-dev-session-selection";

/** Section 3's state, small enough to live in localStorage. */
export interface DevSessionSelection {
	fileName: string;
	gpsAnalysisMode: string;
	selectedLaps: number[];
}

interface StoredActivity {
	key: string;
	name: string;
	lastModified: number;
	bytes: ArrayBuffer;
	savedAt: number;
}

/**
 * Dev builds only, and `?fresh` in the URL opts out for one load — the escape
 * hatch for when the cached file is itself what you are debugging.
 */
export function devSessionEnabled(): boolean {
	if (!import.meta.env.DEV) return false;
	if (typeof window === "undefined") return false;
	return !new URLSearchParams(window.location.search).has("fresh");
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: "key" });
			}
		};
	});
}

function withStore<T>(
	mode: IDBTransactionMode,
	run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
	return openDb().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const transaction = db.transaction([STORE_NAME], mode);
				const request = run(transaction.objectStore(STORE_NAME));
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
				transaction.oncomplete = () => db.close();
			}),
	);
}

/**
 * Cache an activity file's bytes. Called from the one place every activity
 * passes through — `handleFileSelection` — so drops, picks and zip imports
 * are all covered by the single call site.
 *
 * Failures are logged and swallowed: a dev convenience must never be able to
 * break loading a file.
 */
export async function rememberActivityFile(file: File): Promise<void> {
	if (!devSessionEnabled()) return;
	try {
		const record: StoredActivity = {
			key: ACTIVITY_KEY,
			name: file.name,
			lastModified: file.lastModified,
			bytes: await file.arrayBuffer(),
			savedAt: Date.now(),
		};
		await withStore("readwrite", (store) => store.put(record));
	} catch (err) {
		log.debug("dev session: could not cache the activity file", err);
	}
}

/** The cached activity as a `File`, or null when there is nothing usable. */
export async function recallActivityFile(): Promise<File | null> {
	if (!devSessionEnabled()) return null;
	try {
		const record = await withStore<StoredActivity | undefined>(
			"readonly",
			(store) => store.get(ACTIVITY_KEY),
		);
		if (!record?.bytes || !record.name) return null;
		return new File([record.bytes], record.name, {
			lastModified: record.lastModified,
		});
	} catch (err) {
		log.debug("dev session: could not read the cached activity file", err);
		return null;
	}
}

export function rememberSelection(selection: DevSessionSelection): void {
	if (!devSessionEnabled()) return;
	try {
		localStorage.setItem(SELECTION_KEY, JSON.stringify(selection));
	} catch (err) {
		log.debug("dev session: could not cache the Section-3 selection", err);
	}
}

/**
 * The cached Section-3 selection, validated — `fileName` lets the caller
 * refuse a selection captured against a different ride, whose lap numbers
 * would mean something else entirely.
 */
export function recallSelection(): DevSessionSelection | null {
	if (!devSessionEnabled()) return null;
	try {
		const raw = localStorage.getItem(SELECTION_KEY);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return null;
		const candidate = parsed as Record<string, unknown>;
		if (
			typeof candidate.fileName !== "string" ||
			typeof candidate.gpsAnalysisMode !== "string" ||
			!Array.isArray(candidate.selectedLaps) ||
			!candidate.selectedLaps.every((lap) => typeof lap === "number")
		) {
			return null;
		}
		return {
			fileName: candidate.fileName,
			gpsAnalysisMode: candidate.gpsAnalysisMode,
			selectedLaps: candidate.selectedLaps as number[],
		};
	} catch {
		return null;
	}
}

export async function clearDevSession(): Promise<void> {
	try {
		localStorage.removeItem(SELECTION_KEY);
		await withStore("readwrite", (store) => store.delete(ACTIVITY_KEY));
	} catch (err) {
		log.debug("dev session: could not clear the cache", err);
	}
}
