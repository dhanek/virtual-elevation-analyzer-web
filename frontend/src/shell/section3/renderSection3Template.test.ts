import { describe, expect, it } from "vitest";
import { renderSection3Template } from "./renderSection3Template";

const baseInput = {
	laps: [
		{ total_elapsed_time: 60, total_distance: 1000, avg_power: 100 },
		{ total_elapsed_time: 60, total_distance: 1000, avg_power: 200 },
		{ total_elapsed_time: 60, total_distance: 1000, avg_power: 300 },
	],
	hasGpsData: true,
	showGpsLapDetection: true,
	showOutAndBack: false,
	gpsAnalysisMode: "GPS based lap splitting",
	formatDuration: (s: number) => `${s}s`,
	formatDistance: (m: number) => `${m}m`,
	formatPower: (w: number) => `${w}W`,
};

function lapCardCount(html: string, predicate: (card: string) => boolean): number {
	// Split into FIT-lap card chunks and count those matching predicate.
	const cards = html.split('class="lap-checkbox-item').slice(1);
	return cards.filter(predicate).length;
}

describe("renderSection3Template lap selection reflection", () => {
	it("checks only the retained selected FIT laps after a mode change", () => {
		const html = renderSection3Template({ ...baseInput, selectedLaps: [2] });

		// Lap 2's card should be checked + selected; laps 1 and 3 should not be.
		const lap2 = html.slice(html.indexOf('data-lap="2"'));
		const lap2Card = lap2.slice(0, lap2.indexOf("</div></div>"));
		expect(lap2Card).toContain("checked");

		const lap1 = html.slice(html.indexOf('data-lap="1"'));
		const lap1Card = lap1.slice(0, lap1.indexOf('data-lap="2"'));
		expect(lap1Card).not.toContain('type="checkbox" class="lap-checkbox" id="lap-1" checked');
	});

	it("renders all FIT laps unchecked when nothing is selected", () => {
		const html = renderSection3Template({ ...baseInput, selectedLaps: [] });
		const checkedCards = lapCardCount(html, (card) =>
			card.startsWith(" selected"),
		);
		expect(checkedCards).toBe(0);
		expect(html).not.toContain("checked");
	});

	it("marks every FIT lap selected when all are retained", () => {
		const html = renderSection3Template({
			...baseInput,
			selectedLaps: [1, 2, 3],
		});
		const selectedCards = lapCardCount(html, (card) =>
			card.startsWith(" selected"),
		);
		expect(selectedCards).toBe(3);
	});
});
