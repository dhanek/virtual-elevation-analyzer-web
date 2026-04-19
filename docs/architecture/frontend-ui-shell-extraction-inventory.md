# Frontend UI Shell Extraction Inventory

This document tracks the post-stabilization hotspot baseline after Phase 5 closeout.

## Current baseline (post-Phase-5)

Regeneration command:

```bash
bash scripts/report-ui-shell-hotspots.sh
```

Captured on 2026-04-19:

- `frontend/src/main.ts` lines: `103`
- `document.getElementById(` count: `20`
- `addEventListener(` count: `0`
- `innerHTML = \`` count: `0`
- `style="` count: `0`
- `: any` count: `0`

Hotspot function anchors from `bash scripts/report-ui-shell-hotspots.sh`:

- `(no legacy hotspot anchors remain in main.ts)`

Interpretation:
- `frontend/src/main.ts` now reads as a composition root (DOM capture + DI/service construction + shell bootstrap dispatch).
- High-risk orchestration previously anchored in `main.ts` now lives in shell modules (`shell/app`, `shell/fileLoad`, `shell/analysis`, `shell/section3`, `shell/dem`, plus Phase 3/4 mode shells).
- Use the script output as source of truth for future updates; do not rely on stale historical counts.

## Ownership status after extraction milestone

The original ownership buckets are now materially owned by dedicated shell modules:

- Section 3 shell behavior → `frontend/src/shell/section3/`
- Standard VE shell behavior → `frontend/src/shell/ve/`
- GPS-lap shell behavior → `frontend/src/shell/gpsLap/`
- Out-and-back shell behavior → `frontend/src/shell/outAndBack/`
- Shared shell orchestration and bootstrap seams → `frontend/src/shell/app/`, `frontend/src/shell/analysis/`, `frontend/src/shell/fileLoad/`, `frontend/src/shell/dem/`, `frontend/src/shell/dom/`

## Secondary hotspot guidance

`frontend/src/components/MapVisualization.ts` remains a **secondary** hotspot.

Phase 5 posture:
- closeout did **not** perform broad map lifecycle decomposition
- map changes were constrained to seam-required work only
- MAP-01 remains the v2 trigger for targeted decomposition if map complexity becomes the next bottleneck

Guidance for next milestone:
- keep `main.ts` in composition-root posture
- treat MAP-01 as a separate, explicitly scoped effort
- run `bash scripts/report-ui-shell-hotspots.sh` before/after major shell or map changes and update this file in the same PR
