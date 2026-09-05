# dirty fixture — expected gate output

Run from this folder: `node ../../../core/scripts/gates.mjs --state-dir .sdlc`
(`project.json` points `plugins.req.root` at `../..`, which resolves to `plugins/req` from here.)

One violation per req gate. Core stays clean on purpose: anything core reports here would be a
fixture bug, not a finding — `selftest.mjs` asserts that separately.

| gate | fires on | why |
|---|---|---|
| G-req-001 | req/loan/requirements.json | `REQ-loan-001` has an empty `goal` |
| G-req-002 | req/loan/requirements.json | `REQ-loan-002` actor is the words "ผู้จัดการสาขา", not an `STK` id |
| G-req-003 | req/loan/rules.json | five live rules carry no `EX` (`BR-loan-003@v1`, `005@v1`, `005@v2`, `006@v1`, `006@v2`) |
| G-req-004 | req/loan/examples/BR-loan-004.json | six `EX` on `BR-loan-004@v1`, cap is five |
| G-req-005 | req/loan/calc.json | `CALC-loan-002@v1` pins two `BR` versions |
| G-req-006 | req/loan/golden/GD-loan-002.json | row 1 says 1000; re-running `CALC-loan-002@v1.mjs` gives 900 |
| G-req-007 | req/loan/golden/GD-loan-002.json | status `approved` with no `signedBy` and no `evidence` |
| G-req-008 | req/loan/rules.json | `BR-loan-005` and `BR-loan-006` each have two live versions |
| G-req-009 | req/loan/rules.json | `BR-loan-006@v2` supersedes an approved version without naming a `CR` |
| G-req-010 | req questions | `Q-loan-001` is still open (warn — blocks CP1, does not block the run) |

`gates=13 error=14 warn=1 limit=0`, exit code 1. Fourteen errors from ten gates: G-req-003 fires five
times and G-req-008 twice, which is the point — a gate reports every subject, not the first one.

The clean fixture next door is the same shape with none of the violations: `error=0 warn=0 limit=0`, exit 0.
