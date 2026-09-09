/**
 * OUT-AND-BACK'S AGGREGATION HELPERS, measured rather than assumed.
 *
 * WHY THIS EXISTS. GPS-lap's two equivalents each hid an O(targets × samples)
 * rescan worth ~10 ms of a ~22 ms update, and out-and-back's helpers have the
 * same shape with twice the legs — but nobody had ever put a stopwatch on them.
 * The golden literals pin CALCULATOR output; they say nothing about the
 * aggregation that runs downstream of it on every slider move.
 *
 * WHAT IS REAL HERE. `calculateOutAndBackStats` is the production function,
 * imported and called. Nothing in the measured path is re-implemented. Plot
 * BUILDING is NOT measured — no plot-creation function is imported or called —
 * so every number below excludes it.
 *
 * WHAT IS SYNTHESISED, AND WHY. The `OutAndBackVEProfile[]` inputs. Production
 * builds them in `toOutAndBackProfiles`, which needs a populated `AppState`, a
 * WASM calculator and a segment pipeline — all of which sit UPSTREAM of the
 * helpers under test and would put their cost inside the number. The shapes
 * here match what that function emits: monotonically increasing per-leg
 * distances in km, one VE sample per distance, and a mean-elevation reference
 * spanning the A→B leg. Sample counts come from `syntheticActivity.ts`, the same
 * module the other two profilers use, so these numbers can sit beside theirs;
 * the mean-elevation reference is sized instead by PRODUCTION's own formula, so
 * that the "shipped workload" row describes the shipped haystack.
 *
 * SECTIONS 2 AND 3 ARE THE GROWTH PROBES. The wall-clock number says how long
 * the helpers take; it does not say WHY, and "it is O(targets × samples)" is a
 * claim about growth that one workload cannot settle. So each axis is grown on
 * its own. SECTION 2 is the SECTION-count axis, with the per-section sample
 * count held fixed: more sections is strictly more work of the same size, so
 * both columns are linear here and this axis cannot show the rescan. SECTION 3
 * is the SAMPLE axis, and it is the one that carries the finding: growing the
 * samples per leg grows the targets AND the haystack together, so a per-target
 * rescan shows up as roughly the SQUARE of the growth factor while a
 * logarithmic lookup stays near linear.
 *
 * Run: `npm run profile:out-and-back` from `frontend/`.
 */
import { performance } from "node:perf_hooks";

import { calculateOutAndBackStats } from "../src/shell/outAndBack/outAndBackPlots";
import type { OutAndBackVEProfile } from "../src/shell/outAndBack/types";
import { percentile, formatMs } from "./syntheticActivity";

const WARMUP_ITERATIONS = 5;
const MEASURED_ITERATIONS = 30;
const PROCESS_WARMUP_ITERATIONS = 200;

/** The maintainer's case: 3 sections is what the reference ride's gates produce. */
const MAINTAINER_SECTION_COUNT = 3;
/** Samples per leg. A 7 200-sample activity split across 3 sections, two legs each. */
const SAMPLES_PER_LEG = 1_200;
/** One leg's span in km. Production sizes its mean-elevation reference from this. */
const LEG_DISTANCE_KM = 4.2;
/**
 * The mean-elevation reference spans one A→B leg at PRODUCTION's resolution:
 * `calculateOutAndBackMeanElevation` builds `max(100, floor(maxDistance * 100)) + 1`
 * points, ~10 m intervals — `outAndBackPlots.ts:39-44`.
 */
const MEAN_ELEVATION_POINTS =
	Math.max(100, Math.floor(LEG_DISTANCE_KM * 100)) + 1;

function ramp(count: number, from: number, to: number): number[] {
	const step = (to - from) / Math.max(count - 1, 1);
	return Array.from({ length: count }, (_, i) => from + i * step);
}

/** A leg's VE series: a gentle rise with a deterministic wobble, no RNG. */
function veSeries(count: number, amplitude: number): number[] {
	return Array.from(
		{ length: count },
		(_, i) => amplitude * Math.sin(i / 37) + i * 0.002,
	);
}

function makeProfile(
	sectionNumber: number,
	samplesPerLeg: number,
	withCompare: boolean,
): OutAndBackVEProfile {
	const distances = ramp(samplesPerLeg, 0, LEG_DISTANCE_KM);
	return {
		sectionNumber,
		outboundDistances: distances,
		outboundVE: veSeries(samplesPerLeg, 1.5),
		outboundVECompare: withCompare ? veSeries(samplesPerLeg, 1.7) : null,
		outboundActualElevation: veSeries(samplesPerLeg, 1.4),
		outboundSeries: null,
		inboundDistances: distances,
		inboundVE: veSeries(samplesPerLeg, 1.6),
		inboundVECompare: withCompare ? veSeries(samplesPerLeg, 1.8) : null,
		inboundActualElevation: veSeries(samplesPerLeg, 1.45),
		inboundSeries: null,
		outboundDuration: samplesPerLeg,
		inboundDuration: samplesPerLeg,
		totalDistance: 8.4,
	};
}

function makeInputs(
	sectionCount: number,
	samplesPerLeg: number,
	withCompare: boolean,
) {
	const profiles = Array.from({ length: sectionCount }, (_, i) =>
		makeProfile(i + 1, samplesPerLeg, withCompare),
	);
	const meanElevation = {
		distances: ramp(MEAN_ELEVATION_POINTS, 0, LEG_DISTANCE_KM),
		elevation: veSeries(MEAN_ELEVATION_POINTS, 1.3),
	};
	return { profiles, meanElevation };
}

