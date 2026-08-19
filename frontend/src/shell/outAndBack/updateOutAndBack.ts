/**
 * Out-and-back VE update and recalculation.
 *
 * Verbatim lift from main.ts -- update logic for out-and-back mode.
 */
import type { AppState } from "../../state/AppState";
import type {
	ModeUpdateCallbacks,
	SegmentVeProfile,
} from "../../modes/analysis/types";
import type { OutAndBackVEProfile } from "./types";

import {
	matchesRange,
	resolveActiveOutAndBackSections,
} from "../../modes/analysis/activeOutAndBackSections";
import {
	calculateOutAndBackMeanElevation,
	calculateOutAndBackStats,
	renderOutAndBackPlots,
	renderOutAndBackWindPlot,
	renderOutAndBackPowerPlot,
	renderOutAndBackVdPlot,
} from "./outAndBackPlots";


/**
 * Reassemble the primitive's FLAT segment list into the per-section shape the
 * out-and-back plots and stat helpers expect.
 *
 * The primitive emits 2N segments (outbound, inbound, outbound, ...); an
 * `OutAndBackVEProfile` is one section carrying both legs. Pairing is done by
 * matching each profile's full-activity range against the section it came from,
 * NOT by position in the array — a leg under 10 samples is skipped by the
 * primitive, which would shift every subsequent index by one and silently
 * transplant an inbound leg onto the wrong section.
 *
 * A section whose legs were both skipped is dropped, reproducing the old
 * `outboundVE.length > 0 || inboundVE.length > 0` guard.
 */
function toOutAndBackProfiles(
	appState: AppState,
	profiles: SegmentVeProfile[],
): OutAndBackVEProfile[] {
	const result: OutAndBackVEProfile[] = [];

	for (const section of resolveActiveOutAndBackSections(appState)) {
		const outbound = profiles.find((profile) =>
			matchesRange(profile, section.outboundStartIdx, section.outboundEndIdx),
		);
		const inbound = profiles.find((profile) =>
			matchesRange(profile, section.inboundStartIdx, section.inboundEndIdx),
		);

		if (!outbound && !inbound) {
			continue;
		}

		result.push({
			sectionNumber: section.sectionNumber,
			outboundDistances: outbound?.distancesKm ?? [],
			outboundVE: outbound?.virtualElevation ?? [],
			// Carried straight through from the primitive, PER LEG: non-null iff
			// the requested source is `compare` (D-07/D-20). A section's two
			// comparison arrays come from its two segments, because that is where
			// the primitive computes them.
			outboundVECompare: outbound?.virtualElevationCompare ?? null,
			outboundActualElevation: outbound ? [...outbound.actualElevation] : [],
			outboundSeries: outbound?.supplementarySeries ?? null,
			inboundDistances: inbound?.distancesKm ?? [],
			inboundVE: inbound?.virtualElevation ?? [],
			inboundVECompare: inbound?.virtualElevationCompare ?? null,
			inboundActualElevation: inbound ? [...inbound.actualElevation] : [],
			inboundSeries: inbound?.supplementarySeries ?? null,
			outboundDuration: section.outboundDuration,
			inboundDuration: section.inboundDuration,
			totalDistance: section.totalDistance,
		});
	}

	return result;
}

/**
 * Build the out-and-back `ModeUpdateCallbacks`.
 *
 * As with GPS-lap, this is the only out-and-back-specific code left in the
 * update path. The mapped profiles and mean elevation are memoised on the
 * identity of the `profiles` array so `aggregate` and the render callbacks
 * share one computation regardless of call order.
 */
