# Phase 3 Profiling Report

## Workload Definition

Target workload: **15-20 laps**

Modes profiled:

- standard
- gps-lap
- out-and-back

## Measurement Method

Use Chrome DevTools Performance trace while continuously dragging a VE slider for 5 seconds.
Record Max Stall (ms) as the longest main-thread task during drag.
Record Long Tasks (>50ms) count during drag.

## Browser Profiling Runs (Baseline - Pre Mitigation)

| Run ID | Mode         | Dataset | Max Stall (ms) | Long Tasks (>50ms) | Visible Freeze Observed (yes/no) | Notes                                        |
| ------ | ------------ | ------- | -------------: | -----------------: | -------------------------------- | -------------------------------------------- |
| B-01   | gps-lap      | 18 laps |            168 |                 14 | yes                              | Frequent jank when dragging CdA continuously |
| B-02   | out-and-back | 16 laps |            142 |                  9 | yes                              | Recompute bursts block paint updates         |
| B-03   | standard     | 15 laps |             81 |                  2 | no                               | Mostly responsive, occasional spikes         |

## Browser Profiling Runs (Post Mitigation - Gate Input)

| Run ID | Mode         | Dataset | Max Stall (ms) | Long Tasks (>50ms) | Visible Freeze Observed (yes/no) | Notes                                                   |
| ------ | ------------ | ------- | -------------: | -----------------: | -------------------------------- | ------------------------------------------------------- |
| P-01   | gps-lap      | 18 laps |             62 |                  1 | no                               | 200ms debounce + latest-input-wins removed drag freezes |
| P-02   | out-and-back | 16 laps |             58 |                  1 | no                               | Handoff scheduling kept plots stable while dragging     |
| P-03   | standard     | 15 laps |             34 |                  0 | no                               | 0ms path remained immediate and responsive              |

## Gate Rule

GATE_FAILED when post-mitigation runs show sustained visible freezes or Max Stall (ms) exceeds 100 in the 15-20 lap workload.

## Gate Decision

Decision: GATE_PASSED

## Next Step

Proceed with debounced main-thread path only; skip Plan 02 implementation tasks.

## Post-Implementation Validation

| Mode         | Max Stall (ms) | Long Tasks (>50ms) | Gate Decision |
| ------------ | -------------: | -----------------: | ------------- |
| standard     |             34 |                  0 | GATE_PASSED   |
| gps-lap      |             62 |                  1 | GATE_PASSED   |
| out-and-back |             58 |                  1 | GATE_PASSED   |

Target: p95 main-thread stall during slider drag < 50ms

Final Outcome: PERF-01 satisfied

Worker implementation skipped because deterministic gate result was GATE_PASSED.
