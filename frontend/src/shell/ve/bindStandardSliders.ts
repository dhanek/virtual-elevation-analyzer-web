import { AppState, WindSource } from "../../state/AppState";
import { log } from "../../utils/log";
import { MapVisualization } from "../../components/MapVisualization";
import { AnalysisParametersComponent } from "../../components/AnalysisParameters";
import { calculateAutoAirSpeedCalibrationPercent } from "../../analysis/AirSpeedCalibration";
import {
	createDistancePlotContext,
	createPlotContext,
} from "../../plots/PlotContext";
import { getPlotXAxis, syncPlotXAxisAvailability } from "./plotXAxisToggle";
import {
	buildVirtualElevationFigures,
	buildVirtualElevationComparisonFigures,
	buildWindSpeedFigure,
	buildSpeedPowerFigure,
	buildVirtualDistanceFigure,
} from "../../plots/StandardPlotBuilders";
import { calculateAutoRho } from "./autoRho";
import { ShellServices } from "../analysis/types";
import { veViewMatchesSelection } from "./veSelectionGuard";
import { getNormalizedActivityArrays } from "../../analysis/ActivityArrayCache";
import type {
	ModeUpdateCallbacks,
	SegmentVeProfile,
} from "../../modes/analysis/types";
import { bindModeControls } from "../analysis/bindModeControls";
import { registerModeUpdateCallbacks } from "../analysis/modeUpdateCallbacks";
import { setupTabSwitching } from "../dom/tabs";
import {
	hasUsableDistance,
	stitchStandardProfiles,
	type StitchedStandardSeries,
} from "./standardSegments";
import {
	renderVirtualDistanceHeader,
	segmentVirtualDistanceRows,
	selectedLapCount,
} from "./vdHeader";
import {
	renderConvergenceView,
	requestConvergenceRedraw,
} from "../analysis/convergenceView";
import { computeStandardAggregate } from "./standardAggregate";

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

/**
 * THE one writer of Standard's four metric spans.
 *
 * Exported for `initializeVEAnalysis`, which fills them at first paint from the
 * SAME integration that drew the curve beneath them. Before that the template
 * painted them from `prepareAnalysisPayload`'s stitched fit -- a different trim
 * window and a different wind source from the plot underneath -- so the header
 * and the curve disagreed until the post-bind kick replaced both.
 */