export function createOutAndBackUpdateCallbacks(
	appState: AppState,
	Plotly: any,
): ModeUpdateCallbacks {
	let memoKey: SegmentVeProfile[] | null = null;
	let memoSections: OutAndBackVEProfile[] = [];
	let memoMean: { distances: number[]; elevation: number[] } = {
		distances: [],
		elevation: [],
	};

	function sections(profiles: SegmentVeProfile[]): OutAndBackVEProfile[] {
		if (profiles !== memoKey) {
			memoKey = profiles;
			memoSections = toOutAndBackProfiles(appState, profiles);
			memoMean = calculateOutAndBackMeanElevation(memoSections);
		}
		return memoSections;
	}

	function meanElevation(profiles: SegmentVeProfile[]) {
		sections(profiles);
		return memoMean;
	}

	return {
		aggregate(profiles) {
			const sectionProfiles = sections(profiles);
			const stats = calculateOutAndBackStats(
				sectionProfiles,
				meanElevation(profiles),
			);
			// `calculateOutAndBackStats` has no r2 at all, so the aggregate's r2
			// is the mean of the per-SEGMENT calculator r2. Deliberate: it is a
			// value the out-and-back screen never displayed, and it is now what
			// Store Result persists (see outAndBackMode.summarize).
			const meanR2 =
				profiles.length > 0
					? profiles.reduce((sum, profile) => sum + (profile.result.r2 ?? 0), 0) /
						profiles.length
					: 0;

			return {
				r2: meanR2,
				rmse: stats.rmse,
				veGain: stats.avgVeGain,
				actualGain: stats.avgActualGain,
				// Sections, not segments — this is what the header span counts.
				segmentCount: sectionProfiles.length,
				extra: { avgDiff: stats.avgDiff },
				// Out-and-back's own second set of numbers, computed by the SAME
				// helper over the constant legs. r2 has no compare counterpart
				// here for the same reason it has no primary one — the helper
				// does not produce it — so it repeats the mean r2 rather than
				// inventing a number for a field this screen never shows.
				compare: stats.compare
					? {
							r2: meanR2,
							rmse: stats.compare.rmse,
							veGain: stats.compare.avgVeGain,
							actualGain: stats.compare.avgActualGain,
							extra: { avgDiff: stats.compare.avgDiff },
						}
					: undefined,
			};
		},

		renderVe(profiles) {
			renderOutAndBackPlots(Plotly, sections(profiles), meanElevation(profiles));
		},

		renderWind(profiles) {
			renderOutAndBackWindPlot(sections(profiles));
		},

		renderPower(profiles) {
			renderOutAndBackPowerPlot(sections(profiles));
		},

		renderVd(profiles) {
			renderOutAndBackVdPlot(sections(profiles));
		},

		renderMetrics(aggregate) {
			// The template renders ve-metrics-compact with these four spans; there
			// is no #oabVeMetrics element, so refresh all four values here.
			const rmseSpan = document.getElementById("oabRmseValue");
			const veGainValueSpan = document.getElementById("oabVeGainValue");
			const actualGainValueSpan = document.getElementById("oabActualGainValue");
			const sectionCountSpan = document.getElementById("oabSectionCountValue");
			const compareMarker = document.getElementById("oabCompareMarker");
			// Under compare the two spans that HAVE a second number carry both as
			// `fit / constant` (ruling 2). Averaging them would describe neither
			// model. "Actual" is excluded on purpose: out-and-back's actual gain is
			// 0 by construction for both models, so a pair there would be noise.
			const compare = aggregate.compare ?? null;
			const pair = (fit: string, constant: string | null) =>
				constant === null ? fit : `${fit} / ${constant}`;
			if (rmseSpan) {
				rmseSpan.textContent = pair(
					`${aggregate.rmse.toFixed(2)}m`,
					compare ? `${compare.rmse.toFixed(2)}m` : null,
				);
			}
			if (veGainValueSpan) {
				veGainValueSpan.textContent = pair(
					`${aggregate.veGain.toFixed(2)}m`,
					compare ? `${compare.veGain.toFixed(2)}m` : null,
				);
			}
			if (actualGainValueSpan) {
				actualGainValueSpan.textContent = `${aggregate.actualGain.toFixed(2)}m`;
			}
			if (sectionCountSpan) {
				sectionCountSpan.textContent = aggregate.segmentCount.toString();
			}
			if (compareMarker) {
				compareMarker.textContent = compare ? " (FIT / Constant)" : "";
			}
		},
	};
}
