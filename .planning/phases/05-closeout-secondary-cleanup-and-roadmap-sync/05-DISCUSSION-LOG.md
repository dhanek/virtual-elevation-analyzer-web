# Phase 5: Closeout, Secondary Cleanup, and Roadmap Sync - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-19
**Phase:** 05-closeout-secondary-cleanup-and-roadmap-sync
**Areas discussed:** Residual extraction scope, MapVisualization.ts posture

---

## Residual extraction scope

| Option | Description | Selected |
|--------|-------------|----------|
| Aggressive — full composition root | `main.ts` reduced to imports, DI composition, bootstrap dispatch, and minimal shell wiring. | ✓ |
| Targeted — pull obvious buckets | Extract only highest-confidence residuals and keep more orchestration in `main.ts`. | |
| Minimal — stop after Section 3 residuals | Keep most residual buckets in place for a later phase. | |

**User's choice:** Aggressive — full composition root
**Notes:** Structural extraction focus, not behavior changes.

### Follow-up: Explicit residual buckets in scope

| Option | Description | Selected |
|--------|-------------|----------|
| Section 3 residuals | Detection/trim/lap-selection residuals move out of `main.ts`. | ✓ |
| File load orchestration | FIT/CSV orchestration and related Section 3 init helpers move out of `main.ts`. | ✓ |
| DEM + results display | DEM source/file handlers and results display helpers move out of `main.ts`. | ✓ |
| Formatters + small UI helpers | Formatters and small shell helpers move out of `main.ts`. | ✓ |

**User's choice:** Include all four buckets
**Notes:** Keep closeout extraction comprehensive within CLOS-01.

### Follow-up: Behavior adjustment policy

| Option | Description | Selected |
|--------|-------------|----------|
| Structural only | No behavior changes; any visible drift is treated as regression. | ✓ |
| Small fixes allowed | Allow small behavior tweaks during extraction. | |
| Document drift candidates now | Permit drift and record for later cleanup. | |

**User's choice:** Structural only
**Notes:** Preserve BEHV-01/02/03/04 verbatim.

### Follow-up: Reduction proof at checkpoint

| Option | Description | Selected |
|--------|-------------|----------|
| Refreshed hotspot report + guardrail + checklist | Use regenerated hotspot metrics, guardrail script, and manual checklist as closeout proof. | ✓ |
| Concrete size target in guardrail | Add hard numeric size ceiling to guardrail script. | |
| Structural assertion only | Qualitative assertion without refreshed metrics/checklist. | |

**User's choice:** Refreshed hotspot report + guardrail + checklist
**Notes:** Keep `main.ts` target qualitative (composition-root shape), not CI-enforced line ceiling.

---

## MapVisualization.ts posture

| Option | Description | Selected |
|--------|-------------|----------|
| No touches at all | Freeze `MapVisualization.ts` unless fully blocked. | |
| Interface narrowing only | Signatures/exports/callback seams only, no internal cleanup. | |
| Limited internal cleanup allowed | Allow minimal internal cleanup if bounded and behavior-neutral. | ✓ |

**User's choice:** Limited internal cleanup allowed
**Notes:** Only acceptable under closeout guardrails.

### Follow-up: What is allowed under “limited internal cleanup”

| Option | Description | Selected |
|--------|-------------|----------|
| Any small refactor under size cap | Permit standalone small map refactors if under a LOC threshold. | |
| Seam-required only | Internal cleanup allowed only when directly required by an extraction seam. | ✓ |
| One targeted internal extraction | Permit one small lifecycle/helper extraction. | |

**User's choice:** Seam-required only
**Notes:** No standalone map refactor work in Phase 5.

### Follow-up: Enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| Executor discretion only | Mention in summary without strict proof obligations. | |
| Mandatory traceability | Every map touch must name the forcing seam and show no-behavior-change validation evidence in `05-01-SUMMARY.md`. | ✓ |
| Checkpoint before each touch | Pause for user approval before each map change. | |

**User's choice:** Mandatory traceability
**Notes:** Keeps map touches auditable and secondary.

---

## Claude's Discretion

- Exact residual module/file split under `frontend/src/shell/` as long as `main.ts` ends as a thin composition root.
- Sequencing of 05-01 extraction buckets for lowest regression risk.
- Whether to regenerate `.planning/codebase/*.md` docs in 05-02 (only if materially stale).

## Deferred Ideas

- Move GPS mode selection to Section 3 lap selection
- Check elevation smoothing strategy
- Consider worker offload for multi-lap VE
- Evaluate continuous weather sampling
