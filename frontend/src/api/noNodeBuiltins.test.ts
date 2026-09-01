/**
 * BUNDLE SAFETY, MADE CHECKABLE (Convergence plan, C7/C10).
 *
 * Two structural claims keep the headless API out of the shipped site:
 *
 *   1. no non-test file under `src/api/` imports a `node:` builtin, so the
 *      library stays bundle-legal even if something imports it;
 *   2. `src/main.ts`'s transitive import graph never reaches `src/api/`, so
 *      nothing does.
 *
 * The empirical backstop is `npm run build` itself, but that only fails when
 * an import is unbundlable — a pure-TS leak would ride into the bundle
 * silently, which is what claim 2 catches.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(process.cwd(), "src");

function* walk(dir: string): Generator<string> {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			yield* walk(path);
		} else if (path.endsWith(".ts")) {
			yield path;
		}
	}
}

const IMPORT_SPECIFIERS = /from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

function specifiersOf(source: string): string[] {
	const out: string[] = [];
	for (const match of source.matchAll(IMPORT_SPECIFIERS)) {
		out.push((match[1] ?? match[2])!);
	}
	return out;
}

describe("src/api stays out of the bundle", () => {
	it("imports no node builtin from any non-test api module", () => {
		const offenders: string[] = [];
		for (const path of walk(join(SRC_ROOT, "api"))) {
			if (path.endsWith(".test.ts")) continue;
			for (const spec of specifiersOf(readFileSync(path, "utf8"))) {
				if (spec.startsWith("node:")) {
					offenders.push(`${path}: ${spec}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	it("is unreachable from src/main.ts", () => {
		const visited = new Set<string>();
		const queue = [join(SRC_ROOT, "main.ts")];
		const reached: string[] = [];

		while (queue.length > 0) {
			const path = queue.pop()!;
			if (visited.has(path)) continue;
			visited.add(path);

			let source: string;
			try {
				source = readFileSync(path, "utf8");
			} catch {
				continue;
			}
			for (const spec of specifiersOf(source)) {
				if (!spec.startsWith(".")) continue;
				const base = resolve(dirname(path), spec);
				const candidates = [base + ".ts", join(base, "index.ts"), base];
				const next = candidates.find((candidate) => {
					try {
						return statSync(candidate).isFile();
					} catch {
						return false;
					}
				});
				if (!next) continue;
				if (next.includes(`${join("src", "api")}`)) {
					reached.push(`${path} -> ${next}`);
				}
				queue.push(next);
			}
		}

		expect(reached).toEqual([]);
	});
});
