import type { IndexWindow } from "../../utils/GpsLapDetection";

interface LapTimes {
	start_time: number;
	end_time: number;
}

/**
 * The selected FIT laps as contiguous sample-index windows, in track order.
 *
 * Both GPS detectors used to take ONE window from the first selected sample to
 * the last, so a selection of laps 10 and 12 also detected inside lap 11. On
 * the reference ride, laps 10, 12 and 16 produced eleven out-and-back sections,
 * seven of them reaching into laps 11, 13, 14 and 15; per-lap windows give five.
 * Adjacent selected laps still form one window, so a lap that crosses their
 * shared boundary survives.
 */
export function selectedLapWindows(
	timestamps: ArrayLike<number>,
	laps: LapTimes[],
	selectedLaps: number[],
): IndexWindow[] {
	const selected = selectedLaps
		.map((lapNumber) => laps[lapNumber - 1])
		.filter(Boolean);
	const windows: IndexWindow[] = [];
	if (selected.length === 0) return windows;

	for (let i = 0; i < timestamps.length; i++) {
		const t = timestamps[i];
		if (!selected.some((lap) => t >= lap.start_time && t <= lap.end_time)) {
			continue;
		}
		const last = windows[windows.length - 1];
		if (last && last.endIdx === i - 1) last.endIdx = i;
		else windows.push({ startIdx: i, endIdx: i });
	}

	return windows;
}
