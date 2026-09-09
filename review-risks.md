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
             matching other spellings (F17-06, bbdf51f: `0\.\d+` lost `.008` and `8e-3`);
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
Seen in:     F33-01, and the two `main` commits after 9acfb78 that re-pointed and then
             dropped citations the same branch's own deletions had invalidated.
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
