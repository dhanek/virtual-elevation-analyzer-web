## ISSUES FOUND

**Phase:** 02-shell-infrastructure-and-delegation
**Plans checked:** 3
**Issues:** 2 blocker(s), 2 warning(s), 0 info

---

### Dimension 1: Requirement Coverage — ✅ PASS

| Requirement | Plans | Tasks | Status |
|-------------|-------|-------|--------|
| SHEL-01 (delegate top-level orchestration through explicit shell modules) | 02, 03 | 02-Task1, 02-Task2, 03-Task1, 03-Task2 | COVERED |
| SHEL-02 (shared DOM, event, and template helpers for repeated patterns) | 01 | 01-Task1, 01-Task2, 01-Task3 | COVERED |

**Analysis:**
- **SHEL-02** is fully addressed by Plan 01: Task 1 creates typed DOM lookup + selectable card helpers, Task 2 creates tab switching + range-number sync + wind-source + action-footer helpers, Task 3 validates integration with main.ts. All five repeated patterns identified in RESEARCH.md (checkbox-card duplication, VE tab switching x3, slider/number sync, wind-source binding, action-footer binding) have corresponding helper modules.
- **SHEL-01** is addressed by Plans 02 and 03: Plan 02 creates the delegation interfaces (ShellServices, ShellAnalysisContext), the pure payload-preparation function (prepareAnalysisPayload), and named render delegate factories (createModeRenderCallbacks). Plan 03 rewires main.ts to actually use these delegates, making handleAnalyze a composition-root caller instead of an implementation owner.

**Phase Success Criteria coverage:**
1. "Repeated DOM, event, and template patterns have a shared home" → Plan 01 ✓
2. "main.ts delegates top-level shell responsibilities through explicit module seams" → Plan 03 ✓
3. "AppState remains state-only" → All plans explicitly enforce this ✓

**No gaps found.**

---

### Dimension 2: Task Completeness — ✅ PASS

| Plan | Task | Files | Read First | Action | Verify/Automated | Acceptance Criteria | Done | Status |
|------|------|-------|------------|--------|------------------|--------------------|----|--------|
| 01 | 1 | ✓ | ✓ | ✓ (concrete) | ✓ | ✓ | ✓ | Valid |
| 01 | 2 | ✓ | ✓ | ✓ (concrete) | ✓ | ✓ | ✓ | Valid |
| 01 | 3 | ✓ | ✓ | ✓ (concrete) | ✓ | ✓ | ✓ | Valid |
| 02 | 1 | ✓ | ✓ | ✓ (concrete) | ✓ | ✓ | ✓ | Valid |
| 02 | 2 | ✓ | ✓ | ✓ (concrete) | ✓ | ✓ | ✓ | Valid |
| 03 | 1 | ✓ | ✓ | ✓ (concrete) | ✓ | ✓ | ✓ | Valid |
| 03 | 2 | ✓ | ✓ | ✓ (concrete) | ✓ | ✓ | ✓ | Valid |

**Action specificity check:**
- Plan 01 Task 1: Names exact functions (getElement, getRequiredElement, renderSelectableCards, bindSelectableCardEvents), specifies export signatures, describes DOM structure to replicate, names CSS classes. **Concrete.**
- Plan 01 Task 2: Names exact functions (setupTabSwitching, syncRangeAndNumber, getSelectedWindSource, bindWindSourceRadios, bindActionFooter), specifies interfaces (TabRenderMap, RangeNumberPairOptions, ActionFooterCallbacks), describes exact DOM patterns to replace. **Concrete.**
- Plan 01 Task 3: Specific integration smoke test — add imports, run check/lint/test/build. **Concrete.**
- Plan 02 Task 1: Names exact interfaces (ShellServices, ShellAnalysisContext, PayloadPreparationInput, PreparedPayload), specifies exact function signature for prepareAnalysisPayload with 7-step logic, lists specific imports. **Concrete.**
- Plan 02 Task 2: Names exact delegate factory functions (createStandardRenderDelegate, createGpsLapRenderDelegate, createOutAndBackRenderDelegate, createModeRenderCallbacks), specifies wrapping pattern. **Concrete.**
- Plan 03 Task 1: Specifies renderSection3Template function with exact input interface, describes how to modify initializeSection3, specifies which lines to replace. **Concrete.**
- Plan 03 Task 2: Seven-point rewiring plan with exact code snippets showing the replacement patterns for each function. Specifies removal of setupGpsLapTabSwitching and setupOutAndBackTabSwitching. **Concrete.**

