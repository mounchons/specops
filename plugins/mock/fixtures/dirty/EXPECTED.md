# dirty fixture — what must fire

Four wireframes on one app, each wrong in exactly one way, on a design that is otherwise clean.
`selftest.mjs` asserts that every `mock:*` check finds its case here and that no `core:*` check finds
anything: a fixture that also breaks core would prove nothing about mock.

| MCK | what is wrong | check |
|---|---|---|
| MCK-loan-001 | draws `field:phone`, which `UI-loan-001` never declared, twice under the same `data-testid`, and does not draw the `field:name` it did declare | `mock:control-matches-ui` (4 findings: undeclared ×2, duplicate testid, missing declared) |
| MCK-loan-002 | `theme: null` — dev has nothing to reference | `mock:theme-first` |
| MCK-loan-003 | signed with hash `0000000000000000`, and the drawing now hashes to something else, with no open CR | `mock:baseline-hash` |
| MCK-loan-004 | drawn from `UI-loan-004`, a dashboard that declares no fields — buttons only | `mock:ui-without-fields` (warn) |

`MCK-loan-002` names `null` rather than a made-up `THM-002` on purpose: an id-shaped string that points at
nothing is a `core:dangling-ref` error, and the dirty fixture must break mock's gates only.

The clean fixture is one screen drawn correctly and signed, with `signed.hash` equal to the hash of the
drawing — which is what makes "signing does not change the hash" checkable rather than asserted.
