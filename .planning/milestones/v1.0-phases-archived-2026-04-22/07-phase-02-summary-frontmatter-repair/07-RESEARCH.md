# Phase 7: Phase-02 Summary Frontmatter Repair - Research

**Researched:** 2026-04-21
**Domain:** GSD summary frontmatter schema normalization and requirement-matrix metadata repair
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

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

### Claude's Discretion
- Exact YAML field ordering and formatting while normalizing frontmatter.
- Whether to apply minimal additional hygiene (e.g., quote style normalization) if it does not alter meaning.
- Exact command form for the focused matrix sanity check, as long as it is machine-verifiable and tied to SHEL-01/SHEL-02.

### Deferred Ideas (OUT OF SCOPE)
### Reviewed Todos (not folded)
- `2026-04-19-unify-mode-calculation-and-plot-update-pipeline.md` — deferred as out of scope; this is UI/analysis pipeline behavior work, not Phase-07 metadata repair.
- `2026-04-13-move-gps-mode-selection-to-section-3-lap-selection.md` — deferred as out of scope; this is a UX/flow capability change, not requirement-matrix backfill.
- `2026-04-13-check-elevation-smoothing-strategy.md` — deferred as out of scope; this is analysis behavior evaluation, not summary frontmatter repair.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SHEL-01 | Maintainer can delegate top-level UI-shell orchestration through explicit shell modules instead of embedding those responsibilities throughout `frontend/src/main.ts` | Phase-02 summaries 02-02 and 02-03 must expose `requirements-completed: [SHEL-01]` in parseable frontmatter so the 3-source matrix can mark existing implementation+verification evidence as satisfied. |
| SHEL-02 | Maintainer has shared DOM, event, and template helpers for repeated dynamic shell patterns instead of re-implementing the same wiring per panel | Phase-02 summary 02-01 must expose `requirements-completed: [SHEL-02]` in parseable frontmatter (and avoid parser traps) so the matrix can close SHEL-02 as satisfied. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

`CLAUDE.md` not found in repository root at research time. No additional project-level constraints were discovered from CLAUDE.md.

## Summary

Phase 7 is a documentation metadata repair phase, not a product/code behavior phase. The blocking gap is mechanical: milestone audits require a 3-source agreement (REQUIREMENTS traceability + phase VERIFICATION + SUMMARY frontmatter extraction). For SHEL-01 and SHEL-02, implementation and verification artifacts already pass; summary metadata extraction is what currently returns empty arrays.

Tooling inspection confirms `pi-gsd-tools summary-extract` expects **hyphenated frontmatter keys** (especially `requirements-completed`) but emits **underscore output fields** (e.g., `requirements_completed`). This means the phase should keep canonical hyphenated YAML keys and still verify with underscore output selectors exactly as specified by D-12.

The highest-risk pitfall is parser behavior around multiple `--- ... ---` blocks: `summary-extract` uses the **last** fenced block as frontmatter. In `02-01-SUMMARY.md`, a body-level `---` pair causes extraction to ignore the actual top frontmatter and return empty `requirements_completed`. Repair must ensure each summary has exactly one intended YAML frontmatter block and no competing body fence pair that can be misread as frontmatter.

