# Phase 6: Verification Artifact Backfill (Phases 03-05) - Research

**Researched:** 2026-04-19  
**Domain:** Milestone traceability closure via phase-level verification artifacts  
**Confidence:** HIGH

<user_constraints>
## User Constraints

### Locked Decisions
No `06-CONTEXT.md` exists for this phase. Using the user prompt + roadmap as the active constraints:

- Objective: “Close milestone-blocking orphaned requirement gaps by creating missing phase verification artifacts and strengthening parity evidence where audit depth was partial.”
- Must address IDs: `SHEL-03`, `SHEL-04`, `BEHV-01`, `BEHV-02`, `SHEL-05`, `SHEL-06`, `BEHV-03`, `BEHV-04`, `CLOS-01`, `CLOS-02`.
- Output file must be: `.planning/phases/06-verification-artifact-backfill-phases-03-05/06-RESEARCH.md`.
- Include a `## Validation Architecture` section.
- Milestone-audit enforced lock: satisfy mandatory 3-source verification matrix using REQUIREMENTS + phase VERIFICATION tables + SUMMARY frontmatter.

### Claude's Discretion
- Define the most efficient artifact-production order (03 vs 04 vs 05 first).
- Define how much command rerun evidence is needed vs existing summary evidence reuse.
- Define exact template and evidence granularity for the new `03/04/05-VERIFICATION.md` files.

### Deferred Ideas (OUT OF SCOPE)
- New feature work, UI redesign, framework migration, broad backend refactor.
- Additional shell extraction/decomposition beyond verification backfill.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SHEL-03 | Maintainer can change Section 3 lap-selection and GPS-detection UI behavior without editing unrelated analysis-panel code in `frontend/src/main.ts` | Backfill `03-VERIFICATION.md` requirement table + evidence links to 03-01/03-02 outputs and guardrail status. |
| SHEL-04 | Maintainer can change standard VE panel shell behavior without editing unrelated GPS-lap or out-and-back shell code in `frontend/src/main.ts` | `03-VERIFICATION.md` must include shell-boundary evidence and wiring verification from existing plan/summary artifacts. |
| BEHV-01 | User still auto-scrolls to Analysis Parameters after successful FIT/CSV load | `03-VERIFICATION.md` must include explicit behavior-preservation evidence + command/manual references. |
| BEHV-02 | User can run standard VE analysis after shell extraction with unchanged visible behavior and outputs | Strengthen parity evidence depth (audit-flagged partial), then record in `03-VERIFICATION.md` with same quality as BEHV-03/04 flows. |
| SHEL-05 | Maintainer can change GPS-lap shell behavior without editing unrelated standard VE or out-and-back code in `main.ts` | `04-VERIFICATION.md` requirement coverage + link verification of extracted module boundaries. |
| SHEL-06 | Maintainer can change out-and-back shell behavior without editing unrelated standard VE or GPS-lap code in `main.ts` | `04-VERIFICATION.md` requirement coverage + evidence from 04-02 extraction and wiring checks. |
| BEHV-03 | User keeps active tab and scroll position during in-place GPS updates | `04-VERIFICATION.md` must include both automated and manual evidence for tab/scroll preservation. |
| BEHV-04 | User gets correct GPS-based air-speed calibration behavior across GPS/out-and-back modes | `04-VERIFICATION.md` must include calibration behavior proof and manual checklist approval references. |
| CLOS-01 | `main.ts` ends primarily as composition root and materially smaller than baseline | `05-VERIFICATION.md` must include composition-root structural proof and hotspot delta evidence. |
| CLOS-02 | Maintainer can understand shell boundaries/hotspots from updated docs at close | `05-VERIFICATION.md` must verify roadmap/requirements/state/docs synchronization artifacts. |
</phase_requirements>

## Summary

