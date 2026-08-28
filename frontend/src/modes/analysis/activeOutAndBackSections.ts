/**
 * Resolve the out-and-back sections for the overlay currently on screen.
 *
 * This is the out-and-back twin of `resolveActiveGpsLapRanges`, and it exists
 * for the same reason. `currentOutAndBackSections` is written once, by
 * `showOutAndBackVEAnalysis` (`shell/outAndBack/renderOutAndBack.ts:97`), and
 * holds exactly the sections that were analysed and drawn. `outAndBackSections`
 * is the DETECTION list and `outAndBackSelectedSections` is the checkbox state;
 * both can change under the user's hands without the plot being recomputed.
 *
 * Before plan 07-02 the update path looped `currentOutAndBackSections`
 * (`updateOutAndBack.ts:100`), so a slider drag always recomputed what was on
 * screen. Deriving from the detection list instead would mean a checkbox toggle
 * silently changed which sections the next slider drag computed — a behaviour
 * change with no D-09 change-list entry, which is the definition of a defect
 * under D-09. So prefer the on-screen list and fall back to the selection only
 * when nothing has been analysed yet.
 *
 * Kept in `modes/analysis/` rather than `shell/` so `outAndBackMode` can reach
 * it without importing from the shell (D-03).
 */
import type { AppState } from "../../state/AppState";
import type { OutAndBackSection } from "../../utils/GpsLapDetection";
import type { SegmentVeProfile } from "./types";

export function resolveActiveOutAndBackSections(
	appState: AppState,
): OutAndBackSection[] {
	if (
		appState.currentOutAndBackSections &&
		appState.currentOutAndBackSections.length > 0
	) {
		return appState.currentOutAndBackSections;
	}

	const selected = appState.outAndBackSelectedSections;
	return appState.outAndBackSections.filter((section) =>
		selected.includes(section.sectionNumber),
	);
}

/**
 * Which of `sections` actually produced at least one computed segment.
 *
 * A section whose outbound AND inbound were both skipped (under 10 samples) or
 * both threw contributes nothing to the screen, so it must not be reported as
 * analysed either. This mirrors GPS-lap, where `currentAnalyzedLaps` has always
 * been built from the SURVIVING profiles rather than from the selection.
 */
export function sectionsCoveredByProfiles(
	sections: OutAndBackSection[],
	profiles: SegmentVeProfile[],
): OutAndBackSection[] {
	return sections.filter((section) =>
		profiles.some(
			(profile) =>
				matchesRange(
					profile,
					section.outboundStartIdx,
					section.outboundEndIdx,
				) ||
				matchesRange(profile, section.inboundStartIdx, section.inboundEndIdx),
		),
	);
}

export function matchesRange(
	profile: SegmentVeProfile,
	startIdx: number,
	endIdx: number,
): boolean {
	return (
		profile.segment.range.startIdx === startIdx &&
		profile.segment.range.endIdx === endIdx
	);
}
