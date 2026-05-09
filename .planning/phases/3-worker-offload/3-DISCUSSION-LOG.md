# Phase 3: Worker Offload - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-09
**Phase:** 3-worker-offload
**Areas discussed:** Profiling gate definition, Interaction behavior under load, Progress + cancellation UX, Offload boundary if worker is needed

---

## Profiling gate definition

| Option | Description | Selected |
| --- | --- | --- |
| Real browser multi-lap path | Profile actual UI path with Plotly + DOM + mode handlers | ✓ |
| Synthetic script only | Use `frontend/scripts/profile-slider-recompute.ts` only | |
| Both synthetic + real browser | Script + browser trace | |

**User's choice:** Real browser multi-lap path
**Notes:** User confirmed this should be the primary gate source.

| Option | Description | Selected |
| --- | --- | --- |
| Frame-budget threshold | Sustained >100ms visible freeze/jank triggers worker path | ✓ |
| Script benchmark threshold | Use synthetic p95 only | |
| Strict threshold | Any noticeable jank triggers worker path | |

**User's choice:** Frame-budget threshold
**Notes:** User preferred user-visible responsiveness criteria over script-only metrics.

| Option | Description | Selected |
| --- | --- | --- |
| 15–20 laps | Representative heavy use | ✓ |
| 10–12 laps | Moderate load | |
| 25+ laps | Stress target | |

**User's choice:** 15–20 laps

| Option | Description | Selected |
| --- | --- | --- |
| Yes, skip worker if no blocking | Document and stop at main-thread mitigation | ✓ |
| No, still build worker prototype | Proceed regardless | |

**User's choice:** Yes, skip if no blocking

---

## Interaction behavior under load

| Option | Description | Selected |
| --- | --- | --- |
| Debounced live preview | Fluid drag, recompute after short debounce | ✓ |
| Release-to-apply | Recompute on release only | |
| Always live (no debounce) | Recompute on every input event | |

**User's choice:** Debounced live preview

| Option | Description | Selected |
| --- | --- | --- |
| Mode-aware behavior | Stronger debounce for heavy modes | ✓ |
| One global behavior | Same policy for all modes | |

**User's choice:** Mode-aware behavior

| Option | Description | Selected |
| --- | --- | --- |
| ~200ms | Balanced latency/churn | ✓ |
| ~100ms | More immediate, more churn | |
| ~300ms | Smoother compute load, less direct feel | |
| Agent discretion | Decide after profiling | |

**User's choice:** ~200ms

| Option | Description | Selected |
| --- | --- | --- |
| Immediate control feedback | Slider/value update immediately, plots may lag briefly | ✓ |
| Lockstep only | Values and plots update together | |

**User's choice:** Immediate control feedback

| Option | Description | Selected |
| --- | --- | --- |
| Latest-input-wins | Drop intermediate recomputes | ✓ |
| Process each step | Compute every intermediate state | |

**User's choice:** Latest-input-wins

---

## Progress + cancellation UX

| Option | Description | Selected |
| --- | --- | --- |
| Inline lightweight status | Non-blocking status near controls/plots | ✓ |
| Full-screen overlay | Block UI during compute | |
| No indicator | No visible progress | |

**User's choice:** Inline lightweight status

| Option | Description | Selected |
| --- | --- | --- |
| Auto-cancel previous, run latest | New input cancels in-flight work | ✓ |
| Queue requests | Process in order | |
| Ignore new input until done | Lock while computing | |

**User's choice:** Auto-cancel previous, run latest

| Option | Description | Selected |
| --- | --- | --- |
| Auto-cancel only | No explicit cancel button | ✓ |
| Add explicit Cancel button | Manual cancel control | |

**User's choice:** Auto-cancel only

| Option | Description | Selected |
| --- | --- | --- |
| Keep last completed result visible | Replace only when latest run is done | ✓ |
| Clear plots immediately | Blank/placeholder while running | |

**User's choice:** Keep last completed result visible

---

## Offload boundary if worker is needed

| Option | Description | Selected |
| --- | --- | --- |
| VE computation core only | Smallest first worker boundary | |
| VE computation + segment extraction | Broader first worker boundary | ✓ |
| Full analysis pipeline | Aggressive first move | |

**User's choice:** VE computation + segment extraction

| Option | Description | Selected |
| --- | --- | --- |
| GPS-lap + out-and-back first | Heavy multi-segment target | |
| All modes at once | Rollout across standard + GPS-lap + out-and-back | ✓ |
| GPS-lap only first | Narrowest first rollout | |

**User's choice:** All modes at once

| Option | Description | Selected |
| --- | --- | --- |
| Transferable typed arrays from start | Avoid clone overhead | ✓ |
| Structured clone first | Optimize later | |

**User's choice:** Transferables from start

| Option | Description | Selected |
| --- | --- | --- |
| Graceful fallback to debounced main thread | Keep functionality if worker fails | ✓ |
| Hard error | Require worker path | |

**User's choice:** Graceful fallback

---

## the agent's Discretion

- Exact profiling instrumentation and report format
- Exact inline status copy/styling
- Internal cancellation mechanism implementation details

## Deferred Ideas

- GPS mode selector move (already Phase 2)
- Pipeline unification todo (Phase 1/7 scope)
- Smoothing strategy todo (Phase 4)
- Continuous weather sampling todo (Phase 6)