export function updateMetricsDisplay(
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

	/**
	 * The plot context for the CURRENTLY SELECTED x-axis.
	 *
	 * The whole time/distance switch lands here: all four Standard figures take
	 * their x from `context.xPoints{Before,Main,After}` and their range from
	 * `context.xMin/xMax`, so swapping the context swaps the axis for every plot
	 * at once. No figure builder knows which axis it is drawing.
	 *
	 * Availability is synced from the same call, because this is the first place
	 * the stitched series -- and therefore the cumulative distance -- exists.
	 * `syncPlotXAxisAvailability` falls the setting back to time when distance
	 * is unusable, and `getPlotXAxis` is read AFTER it, so a FIT file with no
	 * distance channel cannot reach `createDistancePlotContext`.
	 */
	function contextFor(profiles: SegmentVeProfile[]) {
		const series = stitched(profiles);
		syncPlotXAxisAvailability(hasUsableDistance(series));

		if (getPlotXAxis() === "distance") {
			return createDistancePlotContext(
				series.cumulativeDistanceKm,
				series.trimStart,
				series.trimEnd,
			);
		}
		return createPlotContext(series.length, series.trimStart, series.trimEnd);
	}

	function drawWind(profiles: SegmentVeProfile[]): void {
		drawStandardWindPlot(contextFor(profiles), stitched(profiles), windSource);
	}

	function drawPower(profiles: SegmentVeProfile[]): void {
		drawStandardPowerPlot(contextFor(profiles), stitched(profiles));
	}

	function drawVe(profiles: SegmentVeProfile[]): void {
		const series = stitched(profiles);
		const context = contextFor(profiles);
		// The SAME dispatch the two GPS modes get: which figure is drawn is a
		// property of the profiles the primitive produced, not of a separate
		// update path. Before 07-04 this was a whole second entry point in this
		// file that composed its own two calculators and never reached the
		// primitive. (Its name is deliberately not written down: the acceptance
		// criterion for its removal is a mechanical grep, and naming it in prose
		// would defeat that — plan 07-01 deviation 2.)
		const figures = series.virtualElevationCompare
			? buildVirtualElevationComparisonFigures({
					context,
					virtualElevationFit: series.virtualElevation,
					virtualElevationConstant: series.virtualElevationCompare,
					actualElevation: series.actualElevation,
					referenceElevation: series.referenceElevation,
				})
			: buildVirtualElevationFigures({
					context,
					virtualElevation: series.virtualElevation,
					actualElevation: series.actualElevation,
					referenceElevation: series.referenceElevation,
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
		//
		// `ve` IS IN THE MAP NOW (bundle D). It was not, because the recompute
		// path was the only thing that redrew the VE pair -- which was enough
		// while every redraw came from a control the primitive already funnels.
		// The x-axis toggle is not such a control: it changes no parameter and
		// runs no fit, it repaints the ACTIVE tab through `activateTab`. Without
		// an entry here, flipping the axis on the VE tab would move the other
		// three and leave the one the user was looking at on the old axis.
		setupTabSwitching({
			ve: () => drawVe(profiles),
			wind: () => drawWind(profiles),
			power: () => drawPower(profiles),
			vd: () => drawVd(profiles),
			convergence: requestConvergenceRedraw,
		});
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
		// D-09 entry (g): the headline mean-of-fits aggregate — extracted to
		// `standardAggregate.ts` (C4) so the headless API reaches the same
		// numbers through the same function.
		aggregate: computeStandardAggregate,

		renderVe: drawVe,

		renderWind: drawWind,
		renderPower: drawPower,
		renderVd: drawVd,
		renderConvergence: renderConvergenceView,

		renderMetrics(aggregate) {
			// STANDARD'S AVERAGING IS UNCHANGED (07-04 ruling 2). Pre-refactor the
			// compare branch showed `(result1.x + result2.x) / 2` for all four
			// spans; it still does, now over the two per-lap means. An r² averaged
			// across two wind models describes neither, and the GPS modes
			// therefore show `fit / constant` side by side — but changing
			// Standard's display is a behaviour change with no D-09 entry and no
			// place in this phase's scope, so it is recorded as an observation and
			// left alone.
			const mean = (primary: number, secondary: number | undefined) =>
				secondary === undefined ? primary : (primary + secondary) / 2;
			const compare = aggregate.compare;

			updateMetricsDisplay(
				mean(aggregate.r2, compare?.r2),
				mean(aggregate.rmse, compare?.rmse),
				mean(aggregate.veGain, compare?.veGain),
				mean(aggregate.actualGain, compare?.actualGain),
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
	// FOUR ARRAYS LESS than before 07-04. `selectedIndices`, `power`, `altitude`
	// and `distance` were read only by the compare escape hatch this plan
	// deleted; the primitive slices all four out of the resolved full-activity
	// arrays itself. What is left is what this panel genuinely still owns: the
	// map's trim-marker coordinates, the auto-calibration window's series, and
	// the trim sliders' ranges.
	timestamps: number[],
	velocity: number[],
	positionLat: number[],
	positionLong: number[],
	windSpeed: number[],
	defaultAirSpeedOffset: number,
) {
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
	// THE COMPARE ESCAPE HATCH IS GONE (07-04 Task 1, D-07/D-20). Standard used to
	// register a wind-source override here, claiming `compare` for a private
	// branch that composed its own two calculators and never reached the
	// primitive — the last update path in the app that bypassed the funnel. The
	// primitive now resolves wind twice under `compare` and produces a second
	// per-segment series, so `compare` is a property of the PROFILES and the
	// dispatch lives in `renderVe` above, exactly like the two GPS modes. There is
	// no source any mode renders for itself, and therefore no registry of them.
	//
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
