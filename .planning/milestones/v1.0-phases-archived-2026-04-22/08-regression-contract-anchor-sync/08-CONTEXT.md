# Phase 8: Regression Contract Anchor Sync - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Re-anchor the UI-shell regression contract and manual verification checklist to the current modular shell ownership paths. This is a documentation-synchronization phase to ensure that the "truth" regarding behavior ownership matches the structural changes implemented in Phases 2-7. No functional code changes are scoped for this phase.

</domain>

<decisions>
## Implementation Decisions

### Documentation Update Style
- **D-01: Guided Tour Approach**: Updates to the regression contract will not be simple find-and-replace filename swaps. They will include brief context/notes explaining why specific behaviors now live in their respective shell modules (e.g., explaining the transition from `main.ts` to `shell/fileLoad.ts`).

### Checklist Organization
- **D-02: Module-Based Grouping**: The `ui-shell-manual-checklist.md` will be reorganized from a flat list into sections grouped by shell module (e.g., "File Load", "Analysis Orchestration", "GPS Behavior").

### Guardrail Script Alignment
- **D-03: Reference Sync**: All internal references, comments, and documentation associated with `scripts/validate-ui-shell-guardrails.sh` will be updated to reflect the new modular ownership paths.

### Contract Architecture
- **D-04: Structural Redesign**: The overall structure of the regression contract will be redesigned to mirror the new modular project architecture. Instead of following the Phase 1 layout, it will be reorganized to serve as a modular map of the current system.

### the agent's Discretion
- Exact phrasing of the "Guided Tour" notes.
- Final layout of the reorganized checklist sections.
- Formatting of the redesigned contract document.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Regression Docs (To be updated)
- `docs/testing/ui-shell-regression-contract.md` - The primary document defining the behavior anchors.
- `docs/testing/ui-shell-manual-checklist.md` - The manual verification path.
- `scripts/validate-ui-shell-guardrails.sh` - The CI-parity guardrail script.

### Project Structure
- `.planning/PROJECT.md` - Specifically the "Context" section describing the new shell modules under `frontend/src/shell/`.
</canonical_refs>

<code_context>
## Existing Code Insights

### Established Patterns
- **Shell Delegation**: Logic has been moved from `frontend/src/main.ts` to dedicated modules: `shell/app`, `shell/analysis`, `shell/fileLoad`, `shell/section3`, `shell/dem`, etc.
- **Regression-Sensitive Behaviors**: Specifically auto-scroll after load, tab/scroll preservation during GPS updates, and GPS-based air-speed calibration.

### Integration Points
- The documentation needs to point directly to the TypeScript files in `frontend/src/shell/` that now implement the logic previously anchored to `main.ts`.

</code_context>

<specifics>
## Specific Ideas

- The documentation should feel like a "map" of the new architecture, making it easy for a new maintainer to find which file controls which UI behavior.

</specifics>

<deferred>
## Deferred Ideas

- **UI-Related Todos**: Pending todos such as "Move GPS mode selection to section 3" were reviewed but deferred to v2 as they involve functional changes, whereas Phase 8 is strictly documentation sync.

</deferred>

---

*Phase: 08-regression-contract-anchor-sync*
*Context gathered: 2026-04-21*
