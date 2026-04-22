# Stack Research

**Domain:** Browser-based VE analysis enhancement - performance, pipeline unification, and UI consolidation
**Researched:** 2026-04-22
**Confidence:** MEDIUM-HIGH

## Recommended Stack

Keep the existing TypeScript + Vite + Rust/WASM stack. The v1.1 enhancements primarily add browser-native capabilities without changing the core stack.

### New Technologies for v1.1

| Technology | Purpose | Why | Integration |
| ---------- | ------- | --- | ----------- |
| Web Workers API | Background VE computation for slider responsiveness | Keep main thread free during multi-lap recompute | Built-in browser API, no library needed |
| Comlink | Worker communication abstraction | Simplifies postMessage protocol, adds type safety | `npm install comlink` |
| SharedArrayBuffer | Fast data sharing between main thread and workers | Pass ride data without cloning | Requires cross-origin isolation headers |
| Atomics | Synchronization primitives for SharedArrayBuffer | Safe concurrent access patterns | Built-in browser API |

### No New Dependencies Needed

| Capability | Existing Solution | Notes |
| ---------- | ---------------- | ----- |
| GPS UI consolidation | Existing shell modules | Move existing UI elements, no new library |
| Elevation smoothing | Already in codebase | Clarify layer ownership, no new tool |
| Weather interpolation | Existing weather service | Extend sampling logic, no new dependency |
| Map cleanup | Existing Leaflet integration | Structure refactor only, no library change |
| CSS improvements | Existing CSS | Clean up patterns, no preprocessor needed |

## Worker Architecture Options

### Option A: Dedicated VE Compute Worker
```
Main Thread                    Worker Thread
[UI/Shell] → postMessage → [WASM VE Calculator]
     ↑                           ↓
     └─────── results ───────────┘
```
**Pros:** Full background computation, best responsiveness
**Cons:** Requires WASM module in worker context

### Option B: Hybrid Worker (Chunked Processing)
```
Main Thread                    Worker Thread
[Shell] ─── chunked data ──→ [Array processing]
     ↑                           ↓
     └─────── partial results ───┘
```
**Pros:** Reuses existing WASM on main thread for actual calculation
**Cons:** More complex orchestration

### Option C: Main Thread + Debounced Updates
```
[Slider change] → debounce → [WASM compute] → [UI update]
```
**Pros:** Simplest implementation, no worker complexity
**Cons:** May not solve worst-case latency issues

**Recommendation:** Option A if profiling shows main thread blocking; Option C as v1 (simpler), upgrade to A if needed.

## Cross-Origin Isolation (if using SharedArrayBuffer)

If SharedArrayBuffer is needed:
```javascript
// Server response headers (for static hosting like GitHub Pages)
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

**Note:** GitHub Pages may not support these headers. Test early or use transferable ArrayBuffers instead.

## Sources

- https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API
- https://github.com/GoogleChrome/comlink
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer
- https://vite.dev/guide/build#web-workers

---
*Stack research for: v1.1 Enhancement Wave*
*Researched: 2026-04-22*
