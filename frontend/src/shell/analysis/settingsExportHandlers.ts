/**
 * The two settings-export footer buttons: "Export Settings (JSON)" writes the
 * current file's `SettingsEnvelope`; "Export Zip" writes the original
 * activity file and that JSON in one archive, so a whole analysis travels as
 * a single file and comes back through the same drop zone.
 *
 * Same module shape as `handleExportAllResults` above it in the footer:
 * handlers take their deps as arguments, give button feedback in place, and a
 * user-cancelled save dialog (AbortError from `fileSave`'s picker) is not an
 * error — it must not alert.
 */
import { fileSave } from "browser-fs-access";
import { buildSettingsEnvelope } from "../../analysis/SettingsBundle";
import type { AppState } from "../../state/AppState";
import type { ParameterStorage } from "../../utils/ParameterStorage";
import { buildZip } from "../../utils/zip";
import { log } from "../../utils/log";

function activityBaseName(appState: AppState): string {
	const name = appState.selectedFile?.name ?? "analysis";
	return name.replace(/\.(fit|csv)$/i, "");
}

async function currentSettingsJson(
	appState: AppState,
	parameterStorage: ParameterStorage,
): Promise<string | null> {
	if (!appState.currentFileHash || !appState.currentParameters) {
		return null;
	}
	const record = await parameterStorage.getStoredRecord(
		appState.currentFileHash,
	);
	const envelope = buildSettingsEnvelope({
		record,
		parameters: appState.currentParameters,
		activityFileName: appState.selectedFile?.name ?? record?.fileName ?? null,
		activityFileHash: appState.currentFileHash,
	});
	return JSON.stringify(envelope, null, 2);
}

async function withButtonFeedback(
	buttonId: string,
	fallbackLabel: string,
	action: () => Promise<void>,
): Promise<void> {
	const button = document.getElementById(buttonId) as HTMLButtonElement | null;
	const originalText = button?.textContent ?? fallbackLabel;
	try {
		if (button) {
			button.disabled = true;
			button.textContent = "Exporting...";
		}
		await action();
		if (button) button.textContent = "✓ Exported";
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			// The user closed the save dialog; nothing failed.
			if (button) button.textContent = originalText;
		} else {
			log.error("❌ Settings export failed:", error);
			alert("Failed to export. See console for details.");
			if (button) button.textContent = originalText;
		}
	} finally {
		if (button) {
			setTimeout(() => {
				button.disabled = false;
				button.textContent = originalText;
			}, 2000);
		}
	}
}

export async function handleExportSettings(
	appState: AppState,
	parameterStorage: ParameterStorage,
): Promise<void> {
	await withButtonFeedback(
		"exportSettingsJson",
		"Export Settings (JSON)",
		async () => {
			const json = await currentSettingsJson(appState, parameterStorage);
			if (json === null) {
				throw new Error("No analysed file to export settings for.");
			}
			const blob = new Blob([json], { type: "application/json" });
			await fileSave(blob, {
				fileName: `${activityBaseName(appState)}.ve-settings.json`,
				extensions: [".json"],
				description: "VE analysis settings",
			});
		},
	);
}

export async function handleExportBundle(
	appState: AppState,
	parameterStorage: ParameterStorage,
): Promise<void> {
	await withButtonFeedback("exportBundleZip", "Export Zip", async () => {
		const activityFile = appState.selectedFile;
		if (!activityFile) {
			throw new Error("No activity file loaded to bundle.");
		}
		const json = await currentSettingsJson(appState, parameterStorage);
		if (json === null) {
			throw new Error("No analysed file to export settings for.");
		}
		const activityBytes = new Uint8Array(await activityFile.arrayBuffer());
		const zipped = buildZip([
			{ name: activityFile.name, data: activityBytes },
			{
				name: `${activityBaseName(appState)}.ve-settings.json`,
				data: new TextEncoder().encode(json),
			},
		]);
		const blob = new Blob([zipped as BlobPart], { type: "application/zip" });
		await fileSave(blob, {
			fileName: `${activityBaseName(appState)}.ve-bundle.zip`,
			extensions: [".zip"],
			description: "VE analysis bundle (activity + settings)",
		});
	});
}
