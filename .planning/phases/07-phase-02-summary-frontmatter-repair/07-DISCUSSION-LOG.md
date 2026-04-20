# Phase 7: Phase-02 Summary Frontmatter Repair - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-04-20
**Phase:** 7-phase-02-summary-frontmatter-repair
**Areas discussed:** Frontmatter key format strategy, Repair depth per summary file, Exact requirement-to-summary mapping, Sanity-check gate for closure

---

## Frontmatter key format strategy

| Option | Description | Selected |
| ---------- | ---------------------------------- | -------- |
| Canonicalize on `requirements-completed` only | Match current extraction/audit behavior; single source of truth | ✓ |
| Use `requirements_completed` only | Requires downstream tool/path changes in this phase | |
| Dual-write both keys | Compatibility-first but risks key drift | |

**User's choice:** Canonicalize on `requirements-completed` only.
**Notes:** User selected the recommended option to keep tooling-compatible metadata for audit closure.

---

## Repair depth per summary file

| Option | Description | Selected |
| ---------- | ---------------------------------- | -------- |
| Metadata-only patch | Only backfill requirement metadata | |
| Normalize all three summaries | Single valid YAML frontmatter block + canonical key + consistent schema style | ✓ |
| Surgical normalize only broken file + backfill all | Minimal repair approach | |

**User's choice:** Normalize frontmatter for all three Phase-02 summaries.
**Notes:** User preferred consistent, one-pass normalization instead of partial fixes.

---

## Exact requirement-to-summary mapping

| Option | Description | Selected |
| ---------- | ---------------------------------- | -------- |
| Recommended mapping | `02-01 -> SHEL-02`, `02-02 -> SHEL-01`, `02-03 -> SHEL-01` | ✓ |
| Put both requirements on every summary | Broad attribution across all summary files | |
| Custom mapping | User-specified alternative | |

**User's choice:** Use recommended per-summary mapping.
**Notes:** Mapping aligns with Phase-02 plans and verification evidence.

---

## Sanity-check gate for closure

| Option | Description | Selected |
| ---------- | ---------------------------------- | -------- |
| Tooling gate only | `summary-extract` checks + focused SHEL-01/SHEL-02 matrix sanity check | ✓ |
| Tooling gate + full milestone re-audit now | Stronger but broader than this phase scope | |
| Manual inspection only | Non-machine-verifiable closure | |

**User's choice:** Tooling gate only.
**Notes:** User intentionally scoped closure criteria to machine-verifiable phase-local checks.

---

## the agent's Discretion

- YAML field ordering/style during normalization.
- Exact focused matrix sanity-check command form, provided it is machine-verifiable.

## Deferred Ideas

- Unify calculation and plot update pipeline across analysis modes (deferred; out of scope)
- Move GPS mode selection to section 3 lap selection (deferred; out of scope)
- Check elevation smoothing strategy (deferred; out of scope)
