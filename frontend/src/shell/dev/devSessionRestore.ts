/**
 * DEV-ONLY: replay the cached activity on boot, and keep the Section-3
 * selection snapshotted so the replay lands where you left off.
 *
 * This is the working half of the "warm reload" — see `devSessionStore` for
 * why it exists and what it does not have to store. The replay deliberately
 * reuses the zip-import path's exact sequence — `handleFileSelection`, then
 * `processSelectedFile()`, then `restoreSection3Selection` in the microtask
 * gap before the 100 ms `initializeSection3` timer — because that ordering is
 * already the one Section 3 documents as safe (see `restoreSection3Selection`).
 * Parameters and gate offsets need no help: they restore from
 * `ParameterStorage` under the file hash, which the replayed bytes reproduce.
 *
 * The snapshot is a poll rather than a hook on each mutation. Section 3's
 * selection is written from a dozen places (lap checkboxes, Select All, the
 * mode dropdown, both detectors); instrumenting them all for a dev
 * convenience would put dev-only calls through production paths. A 1 s
 * comparison of two short JSON strings costs nothing and cannot drift.
 */
import { GPS_ANALYSIS_MODES } from "../../analysis/SettingsBundle";
import type { Section3AnalysisMode } from "../../analysis/SettingsBundle";
import type { AppState } from "../../state/AppState";
import { log } from "../../utils/log";
import {
	getGpsAnalysisMode,
	restoreSection3Selection,
} from "../section3/section3Orchestration";
import {
	handleFileSelection,
	processSelectedFile,
} from "../fileLoad/fileLoadOrchestration";
import {
	devSessionEnabled,
	recallActivityFile,
	recallSelection,
	rememberSelection,
	type DevSessionSelection,
} from "./devSessionStore";

const SNAPSHOT_INTERVAL_MS = 1000;

let snapshotTimer: ReturnType<typeof setInterval> | null = null;
let lastSnapshot = "";

function currentSelection(appState: AppState): DevSessionSelection | null {
	const fileName = appState.selectedFile?.name;
	if (!fileName) return null;
	return {
		fileName,
		gpsAnalysisMode: getGpsAnalysisMode(),
		selectedLaps: [...appState.selectedLaps],
	};
}

/** Start the Section-3 snapshot poll. Idempotent; a no-op outside dev. */
export function startDevSessionSnapshots(appState: AppState): void {
	if (!devSessionEnabled() || snapshotTimer !== null) return;
	snapshotTimer = setInterval(() => {
		const selection = currentSelection(appState);
		if (!selection) return;
		const serialized = JSON.stringify(selection);
		if (serialized === lastSnapshot) return;
		lastSnapshot = serialized;
		rememberSelection(selection);
	}, SNAPSHOT_INTERVAL_MS);
}

export function stopDevSessionSnapshots(): void {
	if (snapshotTimer === null) return;
	clearInterval(snapshotTimer);
	snapshotTimer = null;
}

function asAnalysisMode(mode: string): Section3AnalysisMode {
	return (GPS_ANALYSIS_MODES as readonly string[]).includes(mode)
		? (mode as Section3AnalysisMode)
		: "None";
}

/**
 * Reload the cached activity and re-apply the Section-3 selection.
 * Returns true when a session was replayed.
 *
 * Any failure is logged and swallowed back to the cold-start screen: the
 * worst outcome of a bad cache must be having to pick the file by hand.
 */
export async function restoreDevSession(appState: AppState): Promise<boolean> {
	if (!devSessionEnabled()) return false;

	try {
		const file = await recallActivityFile();
		if (!file) return false;

		const selection = recallSelection();

		await handleFileSelection(file);
		if (appState.selectedFile !== file) {
			// Validation rejected it; handleFileSelection has already said why.
			return false;
		}

		await processSelectedFile();

		// Synchronously after the await, so this beats the initializeSection3
		// timer processSelectedFile scheduled — see restoreSection3Selection.
		if (selection && selection.fileName === file.name) {
			restoreSection3Selection({
				gpsAnalysisMode: asAnalysisMode(selection.gpsAnalysisMode),
				selectedLaps: selection.selectedLaps,
			});
		}

		log.debug(
			`dev session: restored ${file.name} (load with ?fresh to skip)`,
		);
		return true;
	} catch (err) {
		log.debug("dev session: restore failed, starting cold", err);
		return false;
	}
}
