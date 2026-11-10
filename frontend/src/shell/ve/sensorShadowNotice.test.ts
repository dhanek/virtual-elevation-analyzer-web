/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

const shown = vi.hoisted(() => [] as string[]);
vi.mock("../dom/notifications", () => ({
	showNotification: (message: string) => shown.push(message),
}));

import type { ShadowEvent } from "../../analysis/SensorShadow";
import { noteSensorShadow } from "./sensorShadowNotice";

const event = (label: string, startIdx: number): ShadowEvent => ({
	segment: 0,
	label,
	startIdx,
	endIdx: startIdx + 60,
	seconds: 60,
	peakExcess: 0.4,
});

describe("noteSensorShadow", () => {
	beforeEach(() => {
		shown.length = 0;
		noteSensorShadow([]);
	});

	it("notifies once for the same events, however many passes report them", () => {
		noteSensorShadow([event("Lap 6", 200)]);
		noteSensorShadow([event("Lap 6", 200)]);
		noteSensorShadow([event("Lap 6", 200)]);
		expect(shown).toHaveLength(1);
		expect(shown[0]).toContain("Lap 6 (60 s)");
	});

	it("notifies again when the events change, and stays quiet with none", () => {
		noteSensorShadow([event("Lap 6", 200)]);
		noteSensorShadow([]);
		noteSensorShadow([event("Lap 2", 10)]);
		expect(shown).toHaveLength(2);
	});
});