**Primary recommendation:** Normalize all three Phase-02 summary frontmatters to one canonical, parser-safe shape with token-exact `requirements-completed` IDs, then verify via `summary-extract` and a focused SHEL-01/SHEL-02 matrix sanity check.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pi-gsd-tools` | 2.1.1 (npm latest, modified 2026-04-13) | Authoritative extraction of summary metadata (`summary-extract`) consumed by milestone audit workflow | This is the same CLI expected by `.pi/gsd/workflows/audit-milestone.md`; using anything else risks mismatch with audit behavior |
| `gsd-tools.cjs` frontmatter commands | repo-local wrapper (current workspace install) | Deterministic frontmatter get/validate operations for schema checks before final verification | Provides fast local schema confirmation (`frontmatter validate --schema summary`) without re-running full milestone audit |
| YAML frontmatter in `*-SUMMARY.md` | project schema | Source of `requirements-completed` evidence in 3-source matrix | Matrix closure depends on this exact artifact class |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js | v22.20.0 (installed) | Runtime for `pi-gsd-tools` and `gsd-tools.cjs` | Required for all command-based verification in this phase |
| npm | 10.9.3 (installed) | Package/runtime management for CLI tooling | Use only if CLI reinstall/update is needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `pi-gsd-tools summary-extract` | ad-hoc grep/yq scripts | Faster one-off, but does not guarantee parity with milestone audit extraction logic |
| `frontmatter validate` | manual frontmatter eyeballing | High false confidence; misses schema-required top-level keys and parser edge-cases |

**Installation:**
```bash
# No new phase dependency is required if tooling is already present.
# If needed, install/update the canonical extractor CLI:
npm install -g pi-gsd@2.1.1
```

**Version verification:**
```bash
npm view pi-gsd version
# 2.1.1
npm view pi-gsd time.modified
# 2026-04-13T20:21:06.865Z
```

## Architecture Patterns

### Recommended Project Structure
```text
.planning/phases/02-shell-infrastructure-and-delegation/
├── 02-01-SUMMARY.md   # Canonical frontmatter + SHEL-02 + parser-safe body separators
├── 02-02-SUMMARY.md   # Canonical frontmatter + SHEL-01
├── 02-03-SUMMARY.md   # Canonical frontmatter + SHEL-01
└── 02-VERIFICATION.md # Existing passed verification source for SHEL-01/SHEL-02
```

### Pattern 1: Single canonical frontmatter block only
**What:** Keep exactly one YAML frontmatter fence pair at file top for each summary.
**When to use:** Always for summary artifacts consumed by `summary-extract`.
**Example:**
```markdown
---
phase: 02-shell-infrastructure-and-delegation
plan: 01
subsystem: ui
tags: [dom, shell, helpers]
requirements-completed: [SHEL-02]
duration: 76min
completed: 2026-04-14
---
```
Source: `/Users/hannes/.nvm/versions/node/v22.20.0/lib/node_modules/pi-gsd/dist/pi-gsd-tools.js` (`le(...)` selects last `---...---` block)

### Pattern 2: Hyphenated input keys, underscore output selector
**What:** Write `requirements-completed` in YAML; verify with `requirements_completed` in command output field selection.
**When to use:** Every extraction command and milestone-audit-compatible check.
**Example:**
```bash
pi-gsd-tools summary-extract \
  .planning/phases/02-shell-infrastructure-and-delegation/02-02-SUMMARY.md \
  --fields requirements_completed \
  --pick requirements_completed \
  --raw
```
Source: `pi-gsd-tools` extractor code maps `o["requirements-completed"]` -> output `requirements_completed`.

### Pattern 3: Keep summary schema-required fields top-level
**What:** `duration` and `completed` must be top-level for `frontmatter validate --schema summary` to pass.
**When to use:** During normalization of 02-02/02-03 (currently nested under `metrics`).
**Example:**
```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" frontmatter validate \
  .planning/phases/02-shell-infrastructure-and-delegation/02-02-SUMMARY.md \
  --schema summary