**All actions are specific with named functions, files, imports, and replacement targets. No vague "implement X" tasks found.**

---

### Dimension 3: Dependency Correctness — ❌ FAIL (1 blocker)

| Plan | Wave | depends_on | Expected Wave | Status |
|------|------|------------|---------------|--------|
| 01 | 1 | [] | 1 | ✅ Valid |
| 02 | 2 | ["01"] | 2 | ✅ Valid |
| 03 | 2 | ["01"] | **3** | ❌ Invalid |

**BLOCKER: Plan 03 missing dependency on Plan 02**

Plan 03 (Task 2) explicitly imports and uses artifacts created by Plan 02:
- `import { prepareAnalysisPayload } from './shell/analysis/prepareAnalysisPayload'` — created by Plan 02 Task 1
- `import { createModeRenderCallbacks } from './shell/analysis/renderDelegates'` — created by Plan 02 Task 2

The action text confirms this: "Replace the inline callbacks construction with: `const callbacks = createModeRenderCallbacks(...)`" and "replace the inline payload preparation with: `const payload = prepareAnalysisPayload(...)`"

Yet Plan 03's `depends_on` is only `["01"]`. It must be `["01", "02"]`.

Furthermore, with depends_on: ["01", "02"] and Plan 02 being Wave 2, Plan 03 must be **Wave 3**, not Wave 2.

**No circular dependencies detected. All other references are valid.**

---

### Dimension 4: Key Links — ✅ PASS

**Plan 01 Key Links:**
| From | To | Via | Planned in Task Action |
|------|----|-----|------------------------|
| selectableCards.ts | DOM checkbox-card pattern | renderSelectableCards + bindSelectableCardEvents | Task 1 ✓ |
| tabs.ts | .ve-tab-button/.ve-tab-content pattern | setupTabSwitching | Task 2 ✓ |
| rangeNumberPair.ts | range + number input pattern | syncRangeAndNumber | Task 2 ✓ |

**Plan 02 Key Links:**
| From | To | Via | Planned in Task Action |
|------|----|-----|------------------------|
| prepareAnalysisPayload.ts | WindSourceResolver.ts | resolveWindSeries import | Task 1 ✓ |
| prepareAnalysisPayload.ts | AnalysisModes.ts | collectSelectionIndices import | Task 1 ✓ |
| renderDelegates.ts | modes/analysis/types.ts | ModeRenderCallbacks interface | Task 2 ✓ |

**Plan 03 Key Links:**
| From | To | Via | Planned in Task Action |
|------|----|-----|------------------------|
| section3/renderSection3Template.ts | dom/selectableCards.ts | renderSelectableCards import | Task 1 ✓ |
| main.ts | dom/tabs.ts | setupTabSwitching replacing 3 inline blocks | Task 2 ✓ |
| main.ts | dom/windSource.ts | getSelectedWindSource replacing 13 queries | Task 2 ✓ |
| main.ts | dom/actionFooter.ts | bindActionFooter replacing 3 blocks | Task 2 ✓ |
| main.ts | analysis/prepareAnalysisPayload.ts | prepareAnalysisPayload replacing inline prep | Task 2 ✓ |
| main.ts | analysis/renderDelegates.ts | createModeRenderCallbacks replacing inline callbacks | Task 2 ✓ |

**All key links have explicit wiring in task actions. No isolated artifacts found.**

---

### Dimension 5: Scope Sanity — ✅ PASS (1 warning)

| Plan | Tasks | Files Modified | Complexity | Status |
|------|-------|----------------|------------|--------|
| 01 | 3 | 11 | Medium — all new files, no existing code changes except Task 3 (import lines only) | ✅ |
| 02 | 2 | 5 | Low — all new files, no existing code changes | ✅ |
| 03 | 2 | 4 | **High** — modifies main.ts, the most complex file in the project | ⚠️ Warning |

