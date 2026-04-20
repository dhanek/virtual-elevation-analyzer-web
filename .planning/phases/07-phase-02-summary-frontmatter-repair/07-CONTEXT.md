# Phase 7: Phase-02 Summary Frontmatter Repair - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 7 repairs Phase-02 summary metadata so SHEL-01 and SHEL-02 close cleanly in the milestone’s 3-source requirement matrix. Scope is limited to frontmatter/schema consistency and requirement metadata fidelity for existing Phase-02 artifacts. This phase does not add frontend capabilities or change behavior.

</domain>

<decisions>
## Implementation Decisions

### Frontmatter key strategy
- **D-01:** Use `requirements-completed` as the canonical summary frontmatter key.
- **D-02:** Do not switch to underscore-only keying (`requirements_completed`) for this phase.
- **D-03:** Do not dual-write both key variants in the same summary file; keep one canonical key to avoid drift.

### Repair depth and normalization
- **D-04:** Normalize frontmatter across all three Phase-02 summaries (`02-01`, `02-02`, `02-03`) so each has a single valid YAML frontmatter block parseable by tooling.
- **D-05:** Preserve body prose/content; this phase is metadata/schema repair, not narrative rewrite.
- **D-06:** Keep frontmatter schema/style consistent with established project summary patterns while preserving existing factual metadata.

### Requirement mapping for Phase-02 summaries
- **D-07:** `02-01-SUMMARY.md` must declare `requirements-completed: [SHEL-02]`.
- **D-08:** `02-02-SUMMARY.md` must declare `requirements-completed: [SHEL-01]`.
- **D-09:** `02-03-SUMMARY.md` must declare `requirements-completed: [SHEL-01]`.
- **D-10:** Requirement IDs must remain token-exact (`SHEL-01`, `SHEL-02`) with no format drift.

### Closure verification gate
- **D-11:** Phase closure requires tooling verification, not manual-only inspection.
- **D-12:** Required check: `pi-gsd-tools summary-extract <summary> --fields requirements_completed --pick requirements_completed --raw` returns expected IDs for all three Phase-02 summaries.
- **D-13:** Required check: focused requirement-matrix sanity check confirms SHEL-01/SHEL-02 are no longer partial due to missing summary metadata.
- **D-14:** Full milestone re-audit is not required inside this phase’s minimum closure gate.

### the agent's Discretion
- Exact YAML field ordering and formatting while normalizing frontmatter.
- Whether to apply minimal additional hygiene (e.g., quote style normalization) if it does not alter meaning.
- Exact command form for the focused matrix sanity check, as long as it is machine-verifiable and tied to SHEL-01/SHEL-02.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirement traceability
- `.planning/ROADMAP.md` - Phase 7 goal, success criteria, plan slots (07-01..07-03), and canonical phase references.
- `.planning/REQUIREMENTS.md` - SHEL-01/SHEL-02 definitions and traceability expectations.
- `.planning/v1.0-v1.0-MILESTONE-AUDIT.md` - source of the partial-status gap and required 3-source closure rationale.

### Phase-02 artifacts to repair/align
- `.planning/phases/02-shell-infrastructure-and-delegation/02-01-SUMMARY.md` - summary frontmatter requiring normalization + SHEL-02 backfill.
- `.planning/phases/02-shell-infrastructure-and-delegation/02-02-SUMMARY.md` - summary frontmatter requiring SHEL-01 metadata confirmation.
- `.planning/phases/02-shell-infrastructure-and-delegation/02-03-SUMMARY.md` - summary frontmatter requiring SHEL-01 metadata confirmation.
- `.planning/phases/02-shell-infrastructure-and-delegation/02-VERIFICATION.md` - verification source establishing SHEL-01/SHEL-02 passed status.
- `.planning/phases/02-shell-infrastructure-and-delegation/02-01-PLAN.md` - plan-level requirement claim context for SHEL-02.
- `.planning/phases/02-shell-infrastructure-and-delegation/02-02-PLAN.md` - plan-level requirement claim context for SHEL-01.
- `.planning/phases/02-shell-infrastructure-and-delegation/02-03-PLAN.md` - plan-level requirement claim context for SHEL-01.

### Audit/tooling behavior reference
- `.pi/gsd/workflows/audit-milestone.md` - 3-source matrix logic and `summary-extract` dependency used by milestone audits.
- `.planning/phases/01-guardrails-and-regression-protection/01-01-SUMMARY.md` - known-good summary frontmatter shape including `requirements-completed` usage.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `pi-gsd-tools summary-extract` command provides machine-verifiable extraction of summary requirement metadata.
- Existing Phase-02 plans and Phase-02 verification report provide authoritative requirement-to-plan mapping for SHEL-01/SHEL-02.
- Phase-01 summary file provides a valid reference frontmatter shape for `requirements-completed` keying.

### Established Patterns
- Summary files are expected to expose requirement closure through frontmatter list fields consumed by audits.
- Requirement IDs in verification artifacts and matrices are token-exact and case-sensitive.
- Milestone audit logic treats summary metadata as a mandatory source in the 3-source closure matrix.

### Integration Points
- Changes land in `.planning/phases/02-shell-infrastructure-and-delegation/*-SUMMARY.md` and are consumed by milestone audit workflows.
- The Phase 7 result is validated through `summary-extract` output plus matrix-level SHEL-01/SHEL-02 sanity checks.

</code_context>

<specifics>
## Specific Ideas

- Keep scope tight: this is a metadata closure phase, not a feature/UI phase.
- Prefer one canonical key (`requirements-completed`) over compatibility dual-key writes.
- Normalize all three Phase-02 summaries in one pass to avoid parser edge cases and mixed schema quality.

</specifics>

<deferred>
## Deferred Ideas

### Reviewed Todos (not folded)
- `2026-04-19-unify-mode-calculation-and-plot-update-pipeline.md` — deferred as out of scope; this is UI/analysis pipeline behavior work, not Phase-07 metadata repair.
- `2026-04-13-move-gps-mode-selection-to-section-3-lap-selection.md` — deferred as out of scope; this is a UX/flow capability change, not requirement-matrix backfill.
- `2026-04-13-check-elevation-smoothing-strategy.md` — deferred as out of scope; this is analysis behavior evaluation, not summary frontmatter repair.

</deferred>

---

*Phase: 07-phase-02-summary-frontmatter-repair*
*Context gathered: 2026-04-20*
