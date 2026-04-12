# Refactoring Checklist

Based on the revised refactoring plan validated against the current codebase.

| Step | Status | Summary | Notes |
|---|---|---|---|
| 5 | ✅ Done | Introduce typed `AppState` + unified `LoadedActivity` model | Added `frontend/src/state/AppState.ts`, moved frontend state behind `appState`, added `LoadedActivity`, `ActivityData`, `SelectedSlice`, and normalized CSV activity loading. |
| 6 | ⬜ Not started | Extract `ActivityLoader`, `WindSourceResolver`, and `SegmentExtractor` | Loader and slicing logic still mostly live in `frontend/src/main.ts`. |
| 7 | ⬜ Not started | Extract `AnalysisInput` / `PlotContext` + pure plot modules | Plotting and VE orchestration are still interleaved in `frontend/src/main.ts`. |
| 8 | ⬜ Not started | Replace mode branching with mode modules (`standard`, `gpsLap`, `outAndBack`) | `handleAnalyze()` still branches heavily by mode. |
| 9 | ⬜ Not started | Cache normalized arrays and centralize VE calculator creation | Calculator wiring is still duplicated across several paths. |
| 10 | ⬜ Not started | Collapse backend VE duplication in `backend/src/virtual_elevation.rs` | Backend refactor. |
| 11 | ⬜ Not started | Implement or hide empty GPS-lap and out-and-back wind / power / VD tabs | Placeholder plots still exist. |
| 12 | ⬜ Not started | Add a frontend lint + test baseline | No dedicated lint/test baseline added yet. |
| 13 | ⬜ Not started | Introduce a leveled `log.ts` and remove raw debug spam | Frontend still uses raw `console.*`. |
| 14 | ⬜ Not started | Simplify the misleading security layer | Validation/runtime CSP cleanup still pending. |
| 15 | ⬜ Not started | Split `backend/src/dem_processor.rs` into focused modules | Backend refactor. |
| 16 | ⬜ Not started | Move CSS out of `frontend/index.html` | Large inline stylesheet still present. |
| 17 | ⬜ Not started | Split and modernize the docs | Doc drift cleanup still pending. |
| 18 | ⬜ Not started | Replace magic numbers with named, local constants | Still pending. |
| 19 | ⬜ Not started | Remove lifecycle guard flags and write-only globals once mode lifecycle is encapsulated | Depends on steps 7–8. |
| 20 | ⬜ Not started | Profile slider recompute; only then add a Web Worker if it is still needed | Intentionally deferred until after cleanup/profiling. |
