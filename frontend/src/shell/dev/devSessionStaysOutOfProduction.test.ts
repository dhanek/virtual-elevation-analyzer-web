/**
 * THE DEV SESSION STAYS OUT OF THE PRODUCTION BUNDLE — STRUCTURAL.
 *
 * `devSessionStore` and `devSessionRestore` are dev-only warm-reload code. A
 * static import anywhere outside `src/shell/dev` pulls them into the entry
 * chunk whatever their own `import.meta.env.DEV` checks say; the callers must
 * reach them through a dynamic `import()` behind `import.meta.env.DEV`, which
 * the production build drops.
 *
 * This is the shape only. The real proof is the dist grep (`npm run build`,
 * then no `ve-dev-session` in `dist`), which the suite cannot run.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(process.cwd(), "src");
const DEV_DIR = join(SRC_ROOT, "shell", "dev");

function* walk(dir: string): Generator<string> {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			if (path === DEV_DIR) continue;
			yield* walk(path);
		} else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) {
			yield path;
		}
	}
}

const DEV_MODULE = String.raw`[^"']*\/dev\/devSession(?:Store|Restore)(?:\.ts)?`;
const STATIC_IMPORT = new RegExp(
	String.raw`from\s+["']${DEV_MODULE}["']|import\s+["']${DEV_MODULE}["']`,
	"g",
);
const DYNAMIC_IMPORT = new RegExp(
	String.raw`import\s*\(\s*["']${DEV_MODULE}["']\s*\)`,
);

describe("dev session modules stay out of the production bundle", () => {
	it("are never statically imported outside src/shell/dev", () => {
		const offenders: string[] = [];
		for (const path of walk(SRC_ROOT)) {
			const source = readFileSync(path, "utf8");
			for (const match of source.matchAll(STATIC_IMPORT)) {
				offenders.push(
					`${path.slice(SRC_ROOT.length + 1).replace(/\\/g, "/")}: ${match[0]}`,
				);
			}
		}
		expect(offenders).toEqual([]);
	});

	it("are still reached, dynamically, by both callers", () => {
		// Without this the test above could pass by matching nothing.
		for (const caller of [
			"shell/app/initializeApplication.ts",
			"shell/fileLoad/fileLoadOrchestration.ts",
		]) {
			const source = readFileSync(join(SRC_ROOT, caller), "utf8");
			expect(DYNAMIC_IMPORT.test(source), caller).toBe(true);
		}
	});
});