**Plan 03 Scope Assessment:**
- Task 1 modifies main.ts (initializeSection3) + creates 3 new section3 files → reasonable
- Task 2 modifies main.ts extensively (handleAnalyze, 3 tab functions, 3 wind-source blocks, 3 action-footer blocks, 13 wind-source queries) → this is a large surface area to touch in one task

**WARNING: Plan 03 Task 2 has high blast radius.** It modifies ~8 distinct code regions in a 7600+ line file (handleAnalyze, setupGpsLapTabSwitching, setupOutAndBackTabSwitching, inline tab block near 4370, 3 wind-source blocks, 3 action-footer blocks, 13 wind-source queries). While the changes are mechanical (replace inline → delegate), the sheer number of touch points increases regression risk. The task's verify block runs the full guardrail pipeline, which is the correct safety net. Consider whether the executor should be more conservative and split into two tasks (handleAnalyze delegation first, then DOM helper rewiring).

---

### Dimension 6: Context Compliance — ✅ PASS

| Decision | Plans Covering | Compliance |
|----------|---------------|------------|
| D-01 (focus on infrastructure, not full extraction) | All three plans stay within scope | ✓ |
| D-02 (prioritize repeated DOM/event/template patterns) | Plan 01 targets all 5 repeated patterns | ✓ |
| D-03 (composition-root role) | Plans 02+03 extract delegation seams | ✓ |
| D-04 (flexible file/module split) | Plans specify goals but allow execution flexibility | ✓ |
| **D-05 (AppState state-only)** | **Explicitly enforced:** Plan 02 types.ts creates separate ShellServices; prepareAnalysisPayload is pure; Plan 01 helpers are DOM-only and stateless; Plan 03 syncs state from payload return values rather than mutating inside helpers | **✓** |
| D-06 (preserve analysis math) | No analysis math changes in any plan | ✓ |
| D-07 (MapVisualization secondary) | Not touched by any plan | ✓ |
| **D-08 (preserve regression behavior)** | **Explicitly enforced:** Plan 03 Task 2 has "CRITICAL BEHAVIOR PRESERVATION" section listing auto-scroll, GPS in-place updates, calibration; verify uses guardrail script | **✓** |
| D-09 (no behavior changes for convenience) | Plans explicitly state "preserve exact behavior" and "byte-identical output" | ✓ |
| D-10 (CI parity + guardrail script) | All tasks verify with check/lint/test/build + guardrails | ✓ |
| **D-11 (function-oriented)** | **All helpers are exported functions, no classes:** getElement, getRequiredElement, renderSelectableCards, setupTabSwitching, syncRangeAndNumber, getSelectedWindSource, bindActionFooter, prepareAnalysisPayload, createModeRenderCallbacks | **✓** |

**No deferred ideas found in any plan:**
- No full Section 3 extraction (just template + lap binding, per D-01)
- No full GPS-lap/out-and-back extraction (just shared infrastructure)
- No MapVisualization decomposition
- No worker/offload/framework migration work

---

### Dimension 7: Nyquist Compliance — SKIPPED

VALIDATION.md exists but declares `nyquist_compliant: false`. The validation strategy uses standard Vitest unit tests + guardrail scripts rather than the Nyquist sampling framework. Per the workflow config, Nyquist compliance is not enforced when the validation doc explicitly opts out.

---

### Dimension 8: CLAUDE.md Compliance — SKIPPED

No `CLAUDE.md` found at project root.

---

### Dimension 9: Cross-Plan Data Contracts — ✅ PASS

