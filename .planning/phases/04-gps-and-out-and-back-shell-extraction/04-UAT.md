---
status: complete
phase: 04-gps-and-out-and-back-shell-extraction
source: [04-01-SUMMARY.md, 04-02-SUMMARY.md, 04-03-SUMMARY.md]
started: 2026-04-18T18:24:30Z
updated: 2026-04-19T00:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running dev server, clear caches, start from scratch. App boots, initial UI renders, no startup errors.
result: pass

### 2. GPS-lap VE Analysis Renders
expected: Load an activity, select GPS-lap mode, trigger VE analysis. All four plots (VE profile, Wind, Power, Virtual Distance) render with data.
result: pass

### 3. Out-and-back VE Analysis Renders
expected: Load an activity, select Out-and-back mode, trigger VE analysis. All four plots (VE, Wind, Power, Virtual Distance) render with data.
result: pass

### 4. GPS-lap Tab & Scroll Preservation (BEHV-03)
expected: In GPS-lap mode, click the Wind tab, scroll the page down, then adjust CdA slider, Crr slider, and click Auto Adjust. After each action the Wind tab remains active and scroll position does not jump.
result: pass

### 5. Out-and-back Tab & Scroll Preservation (BEHV-03)
expected: In Out-and-back mode, click the Power tab, scroll down, then adjust a slider and click Auto Adjust. Power tab stays active and scroll position is stable.
result: pass

### 6. GPS-lap Auto Air-Speed Calibration (BEHV-04)
expected: In GPS-lap mode, click Auto Adjust. Calibration percentage updates to a non-zero value and plots refresh to reflect the new calibration.
result: pass

### 7. Out-and-back Auto Air-Speed Calibration (BEHV-04)
expected: In Out-and-back mode, click Auto Adjust. Calibration percentage updates to non-zero and plots refresh.
result: pass

### 8. Manual Calibration Re-run Updates Plots
expected: After auto calibration, manually change the calibration value and trigger a recalculation. Plots update to reflect the new manual calibration in both GPS-lap and Out-and-back modes.
result: pass

### 9. Per-Mode Settings Persist Across Mode Switches
expected: Adjust settings (e.g., CdA slider, calibration) in GPS-lap, switch to Out-and-back, adjust settings there, switch back to GPS-lap. GPS-lap settings are restored as last left. Same for Out-and-back when switching back.
result: pass

### 10. Screenshot Export (both modes)
expected: In GPS-lap and Out-and-back modes, trigger screenshot/export. A screenshot file is produced (downloaded or shown) containing the current VE plot view.
result: pass

## Summary

total: 10
passed: 10
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none — all tests passed]
