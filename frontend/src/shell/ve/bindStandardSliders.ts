import { AppState, WindSource } from "../../state/AppState";
import {
	AnalysisInput,
	createAnalysisInput,
} from "../../analysis/AnalysisInput";
import { log } from "../../utils/log";
import { MapVisualization } from "../../components/MapVisualization";
import { AnalysisParametersComponent } from "../../components/AnalysisParameters";
import { getSelectedWindSource, bindWindSourceRadios } from "../dom/windSource";
import {
	clampAirSpeedCalibrationPercent,
	calculateAutoAirSpeedCalibrationPercent,
} from "../../analysis/AirSpeedCalibration";
import { calculateAirSpeedSyncError } from "../../analysis/WindSourceResolver";
import { createPlotContext } from "../../plots/PlotContext";
import {
	buildVirtualElevationFigures,
	buildVirtualElevationComparisonFigures,
	buildWindSpeedFigure,
	buildSpeedPowerFigure,
	buildVirtualDistanceFigure,
} from "../../plots/StandardPlotBuilders";
import { calculateAutoRho } from "./autoRho";
import { ShellServices } from "../analysis/types";
import { createVeCalculator } from "../../analysis/VeCalculatorFactory";
import { resolveAppliedCrr } from "../../analysis/CrrTemperatureCorrection";
import { bindCrrTempControls } from "./crrTempControls";
import { bindWindHeightControls } from "./windHeightControls";
import { scheduleRecompute } from "../analysis/recomputeRunner";
import { bindElevationSmoothingToggle } from "../analysis/elevationProfileCycle";
import {
	DEM_PROFILE_FALLBACK_ORDER,
	type ElevationDisplayProfile,
} from "../../analysis/elevationProfiles";
import { veViewMatchesSelection } from "./veSelectionGuard";
import { getNormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import { getAnalysisModeHandler } from "../../modes/analysis/AnalysisModes";
import type {
	ModeUpdateCallbacks,
	SegmentVeProfile,
} from "../../modes/analysis/types";
import {
	isVeTabActive,
	updateModeVEPlots,
} from "../analysis/updateModeVEPlots";
import { setupTabSwitching } from "../dom/tabs";
import {
	mapTrimToSegments,
	resolveSelectionWindSeries,
	stitchStandardProfiles,
	type StitchedStandardSeries,
} from "./standardSegments";
import { selectedLapCount, updateVirtualDistanceHeader } from "./vdHeader";

const MIN_TRIM_WINDOW_SAMPLES = 30;

// Plotly.js type declaration
declare const Plotly: any;

function updateMetricsDisplay(
	r2: number,
	rmse: number,
	veGain: number,
	actualGain: number,
): void {
	const r2ValueSpan = document.getElementById("r2Value");
	if (r2ValueSpan) r2ValueSpan.textContent = r2.toFixed(4);

	const rmseValueSpan = document.getElementById("rmseValue");
	if (rmseValueSpan) rmseValueSpan.textContent = rmse.toFixed(2) + "m";

	const veGainValueSpan = document.getElementById("veGainValue");
	if (veGainValueSpan) veGainValueSpan.textContent = veGain.toFixed(2) + "m";

	const actualGainValueSpan = document.getElementById("actualGainValue");
	if (actualGainValueSpan)
		actualGainValueSpan.textContent = actualGain.toFixed(2) + "m";
}

function isValidSelectionProfile(
	profile: number[] | null,
	selectedIndices: number[],
): profile is number[] {
	if (!profile) return false;
	if (selectedIndices.length === 0) return false;
	return selectedIndices.every((index) => index >= 0 && index < profile.length);
}

function filterProfileBySelection(
	profile: number[],
	selectedIndices: number[],
): number[] {
	return selectedIndices.map((index) => profile[index]);
}

/**
 * KEPT DELIBERATELY, for the `compare` branch only.
 *
 * The plan expected this to become dead once the primitive resolves elevation on
 * full arrays and slices per segment — which is true of the non-compare path,
 * and it no longer has any caller there. But plan 07-02 leaves the `compare`
 * branch composing its own two calculators until plan 07-04 (D-20), and that
 * branch still needs the ACTIVE display profile. Deleting this would silently
 * downgrade compare to raw FIT altitude, i.e. re-break for compare the exact
 * control D-18 was fixing everywhere else. It goes when compare folds into the
 * primitive.
 */
function resolveActiveAltitudeForSelection(
	appState: AppState,
	selectedIndices: number[],
	fallbackAltitude: number[],
): number[] {
	if (selectedIndices.length !== fallbackAltitude.length) {
		return fallbackAltitude;
	}

	const byProfile: Record<ElevationDisplayProfile, number[] | null> = {
		"fit-raw": appState.fitRawElevation,
		"dem-raw-nearest": appState.demRawNearestElevation,
		"dem-interpolated-smoothed-5pt":
			appState.demInterpolatedSmoothed5ptElevation,
	};

	const activeProfile = byProfile[appState.activeDisplayProfile];
	if (isValidSelectionProfile(activeProfile, selectedIndices)) {
		return filterProfileBySelection(activeProfile, selectedIndices);
	}

	for (const profileKey of DEM_PROFILE_FALLBACK_ORDER) {
		const candidate = byProfile[profileKey];
		if (isValidSelectionProfile(candidate, selectedIndices)) {
			return filterProfileBySelection(candidate, selectedIndices);
		}
	}

	const fitRaw = byProfile["fit-raw"];
	if (isValidSelectionProfile(fitRaw, selectedIndices)) {
		return filterProfileBySelection(fitRaw, selectedIndices);
	}

	return fallbackAltitude;
}

/**
 * Update Virtual Elevation plots based on current slider values.
 */
export function updateVEPlots(
	appState: AppState,
	analysisInput: AnalysisInput,
	selectedIndices: number[],
	trimStart: number,
	trimEnd: number,
) {
	scheduleRecompute({
		mode: "standard",
		run: async () => {
			const windSource = getSelectedWindSource() as WindSource;
			await updateVEPlotsWithWindSource(
				appState,
				analysisInput,
				selectedIndices,
				trimStart,
				trimEnd,
				windSource,
			);
		},
	});
}

/**
 * Build the Standard `ModeUpdateCallbacks`.
 *
 * This is the ONLY Standard-specific code left in the update path: which
 * figures are drawn from the stitched series, and which spans carry the
 * headline numbers. The spine — wind, elevation, rho, the per-segment
 * calculator loop, the tab-active check and the result-state writes — belongs
 * to `updateModeVEPlots` and is shared with the two GPS modes.
 *
 * The stitched series is memoised on the identity of the `profiles` array so
 * the aggregate and the four render callbacks share one pass, independent of
 * the order the primitive calls them in.
 */
function createStandardUpdateCallbacks(
	appState: AppState,
	windSource: WindSource,
	cda: number,
	appliedCrr: number,
): ModeUpdateCallbacks {
	const normalized = getNormalizedActivityArrays(appState.currentFitData!);

	let memoKey: SegmentVeProfile[] | null = null;
	let memoStitched: StitchedStandardSeries | null = null;

	function stitched(profiles: SegmentVeProfile[]): StitchedStandardSeries {
		if (profiles !== memoKey || !memoStitched) {
			memoKey = profiles;
			memoStitched = stitchStandardProfiles(profiles, normalized);
		}
		return memoStitched;
	}

	function contextFor(profiles: SegmentVeProfile[]) {
		const series = stitched(profiles);
		return createPlotContext(series.length, series.trimStart, series.trimEnd);
	}

	function drawWind(profiles: SegmentVeProfile[]): void {
		drawStandardWindPlot(contextFor(profiles), stitched(profiles), windSource);
	}

	function drawPower(profiles: SegmentVeProfile[]): void {
		drawStandardPowerPlot(contextFor(profiles), stitched(profiles));
	}

	function drawVd(profiles: SegmentVeProfile[]): void {
		// `profiles.length` is the number of laps actually integrated after the
		// trim window dropped any it no longer covers -- not the number of ticked
		// checkboxes. Virtual distance is only defined when that is exactly 1.
		drawStandardVdPlot(
			contextFor(profiles),
			stitched(profiles),
			profiles.length,
		);
	}

	return {
		/**
		 * D-09 entry (g): under D-19 Option B the headline r²/RMSE are the MEAN
		 * of the per-lap fits, not one fit over the concatenated selection. The
		 * maintainer accepted this deliberately, so that Standard reports the
		 * same way the two segment modes already do.
		 */
		aggregate(profiles) {
			const count = profiles.length;
			return {
				r2: profiles.reduce((sum, p) => sum + p.result.r2, 0) / count,
				rmse: profiles.reduce((sum, p) => sum + p.result.rmse, 0) / count,
				veGain:
					profiles.reduce((sum, p) => sum + p.result.ve_elevation_diff, 0) /
					count,
				actualGain:
					profiles.reduce((sum, p) => sum + p.result.actual_elevation_diff, 0) /
					count,
				segmentCount: count,
			};
		},

		renderVe(profiles) {
			const series = stitched(profiles);
			const context = contextFor(profiles);
			const figures = buildVirtualElevationFigures({
				context,
				virtualElevation: series.virtualElevation,
				actualElevation: series.actualElevation,
				cdaLabel: cda.toFixed(3),
				crrLabel: appliedCrr.toFixed(4),
			});
			Plotly.react(
				"vePlot",
				figures.elevation.data,
				figures.elevation.layout,
				figures.elevation.config,
			);
			Plotly.react(
				"veResidualsPlot",
				figures.residuals.data,
				figures.residuals.layout,
				figures.residuals.config,
			);

			// Register the tab render map, exactly as the GPS-lap adapter does.
			// Standard used to call setupTabSwitching() with an EMPTY map, so a
			// tab activated after a slider drag painted whatever it held at
			// analyze time. The primitive skips inactive tabs (D-14); this is
			// what makes them catch up on activation instead of going stale.
			setupTabSwitching({
				wind: () => drawWind(profiles),
				power: () => drawPower(profiles),
				vd: () => drawVd(profiles),
			});
		},

		renderWind: drawWind,
		renderPower: drawPower,
		renderVd: drawVd,

		renderMetrics(aggregate) {
			updateMetricsDisplay(
				aggregate.r2,
				aggregate.rmse,
				aggregate.veGain,
				aggregate.actualGain,
			);
		},
	};
}

/**
 * The four series every Standard secondary plot needs.
 *
 * Structurally a subset of `StitchedStandardSeries`, so the primitive-driven
 * path passes the stitched output straight in. The `compare` branch, which does
 * NOT go through the primitive until plan 07-04 (D-20), builds one of these from
 * the analyze-selection arrays and its own resolved wind series — which is what
 * lets both paths draw through the SAME three functions instead of the two
 * divergent copies that produced the 2026-04-19 bug.
 */
type StandardSecondarySeries = Pick<
	StitchedStandardSeries,
	"timestamps" | "velocity" | "power" | "apparentWindSpeedMps"
>;

/**
 * The wind figure's two channels are labelled 'Apparent (FIT Air)' and
 * 'Apparent (Constant Wind)', so which one the resolved series belongs in
 * depends on the selected source. Standard used to plot the FIT channel
 * unconditionally — even in constant-wind mode, and even after the wind-source
 * radio changed the fit — which is the visible half of N-5.
 */
function buildStandardWindFigureInput(
	context: ReturnType<typeof createPlotContext>,
	series: StandardSecondarySeries,
	windSource: WindSource,
) {
	const apparent = series.apparentWindSpeedMps;
	const toKmh = (value: number) => (isNaN(value) ? null : value * 3.6);
	const blank = new Array<number | null>(series.velocity.length).fill(null);

	if (windSource === "constant") {
		return {
			context,
			velocity: series.velocity,
			fitWindSpeedKmh: blank,
			constantWindApparentKmh: apparent.map((value) =>
				isNaN(value) ? 0 : value * 3.6,
			),
		};
	}

	const hasWind = apparent.some((value) => !isNaN(value) && value !== 0);
	return {
		context,
		velocity: series.velocity,
		fitWindSpeedKmh: hasWind ? apparent.map(toKmh) : blank,
	};
}

function drawStandardWindPlot(
	context: ReturnType<typeof createPlotContext>,
	series: StandardSecondarySeries,
	windSource: WindSource,
): void {
	const fig = buildWindSpeedFigure(
		buildStandardWindFigureInput(context, series, windSource),
	);
	Plotly.react("windSpeedPlot", fig.data, fig.layout, fig.config);
}

function drawStandardPowerPlot(
	context: ReturnType<typeof createPlotContext>,
	series: StandardSecondarySeries,
): void {
	const fig = buildSpeedPowerFigure({
		context,
		velocity: series.velocity,
		power: series.power,
	});
	Plotly.react("speedPowerPlot", fig.data, fig.layout, fig.config);
}

function drawStandardVdPlot(
	context: ReturnType<typeof createPlotContext>,
	series: StandardSecondarySeries,
	segmentCount: number,
): void {
	const input = {
		context,
		timestamps: series.timestamps,
		velocity: series.velocity,
		// Already offset AND calibrated by resolveWindSeries -- the builder must
		// not scale it again (D-21).
		windSpeed: series.apparentWindSpeedMps,
	};
	const fig = buildVirtualDistanceFigure(input);
	Plotly.react("vdPlot", fig.data, fig.layout, fig.config);
	// The three readouts above the plot are part of the plot. Drawing one
	// without the other is what left them frozen at analyze time.
	updateVirtualDistanceHeader(input, segmentCount);
}

/**
 * Update Virtual Elevation plots with a specific wind source.
 *
 * A thin adapter over `updateModeVEPlots` for everything except `compare`.
 * It reads the four DOM values Standard owns (CdA, Crr, trim start, trim end),
 * maps the trim window onto the handler's per-lap segments, and hands the rest
 * to the primitive.
 */
export async function updateVEPlotsWithWindSource(
	appState: AppState,
	analysisInput: AnalysisInput,
	selectedIndices: number[],
	trimStart: number,
	trimEnd: number,
	windSource: WindSource,
) {
	// The primitive guards both of these too and returns null, but the Standard
	// callbacks are constructed BEFORE the call and need the activity arrays, so
	// the guard has to happen here as well.
	if (!appState.currentParameters || !appState.currentFitData) return;

	const cdaSlider = document.getElementById("cdaSlider") as HTMLInputElement;
	const crrSlider = document.getElementById("crrSlider") as HTMLInputElement;

	if (!cdaSlider || !crrSlider) return;

	const cda = parseFloat(cdaSlider.value);
	const rawCrr = parseFloat(crrSlider.value);
	// The slider value is the 22 °C-referenced Crr; the physics uses the
	// temperature-corrected value when the correction is enabled. The primitive
	// applies the correction itself, so it receives the RAW value; this one is
	// for the compare branch's calculators and for the plot label.
	const crr = resolveAppliedCrr(appState.currentParameters, rawCrr);

	if (windSource !== "compare") {
		const handler = getAnalysisModeHandler(null);
		await updateModeVEPlots({
			appState,
			handler,
			callbacks: createStandardUpdateCallbacks(appState, windSource, cda, crr),
			windSource,
			cda,
			crr: rawCrr,
			// The handler cannot see the trim sliders (they are DOM, and
			// modes/analysis stays DOM-free), so the binder attaches trim here.
			// mapTrimToSegments also DROPS laps the window does not cover -- see
			// MIN_TRIMMED_SEGMENT_SAMPLES.
			segments: mapTrimToSegments(
				handler.getUpdateSegments(appState),
				selectedIndices,
				trimStart,
				trimEnd,
			),
		});
		return;
	}

	// LIVE until plan 07-04 wires renderVe to virtualElevationCompare.
	// Reachability is asserted by the standard/compare golden cases and by plan
	// 03's post-refactor browser check. This branch composes its own two
	// calculators over the concatenated selection and is deliberately NOT routed
	// through the primitive by this plan (D-20); a regression here silently
	// turns "Compare both methods" into plain FIT for the user.
	const context = createPlotContext(
		analysisInput.timestamps.length,
		trimStart,
		trimEnd,
	);
	const activeAltitude = resolveActiveAltitudeForSelection(
		appState,
		selectedIndices,
		analysisInput.altitude,
	);

	{
		const constantWindSpeed = new Array(analysisInput.windSpeed.length).fill(
			NaN,
		);
		const calculator1 = createVeCalculator({
			timestamps: analysisInput.timestamps,
			power: analysisInput.power,
			velocity: analysisInput.velocity,
			positionLat: analysisInput.positionLat,
			positionLong: analysisInput.positionLong,
			altitude: activeAltitude,
			distance: analysisInput.distance,
			windSpeed: constantWindSpeed,
			params: appState.currentParameters,
			cda,
			crr,
		});

		// D-05: the fifth and last inline offset+calibration copy is gone. Even
		// though the branch itself waits for plan 07-04, its WIND now comes from
		// the one resolver, resolved over the FULL series and sliced afterwards
		// -- so compare inherits the offset-ordering fix (change-list entry c)
		// rather than keeping a private copy of the defect.
		const calibratedWindSpeed = resolveSelectionWindSeries(
			appState,
			selectedIndices,
			"fit",
		);

		const calculator2 = createVeCalculator({
			timestamps: analysisInput.timestamps,
			power: analysisInput.power,
			velocity: analysisInput.velocity,
			positionLat: analysisInput.positionLat,
			positionLong: analysisInput.positionLong,
			altitude: activeAltitude,
			distance: analysisInput.distance,
			windSpeed: calibratedWindSpeed,
			params: appState.currentParameters,
			cda,
			crr,
		});

		const result1 = calculator1.calculate_virtual_elevation(
			cda,
			crr,
			trimStart,
			trimEnd,
		);
		const result2 = calculator2.calculate_virtual_elevation(
			cda,
			crr,
			trimStart,
			trimEnd,
		);

		appState.currentVEResult = result1;
		appState.currentWindSource = "compare";

		const figures = buildVirtualElevationComparisonFigures({
			context,
			virtualElevationConstant: Array.from(result1.virtual_elevation),
			virtualElevationFit: Array.from(result2.virtual_elevation),
			actualElevation: activeAltitude,
		});
		Plotly.react(
			"vePlot",
			figures.elevation.data,
			figures.elevation.layout,
			figures.elevation.config,
		);
		Plotly.react(
			"veResidualsPlot",
			figures.residuals.data,
			figures.residuals.layout,
			figures.residuals.config,
		);

		updateMetricsDisplay(
			(result1.r2 + result2.r2) / 2,
			(result1.rmse + result2.rmse) / 2,
			(result1.ve_elevation_diff + result2.ve_elevation_diff) / 2,
			(result1.actual_elevation_diff + result2.actual_elevation_diff) / 2,
		);

		// REGRESSION FIX (07-02 Task 4 follow-up). Before this phase the eight
		// slider handlers called the deleted secondary-plot helper AFTER
		// `updateVEPlots`, unconditionally — so the Wind, Power and VD tabs
		// refreshed in `compare` mode too. Task 4 removed that helper and moved
		// its job into the primitive, but `compare` deliberately does not go
		// through the primitive (D-20, plan 07-04), so those three tabs silently
		// stopped updating on ANY interaction in compare mode.
		// (The deleted helper is not named here: the D-05 acceptance criterion is
		// a mechanical grep for its name in this file, and plan 07-01's deviation
		// 2 recorded the same lesson.)
		//
		// The three draws are the SAME functions the primitive-driven path uses,
		// not a fourth copy: re-introducing a private copy here is the failure
		// class this phase exists to remove.
		//
		// The wind series is plotted in the FIT channel because that is what
		// `calculator2` consumed; `calculator1`'s wind is all-NaN by
		// construction, so there is nothing to draw for the constant leg.
		const compareSeries: StandardSecondarySeries = {
			timestamps: analysisInput.timestamps,
			velocity: analysisInput.velocity,
			power: analysisInput.power,
			apparentWindSpeedMps: calibratedWindSpeed,
		};
		const drawCompareWind = () =>
			drawStandardWindPlot(context, compareSeries, "fit");
		const drawComparePower = () => drawStandardPowerPlot(context, compareSeries);
		// compare integrates the WHOLE concatenated selection in one pass, so the
		// number is only defined when that selection is a single lap. The lap
		// count is the honest discriminator here -- unlike the primitive path
		// there are no per-segment profiles to count.
		const drawCompareVd = () =>
			drawStandardVdPlot(context, compareSeries, selectedLapCount(appState));

		// Without this the tab render map still holds the closures the LAST
		// non-compare update registered, so activating Wind or VD in compare mode
		// repainted that stale non-compare data.
		setupTabSwitching({
			wind: drawCompareWind,
			power: drawComparePower,
			vd: drawCompareVd,
		});

		// The one tab-active check, imported rather than re-implemented (D-14).
		if (isVeTabActive("wind-tab")) drawCompareWind();
		if (isVeTabActive("power-tab")) drawComparePower();
		if (isVeTabActive("vd-tab")) drawCompareVd();
	}
}

/**
 * Setup Standard VE panel sliders and their synchronization logic.
 */
export function setupVESliders(
	appState: AppState,
	parametersComponent: AnalysisParametersComponent | null,
	services: ShellServices,
	mapVisualization: MapVisualization | null,
	saveCurrentLapSettings: () => void,
	selectedIndices: number[],
	timestamps: number[],
	power: number[],
	velocity: number[],
	positionLat: number[],
	positionLong: number[],
	altitude: number[],
	distance: number[],
	windSpeed: number[],
	defaultAirSpeedOffset: number,
) {
	const analysisInput = createAnalysisInput({
		timestamps,
		power,
		velocity,
		positionLat,
		positionLong,
		altitude,
		distance,
		windSpeed,
	});

	if (!appState.currentParameters) {
		log.error("setupVESliders: appState.currentParameters is null");
		return;
	}
	const params = appState.currentParameters;

	const trimStartSlider = document.getElementById(
		"trimStartSlider",
	) as HTMLInputElement;
	const trimEndSlider = document.getElementById(
		"trimEndSlider",
	) as HTMLInputElement;
	const cdaSlider = document.getElementById("cdaSlider") as HTMLInputElement;
	const crrSlider = document.getElementById("crrSlider") as HTMLInputElement;

	const trimStartValue = document.getElementById(
		"trimStartValue",
	) as HTMLInputElement;
	const trimEndValue = document.getElementById(
		"trimEndValue",
	) as HTMLInputElement;
	const cdaValue = document.getElementById("cdaValue") as HTMLInputElement;
	const crrValue = document.getElementById("crrValue") as HTMLInputElement;

	if (
		!trimStartSlider ||
		!trimEndSlider ||
		!cdaSlider ||
		!crrSlider ||
		!trimStartValue ||
		!trimEndValue ||
		!cdaValue ||
		!crrValue
	) {
		log.warn("Standard VE sliders or values not found in DOM");
		return;
	}

	// THE SECOND ENTRY POINT USED TO LIVE HERE, and it is the 2026-04-19 bug in
	// one object: `updateVEPlots` had many call sites, the secondary-plot helper
	// had eight, and the handlers that forgot it — CdA, Crr, the Crr-temperature
	// controls and the wind-height controls — left the Wind, Power and VD tabs
	// showing numbers from a different set of parameters than the VE tab above
	// them. It also carried its own offset+calibration copy, a third wind
	// algorithm alongside the other two.
	//
	// (Recorded precisely because Task 4's first draft of this comment named the
	// calibration slider as one of the handlers that forgot it. At `cb2c7f8` the
	// calibration slider DID call the helper; the four above did not.)
	//
	// It is gone. `updateVEPlots` now rebuilds all four plots through
	// `updateModeVEPlots`, which owns the one active-tab class check left in the
	// update path (D-14). There is no second entry point left to forget — and
	// the `compare` branch, which does not reach the primitive until plan 07-04,
	// imports that same check rather than growing a private copy.
	//
	// (Neither the class name nor the deleted helper's name is spelled out here:
	// the D-05 and D-14 criteria are mechanical greps for them in this file, and
	// a mention in prose would defeat both. Same lesson as plan 07-01's
	// deviation 2.)

	// Trim-marker repaints must not outlive this panel's lap selection: after
	// the user switches lap checkboxes, synthetic input dispatches (auto-rho /
	// parameter changes via handleParametersChange) still run these handlers
	// with the PREVIOUS lap's trim values and coordinates, which would draw
	// stale start/end markers over the newly selected lap's route.
	const mapCanFollowThisPanel = () =>
		mapVisualization !== null &&
		veViewMatchesSelection(appState.currentAnalyzedLaps, appState.selectedLaps);

	const updateTrimStart = () => {
		const value = parseInt(trimStartSlider.value);
		trimStartValue.value = value.toString();
		const trimEnd = parseInt(trimEndSlider.value);
		if (value >= trimEnd - MIN_TRIM_WINDOW_SAMPLES) {
			const corrected = trimEnd - MIN_TRIM_WINDOW_SAMPLES;
			trimStartSlider.value = corrected.toString();
			trimStartValue.value = corrected.toString();
			return;
		}
		updateVEPlots(appState, analysisInput, selectedIndices, value, trimEnd);
		// Only repaint map trim markers while this panel's laps are still the
		// selected laps (see veViewMatchesSelection).
		if (mapCanFollowThisPanel()) {
			mapVisualization!.fitBoundsToTrimRegion(
				value,
				trimEnd,
				positionLat,
				positionLong,
			);
		}
		triggerAutoRhoOnTrimChange();
		saveCurrentLapSettings();
	};

	const updateTrimEnd = () => {
		const value = parseInt(trimEndSlider.value);
		trimEndValue.value = value.toString();
		const trimStart = parseInt(trimStartSlider.value);
		if (value <= trimStart + MIN_TRIM_WINDOW_SAMPLES) {
			const corrected = trimStart + MIN_TRIM_WINDOW_SAMPLES;
			trimEndSlider.value = corrected.toString();
			trimEndValue.value = corrected.toString();
			return;
		}
		updateVEPlots(appState, analysisInput, selectedIndices, trimStart, value);
		if (mapCanFollowThisPanel()) {
			mapVisualization!.fitBoundsToTrimRegion(
				trimStart,
				value,
				positionLat,
				positionLong,
			);
		}
		triggerAutoRhoOnTrimChange();
		saveCurrentLapSettings();
	};

	const updateCdA = () => {
		const value = parseFloat(cdaSlider.value);
		cdaValue.value = value.toFixed(3);
		const trimStart = parseInt(trimStartSlider.value);
		const trimEnd = parseInt(trimEndSlider.value);
		updateVEPlots(appState, analysisInput, selectedIndices, trimStart, trimEnd);
		saveCurrentLapSettings();
	};

	const updateCrr = () => {
		const value = parseFloat(crrSlider.value);
		crrValue.value = value.toFixed(4);
		const trimStart = parseInt(trimStartSlider.value);
		const trimEnd = parseInt(trimEndSlider.value);
		updateVEPlots(appState, analysisInput, selectedIndices, trimStart, trimEnd);
		saveCurrentLapSettings();
	};

	const updateTrimStartFromInput = () => {
		const value = parseInt(trimStartValue.value);
		if (isNaN(value)) return;
		const trimEnd = parseInt(trimEndSlider.value);
		const clamped = Math.max(
			0,
			Math.min(value, trimEnd - MIN_TRIM_WINDOW_SAMPLES),
		);
		trimStartSlider.value = clamped.toString();
		trimStartValue.value = clamped.toString();
		updateVEPlots(appState, analysisInput, selectedIndices, clamped, trimEnd);
		if (mapCanFollowThisPanel()) {
			mapVisualization!.fitBoundsToTrimRegion(
				clamped,
				trimEnd,
				positionLat,
				positionLong,
			);
		}
		triggerAutoRhoOnTrimChange();
		saveCurrentLapSettings();
	};

	const updateTrimEndFromInput = () => {
		const value = parseInt(trimEndValue.value);
		if (isNaN(value)) return;
		const trimStart = parseInt(trimStartSlider.value);
		const clamped = Math.max(
			trimStart + MIN_TRIM_WINDOW_SAMPLES,
			Math.min(value, timestamps.length - 1),
		);
		trimEndSlider.value = clamped.toString();
		trimEndValue.value = clamped.toString();
		updateVEPlots(appState, analysisInput, selectedIndices, trimStart, clamped);
		if (mapCanFollowThisPanel()) {
			mapVisualization!.fitBoundsToTrimRegion(
				trimStart,
				clamped,
				positionLat,
				positionLong,
			);
		}
		triggerAutoRhoOnTrimChange();
		saveCurrentLapSettings();
	};

	const updateCdAFromInput = () => {
		const value = parseFloat(cdaValue.value);
		if (isNaN(value)) return;
		const clamped = Math.max(params.cda_min, Math.min(value, params.cda_max));
		cdaSlider.value = clamped.toString();
		cdaValue.value = clamped.toFixed(3);
		const trimStart = parseInt(trimStartSlider.value);
		const trimEnd = parseInt(trimEndSlider.value);
		updateVEPlots(appState, analysisInput, selectedIndices, trimStart, trimEnd);
		saveCurrentLapSettings();
	};

	const updateCrrFromInput = () => {
		const value = parseFloat(crrValue.value);
		if (isNaN(value)) return;
		const clamped = Math.max(params.crr_min, Math.min(value, params.crr_max));
		crrSlider.value = clamped.toString();
		crrValue.value = clamped.toFixed(4);
		const trimStart = parseInt(trimStartSlider.value);
		const trimEnd = parseInt(trimEndSlider.value);
		updateVEPlots(appState, analysisInput, selectedIndices, trimStart, trimEnd);
		saveCurrentLapSettings();
	};

	trimStartSlider.oninput = updateTrimStart;
	trimEndSlider.oninput = updateTrimEnd;
	cdaSlider.oninput = updateCdA;
	crrSlider.oninput = updateCrr;

	let autoRhoDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	const triggerAutoRhoOnTrimChange = () => {
		if (autoRhoDebounceTimer) clearTimeout(autoRhoDebounceTimer);
		autoRhoDebounceTimer = setTimeout(() => {
			if (
				appState.currentParameters?.auto_calculate_rho &&
				!appState.isCalculatingAutoRho
			) {
				calculateAutoRho(appState, parametersComponent, services).catch(
					(err) => {
						log.error("Auto-rho calculation error on trim change:", err);
					},
				);
			}
		}, 500);
	};

	if (
		appState.currentParameters?.auto_calculate_rho &&
		!appState.isCalculatingAutoRho
	) {
		setTimeout(() => {
			calculateAutoRho(appState, parametersComponent, services).catch((err) => {
				log.error("Auto-rho initial calculation error:", err);
			});
		}, 1000);
	}

	trimStartValue.onchange = updateTrimStartFromInput;
	trimEndValue.onchange = updateTrimEndFromInput;
	cdaValue.onchange = updateCdAFromInput;
	crrValue.onchange = updateCrrFromInput;

	bindWindSourceRadios(() => {
		const trimStart = parseInt(trimStartSlider.value);
		const trimEnd = parseInt(trimEndSlider.value);
		updateVEPlots(appState, analysisInput, selectedIndices, trimStart, trimEnd);
	});

	const airSpeedCalibrationSlider = document.getElementById(
		"airSpeedCalibrationSlider",
	) as HTMLInputElement;
	const airSpeedCalibrationValue = document.getElementById(
		"airSpeedCalibrationValue",
	) as HTMLInputElement;

	if (airSpeedCalibrationSlider && airSpeedCalibrationValue) {
		// airSpeedCalibrationPercent lives in AppState (not persisted per-file)
		// so it bypasses the parameter storage layer and uses local update.
		// This is intentional - it's a runtime adjustment, not a saved parameter.
		// See analyzeOrchestrator.handleParametersChange for parameters that trigger orchestrator updates.
		const updateAirSpeedCalibration = () => {
			const value = parseFloat(airSpeedCalibrationSlider.value);
			airSpeedCalibrationValue.value = value.toFixed(1);
			appState.airSpeedCalibrationPercent = value;
			const trimStart = parseInt(trimStartSlider.value);
			const trimEnd = parseInt(trimEndSlider.value);
			updateVEPlots(
				appState,
				analysisInput,
				selectedIndices,
				trimStart,
				trimEnd,
			);
			saveCurrentLapSettings();
		};

		const updateAirSpeedCalibrationFromInput = () => {
			const value = parseFloat(airSpeedCalibrationValue.value);
			if (isNaN(value)) return;
			const clamped = clampAirSpeedCalibrationPercent(value);
			airSpeedCalibrationSlider.value = clamped.toString();
			airSpeedCalibrationValue.value = clamped.toFixed(1);
			appState.airSpeedCalibrationPercent = clamped;
			const trimStart = parseInt(trimStartSlider.value);
			const trimEnd = parseInt(trimEndSlider.value);
			updateVEPlots(
				appState,
				analysisInput,
				selectedIndices,
				trimStart,
				trimEnd,
			);
			saveCurrentLapSettings();
		};

		airSpeedCalibrationSlider.oninput = updateAirSpeedCalibration;
		airSpeedCalibrationValue.onchange = updateAirSpeedCalibrationFromInput;

		const autoAdjustButton = document.getElementById(
			"autoAdjustCalibration",
		) as HTMLButtonElement;
		if (autoAdjustButton) {
			autoAdjustButton.onclick = () => {
				const trimStart = parseInt(trimStartSlider.value);
				const trimEnd = parseInt(trimEndSlider.value);
				const calibrationPercent = calculateAutoAirSpeedCalibrationPercent([
					{
						timestamps,
						groundSpeed: velocity,
						apparentSpeed: windSpeed,
						startIndex: trimStart,
						endIndex: trimEnd,
					},
				]);
				if (calibrationPercent === null) return;
				airSpeedCalibrationSlider.value = calibrationPercent.toFixed(1);
				airSpeedCalibrationValue.value = calibrationPercent.toFixed(1);
				appState.airSpeedCalibrationPercent = calibrationPercent;
				updateVEPlots(
					appState,
					analysisInput,
					selectedIndices,
					trimStart,
					trimEnd,
				);
				saveCurrentLapSettings();
			};
		}
	}

	const airSpeedOffsetSlider = document.getElementById(
		"airSpeedOffsetSlider",
	) as HTMLInputElement;
	const airSpeedOffsetValue = document.getElementById(
		"airSpeedOffsetValue",
	) as HTMLInputElement;
	const airSpeedOffsetErrorMetric = document.getElementById(
		"airSpeedOffsetErrorMetric",
	) as HTMLSpanElement;

	if (airSpeedOffsetSlider && airSpeedOffsetValue) {
		const updateAirSpeedOffset = () => {
			const value = parseInt(airSpeedOffsetSlider.value);
			airSpeedOffsetValue.value = value.toString();
			if (parametersComponent && appState.currentParameters) {
				parametersComponent.setParameters({ air_speed_offset: value });
			}
			const trimStart = parseInt(trimStartSlider.value);
			const trimEnd = parseInt(trimEndSlider.value);
			const errorMetric = calculateAirSpeedSyncError(
				velocity,
				windSpeed,
				value,
				trimStart,
				trimEnd,
			);
			if (airSpeedOffsetErrorMetric && !isNaN(errorMetric)) {
				airSpeedOffsetErrorMetric.textContent = errorMetric.toFixed(2);
			}
			// Note: updateVEPlots is now triggered via orchestrator through handleParametersChange
			// when setParameters is called above. This avoids double updates.
			saveCurrentLapSettings();
		};

		const updateAirSpeedOffsetFromInput = () => {
			const value = parseInt(airSpeedOffsetValue.value);
			if (isNaN(value)) return;
			const clamped = Math.max(-10, Math.min(value, 10));
			airSpeedOffsetSlider.value = clamped.toString();
			airSpeedOffsetValue.value = clamped.toString();
			if (parametersComponent && appState.currentParameters) {
				parametersComponent.setParameters({ air_speed_offset: clamped });
			}
			const trimStart = parseInt(trimStartSlider.value);
			const trimEnd = parseInt(trimEndSlider.value);
			const errorMetric = calculateAirSpeedSyncError(
				velocity,
				windSpeed,
				clamped,
				trimStart,
				trimEnd,
			);
			if (airSpeedOffsetErrorMetric && !isNaN(errorMetric)) {
				airSpeedOffsetErrorMetric.textContent = errorMetric.toFixed(2);
			}
			// Note: updateVEPlots is now triggered via orchestrator through handleParametersChange
			// when setParameters is called above. This avoids double updates.
			saveCurrentLapSettings();
		};

		airSpeedOffsetSlider.oninput = updateAirSpeedOffset;
		airSpeedOffsetValue.onchange = updateAirSpeedOffsetFromInput;

		const trimStart = parseInt(trimStartSlider.value);
		const trimEnd = parseInt(trimEndSlider.value);
		const initialOffset =
			appState.currentParameters?.air_speed_offset ?? defaultAirSpeedOffset;
		const initialError = calculateAirSpeedSyncError(
			velocity,
			windSpeed,
			initialOffset,
			trimStart,
			trimEnd,
		);
		if (airSpeedOffsetErrorMetric && !isNaN(initialError)) {
			airSpeedOffsetErrorMetric.textContent = initialError.toFixed(2);
		}
	}

	bindElevationSmoothingToggle(appState, () => {
		const trimStart = parseInt(trimStartSlider.value);
		const trimEnd = parseInt(trimEndSlider.value);
		updateVEPlots(appState, analysisInput, selectedIndices, trimStart, trimEnd);
		saveCurrentLapSettings();
	});

	bindCrrTempControls({
		getParams: () => appState.currentParameters,
		setParams: (fields) => {
			if (parametersComponent) {
				// Persists per-file via the orchestrator's parameter storage path.
				parametersComponent.setParameters(fields);
			} else if (appState.currentParameters) {
				Object.assign(appState.currentParameters, fields);
			}
		},
		onChange: () => {
			const trimStart = parseInt(trimStartSlider.value);
			const trimEnd = parseInt(trimEndSlider.value);
			updateVEPlots(appState, analysisInput, selectedIndices, trimStart, trimEnd);
		},
	});

	// Same persistence and recompute needs as the Crr temperature controls above,
	// so the binding shape is deliberately identical: standard mode routes through
	// the parameters component directly rather than the parametersSync gateway.
	bindWindHeightControls({
		getParams: () => appState.currentParameters,
		setParams: (fields) => {
			if (parametersComponent) {
				// Persists per-file via the orchestrator's parameter storage path.
				parametersComponent.setParameters(fields);
			} else if (appState.currentParameters) {
				Object.assign(appState.currentParameters, fields);
			}
		},
		onChange: () => {
			const trimStart = parseInt(trimStartSlider.value);
			const trimEnd = parseInt(trimEndSlider.value);
			updateVEPlots(appState, analysisInput, selectedIndices, trimStart, trimEnd);
		},
	});

	const mapTrimControls = document.getElementById("mapTrimControls");
	const mapTrimStartSlider = document.getElementById(
		"mapTrimStartSlider",
	) as HTMLInputElement;
	const mapTrimEndSlider = document.getElementById(
		"mapTrimEndSlider",
	) as HTMLInputElement;
	const mapTrimStartValue = document.getElementById(
		"mapTrimStartValue",
	) as HTMLInputElement;
	const mapTrimEndValue = document.getElementById(
		"mapTrimEndValue",
	) as HTMLInputElement;

	if (
		mapTrimControls &&
		mapTrimStartSlider &&
		mapTrimEndSlider &&
		mapTrimStartValue &&
		mapTrimEndValue
	) {
		mapTrimControls.classList.remove("hidden");
		mapTrimStartSlider.min = "0";
		mapTrimStartSlider.max = (
			timestamps.length - MIN_TRIM_WINDOW_SAMPLES
		).toString();
		mapTrimStartSlider.value = appState.presetTrimStart.toString();
		mapTrimStartValue.value = appState.presetTrimStart.toString();
		mapTrimStartValue.min = "0";
		mapTrimStartValue.max = (
			timestamps.length - MIN_TRIM_WINDOW_SAMPLES
		).toString();

		const initialTrimEnd = appState.presetTrimEnd ?? timestamps.length - 1;
		mapTrimEndSlider.min = MIN_TRIM_WINDOW_SAMPLES.toString();
		mapTrimEndSlider.max = (timestamps.length - 1).toString();
		mapTrimEndSlider.value = initialTrimEnd.toString();
		mapTrimEndValue.value = initialTrimEnd.toString();
		mapTrimEndValue.min = MIN_TRIM_WINDOW_SAMPLES.toString();
		mapTrimEndValue.max = (timestamps.length - 1).toString();

		const syncMapToMain = () => {
			mapTrimStartSlider.value = trimStartSlider.value;
			mapTrimStartValue.value = trimStartValue.value;
			mapTrimEndSlider.value = trimEndSlider.value;
			mapTrimEndValue.value = trimEndValue.value;
		};

		trimStartSlider.addEventListener("input", syncMapToMain);
		trimEndSlider.addEventListener("input", syncMapToMain);
		trimStartValue.addEventListener("change", syncMapToMain);
		trimEndValue.addEventListener("change", syncMapToMain);

		mapTrimStartSlider.oninput = () => {
			mapTrimStartValue.value = mapTrimStartSlider.value;
			trimStartSlider.value = mapTrimStartSlider.value;
			trimStartValue.value = mapTrimStartSlider.value;
			updateTrimStart();
		};
		mapTrimEndSlider.oninput = () => {
			mapTrimEndValue.value = mapTrimEndSlider.value;
			trimEndSlider.value = mapTrimEndSlider.value;
			updateTrimEnd();
		};
		mapTrimStartValue.onchange = () => {
			const value = parseInt(mapTrimStartValue.value);
			if (!isNaN(value)) {
				const trimEnd = parseInt(trimEndSlider.value);
				const clamped = Math.max(
					0,
					Math.min(value, trimEnd - MIN_TRIM_WINDOW_SAMPLES),
				);
				mapTrimStartSlider.value = clamped.toString();
				mapTrimStartValue.value = clamped.toString();
				trimStartSlider.value = clamped.toString();
				trimStartValue.value = clamped.toString();
				updateTrimStart();
			}
		};
		mapTrimEndValue.onchange = () => {
			const value = parseInt(mapTrimEndValue.value);
			if (!isNaN(value)) {
				const trimStart = parseInt(trimStartSlider.value);
				const clamped = Math.max(
					trimStart + MIN_TRIM_WINDOW_SAMPLES,
					Math.min(value, timestamps.length - 1),
				);
				mapTrimEndSlider.value = clamped.toString();
				mapTrimEndValue.value = clamped.toString();
				trimEndSlider.value = clamped.toString();
				trimEndValue.value = clamped.toString();
				updateTrimEnd();
			}
		};
	}
}
