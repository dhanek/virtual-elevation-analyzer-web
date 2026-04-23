# Phase 1: Pipeline Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-04-22
**Phase:** 01-pipeline-foundation
**Areas discussed:** Test strategy, Pipeline abstraction, Fix verification method

---

## Test Strategy

| Option | Description | Selected |
| ------ | ----------- | -------- |
| Add regression tests with known inputs/outputs | Document bug behavior, assert correct behavior | |
| Add integration tests for Standard VE mode | Test full analysis pipeline with representative ride file | |
| Add integration tests verifying parameter changes trigger updates (mocked DOM, assert update functions called) | Tests use existing Vitest infrastructure, no WASM required | ✓ |
| Rely on existing unit tests + manual verification | Unit tests verify math, manual browser checks end-to-end | |
| Agent decides | Trust maintainer's judgment on test coverage | |

**User's choice:** Add integration tests that verify parameter changes trigger the expected update calls (mocked DOM, assert update functions are called)

**Notes:** Clarified that the bug is in trigger wiring, not in calibration math. The calculation was correct - it just wasn't being triggered when parameters changed.

---

## Pipeline Abstraction Boundary

| Option | Description | Selected |
| ------ | ----------- | -------- |
| Centralized in orchestrator | `handleParametersChange` becomes single source of truth for all parameter-change-triggered updates | ✓ |
| Mode handlers own their update | Each mode handler has its own update mechanism but follows shared interface contract | |
| Shared update helper | Common `updateAnalysisPlots(mode, appState, params)` utility with mode-specific internals | |
| Agent decides | Trust maintainer to find right abstraction level | |

**User's choice:** Centralized in orchestrator (`handleParametersChange` as single trigger point)

**Notes:** User confirmed this approach - "essentially every change in CdA, Crr, start/stop slider, air speed etc has to trigger a re-calculation so I am leaning towards a Centralized handleParametersChange - does that sound correct?" Agent confirmed this is the right approach.

---

## Fix Verification Method

| Option | Description | Selected |
| ------ | ----------- | -------- |
| Add integration tests (mocked DOM, assert update functions called) | Use existing Vitest infrastructure | ✓ |
| Use existing test infrastructure + manual checklist | Existing tests verify math; manual check for trigger wiring | |
| Add e2e smoke test (Playwright/Cypress) | Load ride, change calibration, assert plots update | |
| Agent decides | Trust maintainer to verify appropriately | |

**User's choice:** Add integration tests

**Notes:** Confirmation that verification approach is to use integration tests as primary verification method.

---

## Agent's Discretion

- Exact implementation details of the centralized handler
- Specific test file locations and naming conventions
- Whether to refactor existing trigger logic or add wrapper layer

## Deferred Ideas

None - discussion stayed within phase scope