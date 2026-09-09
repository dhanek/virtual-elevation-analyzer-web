/**
 * @vitest-environment jsdom
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import { AppState } from "./AppState";
import { applyVeStatus } from "./veStatus";

describe("applyVeStatus", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("starts idle", () => {
		expect(new AppState().veStatus).toBe("idle");
	});

	it("writes the status onto the state", () => {
		const appState = new AppState();
		applyVeStatus(appState, "computing");
		expect(appState.veStatus).toBe("computing");
	});

	it("enables #storeResult only when ready", () => {
		document.body.innerHTML = `<button id="storeResult"></button>`;
		const button = document.getElementById("storeResult") as HTMLButtonElement;
		const appState = new AppState();

		applyVeStatus(appState, "computing");
		expect(button.disabled).toBe(true);

		applyVeStatus(appState, "ready");
		expect(button.disabled).toBe(false);

		applyVeStatus(appState, "error");
		expect(button.disabled).toBe(true);
	});

	it("tolerates a missing button, because the panel may not be mounted", () => {
		const appState = new AppState();
		expect(() => applyVeStatus(appState, "ready")).not.toThrow();
		expect(appState.veStatus).toBe("ready");
	});
});

/** Every `.ts` under src, excluding the tests. */
function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			sourceFiles(full, out);
		} else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
			out.push(full);
		}
	}
	return out;
}

/**
 * THE STATUS REPLACED THE SEEDS. NEITHER SEED COMES BACK.
 *
 * All three analyze legs used to write analyze-derived state of their own before
 * the update pass ran — `currentFilteredData` for Standard, and that plus
 * `currentVEResult` / `currentWindSource` / `currentVirtualDistances` for the two
 * segment modes, through two helpers in `segmentSummary.ts`. They existed so
 * that Analyze followed straight by Store Result described THIS ride rather than
 * the previous one (CR-01/WR-3). The cost was a second writer of each field, in
 * a second index space, disagreeing with the update pass — which is what CR-02
 * was, and what made Standard's header visibly jump a macrotask after the panel
 * appeared.
 *
 * `veStatus` carries the same guarantee without the second writer: a new panel
 * leaves `"ready"`, `handleStoreResult` refuses anything that is not `"ready"`,
 * and `applyVeStatus` renders `#storeResult` disabled to say so. Store Result
 * cannot reach a stale value at all, rather than reaching a freshly-overwritten
 * one. Both helpers are therefore deleted, and `summarize` is the single
 * producer of every analyze-derived field.
 *
 * SOURCE-LEVEL, deliberately, and this test lives here rather than beside the
 * deleted code because there is no module left to hang it off. The defect it
 * guards is an ADDITION nobody would think to look for: a future mode, or a
 * revert of one of these three commits, quietly reintroducing an analyze-time
 * write. No test of any module's own exports can observe a caller that should
 * not exist. Same reasoning as `calculatorRhoArray.test.ts`'s source scan and
 * `unsetParameterFallbacks.test.ts`'s.
 *
 * The scan skips `.test.ts`, so the historical mentions in the chain suites'
 * explanatory comments are not offenders — and no non-test comment may name
 * either helper, which is why the "no seed here any more" comments in the three
 * render legs describe the mechanism instead of naming it.
 *
 * Mutation: restore either call site and this fails, naming the file.
 */
describe("the analyze legs seed no analyze-derived state", () => {
	it("leaves no analyze-time seed helper anywhere in src", () => {
		const offenders: string[] = [];
		const seeds = /seedSegmentMode(AnalyzeState|FilteredData)/;
		for (const file of sourceFiles(join(__dirname, ".."))) {
			const text = readFileSync(file, "utf8");
			text.split("\n").forEach((line, i) => {
				if (seeds.test(line)) {
					offenders.push(`${file.split("/src/")[1]}:${i + 1}  ${line.trim()}`);
				}
			});
		}
		expect(offenders).toEqual([]);
	});
});
