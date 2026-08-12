import { AppState, WindSource } from "../../state/AppState";
import {
	AnalysisInput,
	createAnalysisInput,
} from "../../analysis/AnalysisInput";
import { log } from "../../utils/log";
import { MapVisualization } from "../../components/MapVisualization";
import { AnalysisParametersComponent } from "../../components/AnalysisParameters";
import { calculateAutoAirSpeedCalibrationPercent } from "../../analysis/AirSpeedCalibration";
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
import {
	DEM_PROFILE_FALLBACK_ORDER,
	type ElevationDisplayProfile,
} from "../../analysis/elevationProfiles";
import { veViewMatchesSelection } from "./veSelectionGuard";
import { getNormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import type {
	ModeUpdateCallbacks,
	SegmentVeProfile,
} from "../../modes/analysis/types";
import { isVeTabActive } from "../analysis/updateModeVEPlots";
import { bindModeControls } from "../analysis/bindModeControls";
import {
	registerModeUpdateCallbacks,
	registerModeWindSourceOverride,
} from "../analysis/modeUpdateCallbacks";
import { setupTabSwitching } from "../dom/tabs";
import {
	resolveSelectionWindSeries,
	stitchStandardProfiles,
	type StitchedStandardSeries,
} from "./standardSegments";
import {
	renderVirtualDistanceHeader,
	segmentVirtualDistanceRows,
	selectedLapCount,
	updateCombinedVirtualDistanceHeader,
} from "./vdHeader";

const MIN_TRIM_WINDOW_SAMPLES = 30;

// Plotly.js type declaration
declare const Plotly: any;

/**
 * How the covered-lap count reads (maintainer ruling, plan 07-03).
 *
 * D-19 Option B makes the headline numbers the MEAN OF N PER-LAP FITS, and the
 * primitive drops any lap the trim window leaves under `MIN_TRIMMED_SEGMENT_SAMPLES`
 * samples. The maintainer accepted that exclusion — and with it the consequence
 * that the mean can cover fewer laps than the user has ticked. Accepted is not
 * the same as invisible: before this, a trim that silently dropped two of three
 * laps changed the numbers with nothing on screen saying so.
 *
 * So the span says "3" when every ticked lap is covered and "2 of 3" when it is
 * not. The bare number in the common case keeps the header quiet; the "of M"
 * appears exactly when there is something to notice.
 */
export function formatCoveredLapCount(
	covered: number,
	selected: number,
): string {
	return covered === selected
		? `${covered}`
		: `${covered} of ${selected}`;
}

function updateMetricsDisplay(
	r2: number,
	rmse: number,
	veGain: number,
	actualGain: number,
	coveredLaps: { covered: number; selected: number } | null,
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

	const lapsCoveredSpan = document.getElementById("lapsCoveredValue");
	if (lapsCoveredSpan && coveredLaps) {
		lapsCoveredSpan.textContent = formatCoveredLapCount(
			coveredLaps.covered,
			coveredLaps.selected,
		);
	}
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
		// `profiles` is what the trim window actually still covers -- not the
		// ticked checkboxes -- so a lap the window has dropped contributes no row,
		// exactly as it contributes no fit to the headline mean.
		drawStandardVdPlot(contextFor(profiles), stitched(profiles), () =>
			renderVirtualDistanceHeader(
				segmentVirtualDistanceRows(profiles, normalized),
			),
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
				// `segmentCount` is how many per-lap fits the mean is actually over,
				// AFTER the primitive dropped any lap the trim left too short.
				{
					covered: aggregate.segmentCount,
					selected: selectedLapCount(appState),
				},
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

/**
 * Draw the stitched VD curve and its header.
 *
 * The readouts above the plot are part of the plot -- drawing one without the
 * other is what left them frozen at analyze time -- so this is the only place
 * either happens.
 *
 * `header` is what differs between the two Standard paths. The primitive-driven
 * path hands over per-lap rows, each integrated over its own trim window, which
 * is the honest reading under D-19 Option B. `compare` has no per-segment
 * decomposition (D-20, until plan 07-04), so it hands over the concatenated
 * integral and `renderCombinedVirtualDistanceHeader` labels it as such.
 */
function drawStandardVdPlot(
	context: ReturnType<typeof createPlotContext>,
	series: StandardSecondarySeries,
	header: () => void,
): void {
	const fig = buildVirtualDistanceFigure({
		context,
		timestamps: series.timestamps,
		velocity: series.velocity,
		// Already offset AND calibrated by resolveWindSeries -- the builder must
		// not scale it again (D-21).
		windSpeed: series.apparentWindSpeedMps,
	});
	Plotly.react("vdPlot", fig.data, fig.layout, fig.config);
	header();
}

/**
 * Standard's `compare` branch — the ONE update path that does not go through
 * the funnel, and therefore not through the primitive either.
 *
 * Plan 07-03 moved every other Standard control onto `requestModeUpdate`. This
 * one could not follow: `updateModeVEPlots` has no compare path until plan 07-04
 * (D-07/D-20), and `resolveWindSeries` collapses 'compare' to 'fit', so routing
 * it through the funnel would silently turn "Compare both methods" into plain
 * FIT for the user — a live capability lost inside a refactor, with no D-09
 * change-list entry to its name. The two `standard / compare / rho present|absent`
 * golden cases from plan 07-01 exist to prove it did not move.
 *
 * It composes its own two calculators over the concatenated selection. It does
 * NOT call the primitive, which is why "the funnel is the only caller of
 * `updateModeVEPlots`" holds without an exception clause.
 */
export async function updateStandardComparePlots(
	appState: AppState,
	analysisInput: AnalysisInput,
	selectedIndices: number[],
	trimStart: number,
	trimEnd: number,
) {
	if (!appState.currentParameters || !appState.currentFitData) return;

	const cdaSlider = document.getElementById("cdaSlider") as HTMLInputElement;
	const crrSlider = document.getElementById("crrSlider") as HTMLInputElement;

	if (!cdaSlider || !crrSlider) return;

	const cda = parseFloat(cdaSlider.value);
	const rawCrr = parseFloat(crrSlider.value);
	// The slider value is the 22 °C-referenced Crr; the physics uses the
	// temperature-corrected value when the correction is enabled.
	const crr = resolveAppliedCrr(appState.currentParameters, rawCrr);

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
			// compare integrates the WHOLE concatenated selection in ONE pass rather
			// than one fit per lap, so no lap can be dropped for being too short and
			// the covered count is the selection itself. Passing it explicitly rather
			// than null keeps the span from carrying a stale count over from the last
			// non-compare render.
			{
				covered: selectedLapCount(appState),
				selected: selectedLapCount(appState),
			},
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
		// compare integrates the WHOLE concatenated selection in one pass, so
		// there are no per-lap figures to show here -- unlike the primitive path
		// there are no per-segment profiles to decompose. A single-lap selection
		// is well defined and renders normally; anything wider renders the
		// combined integral with the caveat that says what it is.
		const drawCompareVd = () =>
			drawStandardVdPlot(context, compareSeries, () =>
				updateCombinedVirtualDistanceHeader(
					{
						context,
						timestamps: compareSeries.timestamps,
						velocity: compareSeries.velocity,
						windSpeed: compareSeries.apparentWindSpeedMps,
					},
					selectedLapCount(appState),
				),
			);

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
 * Setup Standard VE panel sliders.
 *
 * There are no per-control handler bodies here any more. Every VE control in
 * every mode is a row in `MODE_CONTROL_TABLE`, wired by the one binder, and each
 * row reaches the primitive through the one funnel (D-04, ROADMAP SC#2). What is
 * left in this function is the three things that are genuinely Standard's:
 *
 *   - which figures the primitive's profiles are drawn into (the registered
 *     `ModeUpdateCallbacks` factory),
 *   - the mode-specific side effects the binder calls back into (map trim
 *     markers, auto-rho, the auto-calibration window, the compare escape hatch),
 *   - the map trim twin sliders' RANGES, which come from this panel's activity
 *     arrays. Their handlers are rows like everything else.
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
	// Plan 07-02 removed the second COMPUTE path. This plan removes the second
	// BINDING path, which is the half that actually produced the bug: a handler
	// that updated its own state and forgot to ask for the plots. There is now no
	// hand-written control handler in this file to forget anything, and there is
	// no way to add a control except as a table row that funnels by construction.
	//
	// (Neither the class name nor the deleted helper's name is spelled out here:
	// the D-05 and D-14 criteria are mechanical greps for them in this file, and
	// a mention in prose would defeat both. Same lesson as plan 07-01's
	// deviation 2.)

	const currentTrim = () => ({
		start: parseInt(trimStartSlider.value),
		end: parseInt(trimEndSlider.value),
	});

	// Standard's half of the primitive contract: the figures, and nothing else.
	// Registered rather than passed, so the funnel can build it for whichever
	// mode is live without knowing any of them.
	registerModeUpdateCallbacks("standard", (context) =>
		createStandardUpdateCallbacks(
			appState,
			context.windSource,
			context.cda,
			context.appliedCrr,
		),
	);
	// Standard renders `compare` itself, for every control and not just for the
	// radio that selects it. Registered as a property of the SOURCE so the funnel
	// routes there whatever the user touched — dragging k, CdA or the trim under
	// "Compare both methods" recomputes the comparison rather than painting a
	// single-source figure over it.
	//
	// Temporary: plan 07-04 (D-07/D-20) generalises compare into the primitive and
	// deletes this registration along with `updateStandardComparePlots`.
	registerModeWindSourceOverride("standard", (windSource) => {
		if (windSource !== "compare") return null;
		return () => {
			const { start, end } = currentTrim();
			return updateStandardComparePlots(
				appState,
				analysisInput,
				selectedIndices,
				start,
				end,
			);
		};
	});
	// The funnel is configured by `bindModeControls` below, from the same
	// `appState`. It used to be configured HERE, and here only — which is why the
	// GPS modes, which never run this function, bound every control onto a funnel
	// that dropped every call. Configuring it per mode was the forget-to-call
	// surface one level up from the one the table removed.

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

	// The map's trim twins are the same control with a second face, so the binder
	// owns their handlers. Their RANGES are not declarative — they come from this
	// panel's activity length — so they are set here, once.
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
	}

	bindModeControls({
		appState,
		modeId: "standard",
		saveSettings: saveCurrentLapSettings,
		onTrimMapUpdate: (trimStart, trimEnd) => {
			mapVisualization?.fitBoundsToTrimRegion(
				trimStart,
				trimEnd,
				positionLat,
				positionLong,
			);
		},
		// Trim-marker repaints must not outlive this panel's lap selection. Auto-rho
		// still fires ~500 ms after a selection change and runs these handlers with
		// the PREVIOUS lap's trim values and coordinates, which would draw stale
		// start/end markers over the newly selected lap's route — so the guard
		// survives N-4's removal of the synthetic dispatch. Only its reason changed.
		mapCanFollow: () =>
			mapVisualization !== null &&
			veViewMatchesSelection(appState.currentAnalyzedLaps, appState.selectedLaps),
		triggerAutoRho: triggerAutoRhoOnTrimChange,
		// Standard has exactly one segment window — its trim — so the generalised
		// per-segment mean (N-3) reduces to the number this panel already showed.
		getOffsetMetricWindows: () => {
			const { start, end } = currentTrim();
			return Number.isNaN(start) || Number.isNaN(end)
				? []
				: [{ start, end }];
		},
		getSyncErrorSeries: () => ({ groundSpeed: velocity, airSpeed: windSpeed }),
		getAutoCalibrationPercent: () => {
			const { start, end } = currentTrim();
			return calculateAutoAirSpeedCalibrationPercent([
				{
					timestamps,
					groundSpeed: velocity,
					apparentSpeed: windSpeed,
					startIndex: start,
					endIndex: end,
				},
			]);
		},
	});

	// The offset control is not rendered in Standard's template, but its default
	// is still what the parameters form carries into the primitive; referencing it
	// here keeps the signature honest about what the panel was handed.
	log.debug(
		`Standard VE controls bound (default air-speed offset ${defaultAirSpeedOffset}s)`,
	);
}
