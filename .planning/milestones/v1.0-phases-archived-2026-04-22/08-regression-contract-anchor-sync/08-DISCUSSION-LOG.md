# Phase 8: Regression Contract Anchor Sync - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 08-regression-contract-anchor-sync
**Areas discussed:** Update Strategy, Checklist Organization, Guardrail Sync, Contract Architecture

---

## Update Strategy

| Option     | Description                        | Selected |
| ---------- | ---------------------------------- | -------- |
| Find-and-Replace | Simple swap of `main.ts` for new file paths |          |
| Guided Tour | Descriptive re-anchoring with context on why ownership moved | ✓        |

**User's choice:** Guided Tour
**Notes:** User wants to provide a a "Guided Tour" approach rather than simple replacements.

---

## Checklist Organization

| Option     | Description                        | Selected |
| ---------- | ---------------------------------- | -------- |
| Flat List | Maintain a broad "UI-shell" perspective |          |
| Organized | Grouped by new shell modules (File Load, Analysis, etc.) | ✓        |

**User's choice:** Organize by module
**Notes:** User preferred organizing the checklist to match the modular structure.

---

## Guardrail Sync

| Option     | Description                        | Selected |
| ---------- | ---------------------------------- | -------- |
| Minimal | Update only critical paths |          |
| Full Sync | Update all internal references and docs for `validate-ui-shell-guardrails.sh` | ✓        |

**User's choice:** Full Sync
**Notes:** User confirmed "yeah" to updating guardrail references.

---

## Contract Architecture

| Option     | Description                        | Selected |
| ---------- | ---------------------------------- | -------- |
| Mirror Phase 1 | Keep the original layout from the first phase |          |
| Evolve | Create a new structure representing the new project structure | ✓        |

**User's choice:** New structure representing project structure
**Notes:** User believes we should create a new structure that reflects the modularized state of the project.

---

## the agent's Discretion

- Exact phrasing of the "Guided Tour" notes.
- Final layout of the reorganized checklist sections.
- Formatting of the redesigned contract document.

## Deferred Ideas

- **UI-Related Todos**: Functional changes (e.g., GPS mode selection move) deferred to v2.