```
Source: `$HOME/.claude/get-shit-done/bin/lib/frontmatter.cjs` (`summary.required = ['phase','plan','subsystem','tags','duration','completed']`).

### Anti-Patterns to Avoid
- **Body `---` pairs that form a second fenced block:** `summary-extract` reads the last block and can ignore real frontmatter.
- **Using `requirements_completed` as YAML key:** extractor ignores it; input must be `requirements-completed`.
- **Leaving SHEL IDs only in prose/body:** milestone audit reads frontmatter extraction, not narrative text.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Requirement metadata extraction | Custom regex/grep parser | `pi-gsd-tools summary-extract` | Guarantees behavior parity with milestone audit workflow |
| Frontmatter schema checks | Manual visual review | `gsd-tools.cjs frontmatter validate --schema summary` | Catches required-field placement issues quickly |
| Requirement matrix closure logic | Ad-hoc spreadsheet/manual reasoning | Focused 3-source check against REQUIREMENTS + 02-VERIFICATION + summary-extract outputs | Prevents false closure when one source is missing |

**Key insight:** The issue is not missing implementation; it is metadata parseability under the same toolchain that the audit uses.

## Common Pitfalls

### Pitfall 1: Hidden second frontmatter block in body
**What goes wrong:** Extraction reads body block instead of actual frontmatter, returning empty `requirements_completed`.
**Why it happens:** Parser selects the **last** `--- ... ---` block.
**How to avoid:** Ensure only one intended fence pair exists for frontmatter; replace body separators with `***` or section headings.
**Warning signs:** `summary-extract --raw` returns `requirements_completed: []` even though key appears in file.

### Pitfall 2: Key-shape mismatch (hyphen vs underscore)
**What goes wrong:** `requirements_completed` key in YAML is ignored by extractor.
**Why it happens:** Extractor reads `requirements-completed` from YAML, then outputs `requirements_completed` JSON.
**How to avoid:** Write hyphenated key in frontmatter, use underscore in `--fields/--pick` output selectors only.
**Warning signs:** `frontmatter get --field requirements-completed` works, but extract output still empty because parser is reading a different block or malformed schema.

### Pitfall 3: Nested metrics fields failing summary schema validation
**What goes wrong:** `frontmatter validate --schema summary` reports invalid due missing `duration`/`completed`.
**Why it happens:** `duration`/`completed` are nested under `metrics` instead of top-level.
**How to avoid:** Keep schema-required fields top-level; preserve nested metrics only if needed but do not omit top-level required keys.
**Warning signs:** Validation output lists `missing: ["duration", "completed"]`.

## Code Examples

Verified patterns from repo/tooling sources:

### Extract expected requirement IDs (closure gate)
```bash
for f in \
  .planning/phases/02-shell-infrastructure-and-delegation/02-01-SUMMARY.md \
  .planning/phases/02-shell-infrastructure-and-delegation/02-02-SUMMARY.md \
  .planning/phases/02-shell-infrastructure-and-delegation/02-03-SUMMARY.md
  do
    pi-gsd-tools summary-extract "$f" \
      --fields requirements_completed \
      --pick requirements_completed \
      --raw
  done
```
Source: `.pi/gsd/workflows/audit-milestone.md` + D-12 in `07-CONTEXT.md`

### Validate summary schema before extraction
```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" frontmatter validate \
  .planning/phases/02-shell-infrastructure-and-delegation/02-02-SUMMARY.md \
  --schema summary