**Shared data flows:**
1. **Plan 01 → Plan 03:** Plan 03 imports shell/dom helpers (setupTabSwitching, getSelectedWindSource, bindWindSourceRadios, bindActionFooter, syncRangeAndNumber). These are simple function calls — no data transformation conflict possible.
2. **Plan 02 → Plan 03:** Plan 03 imports prepareAnalysisPayload (returns PreparedPayload) and createModeRenderCallbacks (returns ModeRenderCallbacks). Plan 03 consumes the output directly — no re-transformation, no conflicting assumptions.
3. **Plan 01 → Plan 03 (via section3):** Plan 03 Task 1 imports renderSelectableCards from Plan 01's selectableCards.ts to use in renderSection3Template. The card items are simple data objects — no transform conflict.

**No conflicting transformations on shared data entities detected.**

---

### Blockers (must fix)

**1. [dependency_correctness] Plan 03 depends on Plan 02 artifacts but doesn't declare the dependency**
- Plan: 03
- Task: 2 (imports prepareAnalysisPayload and createModeRenderCallbacks from Plan 02)
- Current: `depends_on: ["01"]`, `wave: 2`
- Fix: Change to `depends_on: ["01", "02"]` and `wave: 3`

**2. [dependency_correctness] Plan 03 wave number inconsistent with corrected dependency**
- Plan: 03
- Current: Wave 2
- Expected: Wave 3 (depends on Plan 02 which is Wave 2)
- Fix: Change `wave: 2` to `wave: 3`

---

### Warnings (should fix)

**1. [scope_sanity] Plan 03 Task 2 has high blast radius in main.ts**
- Plan: 03, Task: 2
- Touches ~8 distinct code regions in a 7600+ line file
- The verify block uses the full guardrail pipeline, which is appropriate
- Consider whether the executor needs a hint to be extra conservative and make one change at a time with intermediate verification

**2. [scope_sanity] Plan 01 Task 2 creates 7 files in one task**
- Plan: 01, Task: 2
- Creates tabs.ts, rangeNumberPair.ts, windSource.ts, actionFooter.ts, tabs.test.ts, rangeNumberPair.test.ts, and index.ts
- All are small focused modules with clear interfaces, so this is borderline acceptable
- The 11 total files for Plan 01 is above the 5-8 target but below the 15+ blocker threshold

---

### Structured Issues

```yaml
issues:
  - plan: "02-03"
    dimension: dependency_correctness
    severity: blocker
    description: "Plan 03 imports prepareAnalysisPayload and createModeRenderCallbacks from Plan 02 but depends_on only lists [\"01\"]. Missing dependency on Plan 02."
    task: 2
    fix_hint: "Change depends_on from [\"01\"] to [\"01\", \"02\"] and wave from 2 to 3"
  - plan: "02-03"
    dimension: dependency_correctness
    severity: blocker
    description: "Plan 03 wave is 2 but depends on Plan 02 (wave 2), so it must be wave 3"
    fix_hint: "Change wave: 2 to wave: 3 in Plan 03 frontmatter"
  - plan: "02-03"
    dimension: scope_sanity
    severity: warning
    description: "Task 2 modifies ~8 distinct regions in 7600-line main.ts (handleAnalyze, 3 tab functions, 3 wind-source blocks, 3 action-footer blocks, 13 wind queries). High regression risk surface."
    task: 2
    fix_hint: "Consider adding a note in the task action to apply changes one region at a time with intermediate check/lint/test verification, or split into two tasks (handleAnalyze delegation + DOM helper rewiring)"
  - plan: "02-01"
    dimension: scope_sanity
    severity: warning
    description: "Task 2 creates 7 files in one task (4 helper modules + 2 test files + 1 barrel). Above the 5-8 files-per-plan target but not blocking."
    task: 2
    fix_hint: "Acceptable given all files are small focused modules with clear interfaces. No action required."
```

---

### Recommendation

**2 blocker(s) require revision before execution.**

The blockers are both in Plan 03's dependency declaration:
1. Add `"02"` to Plan 03's `depends_on` array
2. Change Plan 03's `wave` from `2` to `3`

These are mechanical frontmatter fixes — no task content, actions, or artifacts need to change. The plans themselves are well-structured with concrete actions, specific file targets, and comprehensive verification. Once the dependency and wave corrections are applied, the plans are ready for execution.

Returning to planner with feedback.

---

*Plan check completed: 2026-04-14*
*Verifier: gsd-plan-checker*
