# Phase 4: GPS and Out-and-Back Shell Extraction - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-17
**Phase:** 04-gps-and-out-and-back-shell-extraction
**Areas discussed:** Module layout, Plot rendering home, Persistence helpers, In-place update seam

---

## Module layout

| Option | Description | Selected |
|--------|-------------|----------|
| Parallel per-mode (Recommended) | shell/gpsLap/ + shell/outAndBack/, each with render/bind/update/plot files. Mirrors Phase 3 shell/ve/ pattern. Thin shell/multiSegment/shared.ts if duplication emerges. | ✓ |
| Shared multi-segment base | shell/multiSegment/ owns both modes via mode-parameterized functions. Emphasizes mode similarity. | |
| Hybrid: thin per-mode + shared core | Per-mode entry points calling shared shell/multiSegment/ core. | |

**User's choice:** Parallel per-mode (Recommended)
**Notes:** None

### Follow-up: Shared extraction threshold

| Option | Description | Selected |
|--------|-------------|----------|
| Only exact duplicates | Extract to shared.ts only for verbatim duplicate functions. | |
| Similar shape too | Also extract functions with same structure but different details into shared parameterized versions. | |
| You decide | Executor's discretion based on what emerges during implementation. | ✓ |

**User's choice:** You decide
**Notes:** None

---

## Plot rendering home

| Option | Description | Selected |
|--------|-------------|----------|
| Co-located in shell/ (Recommended) | gpsLapPlots.ts inside shell/gpsLap/, outAndBackPlots.ts inside shell/outAndBack/. Keeps mode render + bind + plot together. plots/MultiSegmentPlotBuilders.ts keeps current small scope. | ✓ |
| Move to plots/ | Merge into plots/ directory. Separates plot layout from shell DOM wiring. | |
| You decide | Executor's judgment based on coupling. | |

**User's choice:** Co-located in shell/ (Recommended)
**Notes:** None

---

## Persistence helpers

| Option | Description | Selected |
|--------|-------------|----------|
| Grow analysis/MultiSegmentSettings.ts (Recommended) | Consolidate resolveMultiSegmentAnalysisParams, saveCurrentMultiSegmentSettings, saveMapTrimSettings, buildAutoCalibrationSegmentsFromRanges into existing file (42 → ~200 lines). Both shell modules import from analysis/. | ✓ |
| New shell/multiSegment/storage.ts | Keep persistence co-located with shell layer. analysis/ stays pure math/types. | |
| Split by concern | Analysis functions to analysis/, save functions to shell/. | |
| You decide | Executor's judgment based on import graph. | |

**User's choice:** Grow analysis/MultiSegmentSettings.ts (Recommended)
**Notes:** None

---

## In-place update seam

| Option | Description | Selected |
|--------|-------------|----------|
| Verbatim lift (Recommended) | Move updateGpsLapVEPlots and updateOutAndBackVEPlots as-is. Preserve exact tab/scroll save-restore code. No new abstraction. Duplication acceptable for BEHV-03 safety. | ✓ |
| Thin shared wrapper | Extract withTabPreservation(fn) helper. Reduces duplication but any bug affects both modes. | |
| You decide | Executor's judgment based on similarity after extraction. | |

**User's choice:** Verbatim lift (Recommended)
**Notes:** Correctness over DRY for the in-place update invariant.

### Follow-up: Validation depth for 04-03

| Option | Description | Selected |
|--------|-------------|----------|
| Current baseline is enough | Existing guardrail script + manual checklist + CI parity. No new test infrastructure. | |
| Add targeted unit tests | New tests for calibration param resolution round-trip and multi-segment settings save/load. | |
| You decide | Executor's choice based on what looks risky during extraction. | ✓ |

**User's choice:** You decide
**Notes:** None

---

## Claude's Discretion

- Exact file names and internal structure within shell/gpsLap/ and shell/outAndBack/
- Duplication threshold for shared extraction into shell/multiSegment/shared.ts
- Whether to add targeted unit tests for extracted persistence/calibration logic
- How to stage plans 04-01, 04-02, 04-03 for optimal risk reduction

## Deferred Ideas

None — discussion stayed within phase scope.
