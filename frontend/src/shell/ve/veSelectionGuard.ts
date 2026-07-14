/**
 * Guard for map-marker updates issued from the standard VE panel.
 *
 * The VE sliders belong to the laps that were analyzed when the panel was
 * rendered (appState.currentAnalyzedLaps). Once the user switches the lap
 * checkboxes, the map belongs to the NEW selection — repainting trim markers
 * from this panel's values would draw the previous lap's start/end points
 * onto the newly selected lap's route. That exact path is triggered by
 * handleParametersChange's synthetic "input" dispatch on trimStartSlider
 * (e.g. auto-rho firing ~500ms after a lap switch), which runs the trim
 * handlers with the previous lap's slider values and GPS coordinates.
 * See .planning/debug/resolved/stale-trim-on-lap-switch.md.
 */
export function veViewMatchesSelection(
	analyzedLaps: number[],
	selectedLaps: number[],
): boolean {
	if (analyzedLaps.length === 0) return false;
	if (analyzedLaps.length !== selectedLaps.length) return false;
	const analyzed = [...analyzedLaps].sort((a, b) => a - b);
	const selected = [...selectedLaps].sort((a, b) => a - b);
	return analyzed.every((lap, index) => lap === selected[index]);
}
