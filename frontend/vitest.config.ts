import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
    // Vitest does NOT merge `vite.config.ts` when a `vitest.config.ts` exists,
    // so the `@wasm` alias declared over in `vite.config.ts` is invisible here.
    // Without this block any test file that imports `@wasm/...` for real dies
    // with `Failed to load url @wasm/virtual_elevation_analyzer.js`. Existing
    // mocked tests survive only because `vi.mock('@wasm/...')` short-circuits
    // resolution entirely. Mirrors `vite.config.ts` `resolve.alias` exactly —
    // both point at the directory `wasm-pack --out-dir ../frontend/pkg` writes.
    resolve: {
        alias: {
            '@wasm': resolve(__dirname, 'pkg'),
        },
    },
    test: {
        include: ['src/**/*.test.ts'],
        environment: 'node',
    },
})