Phase 6 is a **traceability closure phase**, not a feature phase. The blocking issue is not missing implementation; it is missing/partial verification evidence under the milestone’s mandatory **3-source requirement closure rule**. The audit is explicit: requirements mapped to Phases 03-05 remain orphaned because `03-VERIFICATION.md`, `04-VERIFICATION.md`, and `05-VERIFICATION.md` do not exist, and BEHV-02 parity evidence depth is weaker than expected.

The fastest safe plan is to backfill verification artifacts using the existing Phase 01/02 verification report structure (frontmatter + Goal Achievement + Requirements Coverage + Metadata + Gaps Summary), then re-anchor each requirement ID to concrete evidence already present in 03/04/05 plans and summaries. BEHV-02 needs deeper parity evidence (not just a generic pass statement) to match the evidence quality standard already applied to other preserved behaviors.

Because this phase is documentation/verification-focused, no new runtime architecture or package adoption is required. Success depends on producing audit-parseable coverage tables and consistent requirement-ID traceability that can satisfy the milestone gate immediately.

**Primary recommendation:** Create `03-VERIFICATION.md`, `04-VERIFICATION.md`, and `05-VERIFICATION.md` first, using the 02-VERIFICATION template and explicit requirement coverage rows, then strengthen BEHV-02 parity evidence before re-running milestone audit checks.

## Standard Stack

### Core
| Library/Tool | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Phase verification report format (`*-VERIFICATION.md`) | Existing project pattern (Phase 01/02) | Canonical phase closure artifact | Audit expects this structure as source #2 in 3-source verification. |
| Requirement traceability table (`.planning/REQUIREMENTS.md`) | Current repo baseline | Source-of-truth ID mapping | Audit and roadmap use this as source #1 for closure. |
| Summary frontmatter (`requirements_completed`) | Existing project pattern | Completion declaration source | Used as source #3 in milestone matrix correlation. |

### Supporting
| Library/Tool | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `scripts/validate-ui-shell-guardrails.sh` | Repo script (current) | Regression guardrail execution entrypoint | When verification requires fresh CI/manual evidence references. |
| Vitest | `^3.2.4` (frontend manifest) | Frontend automated tests (`npm run test`) | Include in verification metadata when test evidence is cited. |
| Vite | `^8.0.7` (frontend manifest) | Build/tooling baseline | Include in metadata when build parity is cited. |
| TypeScript | `^6.0.2` (frontend manifest) | Typecheck baseline (`npm run check`) | Include in metadata for structural parity evidence. |
| Rust/Cargo test harness | cargo `1.90.0` env; Rust `1.90.0` env | Backend lib validation | Include when using full validation chain evidence. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Backfilling phase `*-VERIFICATION.md` files | Rely only on `*-SUMMARY.md` and plans | Fails mandatory 3-source policy; remains orphaned in audit. |
| Standardized verification tables | Free-form prose evidence notes | Hard to parse/re-audit; increases risk of repeat blocker. |

**Installation:**
```bash
# No new dependencies required for Phase 6.
# Use existing repo toolchain and scripts.
```

**Version verification:**
- No package additions are recommended for Phase 6.
- Versions used for evidence metadata are taken from current repo manifests (`frontend/package.json`) and local environment availability probes.

## Architecture Patterns

### Recommended Project Structure
```text
.planning/
└── phases/
    ├── 03-section-3-and-standard-ve-shell-extraction/
    │   ├── 03-01-PLAN.md
    │   ├── 03-02-PLAN.md
    │   ├── 03-03-PLAN.md
    │   ├── 03-01-SUMMARY.md
    │   ├── 03-02-SUMMARY.md
    │   ├── 03-03-SUMMARY.md
    │   └── 03-VERIFICATION.md   # create in Phase 6
    ├── 04-gps-and-out-and-back-shell-extraction/
    │   └── 04-VERIFICATION.md   # create in Phase 6
    └── 05-closeout-secondary-cleanup-and-roadmap-sync/
        └── 05-VERIFICATION.md   # create in Phase 6
```

