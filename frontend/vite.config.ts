import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  base: '/virtual-elevation-analyzer-web/',
  root: '.',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('backend/pkg')) {
            return 'wasm-core';
          }
        }
      }
    }
  },
  resolve: {
    alias: {
      '@wasm': resolve(__dirname, '../backend/pkg')
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
})