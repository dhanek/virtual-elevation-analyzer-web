import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig(() => ({
  // Use GitHub Pages base path only when VITE_GITHUB_PAGES=true
  // For local dev/testing: npm run build
  // For GitHub Pages: VITE_GITHUB_PAGES=true npm run build
  base: process.env.VITE_GITHUB_PAGES === 'true' ? '/virtual-elevation-analyzer-web/' : '/',
  root: '.',
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
    }
  },
  worker: {
    format: 'es'
  },
  optimizeDeps: {
    exclude: ['virtual-elevation-analyzer']
  }
}))