/**
 * Virtual-distance integration, and the per-segment shape both the on-screen
 * header and the stored/exported record are built from.
 *
 * This used to live inside `plots/StandardPlotBuilders.ts`, next to the figure
 * it feeds. It moved because the numbers are no longer only drawn: change-list
 * entry (h) now has Store Result and Export CSV persist them, and the
 * `summarize` seam that writes them is in `modes/analysis/`, which must not
 * reach into the drawing layer. Keeping ONE integration is the whole point --
 * the original defect in this area was a header sourced from somewhere other
 * than the curve it labelled, and an export sourced from somewhere other than
 * the header would be the same defect wearing a different hat.
 *
 * D-21: the series is integrated exactly as given. No calibration multiplier
 * lives here; calibration is applied once, upstream, when the wind series is
 * resolved.
 */

/** Cumulative air / ground virtual distance in metres, indexed like the input. */
export interface VirtualDistanceIntegration {
	air: number[];
	ground: number[];
}

/** The two virtual distances over the trim window, plus their relative gap. */
export interface VirtualDistanceTotals {
	airKm: number;
	groundKm: number;
	/** ((air - ground) / ground) * 100, matching the Rust reference definition. */
	differencePercent: number;
}

export interface VirtualDistanceWindow {
	timestamps: number[];
	velocity: number[];
	/** Already offset AND calibrated, as for VirtualDistancePlotInput. */
	windSpeed: number[];
	trimStart: number;
	trimEnd: number;
}

/**
 * One independently-integrated segment's virtual distance.
 *
 * Always labelled. Whether the label is SHOWN is a presentation rule — a
 * single-segment analysis drops the prefix, which is the shape Standard has
 * always had for one lap — and it is applied by the header renderer and the CSV
 * writer, not baked into the data.
 */
export interface SegmentVirtualDistance extends VirtualDistanceTotals {
	/** e.g. "Lap 3" or "Section 2". */
	label: string;
}

/**
 * Integrate exactly as given, accumulating from `trimStart`.
 *
 * Shared by the figure and by every totals reading, so the numbers in the VD
 * header — and now in the stored result — can never disagree with the curve
 * they sit above.
 */
export function integrateVirtualDistance(
	timestamps: number[],
	velocity: number[],
	windSpeed: number[],
	trimStart: number,
): VirtualDistanceIntegration {
	const air: number[] = new Array(timestamps.length).fill(0);
	const ground: number[] = new Array(timestamps.length).fill(0);

	for (let i = trimStart + 1; i < timestamps.length; i++) {
		const dt = timestamps[i] - timestamps[i - 1];

		const apparentSpeed = !isNaN(windSpeed[i]) ? windSpeed[i] : 0;
		air[i] = air[i - 1] + (apparentSpeed > 0 ? apparentSpeed : 0) * dt;

		const groundSpeed = !isNaN(velocity[i]) && velocity[i] > 0 ? velocity[i] : 0;
		ground[i] = ground[i - 1] + groundSpeed * dt;
	}

	return { air, ground };
}

/**
 * The endpoint reading over an explicit window.
 *
 * This exists so ONE SEGMENT of a multi-lap selection can be integrated on its
 * own. Under D-19 Option B each lap is fitted and integrated independently, so
 * the honest virtual distance of a multi-lap selection is N per-lap figures --
 * NOT the endpoint of the concatenated curve, which accumulates across the
 * wall-clock gap between lap N's end and lap N+1's start, and across the parts
 * of intermediate laps the trim window excludes.
 *
 * Same arithmetic as the whole-selection case, so a single-lap selection is
 * bit-identical to what it produced before this helper existed.
 */
export function computeVirtualDistanceWindowTotals(
	window: VirtualDistanceWindow,
): VirtualDistanceTotals {
	const { air, ground } = integrateVirtualDistance(
		window.timestamps,
		window.velocity,
		window.windSpeed,
		window.trimStart,
	);
	const endIndex = Math.min(window.trimEnd, air.length - 1);

	if (endIndex < 0) {
		return { airKm: 0, groundKm: 0, differencePercent: 0 };
	}

	const airMeters = air[endIndex];
	const groundMeters = ground[endIndex];

	return {
		airKm: airMeters / 1000,
		groundKm: groundMeters / 1000,
		differencePercent:
			groundMeters > 0 ? ((airMeters - groundMeters) / groundMeters) * 100 : 0,
	};
}

/** ((air - ground) / ground) * 100, the Rust reference definition, on km inputs. */
export function virtualDistanceDifferencePercent(
	airKm: number,
	groundKm: number,
): number {
	return groundKm > 0 ? ((airKm - groundKm) / groundKm) * 100 : 0;
}
