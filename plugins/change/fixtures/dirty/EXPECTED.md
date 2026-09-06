# dirty fixture — what must fire

Six change requests, each wrong in exactly one way, on a design that is otherwise clean. `selftest.mjs`
asserts that every `change:*` check finds its case here and that no `core:*` check finds anything: a
fixture that also breaks core would prove nothing about change.

| CR | what is wrong | check |
|---|---|---|
| CR-001 | `kind: "colour"`, `source: "boss"`, blank `request`, `lane: "maybe"` | `change:cr-shape` (4 findings) |
| CR-002 | `source: finding` with `finding: null` — no defect to trace it to | `change:finding-needs-def` |
| CR-003 | `kind: display` with an empty `fields[]` — nothing to display | `change:display-needs-fields` |
| CR-004 | open since 2020 and still never walked | `change:stale-open` (warn) |
| CR-005 | open, walked, and freezing `UI-loan-001` which is `approved` | `change:frozen` (warn) |
| CR-006 | closed with `closed: {}` — no signature, no evidence | `change:closed-clean` (2 findings) |

`ENT-001` deliberately has only `name`, not `phone`: a display CR that named `ENT-001.phone` would fire
`change:display-needs-fields` for the second reason (the attribute does not exist), which is the case
`open.mjs` refuses outright rather than writing.
