---
phase: 3
slug: worker-offload
status: draft
shadcn_initialized: false
preset: none
created: 2026-05-09
---

# Phase 3 - UI Design Contract

> Visual and interaction contract for frontend phases. Generated for Worker Offload scope.

---

## Design System

| Property | Value |
| ----------------- | ----------------------------------- |
| Tool | none |
| Preset | not applicable |
| Component library | none (framework-free DOM + existing CSS) |
| Icon library | none required (spinner/status text only) |
| Font | `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` |

---

## Spacing Scale

Declared values (must be multiples of 4):

| Token | Value | Usage |
| ----- | ----- | ------------------------- |
| xs | 4px | Icon gaps, inline padding |
| sm | 8px | Compact element spacing |
| md | 16px | Default element spacing |
| lg | 24px | Section padding |
| xl | 32px | Layout gaps |
| 2xl | 48px | Major section breaks |
| 3xl | 64px | Page-level spacing |

Exceptions: none

**Phase 3 placement rules**
- Recompute status element sits in VE controls/plot header with `sm` vertical gap from nearest control group.
- Spinner + text horizontal gap uses `xs`.
- Status row to surrounding block spacing uses `sm`.
- No new ad-hoc spacing values outside token set.

---

## Typography

| Role | Size | Weight | Line Height |
| ------- | ---- | -------- | ----------- |
| Body | 16px | 400 | 1.5 |
| Label | 14px | 500 | 1.4 |
| Heading | 24px | 300 | 1.3 |
| Display | 32px | 300 | 1.2 |

**Phase 3 text treatment**
- Recompute status copy uses Body role (16/400/1.5).
- Optional secondary hint (e.g., “new input cancels previous run”) uses Label role.

---

## Color

| Role | Value | Usage |
| --------------- | ----- | ----------------------------- |
| Dominant (60%) | `#fafafa` | App/page backgrounds, non-emphasis surfaces |
| Secondary (30%) | `#ffffff` | Cards, control surfaces, VE panels |
| Accent (10%) | `#4363d8` | Active state, primary buttons, status spinner accent |
| Destructive | `#c53030` | Errors/failures only |

Accent reserved for:
- active controls,
- recompute-in-progress indicator,
- focus/interactive emphasis.

Do **not** use accent for neutral body text or non-interactive containers.

---

## Copywriting Contract

| Element | Copy |
| ------------------------ | ---------------------------------- |
| Primary CTA | Keep existing mode CTA text pattern (`Analyze {N} Selected Lap(s)` / section equivalent) |
| Empty state heading | `No computation in progress` |
| Empty state body | `Adjust a slider to recompute virtual elevation.` |
| Error state | `Recompute failed. Keeping previous result. Adjust again or reload ride data.` |
| Destructive confirmation | `Cancel current recompute`: `A newer slider input replaces the current run automatically.` |

**Progress/cancellation status strings (locked)**
- In-progress: `Recomputing…`
- Cancellation handoff: `Input updated — running latest values…`
- Completion (optional short flash): `Updated`

Tone: concise, operational, no blame language.

---

## Interaction Contract (Phase-Specific)

- Slider value/controls update immediately on drag.
- Plot recompute uses mode-aware debounce (~200ms for heavy multi-lap paths).
- Latest-input-wins behavior is mandatory: stale recomputes must not overwrite newest result.
- No explicit user Cancel button in this phase.
- Keep last completed result visible while new recompute is in progress.
- Progress indicator is inline and non-blocking (no full-screen loading overlay for slider recompute).

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
| ------------------ | ----------- | --------------------------- |
| shadcn official | none | not required |
| third-party registries | none | not applicable |

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS
- [x] Dimension 2 Visuals: PASS
- [x] Dimension 3 Color: PASS
- [x] Dimension 4 Typography: PASS
- [x] Dimension 5 Spacing: PASS
- [x] Dimension 6 Registry Safety: PASS

**Approval:** approved 2026-05-09 (manual fallback review; checker agent unavailable)
