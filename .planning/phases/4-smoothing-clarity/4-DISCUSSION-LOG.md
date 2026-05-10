# Phase 4: Smoothing Clarity - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-09
**Phase:** 4-smoothing-clarity
**Areas discussed:** Smoothing ownership boundary, Smoothing parameter contract, What users see in plots, Source + mode coverage rules

---

## Smoothing ownership boundary

| Option                        | Description                                                                             | Selected |
| ----------------------------- | --------------------------------------------------------------------------------------- | -------- |
| Data layer ownership          | Smooth once before analysis/plots; visualization may compare but must not own smoothing | ✓        |
| Visualization layer ownership | Keep analysis raw and smooth only rendered traces                                       |          |
| Hybrid ownership              | Allow smoothing in multiple layers with explicit rules                                  |          |
| You decide                    | Agent discretion                                                                        |          |

**User's choice:** Data layer ownership.
**Notes:** Follow-up clarification locked scope: FIT elevation should not be smoothed; smoothing should happen on DEM loading/correction; keep two DEM profiles (original + smoothed).

---

## Smoothing placement seam

| Option                                                     | Description                           | Selected |
| ---------------------------------------------------------- | ------------------------------------- | -------- |
| After elevation source resolution, before analysis payload | Smooth once after source selection    |          |
| Inside DEM correction utilities                            | Smooth in DEM correction flow         |          |
| Inside analysis payload preparation                        | Smooth right before calculator inputs |          |
| You decide                                                 | Agent discretion                      |          |

**User's choice:** Custom (free text): "fit elevation should not be smoothed, so it should be done on DEM loading, ideally after loading we have 2 DEM elevation profiles: orig and smoothed."
**Notes:** This superseded preset options and was recorded as authoritative.

---

## Smoothing parameter contract

| Option                        | Description                               | Selected |
| ----------------------------- | ----------------------------------------- | -------- |
| Single global strength preset | One shared smoothing setting across modes |          |
| Window-size numeric control   | Expose explicit smoothing window          |          |
| No user control yet           | Fixed internal smoothing behavior in v1.1 | ✓        |
| You decide                    | Agent discretion                          |          |

**User's choice:** No user control yet.
**Notes:** Smoothing configuration remains internal/fixed this phase.

---

## What users see in plots

| Option                                 | Description                          | Selected |
| -------------------------------------- | ------------------------------------ | -------- |
| Show only final analysis line(s)       | No dedicated comparison traces       |          |
| Always show raw vs smoothed comparison | Dual traces by default               |          |
| Optional comparison view               | Main view clean, optional comparison |          |
| You decide                             | Agent discretion                     |          |

**User's choice:** Custom (free text): "show only one line at a time. Standard is smoothed, but show a toggle for raw elevation data which replaces the smoothed curve with raw values."
**Notes:** Follow-up locked default/scope: default is smoothed; toggle available in all modes.

---

## Source + mode coverage rules

| Option                                 | Description                                                     | Selected |
| -------------------------------------- | --------------------------------------------------------------- | -------- |
| Apply to all DEM sources and all modes | Consistent smoothing across local/remote and all analysis modes | ✓        |
| Apply only to local DEM                | Remote DEM unsmoothed                                           |          |
| Apply only in Standard mode            | GPS modes unchanged                                             |          |
| You decide                             | Agent discretion                                                |          |

**User's choice:** Apply to all DEM sources and all modes.
**Notes:** Additional clarification: when no DEM is active, use raw FIT elevation; hide/disable raw/smoothed toggle when no DEM is active.

---

## the agent's Discretion

- Exact smoothing algorithm and fixed internal parameters
- Exact storage model for original vs smoothed DEM profiles
- Exact UI placement/text for the raw/smoothed toggle

## Deferred Ideas

- Move GPS mode selection to section 3 lap selection (Phase 2 scope)
- Unify calculation and plot update pipeline across analysis modes (Phase 1/7 scope)
- Consider worker offload for multi-lap VE (Phase 3 scope)