```
Source: `$HOME/.claude/get-shit-done/bin/lib/frontmatter.cjs`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual closure interpretation from plans + verification prose | Mandatory 3-source matrix with machine extraction from summary frontmatter | Enforced in current milestone audit workflow (`audit-milestone.md`) | Requirement closure can remain partial unless summary metadata is parseable |
| Treating any `---` separators as harmless markdown | Parser-sensitive fenced block handling (last block wins in extractor) | Current `pi-gsd-tools` extractor implementation | Non-frontmatter body separators can silently break extraction |

**Deprecated/outdated:**
- Manual-only SHEL-01/SHEL-02 closure assertions without extractor output: outdated for this phase gate.

## Open Questions

1. **Focused matrix sanity command exact form**
   - What we know: D-13 requires machine-verifiable focused sanity check for SHEL-01/SHEL-02; D-14 says no full re-audit required.
   - What's unclear: Preferred single command for matrix sanity in this repository wrapper.
   - Recommendation: Use a short scripted check in plan 07-03 combining (a) three `summary-extract` outputs and (b) SHEL-01/SHEL-02 passed rows from `02-VERIFICATION.md` + presence in `.planning/REQUIREMENTS.md` traceability.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | `pi-gsd-tools`, `gsd-tools.cjs` commands | ✓ | v22.20.0 | — |
| npm | Tooling install/update | ✓ | 10.9.3 | — |
| `pi-gsd-tools` CLI | D-12 closure gate extraction | ✓ | 2.1.1 | Use `gsd-tools.cjs frontmatter get` + explicit manual compare (lower confidence) |

**Missing dependencies with no fallback:**
- None.

**Missing dependencies with fallback:**
- None.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | CLI-based documentation/schema validation (`pi-gsd-tools` + `gsd-tools.cjs`) |
| Config file | `.planning/config.json` (`workflow.nyquist_validation: true`) |
| Quick run command | `pi-gsd-tools summary-extract <summary> --fields requirements_completed --pick requirements_completed --raw` |
| Full suite command | Run extraction for all 3 summaries + `frontmatter validate --schema summary` on all 3 + focused SHEL-01/SHEL-02 matrix sanity check |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SHEL-01 | 02-02 and 02-03 summaries emit `SHEL-01` in `requirements_completed` extraction | smoke (doc metadata) | `pi-gsd-tools summary-extract .planning/phases/02-shell-infrastructure-and-delegation/02-02-SUMMARY.md --fields requirements_completed --pick requirements_completed --raw` and same for 02-03 | ✅ |
| SHEL-02 | 02-01 summary emits `SHEL-02` in `requirements_completed` extraction | smoke (doc metadata) | `pi-gsd-tools summary-extract .planning/phases/02-shell-infrastructure-and-delegation/02-01-SUMMARY.md --fields requirements_completed --pick requirements_completed --raw` | ✅ |

### Sampling Rate
- **Per task commit:** Re-run extraction command(s) for touched summary file(s).
- **Per wave merge:** Re-run extraction for all three Phase-02 summaries + summary schema validation.
- **Phase gate:** D-12 extraction outputs match expected IDs and D-13 focused matrix sanity check passes.

### Wave 0 Gaps
- [ ] Add a reusable script/snippet in Phase 07 plan for focused SHEL-01/SHEL-02 matrix sanity check (command form currently discretionary in context).

## Sources

### Primary (HIGH confidence)
- `.planning/phases/07-phase-02-summary-frontmatter-repair/07-CONTEXT.md` - locked decisions D-01..D-14 and phase boundaries.
- `.planning/REQUIREMENTS.md` - SHEL-01/SHEL-02 requirement definitions and traceability mapping to Phase 7.
- `.planning/ROADMAP.md` - Phase 7 goal/success criteria and required plan slots 07-01..07-03.
- `.planning/v1.0-v1.0-MILESTONE-AUDIT.md` - root cause of partial state (verification passed, summary metadata missing).
- `.pi/gsd/workflows/audit-milestone.md` - canonical `summary-extract` usage and 3-source status matrix rules.
- `/Users/hannes/.nvm/versions/node/v22.20.0/lib/node_modules/pi-gsd/dist/pi-gsd-tools.js` - authoritative extractor implementation (`requirements-completed` input, `requirements_completed` output, last frontmatter block behavior).
- `$HOME/.claude/get-shit-done/bin/lib/frontmatter.cjs` - summary schema required fields (`phase`, `plan`, `subsystem`, `tags`, `duration`, `completed`).
- `.planning/phases/02-shell-infrastructure-and-delegation/02-01-SUMMARY.md`, `02-02-SUMMARY.md`, `02-03-SUMMARY.md`, `02-VERIFICATION.md` - direct phase artifacts being repaired/verified.

### Secondary (MEDIUM confidence)
- Runtime command probes in local environment (`command -v`, `--version`, extraction/validation command outputs) captured during this research session.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - based on direct inspection of installed CLI versions and local command behavior.
- Architecture: HIGH - based on source-code inspection of extractor/parser and current artifact structures.
- Pitfalls: HIGH - confirmed by reproducible command outputs (including temp-file A/B checks for 02-01 separator behavior).

**Research date:** 2026-04-21
**Valid until:** 2026-05-21
