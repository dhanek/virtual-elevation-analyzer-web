## Test Files

- ride-a.fit
- ride-b.fit
- ride-c.fit

## Comparison Results

| file       | mode         | raw artifacts                         | moving-average artifacts            | interpolated artifacts                         | preferred      |
| ---------- | ------------ | ------------------------------------- | ----------------------------------- | ---------------------------------------------- | -------------- |
| ride-a.fit | Standard     | stair-step spikes on rough sections   | reduced spikes, stable trend        | slightly sharper than smoothing, still stable  | moving-average |
| ride-b.fit | GPS-lap      | lap overlays drift at hill crests     | overlays align better, lower spread | close to smoothing with occasional edge jitter | moving-average |
| ride-c.fit | Out-and-back | outbound/inbound mismatch around turn | mismatch reduced and more symmetric | symmetric but slightly noisier over tile seams | moving-average |

## Decision

Winner: moving-average

## Deferred Cleanup

Do not remove either method in this phase; cleanup happens only after winner confirmation.
