import { afterEach, describe, expect, test, vi } from "vitest";
import {
	configureParameterMerge,
	mergeAnalysisParameters,
} from "./parametersSync";

describe("parametersSync", () => {
	afterEach(() => {
		configureParameterMerge(null);
	});

	test("returns false when no merge handler is configured", () => {
		expect(mergeAnalysisParameters({ crr_temp_correction: true })).toBe(false);
	});

	test("delegates fields to the configured handler and returns true", () => {
		const handler = vi.fn();
		configureParameterMerge(handler);

		const fields = { crr_temp_correction: true, ambient_temp_c: 18.3 };
		expect(mergeAnalysisParameters(fields)).toBe(true);
		expect(handler).toHaveBeenCalledWith(fields);
	});
});
