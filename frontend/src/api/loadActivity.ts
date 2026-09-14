/**
 * Turn a config's activity reference into the `ActivityDataLike` +
 * lap list the run state needs (Convergence plan, C6).
 *
 * No `node:` imports: the CLI shim reads bytes/text off disk and passes them
 * in, which is what keeps `src/api/` bundle-safe (`noNodeBuiltins.test.ts`).
 *
 * FIT: `parse_fit_file`'s `FitData` is DIRECTLY assignable to
 * `ActivityDataLike`, and `getNormalizedActivityArrays` WeakMap-caches on
 * object identity — so each channel getter (each of which clones a `Vec` on
 * the Rust side) is hit exactly once. Rebuilding a plain object from it would
 * be a second copy for no gain; a plain `ActivityData` is built only for the
 * inline-channels path.
 *
 * CSV: `loadCsvActivity` is DOM-free apart from typing `file: File`, which it
 * only stores — a `{ name }` stand-in is enough, and it is what unlocks the
 * humidity/pressure channels that feed `resolveRhoArray`'s environmental
 * branch.
 */
import { loadCsvActivity } from "../activity/ActivityLoader";
import { parse_fit_file } from "@wasm/virtual_elevation_analyzer.js";
import type { ActivityDataLike } from "../state/AppState";
import { activityFromChannels } from "./activityFromChannels";
import type { RunActivityChannels } from "./schema";

export interface LoadRunActivityInput {
	kind: "fit" | "csv" | "channels";
	/** FIT file body; required for kind "fit". */
	bytes?: Uint8Array;
	/** CSV text; required for kind "csv". */
	text?: string;
	/** Decoded arrays; required for kind "channels". */
	channels?: RunActivityChannels;
	fileName: string;
}

export interface LoadedRunActivity {
	fitData: ActivityDataLike;
	laps: Array<{ start_time: number; end_time: number }>;
	recordCount: number;
	fileName: string;
}

export function loadRunActivity(
	input: LoadRunActivityInput,
): LoadedRunActivity {
	switch (input.kind) {
		case "fit": {
			if (!input.bytes) {
				throw new Error("FIT activity needs file bytes");
			}
			const parsed = parse_fit_file(input.bytes);
			const fitData = parsed.fit_data as unknown as ActivityDataLike;
			return {
				fitData,
				laps: parsed.laps,
				recordCount: fitData.record_count,
				fileName: input.fileName,
			};
		}
		case "csv": {
			if (input.text === undefined) {
				throw new Error("CSV activity needs file text");
			}
			const loaded = loadCsvActivity({
				text: input.text,
				file: { name: input.fileName } as unknown as File,
				fileHash: null,
			});
			const fitData = loaded.result.fit_data as unknown as ActivityDataLike;
			return {
				fitData,
				laps: loaded.result.laps,
				recordCount: fitData.record_count,
				fileName: input.fileName,
			};
		}
		case "channels": {
			if (!input.channels) {
				throw new Error("inline activity needs channels");
			}
			const fitData = activityFromChannels(input.channels);
			return {
				fitData,
				laps: [],
				recordCount: input.channels.record_count,
				fileName: input.fileName,
			};
		}
	}
}