### Pattern 1: 3-Source Requirement Closure Matrix
**What:** For each requirement ID, align three sources: REQUIREMENTS phase mapping, VERIFICATION coverage table, SUMMARY frontmatter completion markers.  
**When to use:** For every requirement in scope (all 10 IDs in this phase).  
**Example:**
```markdown
## Requirements Coverage
| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| SHEL-03 | ✓ SATISFIED | — |
| SHEL-04 | ✓ SATISFIED | — |
| BEHV-01 | ✓ SATISFIED | — |
| BEHV-02 | ✓ SATISFIED | Added parity evidence links + command/manual references |
```
Source: `.planning/phases/02-shell-infrastructure-and-delegation/02-VERIFICATION.md`

### Pattern 2: Evidence-First Verification Narrative
**What:** Use observable truths, required artifacts, link verification, and verification metadata instead of high-level claims.  
**When to use:** Every new `03/04/05-VERIFICATION.md`.  
**Example:**
```markdown
### Observable Truths
| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Phase artifacts exist and are substantive | ✓ VERIFIED | 03-01/02/03 plans + summaries |
| 2 | Requirement IDs are explicitly covered | ✓ VERIFIED | Requirements Coverage table |
```
Source: `.planning/phases/01-guardrails-and-regression-protection/01-VERIFICATION.md`

### Anti-Patterns to Avoid
- **Summary-only closure:** Declaring completion from summary files without `*-VERIFICATION.md` coverage tables.
- **ID drift:** Using inconsistent requirement IDs or omitting one of the 10 in-scope IDs.
- **Uneven evidence quality:** Keeping BEHV-02 proof at lower depth than BEHV-03/04.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Verification artifact format | New custom markdown schema | Existing 01/02 verification report structure | Already accepted by audit process and easier to re-validate. |
| Regression evidence chain | Ad-hoc command list in each doc | `scripts/validate-ui-shell-guardrails.sh` + documented CI chain | Keeps parity with project contract and reduces missed checks. |
| Requirement closure logic | Manual memory-based mapping | Explicit per-ID table + source links | Prevents orphaned requirements and audit ambiguity. |

**Key insight:** Phase 6 fails/succeeds on **traceability precision**, not code volume. Reuse the existing verification grammar and make every requirement row auditable.

## Common Pitfalls

### Pitfall 1: Missing `*-VERIFICATION.md` despite completed implementation
**What goes wrong:** Requirements remain orphaned even though plans/summaries show work completed.  
**Why it happens:** Audit requires the phase verification artifact as a mandatory source.  
**How to avoid:** Create 03/04/05 verification files before final audit pass.  
**Warning signs:** Milestone audit still labels requirements as `orphaned`/`unsatisfied`.

### Pitfall 2: BEHV-02 evidence stays “partial”
**What goes wrong:** Artifact exists but parity depth is insufficient for closure confidence.  
**Why it happens:** Evidence references are generic and not behavior-specific.  
**How to avoid:** Add explicit standard VE behavior parity proof with concrete commands/manual checklist anchors.  
**Warning signs:** Audit notes “partial parity evidence” or non-uniform behavioral proof quality.

### Pitfall 3: Non-parseable verification docs
**What goes wrong:** Re-audit cannot reliably correlate requirement status across artifacts.  
**Why it happens:** Free-form prose replaces tabular coverage sections.  
**How to avoid:** Keep the same section headings/tables used in 01/02 verification docs.  
**Warning signs:** Reviewer must infer closure from narrative text rather than direct table rows.

## Code Examples

Verified patterns from project sources:

### Verification coverage table pattern
```markdown
## Requirements Coverage
| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| SHEL-05 | ✓ SATISFIED | — |
| SHEL-06 | ✓ SATISFIED | — |
| BEHV-03 | ✓ SATISFIED | — |
| BEHV-04 | ✓ SATISFIED | — |

**Coverage:** 4/4 requirements satisfied
```
Source: `.planning/phases/02-shell-infrastructure-and-delegation/02-VERIFICATION.md` (table structure)

