import type { Plugin } from "vite";

export const WASM_BUILD_DONE_MARKER = ".build-done";

const toPosix = (file: string): string => file.replace(/\\/g, "/");

/**
 * Full-reload the page when wasm-pack rewrites `frontend/pkg`.
 *
 * `npm run dev:wasm` (root) rebuilds the Rust crate into that directory on
 * every change under `backend/`. The generated JS glue is in the module
 * graph, so Vite would notice that on its own — but the actual code lives in
 * `..._bg.wasm`, which the glue fetches at runtime by URL and which no module
 * imports. Without this, editing Rust and rebuilding leaves the page running
 * the previous wasm binary with no indication anything changed.
 *
 * Reload rather than HMR because the module is instantiated once at boot
 * (`init()` in fileLoadOrchestration); there is nothing to hot-swap it into.
 *
 * A rebuild writes `pkg/` in two waves ~16 s apart (wasm-bindgen, then
 * wasm-opt), so the watch command touches `pkg/.build-done` after
 * `wasm-pack build` exits 0 and this plugin reloads on that alone.
 * `hotUpdate` returns [] for `pkg/` files because the glue and the .wasm are
 * in Vite's module graph and core would otherwise reload on the first wave.
 */
export function wasmReloadPlugin(pkgDir: string): Plugin {
	const pkgPrefix = `${toPosix(pkgDir).replace(/\/+$/, "")}/`;
	return {
		name: "ve-wasm-reload",
		apply: "serve",
		configureServer(server) {
			server.watcher.add(pkgDir);
			const reload = (file: string) => {
				if (toPosix(file) !== `${pkgPrefix}${WASM_BUILD_DONE_MARKER}`) return;
				server.config.logger.info("wasm rebuilt, reloading page");
				server.ws.send({ type: "full-reload", path: "*" });
			};
			server.watcher.on("change", reload);
			server.watcher.on("add", reload);
		},
		hotUpdate({ file }) {
			if (toPosix(file).startsWith(pkgPrefix)) {
				return [];
			}
		},
	};
}
