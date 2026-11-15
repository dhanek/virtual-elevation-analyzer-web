/**
 * Where the calibration control's value comes from, and the switch that
 * changes it (TODO.md decisions D1 and D4, 2026-11-14).
 *
 * - The tag says "Ride value" or "Own value". Not "This selection only":
 *   that is the switch's own label beside it, and the two read the same
 *   words twice whenever the switch is on.
 * - "This selection only" makes the current value this selection's override;
 *   a calibration change is then stored on the selection instead of the ride.
 * - "Use ride value" removes the override and gives the selection the ride
 *   value back, so its VE changes.
 *
 * The markup lives in `airSpeedCalibrationControl.ts`; the storage behind the
 * switch in `MultiSegmentSettings.setAirSpeedCalibrationScope`.
 */
import type { CalibrationSource } from "../../analysis/RideCalibration";
import type { AppState } from "../../state/AppState";

const CALIBRATION_SCOPE_ID = "airSpeedCalibrationScope";
const CALIBRATION_SOURCE_ID = "airSpeedCalibrationSource";
const CALIBRATION_USE_RIDE_ID = "airSpeedCalibrationUseRide";

const SOURCE_LABEL: Record<CalibrationSource, string> = {
	ride: "Ride value",
	selection: "Own value",
};

const signed = (percent: number): string =>
	`${percent >= 0 ? "+" : ""}${percent.toFixed(1)} %`;

export function calibrationScopeMarkup(source: CalibrationSource): string {
	const own = source === "selection";
	return `
            <div class="ve-parameter__scope">
                <span id="${CALIBRATION_SOURCE_ID}" class="ve-parameter__source ve-parameter__source--${source}">${SOURCE_LABEL[source]}</span>
                <button type="button" id="${CALIBRATION_USE_RIDE_ID}" class="ve-parameter__link"${own ? "" : " hidden"}>Use ride value</button>
                <label class="ve-parameter__scope-switch">
                    <input type="checkbox" id="${CALIBRATION_SCOPE_ID}"${own ? " checked" : ""} />
                    This selection only
                </label>
            </div>`;
}

/** Paint the tag, the switch and the reset link from `appState`. */
export function refreshCalibrationScope(appState: AppState): void {
	if (typeof document === "undefined") return;
	const own = appState.airSpeedCalibrationSource === "selection";
	const tag = document.getElementById(CALIBRATION_SOURCE_ID);
	if (tag) {
		tag.textContent = SOURCE_LABEL[own ? "selection" : "ride"];
		tag.className = `ve-parameter__source ve-parameter__source--${
			own ? "selection" : "ride"
		}`;
	}
	const reset = document.getElementById(CALIBRATION_USE_RIDE_ID);
	if (reset) {
		reset.hidden = !own;
		reset.textContent = `Use ride value (${signed(
			appState.rideAirSpeedCalibrationPercent ?? 0,
		)})`;
	}
	const scope = document.getElementById(
		CALIBRATION_SCOPE_ID,
	) as HTMLInputElement | null;
	if (scope) scope.checked = own;
}

export interface CalibrationScopeBinding {
	appState: AppState;
	/** Store the scope change (`setAirSpeedCalibrationScope`). */
	setScope: (scope: CalibrationSource) => Promise<void>;
	/**
	 * Called after switching back to the ride value: the value changed, so the
	 * control must show it and the VE must recompute.
	 */
	onRideValueRestored: () => void;
}

/** True when the switch was rendered and bound. */
export function bindCalibrationScope(
	binding: CalibrationScopeBinding,
): boolean {
	const scope = document.getElementById(
		CALIBRATION_SCOPE_ID,
	) as HTMLInputElement | null;
	if (!scope) return false;

	const apply = async (next: CalibrationSource): Promise<void> => {
		await binding.setScope(next);
		refreshCalibrationScope(binding.appState);
		if (next === "ride") binding.onRideValueRestored();
	};

	scope.addEventListener("change", () => {
		void apply(scope.checked ? "selection" : "ride");
	});
	document
		.getElementById(CALIBRATION_USE_RIDE_ID)
		?.addEventListener("click", () => {
			void apply("ride");
		});
	refreshCalibrationScope(binding.appState);
	return true;
}
