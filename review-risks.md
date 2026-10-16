# Review risk classes

The finite list of things `/pr-review` checks on every pull request in this repo, and reports on
whether or not it finds something. A finite list terminates; "are there any bugs?" does not.

Rules for keeping this file useful:

- Add a class when something breaks in production or slips through a review here. **This file is
  a scar record, not a generic checklist.** Generic entries make every review report "checked"
  without reading anything.
- Each class names the code to read, so a check can be evidenced rather than asserted.
- Remove a class when the structure that made it possible is gone. A class nobody can trigger
  any more costs attention on every review.

Seeded 2026-09-09 from PR #24 review round 40. Only classes this repo has actually been bitten by
are here — the template's other seed classes were deliberately not copied in.

## Classes

### Guard vacuity

A source-scanning check that has stopped being able to fail on the thing it exists to catch. This
repo's most expensive class by a wide margin: hit four times in one session — F17-06, F37-01,
F38-01, F40-01 — and **three of the four were introduced by a fix for one of the others.**

```
Read:        the *.test.ts files under frontend/src that call readFileSync/readdirSync —
             13 of them today. The named ones:
             src/analysis/unsetParameterFallbacks.test.ts,
             src/tooling/mapLiteralAnnotation.test.ts,
             src/tooling/formatterCoverage.test.ts,
             src/shell/analysis/calculatorRhoArray.test.ts,
             src/state/veStatus.test.ts, src/analysis/sliderBounds.test.ts
Fails when:  the check's pattern is narrowed to kill one false positive and silently stops
             matching other spellings (F17-06: narrowing to `0\.\d+` lost `.008` and `8e-3`);
             or the check is applied per line while the formatter breaks its subject across
             lines (F37-01); or it takes only the first match on a line while the defect sits
             in a later one (F40-01: `exec` returns one match and `??` stops at the first
             pattern that matched at all).
             Also when a scan excludes its own file from its own sweep — `sourceFiles()` in
             unsetParameterFallbacks.test.ts skips every *.test.ts — so the detector cannot
             observe the defect class inside the detector.
             THE TELL, in all of them: the guard was verified against the single case that
             prompted it and against nothing else. The counter-artefact is a matrix run in
             one pass over every shape the guard has been wrong about — see
             CRR_FALLBACK_MATRIX. Ask of any guard change: what makes this fail today?
Seen in:     PR #23 F37-01 and F38-01; PR #24 F40-01; and F17-06.
```

### Line-number citation decay

```
Read:        `file:line` citations wherever they are written — comments, TODO.md, and review
             prose. `git grep -nE '[A-Za-z]+\.ts:[0-9]+'` finds them.
Fails when:  the cited file moves and the citation silently points at unrelated code. A
             citation is never type-checked, so nothing fails; the next reader is simply sent
             to the wrong line. Commit SHAs on an unmerged branch decay the same way: a
             rebase or a squash merge orphans them (F41-03). Naming the mechanism instead of
             the location is what does not decay.
Seen in:     F33-01 — PR #21's branch re-pointed five citations its own deletions had
             invalidated, then had to drop three of them because the re-pointing commit
             had broken them in turn. Both commits reached `main` as a single squash.
```

### Object literals escaping excess-property checking

```
Read:        src/tooling/mapLiteralAnnotation.test.ts and its ALLOWED list (:57)
Fails when:  an unannotated `.map(… => ({ … }))` produces a result that reaches a declared
             type, so a stray or misspelled field is accepted silently — tsc checks excess
             properties on a literal assigned directly to a typed target, not on one that
             arrives through an inferred callback return.
Seen in:     F33-02, F37-01.
```

### A threshold validated only on synthetic fixtures

```
Read:        the numeric constants in src/analysis/HeadingCalibration.ts and
             src/analysis/AirSpeedCalibration.ts — MAX_CLOSURE_METERS, MAX_BACKTRACK_DEG,
             MAX_SAMPLE_GAP_SECONDS, MIN_RECOMMENDED_CIRCUITS, SEGMENT_SPREAD_WARN_PERCENT —
             against the fixtures that justify them,
             src/analysis/__fixtures__/syntheticTrack.ts and the sweeps in
             HeadingCalibration.test.ts and AirSpeedCalibration.test.ts.
Fails when:  a threshold is derived from a synthetic fixture and every later test of it is
             another synthetic fixture, so the property that decides the real case is absent
             from the whole sweep and the sweep cannot report its own blind spot. THE RULE:
             a numeric threshold introduced with a fixture-derived justification must be
             re-measured on at least one real ride before the criterion that names it can be
             ticked, and the real-ride figure is stated beside the fixture figure.
             THE TELL: the justification cites figures from an idealised geometry — a smooth
             oval, a uniform rate, a whole number of laps — and the prose calls the result
             "typical".
Seen in:     PR #30. F63-03 sized the circuit-sweep tolerance as the run's MEDIAN azimuth step
             and justified it from smooth ovals (6.3 deg on a 451 m oval, 18.8 deg on a 250 m
             track), where the azimuth rate is near-uniform. Round 64's deep pass asked exactly
             the right question — does the tolerance under-cover a lap that ends in a corner? —
             swept synthetic ovals and an idealised 845 m lap, and answered "nothing found".
             On a real venue whose start/finish sits ~35 m from the centre of a 300x283 m
             bounding box the within-lap step spread is 2.4 / 9.5 / 15.3 deg (median / p90 /
             max), a 6:1 range, and two of four complete laps were refused (F65-01). The
             conclusion was sound about its fixtures and wrong about the venue.
```
