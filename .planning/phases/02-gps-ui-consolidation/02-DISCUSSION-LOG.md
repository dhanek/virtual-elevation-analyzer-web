# Phase 2: GPS UI Consolidation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-04-23
**Phase:** 02-gps-ui-consolidation
**Areas discussed:** Mode selector placement, State synchronization, Mode switching behavior, Default mode

---

## Mode selector placement

| Option | Description | Selected |
| ------ | ----------- | -------- |
| Above lap list | New selector positioned before lap selection controls | ✓ |
| Below lap list | Selector appears after lap selection, near GPS panels | |
| Sidebar control | Separate dedicated control area in sidebar | |

**User's choice:** Above lap list
**Notes:** Clear visual flow - user selects mode, then sees appropriate laps/panels

---

## State synchronization

| Option | Description | Selected |
| ------ | ----------- | -------- |
| Copy to Section 3 | Keep in both places, sync state between them | |
| Remove from Analysis Parameters | Move entirely to Section 3, single source of truth | ✓ |

**User's choice:** Remove from Analysis Parameters - it's a MOVE, not a copy
**Notes:** Keeps state location clear, avoids sync issues

---

## Mode switching behavior

| Option | Description | Selected |
| -------- | ----------- | -------- |
| Apply button | User changes mode, then clicks "Apply" to confirm | |
| Immediate behavior change | Mode switch triggers actions right away | ✓ |

**User's choice:** Immediate behavior change, no apply button
**Notes:** Flow should be: user selects mode → panels show/hide immediately → detection runs when conditions met

**Follow-up behavior:** 
- Switching modes clears previous detections (different algorithms)
- FIT lap selection preserved across mode switches
- Map visualization reflects mode immediately

---

## Default mode

| Option | Description | Selected |
| ------ | ----------- | -------- |
| None | Default when file loaded | ✓ |
| Remember last used | Persist mode selection in localStorage | |

**User's choice:** "None"
**Notes:** Clean slate on each file load, user must actively choose GPS mode

---

## Deferred Ideas

None - discussion stayed within phase scope