### Regression contract command chain
```bash
cd backend && cargo test --lib
cd backend && wasm-pack build --target web --out-dir ../frontend/pkg
cd frontend && npm run check
cd frontend && npm run lint
cd frontend && npm run test
cd frontend && npm run build
```
Source: `docs/testing/ui-shell-regression-contract.md`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Plan + Summary considered sufficient for closure | Mandatory 3-source closure (Requirements + Verification table + Summary frontmatter) | Enforced in milestone audit (`v1.0-v1.0-MILESTONE-AUDIT.md`) | Prevents false-positive completion and enforces auditable requirement closure. |
| Behavioral claims with uneven proof depth | Uniform, behavior-specific parity evidence expected across BEHV requirements | Formalized by audit gap note on BEHV-02 | Raises confidence and reduces regression-risk blind spots. |

**Deprecated/outdated:**
- “Summary-only closeout” is outdated for milestone acceptance; it does not satisfy the current verification gate.

## Open Questions

1. **How much fresh command rerun evidence is required vs historical evidence reuse?**
   - What we know: Existing summaries already record command outcomes for 03-05.
   - What's unclear: Whether milestone re-audit requires newly timestamped reruns for all chains.
   - Recommendation: Plan a minimum rerun set (`--ci-only` guardrails + targeted checks), and escalate to full chain only if reviewer requests.

2. **Where should strengthened BEHV-02 parity evidence live?**
   - What we know: Audit flags BEHV-02 depth as partial; roadmap requires elevation.
   - What's unclear: Whether to place all added detail in `03-VERIFICATION.md` only or cross-link additional appendix evidence.
   - Recommendation: Put canonical proof in `03-VERIFICATION.md` and cross-link any supporting artifacts for traceability.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| bash | Guardrail scripts / command orchestration | ✓ | GNU bash 3.2.57 | — |
| node | Frontend toolchain commands | ✓ | v22.20.0 | — |
| npm | `npm run check/lint/test/build` | ✓ | 10.9.3 | — |
| cargo | `cargo test --lib` evidence | ✓ | 1.90.0 | — |
| rustc | Cargo test toolchain | ✓ | 1.90.0 | — |
| wasm-pack | WASM build evidence command | ✓ | 0.13.1 | If missing, Phase 6 docs can still proceed; mark missing build evidence explicitly. |
| git | Evidence links/commit traceability | ✓ | 2.50.1 | — |
| jq | Optional JSON audit utilities | ✓ | 1.7.1 | Not required |

**Missing dependencies with no fallback:**
- None.

