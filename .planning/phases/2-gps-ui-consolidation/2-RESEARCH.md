# Phase 2: GPS UI Consolidation - Research

**Phase:** 2
**Goal:** Move GPS analysis mode selector from Analysis Parameters into Section 3 near lap-selection UI; ensure state synchronization.
**Requirements:** GPS-01, GPS-02

---

## What I Need to Know to Plan This Phase

### Current State Location

**`auto_lap_detection` lives in two places:**

1. **Interface Definition** (`AnalysisParameters.ts` lines 12-17):
   ```typescript
   auto_lap_detection: 'None' | 'GPS based lap splitting' | 'GPS based out and back' | 'GPS gate one way';
   ```

2. **Usage in `section3Orchestration.ts`**:
   - Line 200: `deps.appState.currentParameters?.auto_lap_detection` - reads current mode
   - Line 206: Used to determine `detectionMode` for `runGpsLapDetection()`
   - Line 396, 450: Read to check if GPS mode is active
   - Line 494: `lapDetectionMode` used for panel visibility decisions

### State Flow Pattern

```
AnalysisParameters Component (Section 2)
    │
    ├── user changes auto_lap_detection dropdown
    │
    ├── handleParameterChange() fires
    │
    ├── this.onParametersChange(this.parameters) callback
    │
    ├── main.ts receives updated parameters
    │
    └── appState.currentParameters.updated
            │
            ├── Section 3 reads: deps.appState.currentParameters?.auto_lap_detection
            │
            ├── Panel visibility: showGpsLapDetection / showOutAndBack
            │
            └── Detection logic: detectionMode passed to runGpsLapDetection()
```

### Where UI State is Needed

**In `section3Orchestration.ts`:**
- `updateGpsMarkerButtonState()` - lines 447-474 (shows/hides GPS gate slider)
- `updateOutAndBackButtonState()` - lines 418-446 (shows/hides OAB gate slider)
- `runGpsLapDetection()` - line 200 (mode for detection algorithm)
- `initializeSection3()` - lines 493-497 (initial panel visibility)
- `updateSelectedLaps()` - lines 478-484 (trim control visibility)

**In `renderSection3Template.ts`:**
- Template receives `showGpsLapDetection` and `showOutAndBack` booleans
- These determine which panels render in the HTML

### Required Changes Summary

| File | Change |
|------|--------|
| `AnalysisParameters.ts` | Remove `auto_lap_detection` field from interface and DEFAULT_PARAMETERS |
| `renderSection3Template.ts` | Add GPS mode selector dropdown to template |
| `section3Orchestration.ts` | Add `gpsAnalysisMode` state; wire change handler |
| `bindLapSelection.ts` | Add event binding for new dropdown |
| `main.ts` | Remove any auto_lap_detection references (if any) |

### State Management Decision

**Decision D-04:** GPS mode state should live in **Section 3 shell module** (`section3Orchestration.ts`), NOT in AppState.

Rationale:
- State is UI-local to Section 3
- No other shell modules need this state
- AppState is meant for state-only, not DOM/service singletons (per CONVENTIONS.md)
- Section 3 already manages GPS detection logic

### Verification Approach

1. **Functional:** User opens Section 3, sees GPS mode dropdown at top, selects mode, panels appear/disappear correctly
2. **State sync:** Mode selection persists across lap selection changes, file refresh, and navigation
3. **Cleanup:** No `auto_lap_detection` references remain in Analysis Parameters UI

### Risks Identified

1. **State sync gap:** Any code that reads `currentParameters?.auto_lap_detection` will break after removal
   - Mitigation: Search entire codebase for this pattern before planning

2. **Default value:** Current default is `'None'` in DEFAULT_PARAMETERS
   - Need to ensure Section 3 initializes with `'None'` as well

3. **Mode persistence:** D-12 says no persistence - but UI may have existing localStorage
   - Mitigation: Verify no persistence code exists

---

## Files to Modify

| File | Purpose |
|------|---------|
| `frontend/src/components/AnalysisParameters.ts` | Remove auto_lap_detection field |
| `frontend/src/shell/section3/renderSection3Template.ts` | Add GPS mode dropdown HTML |
| `frontend/src/shell/section3/section3Orchestration.ts` | Add mode state + handlers |
| `frontend/src/shell/section3/bindLapSelection.ts` | Add dropdown event binding |
| `frontend/src/shell/app/initializeApplication.ts` | May need updates for state wiring |

---

## Implementation Order

1. **Add mode state to Section 3 orchestration** - before removing from Analysis Parameters
2. **Update template** - add dropdown matching existing `.param-item select` CSS
3. **Add event binding** - wire dropdown change to mode state update
4. **Remove from Analysis Parameters** - delete field + update handleParameterChange
5. **Update detection calls** - switch from `currentParameters?.auto_lap_detection` to local state
6. **Verify no orphans** - grep for any remaining references

---

*Research complete: 2026-04-23*
