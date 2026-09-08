import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";
import { describe, expect, it } from "vitest";

/**
 * The set of files the formatter covers is written by hand in three places:
 * the glob list in `npm run check`, the identical list in `npm run format`,
 * and the exclusions in `.prettierignore`. Nothing derives one from another,
 * so the three drift silently — `.prettierignore` once excluded the whole of
 * `src/analysis/__fixtures__`, which swallowed two first-party TypeScript
 * modules along with the generated JSON they load, and `npm run check` kept
 * exiting 0 with a misindented block sitting in one of them.
 *
 * This file is the guard that makes the three disagree loudly. It does not
 * widen the covered set; it asserts that the set the three places describe is
 * the same set, and that it is every tracked TypeScript file.
 *
 * Everything it compares is READ from the repository — the globs from
 * `package.json`, the exclusions from `.prettierignore` via prettier's own
 * API, the file list from `git ls-files`. It restates none of them. A test
 * that hard-codes the globs is testing a copy of the code, not the code.
 */

/** The frontend package root, i.e. the directory holding `package.json`. */
const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

interface PackageJson {
	scripts: Record<string, string>;
}

function readPackageJson(): PackageJson {
	return JSON.parse(
		readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"),
	) as PackageJson;
}

/**
 * The double-quoted arguments that immediately follow `marker` in an npm
 * script — i.e. prettier's own glob list, stopping at the first argument that
 * is not a quoted glob (`&&`, `tsc`, a bare flag).
 *
 * Throws rather than returning `[]` when the marker is missing: a script that
 * no longer invokes prettier at all is the loudest possible failure, and an
 * empty list would make assertions 1 and 3 pass vacuously.
 */
function quotedGlobsAfter(script: string, marker: string): string[] {
	const at = script.indexOf(marker);
	if (at === -1) {
		throw new Error(
			`Expected the npm script to contain \`${marker}\`, got: ${script}`,
		);
	}

	let rest = script.slice(at + marker.length);
	const globs: string[] = [];
	for (;;) {
		const match = /^\s+"([^"]*)"/.exec(rest);
		if (match === null) break;
		globs.push(match[1]);
		rest = rest.slice(match[0].length);
	}

	if (globs.length === 0) {
		throw new Error(
			`Expected at least one quoted glob after \`${marker}\`, got: ${script}`,
		);
	}
	return globs;
}

/**
 * A glob from the scripts, as a pattern over repository-relative paths.
 *
 * Only the constructs the glob list actually uses are translated, and a single
 * `*` is kept distinct from a double one because that distinction is the whole
 * point: `scripts/*.ts` does not reach `scripts/sub/x.ts` and the recursive
 * form does. That is exactly the divergence from `eslint src scripts` and from
 * `tsconfig.scripts.json`'s recursive `include` that this file guards.
 *
 * Deliberately not a glob library: the dependency would buy a general matcher
 * where three constructs are needed, and prettier's own resolution of these
 * globs is already exercised by `npm run check` itself.
 */
function globToRegExp(glob: string): RegExp {
	let pattern = "";
	let i = 0;
	while (i < glob.length) {
		if (glob.startsWith("**/", i)) {
			// Zero or more directory segments, matching fast-glob: `src/**/*.ts`
			// reaches `src/a.ts` as well as `src/a/b/c.ts`.
			pattern += "(?:[^/]+/)*";
			i += 3;
		} else if (glob.startsWith("**", i)) {
			pattern += ".*";
			i += 2;
		} else if (glob[i] === "*") {
			pattern += "[^/]*";
			i += 1;
		} else if (glob[i] === "?") {
			pattern += "[^/]";
			i += 1;
		} else {
			pattern += glob[i].replace(/[.+^${}()|[\]\\]/g, "\\$&");
			i += 1;
		}
	}
	return new RegExp(`^${pattern}$`);
}

/**
 * Every tracked `.ts` file under the frontend package, relative to it.
 *
 * Fails loudly when git is unavailable or returns nothing. A skip here would
 * leave a guard that reports success over an empty set.
 */
function trackedTypeScriptFiles(): string[] {
	const stdout = execSync("git ls-files '*.ts'", {
		cwd: PACKAGE_ROOT,
		encoding: "utf8",
	});
	const paths = stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	if (paths.length === 0) {
		throw new Error(
			`git ls-files '*.ts' listed no files under ${PACKAGE_ROOT}. ` +
				"The coverage assertions below would pass over an empty set.",
		);
	}
	return paths;
}

describe("formatter coverage", () => {
	it("checks and formats the identical set of globs", () => {
		const { scripts } = readPackageJson();
		const checked = quotedGlobsAfter(scripts.check, "prettier --check");
		const written = quotedGlobsAfter(scripts.format, "prettier --write");

		// Deep equality, order included: `npm run format` must produce a tree
		// that `npm run check` accepts, and a glob present in one list only is
		// either a file nobody formats or a file nobody checks.
		expect(written).toEqual(checked);
	});

	it("ignores no tracked TypeScript source", async () => {
		// Absolute, both of them: prettier resolves a relative `ignorePath`
		// against `process.cwd()`, and a run started from anywhere but the
		// package root would then find no ignore file and report every path as
		// unignored — a green assertion over nothing.
		const ignorePath = join(PACKAGE_ROOT, ".prettierignore");

		const ignored: string[] = [];
		for (const path of trackedTypeScriptFiles()) {
			const info = await prettier.getFileInfo(join(PACKAGE_ROOT, path), {
				ignorePath,
			});
			if (info.ignored) ignored.push(path);
		}

		// Reported as the list of paths, not as a bare boolean: the failure a
		// reader needs to act on is *which* source files went uncovered.
		expect(ignored).toEqual([]);
	});

	it("leaves no tracked TypeScript source outside the globs", () => {
		const { scripts } = readPackageJson();
		const patterns = quotedGlobsAfter(scripts.check, "prettier --check").map(
			globToRegExp,
		);

		const uncovered = trackedTypeScriptFiles().filter(
			(path) => !patterns.some((pattern) => pattern.test(path)),
		);

		expect(uncovered).toEqual([]);
	});
});
