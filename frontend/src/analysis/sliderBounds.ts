/**
 * THE SLIDER'S RANGE IS APP CONFIGURATION. THE OPTIMIZER'S SEARCH RANGE IS THE
 * USER'S SETTING. They were one pair of numbers, and that is why widening the
 * range never reached an existing file.
 *
 * `crr_min`/`crr_max` do two unrelated jobs:
 *
 *   1. the optimizer's SEARCH bounds — a real analysis input the user sets in
 *      the Section 2 "Crr Bounds" form and which `VeCalculatorFactory` passes
 *      into the calculator. Per-file, deliberately chosen, worth persisting.
 *   2. the Crr slider's `min`/`max` — how wide the control can travel, which is
 *      a property of the app version and of nothing else.
 *
 * Bundle E widened (2) to 0.0015–0.030. But the stored pair from (1) shadowed
 * it: `normalizeLoadedParameters` returns a post-feature record by identity, so
 * a file analysed before the widening came back carrying 0.002–0.015 and its
 * slider stayed narrow forever. The user never CHOSE those numbers — they were
 * the defaults at the time, frozen into the file.
 *
 * Migrating the stored pair was rejected: it would have to guess whether
 * 0.002/0.015 was chosen or merely inherited, and the next widening would need
 * the same guess again. Reading the display range from `DEFAULT_PARAMETERS`
 * instead makes every future change reach every file with no migration at all.
 *
 * A narrower stored OPTIMIZER range with a wider slider is intentional and not
 * a conflict: the bounds constrain the search, and the slider is not the input
 * on the path where a search happens (`crr === null` means optimize).
 */
import { DEFAULT_PARAMETERS } from "../components/AnalysisParameters";

export interface SliderBounds {
	min: number;
	max: number;
}

/** The Crr slider's travel. App configuration — never read from stored BOUNDS.
 *  `current` widens the range so a stored value outside it stays representable:
 *  a range input sanitizes to its `max`, and the sanitized value is what the
 *  save paths persist. See F17-01. */
export function displayCrrBounds(current?: number | null): SliderBounds {
	const { crr_min: min, crr_max: max } = DEFAULT_PARAMETERS;
	if (typeof current !== "number" || !Number.isFinite(current)) return { min, max };
	return { min: Math.min(min, current), max: Math.max(max, current) };
}

/** The CdA counterpart, for the same reason, and with the same widening:
 *  `current` keeps a stored value outside the app range representable, because
 *  a range input sanitizes to its `max` and the save paths persist the
 *  sanitized value. Deliberately NOT factored into one generic helper with
 *  `displayCrrBounds` — two named helpers is the shape this module chose, and
 *  the two ranges are unrelated app configuration. See F17-05. */
export function displayCdaBounds(current?: number | null): SliderBounds {
	const { cda_min: min, cda_max: max } = DEFAULT_PARAMETERS;
	if (typeof current !== "number" || !Number.isFinite(current)) return { min, max };
	return { min: Math.min(min, current), max: Math.max(max, current) };
}
