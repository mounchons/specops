# dirty fixture — what must fire

Four scenarios, three test cases, one run and two findings on an otherwise clean project, each wrong
in exactly one way. `selftest.mjs` asserts that every `qa:*` check finds its case here and that no
`core:*` check finds anything: a fixture that also breaks core would prove nothing about qa.

| what is wrong | check |
|---|---|
| `SCN-loan-002` belongs to `UC-loan-001`, which `TSK-001` has verified, and no test case covers it | `qa:scn-without-tc` |
| `TC-loan-002` is `verified` and no run has it passing | `qa:tc-verified-needs-run` |
| `DEF-loan-002` is routed to `design` and names no change request | `qa:def-routing-needs-cr` |
| `RUN-001` names `qa/evidence/TC-loan-001-RUN-001-s1-pass.log`, which is not on disk | `qa:evidence-missing` |
| `DEF-loan-003` is `verified`, raised after `RUN-001`, and no run since has `TC-loan-003` passing | `qa:def-closed-needs-green-run` |
| `TC-loan-003` has `runnable: false` and a gap naming the API record | `qa:tc-not-runnable` (warn) |

`G-qa-007` (`qa:ui-runner`) and `G-qa-008` (`qa:no-duplicate-unit`) have no function on purpose and
therefore no fixture: gates.mjs prints both as **LIMIT**s every run. There is no browser runner here,
and no script can tell whether an end-to-end step is re-proving a unit test — the honest form of both
rules is a line that never passes silently and never blocks.

**A known limit of `qa:evidence-missing`**: it checks that the file exists, not that its contents are
the ones the verdict was read from. Someone who edits an evidence file after the fact gets a green
gate. Catching that means hashing evidence at write time and checking the hash here — the same shape
as `mock:baseline-hash`, and worth doing the first time a run's evidence is disputed rather than
before.

The clean fixture is the same project done right: one test case covering the scenario, a run in which
it passed with both evidence files on disk, and a finding closed by that run rather than by hand.
