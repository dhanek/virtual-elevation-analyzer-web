import { defineConfig, type Plugin } from 'vite'
import { release } from 'os'
import { resolve } from 'path'

const PKG_DIR = resolve(__dirname, 'pkg')

/**
 * WSL cannot deliver inotify events for files on a Windows drive: the
 * 9p/drvfs mount under /mnt/<letter> simply never fires them, so chokidar
 * sits silent and NOTHING hot-reloads — not the wasm below, not CSS, not a
 * source edit. Polling is the only way to see a change there, and it is
 * wasteful everywhere else, so turn it on exactly where it is needed.
 *
 * `VITE_POLL=1` / `VITE_POLL=0` forces it either way, for a layout this
 * check does not anticipate.
 */
function needsPolling(): boolean {
  if (process.env.VITE_POLL === '1') return true
  if (process.env.VITE_POLL === '0') return false
  const onWsl = process.platform === 'linux' && /microsoft/i.test(release())
  return onWsl && __dirname.startsWith('/mnt/')
}

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
 */
function wasmReloadPlugin(): Plugin {
  return {
    name: 've-wasm-reload',
    apply: 'serve',
    configureServer(server) {
      server.watcher.add(PKG_DIR)
      const reload = (file: string) => {
        if (!file.replace(/\\/g, '/').includes('/pkg/')) return
        server.config.logger.info('wasm rebuilt, reloading page')
        server.ws.send({ type: 'full-reload', path: '*' })
      }
      server.watcher.on('change', reload)
      server.watcher.on('add', reload)
    },
  }
}

export default defineConfig(() => ({
  // Use GitHub Pages base path only when VITE_GITHUB_PAGES=true
  // For local dev/testing: npm run build
  // For GitHub Pages: VITE_GITHUB_PAGES=true npm run build
  base: process.env.VITE_GITHUB_PAGES === 'true' ? '/virtual-elevation-analyzer-web/' : '/',
  root: '.',
  plugins: [wasmReloadPlugin()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Put any imports coming from a `pkg` directory (wasm-pack output)
          // into a separate chunk so the wasm core is isolated.
          if (id.includes('/pkg/') || id.includes('backend/pkg') || id.includes('frontend/pkg')) {
            return 'wasm-core';
          }
        }
      }
    }
  },
  resolve: {
    alias: {
      // The CI workflow writes the wasm build output into frontend/pkg,
      // so resolve the alias to the frontend `pkg` directory where
      // `wasm-pack --out-dir ../frontend/pkg` places the JS glue file.
      '@wasm': resolve(__dirname, 'pkg')
    }
  },
  server: {
    fs: {
      allow: ['..']
    },
    // See needsPolling: an empty object leaves chokidar's defaults alone.
    watch: needsPolling() ? { usePolling: true, interval: 300 } : {}
  },
  optimizeDeps: {
    exclude: ['virtual-elevation-analyzer']
  }
}))