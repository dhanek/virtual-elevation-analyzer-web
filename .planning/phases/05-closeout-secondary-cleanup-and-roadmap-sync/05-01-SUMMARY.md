---
phase: 05-closeout-secondary-cleanup-and-roadmap-sync
plan: 01
status: complete
requirements: [CLOS-01]
commits: [9caef4a, 7cbb318, 66609f7, fd5f912]
---

## What was built

Phase 5 residual extraction is in place and `frontend/src/main.ts` now functions as a composition root.

### Extracted orchestration surface (present)
- `frontend/src/shell/fileLoad/fileLoadOrchestration.ts`
  - `processFitFile`, `processCsvFile`, file-selection and FIT/CSV orchestration
- `frontend/src/shell/section3/section3Orchestration.ts`
  - GPS/out-and-back detection, lap/section selection, trim control wiring
- `frontend/src/shell/dem/demHandlers.ts`
  - DEM source/file handling and results rendering delegation
- `frontend/src/shell/analysis/analyzeOrchestrator.ts`
  - analyze-button orchestration and parameter-change handling
- `frontend/src/shell/app/initializeApplication.ts`
  - `initializeApplicationShell(...)` composition/bootstrap seam
- `frontend/src/main.ts`
  - reduced to imports, DOM capture, service construction, and bootstrap dispatch

## Structural verification

Executed and passed:

```bash
rg -q "export async function processFitFile" frontend/src/shell/fileLoad/fileLoadOrchestration.ts
rg -q "export async function runGpsLapDetection" frontend/src/shell/section3/section3Orchestration.ts
rg -q "export async function handleAnalyze" frontend/src/shell/analysis/analyzeOrchestrator.ts
rg -q "export async function initializeApplicationShell" frontend/src/shell/app/initializeApplication.ts
rg -q "export (async )?function handleDEMFileSelection" frontend/src/shell/dem/demHandlers.ts
! rg -q "function runGpsLapDetection|function processFitFile|function displayResults|async function handleAnalyze" frontend/src/main.ts
```

Result: **PASS**.

## CI parity / guardrail verification

Executed and passed:

```bash
bash scripts/validate-ui-shell-guardrails.sh --ci-only
```

This ran the required sequence:
1. `cd backend && cargo test --lib`
2. `cd backend && wasm-pack build --target web --out-dir ../frontend/pkg`
3. `cd frontend && npm run check`
4. `cd frontend && npm run lint`
5. `cd frontend && npm run test`
6. `cd frontend && npm run build`

Result: **PASS**.

## Hotspot reduction evidence

`bash scripts/report-ui-shell-hotspots.sh` reports:
- `main.ts` lines: `103`
- `document.getElementById(`: `20`
- `addEventListener(`: `0`
- `innerHTML = \``: `0`
- hotspot anchors: `(no legacy hotspot anchors remain in main.ts)`

## MapVisualization traceability (D-12)

`frontend/src/components/MapVisualization.ts` was **not modified** as part of Phase 5 closeout extraction.

## Notes

- Logging boundary preserved (`frontend/src/shell/` contains no new `console.*` usage).
- No standalone `shell/ui/formatters.ts`, `shell/ui/status.ts`, or `shell/analysis/resultMath.ts` modules were introduced.
