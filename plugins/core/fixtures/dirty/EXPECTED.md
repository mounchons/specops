# dirty fixture — expected gate output

Run: `node ../../scripts/gates.mjs --state-dir .sdlc` from this folder.

| gate | fires on | why |
|---|---|---|
| G-core-001 | req/loan/functions.json | `FUN-` is not a specops prefix |
| G-core-002 | design/loan/leaked.json | a `REQ-` record lives under design/ |
| G-core-003 | req/loan/requirements.json | `REQ-loan-001` defined twice |
| G-core-004 | req/loan/functions.json | status `wip` |
| G-core-005 | req/loan/glossary.json | 604 lines |
| G-core-006 | design/loan/scenarios.json | refs `UC-loan-999` which does not exist |
| G-core-007 | trace.design.json | design wrote an edge whose `from` is req's `BR-` |
| G-core-008 | req/loan/questions.json | invalid JSON |
| G-core-010 | registry.json | stale (warn) |
| G-design-001 | design:screens-coverage | LIMIT — no script implements it yet (design plugin not installed) |

Exit code 1. error=8 warn=1 limit=1.