**Missing dependencies with fallback:**
- None in current environment.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest `^3.2.4` (frontend), Cargo lib tests (Rust built-in harness) |
| Config file | `frontend/vitest.config.ts` |
| Quick run command | `bash scripts/validate-ui-shell-guardrails.sh --ci-only` |
| Full suite command | `bash scripts/validate-ui-shell-guardrails.sh` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SHEL-03 | Section 3 shell boundary remains extracted and isolated | artifact + structural validation | `bash scripts/validate-ui-shell-guardrails.sh --ci-only` | ❌ Wave 0 (`03-VERIFICATION.md`) |
| SHEL-04 | Standard VE shell boundary remains isolated | artifact + structural validation | `bash scripts/validate-ui-shell-guardrails.sh --ci-only` | ❌ Wave 0 (`03-VERIFICATION.md`) |
| BEHV-01 | Auto-scroll behavior preserved evidence | regression + manual-reference validation | `bash scripts/validate-ui-shell-guardrails.sh` | ❌ Wave 0 (`03-VERIFICATION.md`) |
| BEHV-02 | Standard VE parity evidence depth (strengthened) | regression + parity evidence validation | `bash scripts/validate-ui-shell-guardrails.sh` | ❌ Wave 0 (`03-VERIFICATION.md`) |
| SHEL-05 | GPS-lap shell isolation remains intact | artifact + structural validation | `bash scripts/validate-ui-shell-guardrails.sh --ci-only` | ❌ Wave 0 (`04-VERIFICATION.md`) |
| SHEL-06 | Out-and-back shell isolation remains intact | artifact + structural validation | `bash scripts/validate-ui-shell-guardrails.sh --ci-only` | ❌ Wave 0 (`04-VERIFICATION.md`) |
| BEHV-03 | In-place tab/scroll preservation evidence | regression + manual-reference validation | `bash scripts/validate-ui-shell-guardrails.sh` | ❌ Wave 0 (`04-VERIFICATION.md`) |
| BEHV-04 | GPS calibration behavior evidence across modes | regression + manual-reference validation | `bash scripts/validate-ui-shell-guardrails.sh` | ❌ Wave 0 (`04-VERIFICATION.md`) |
| CLOS-01 | `main.ts` composition-root closeout proof | artifact + hotspot-report validation | `bash scripts/report-ui-shell-hotspots.sh` | ❌ Wave 0 (`05-VERIFICATION.md`) |
| CLOS-02 | Documentation closeout parity and traceability proof | artifact validation | `bash scripts/validate-ui-shell-guardrails.sh --ci-only` | ❌ Wave 0 (`05-VERIFICATION.md`) |

### Sampling Rate
- **Per task commit:** `bash scripts/validate-ui-shell-guardrails.sh --ci-only`
- **Per wave merge:** `bash scripts/validate-ui-shell-guardrails.sh`
- **Phase gate:** Full suite green + milestone audit shows no orphaned Phase 03-05 requirements.

### Wave 0 Gaps
- [ ] `.planning/phases/03-section-3-and-standard-ve-shell-extraction/03-VERIFICATION.md` — required for SHEL-03/SHEL-04/BEHV-01/BEHV-02 closure.
- [ ] `.planning/phases/04-gps-and-out-and-back-shell-extraction/04-VERIFICATION.md` — required for SHEL-05/SHEL-06/BEHV-03/BEHV-04 closure.
- [ ] `.planning/phases/05-closeout-secondary-cleanup-and-roadmap-sync/05-VERIFICATION.md` — required for CLOS-01/CLOS-02 closure.
- [ ] BEHV-02 parity-evidence subsection with command + manual checklist anchors at same quality level as BEHV-03/04.

## Sources

### Primary (HIGH confidence)
- `.planning/ROADMAP.md` — Phase 6 goal, requirement scope, and success criteria.
- `.planning/v1.0-v1.0-MILESTONE-AUDIT.md` — orphaned requirement findings, 3-source verification policy, and closure blockers.
- `.planning/REQUIREMENTS.md` — canonical requirement text and phase mapping.
- `.planning/phases/01-guardrails-and-regression-protection/01-VERIFICATION.md` — full verification artifact example.
- `.planning/phases/02-shell-infrastructure-and-delegation/02-VERIFICATION.md` — minimal verification artifact template.
- `docs/testing/ui-shell-regression-contract.md` — required validation command chain and manual-check requirement.
- Phase 03/04/05 plan+summary docs — implementation and prior evidence anchors.
- `GEMINI.md` — project conventions and non-regression constraints.
- `.planning/config.json` — `workflow.nyquist_validation: true`.

### Secondary (MEDIUM confidence)
- Local environment probe output (tool availability/version checks) executed in this workspace.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — based on existing in-repo artifact patterns and manifest/tooling definitions.
- Architecture: **HIGH** — directly derived from milestone audit closure policy and existing verification docs.
- Pitfalls: **HIGH** — explicitly documented by audit findings and prior phase outcomes.

**Research date:** 2026-04-19  
**Valid until:** 2026-05-19


---
**Output:** Write your findings to: /Users/hannes/Documents/git/virtual-elevation-analyzer-web/context.md
