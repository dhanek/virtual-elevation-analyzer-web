/**
 * Guard for map-marker updates issued from the standard VE panel.
 *
 * The VE sliders belong to the laps that were analyzed when the panel was
 * rendered (appState.currentAnalyzedLaps). Once the user switches the lap
 * checkboxes, the map belongs to the NEW selection — repainting trim markers
 * from this panel's values would draw the previous lap's start/end points
 * onto the newly selected lap's route.
 *
 * The trigger this guard was written against was handleParametersChange's
 * synthetic "input" dispatch on trimStartSlider. That dispatch is gone (N-4,
 * plan 07-03), but the RACE it exposed is not: auto-rho still fires ~500 ms
 * after a lap switch and writes parameters, and that write still reaches a
 * recompute — now through `requestModeUpdate("parameters")` — while the panel
 * on screen still belongs to the previous selection. So does any other edit in
 * the parameters form made in that window. The mechanism changed; the timing
 * hazard did not, and this guard is still what stops the stale markers.
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