function measure(run: () => void): { median: number; p95: number } {
	for (let i = 0; i < WARMUP_ITERATIONS; i++) run();
	const samples: number[] = [];
	for (let i = 0; i < MEASURED_ITERATIONS; i++) {
		const start = performance.now();
		run();
		samples.push(performance.now() - start);
	}
	samples.sort((a, b) => a - b);
	return { median: percentile(samples, 0.5), p95: percentile(samples, 0.95) };
}

/**
 * `measure`'s warm-up is per-configuration and does not cover the first call in the
 * PROCESS. Without this, whichever Section 1 configuration runs first absorbs JIT
 * warm-up and is reported 2.5-5x slow — enough to invert the two Section 1 rows.
 */
function warmUpProcess(): void {
	const { profiles, meanElevation } = makeInputs(
		MAINTAINER_SECTION_COUNT,
		SAMPLES_PER_LEG,
		true,
	);
	for (let i = 0; i < PROCESS_WARMUP_ITERATIONS; i++) {
		calculateOutAndBackStats(profiles, meanElevation);
	}
}

const out = (line: string) => process.stdout.write(`${line}\n`);

function main(): void {
	warmUpProcess();
	out("");
	out("OUT-AND-BACK AGGREGATION — calculateOutAndBackStats");
	out("=".repeat(72));
	out(
		`  ${SAMPLES_PER_LEG} samples per leg, 2 legs per section, over ${LEG_DISTANCE_KM} km.`,
	);
	out(
		`  ${MEAN_ELEVATION_POINTS}-point mean-elevation reference — production's own ` +
			`~10 m spacing over that leg, not the sample count.`,
	);
	out("");

	out("  Section 1 — the shipped workload");
	out("  " + "-".repeat(68));
	for (const withCompare of [false, true]) {
		const { profiles, meanElevation } = makeInputs(
			MAINTAINER_SECTION_COUNT,
			SAMPLES_PER_LEG,
			withCompare,
		);
		const { median, p95 } = measure(() => {
			calculateOutAndBackStats(profiles, meanElevation);
		});
		const label = withCompare
			? "with compare series (scored TWICE)"
			: "primary legs only";
		out(
			`  ${MAINTAINER_SECTION_COUNT} sections, ${label.padEnd(34)} ` +
				`median ${formatMs(median).padStart(8)}  p95 ${formatMs(p95).padStart(8)}`,
		);
	}

	out("");
	out("  Section 2 — how it grows with the section count");
	out("  " + "-".repeat(68));
	out("  Samples per leg held FIXED, so a linear helper would grow linearly");
	out("  with the section count and a rescan grows faster.");
	out("");
	const growth: Array<{ sections: number; median: number }> = [];
	for (const sectionCount of [2, 4, 8]) {
		const { profiles, meanElevation } = makeInputs(
			sectionCount,
			SAMPLES_PER_LEG,
			true,
		);
		const { median, p95 } = measure(() => {
			calculateOutAndBackStats(profiles, meanElevation);
		});
		growth.push({ sections: sectionCount, median });
		out(
			`  ${String(sectionCount).padStart(2)} sections   ` +
				`median ${formatMs(median).padStart(8)}  p95 ${formatMs(p95).padStart(8)}`,
		);
	}
	const first = growth[0];
	const last = growth[growth.length - 1];
	const sectionRatio = last.sections / first.sections;
	const timeRatio = last.median / first.median;
	out("");
	out(
		`  ${first.sections} -> ${last.sections} sections is ${sectionRatio.toFixed(1)}x the work; ` +
			`time went up ${timeRatio.toFixed(1)}x.`,
	);
	out(
		"  Roughly equal ratios mean the per-section cost is flat in the SECTION",
	);
	out("  count. That is the axis this probe can settle; the sample axis is");
	out("  Section 3.");

	out("");
	out("  Section 3 — how it grows with the samples per leg");
	out("  " + "-".repeat(68));
	out("  Section count held FIXED. A per-target rescan of the mean profile is");
	out("  O(targets x samples), so DOUBLING both sides quadruples the work.");
	out("");
	const sampleGrowth: Array<{ samples: number; median: number }> = [];
	for (const samples of [600, 1_200, 2_400]) {
		const profiles = Array.from({ length: MAINTAINER_SECTION_COUNT }, (_, i) =>
			makeProfile(i + 1, samples, true),
		);
		const meanElevation = {
			distances: ramp(samples, 0, LEG_DISTANCE_KM),
			elevation: veSeries(samples, 1.3),
		};
		const { median, p95 } = measure(() => {
			calculateOutAndBackStats(profiles, meanElevation);
		});
		sampleGrowth.push({ samples, median });
		out(
			`  ${String(samples).padStart(5)} samples/leg   ` +
				`median ${formatMs(median).padStart(8)}  p95 ${formatMs(p95).padStart(8)}`,
		);
	}
	const sFirst = sampleGrowth[0];
	const sLast = sampleGrowth[sampleGrowth.length - 1];
	const sampleRatio = sLast.samples / sFirst.samples;
	const sampleTimeRatio = sLast.median / sFirst.median;
	out("");
	out(
		`  ${sFirst.samples} -> ${sLast.samples} samples/leg is ${sampleRatio.toFixed(1)}x the targets ` +
			`AND ${sampleRatio.toFixed(1)}x the haystack;`,
	);
	out(
		`  time went up ${sampleTimeRatio.toFixed(1)}x. Linear would be ` +
			`${sampleRatio.toFixed(1)}x, quadratic ${(sampleRatio * sampleRatio).toFixed(1)}x.`,
	);
	out("");
}

main();
