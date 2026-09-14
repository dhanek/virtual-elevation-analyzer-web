/**
 * THE WASM RELOAD FIRES ONCE PER BUILD, ON THE MARKER.
 *
 * A rebuild writes `pkg/` in two waves ~16 s apart; the watch command touches
 * `pkg/.build-done` only after `wasm-pack build` succeeds. The plugin must
 * reload on that path alone, and must stop Vite core's own reload for every
 * other `pkg/` file (via `hotUpdate` returning []).
 *
 * The fake server is hand-rolled so the module stays free of Node types. The
 * watch command itself is not run by any suite.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WASM_BUILD_DONE_MARKER, wasmReloadPlugin } from "./wasmReloadPlugin";

const PKG_DIR = "/repo/frontend/pkg";

type Handler = (file: string) => void;

function makeServer() {
	const handlers: Record<string, Handler[]> = {};
	const server = {
		watcher: {
			add: vi.fn(),
			on: vi.fn((event: string, fn: Handler) => {
				(handlers[event] ??= []).push(fn);
			}),
		},
		config: { logger: { info: vi.fn() } },
		ws: { send: vi.fn() },
	};
	const fire = (event: "change" | "add", file: string) => {
		for (const fn of handlers[event] ?? []) fn(file);
	};
	return { server, handlers, fire };
}

function setup() {
	const plugin = wasmReloadPlugin(PKG_DIR);
	const ctx = makeServer();
	const configureServer = plugin.configureServer as unknown as (
		server: unknown,
	) => void;
	configureServer(ctx.server);
	const hotUpdate = plugin.hotUpdate as unknown as (options: {
		file: string;
	}) => unknown;
	return { plugin, ...ctx, hotUpdate };
}

describe("wasmReloadPlugin", () => {
	let ctx: ReturnType<typeof setup>;

	beforeEach(() => {
		ctx = setup();
	});

	it("keeps its name and serve-only apply", () => {
		expect(ctx.plugin.name).toBe("ve-wasm-reload");
		expect(ctx.plugin.apply).toBe("serve");
		expect(WASM_BUILD_DONE_MARKER).toBe(".build-done");
	});

	it("registers both the change and add handlers it is driven through", () => {
		const events = ctx.server.watcher.on.mock.calls.map(([event]) => event);
		expect(events).toContain("change");
		expect(events).toContain("add");
		expect(ctx.handlers.change).toHaveLength(1);
		expect(ctx.handlers.add).toHaveLength(1);
	});

	it("(e) watches exactly the pkgDir passed to the factory", () => {
		expect(ctx.server.watcher.add).toHaveBeenCalledTimes(1);
		expect(ctx.server.watcher.add).toHaveBeenCalledWith(PKG_DIR);
	});

	describe("(a) the marker reloads once per event", () => {
		it("via change, then once more via add", () => {
			ctx.fire("change", "/repo/frontend/pkg/.build-done");
			expect(ctx.server.ws.send).toHaveBeenCalledTimes(1);
			expect(ctx.server.ws.send).toHaveBeenCalledWith({
				type: "full-reload",
				path: "*",
			});
			expect(ctx.server.config.logger.info).toHaveBeenCalledTimes(1);

			ctx.fire("add", "/repo/frontend/pkg/.build-done");
			expect(ctx.server.ws.send).toHaveBeenCalledTimes(2);
			expect(ctx.server.config.logger.info).toHaveBeenCalledTimes(2);
		});

		it("with a Windows path", () => {
			ctx.fire("change", "C:\\repo\\frontend\\pkg\\.build-done");
			expect(ctx.server.ws.send).toHaveBeenCalledTimes(1);
			expect(ctx.server.ws.send).toHaveBeenCalledWith({
				type: "full-reload",
				path: "*",
			});
		});
	});

	describe("(b) the measured pkg/ writes do not reload", () => {
		const files = [
			".gitignore",
			"package.json",
			"virtual_elevation_analyzer.js",
			"virtual_elevation_analyzer.d.ts",
			"virtual_elevation_analyzer_bg.wasm",
			"virtual_elevation_analyzer_bg.wasm.d.ts",
			"virtual_elevation_analyzer_bg.wasm-opt.wasm",
		];
		for (const name of files) {
			for (const event of ["change", "add"] as const) {
				it(`${name} via ${event}`, () => {
					ctx.fire(event, `/repo/frontend/pkg/${name}`);
					expect(ctx.server.ws.send).toHaveBeenCalledTimes(0);
					expect(ctx.server.config.logger.info).toHaveBeenCalledTimes(0);
				});
			}
		}
	});

	describe("(c) paths outside pkg/ do not reload", () => {
		for (const file of [
			"/repo/frontend/src/main.ts",
			"/repo/frontend/src/.build-done",
		]) {
			it(file, () => {
				ctx.fire("change", file);
				expect(ctx.server.ws.send).toHaveBeenCalledTimes(0);
			});
		}
	});

	describe("(d) hotUpdate suppresses core's reload for pkg/ only", () => {
		for (const file of [
			"/repo/frontend/pkg/virtual_elevation_analyzer.js",
			"/repo/frontend/pkg/virtual_elevation_analyzer_bg.wasm",
			"C:\\repo\\frontend\\pkg\\virtual_elevation_analyzer_bg.wasm",
		]) {
			it(`returns [] for ${file}`, () => {
				expect(ctx.hotUpdate({ file })).toEqual([]);
			});
		}

		it("returns undefined for /repo/frontend/src/main.ts", () => {
			expect(
				ctx.hotUpdate({ file: "/repo/frontend/src/main.ts" }),
			).toBeUndefined();
		});
	});
});
