# qa — one-page spec (constitution rule 2)

> Phase 6 · brief §5.6 · test project RentPoint §8: DEF-rental-001 routes to dev with no CR · DEF-rental-002 routes to design and opens a CR `source: finding` by itself · delete when the plugin ships.
> Names are proposals. Inputs, outputs and DoD are not. Every command persists before it answers (rule 7).
> qa turns scenarios into things that run, and a verdict is the output of a command with a file behind it. unit test = dev · E2E/scenario = qa · never the same thing twice. A TC without a RUN is a plan; a RUN without evidence is a claim (P6); a DEF whose root cause is the spec is a CR, not a bug (P5).

## Reads (inputs)
| id kinds | from | required |
|---|---|---|
| `SCN` `AC` `UC` — what to prove · `TSK` (`verified`, its `commit`) `IMP` `CMP.run` `API` `MCK` (testids) `GD` — what dev handed over, read from the records the handoff was rendered from, never from `export/handoff-*.md` (rule 4) | registry / `query` (by id, never by folder) | `cases` `run` `report` |
| `REQ` `NFR` — the top of the coverage chain | registry | `report` |
| `openCr()` from `plugins/change/scripts/open.mjs` · `isFrozen()` from `plugins/change/scripts/checks.mjs` | import, never copy | `finding` · `cases` (a frozen SCN gets no new TC) |
| the running system: `CMP.run.healthcheck` decides whether a RUN can start; the code root's `git HEAD` is the version under test | disk · git · network | `run` |

## Writes (outputs — only under `.sdlc/qa/`, `trace.qa.json`, and `export/qa-<module>.md`)
| id kinds minted | file | notes |
|---|---|---|
| `TC` | `qa/<module>/cases/<TC>.json` | one per SCN · `scenario` `usecase` `acceptance[AC]` `flow` · `given` `expected` verbatim from the SCN · `data[]` (the rows the given needs, by ENT) · `steps[] {n, do, via: http\|ui\|cmd, cmd, expect {http?, fields?, contains?, exitCode?}}` — `cmd` for http is built from `CMP.run.healthcheck`'s origin + `API.method/path` + `API.request`; `expect.fields` from the GD row the AC derives from; ui steps carry the MCK testid and no `cmd` · `runnable` + `gaps[]` naming every record that stopped a step from being executable · `lastRun` `lastVerdict` · `status`: draft → approved (runnable) → verified (last RUN passed). One file per TC: phase 5 showed one-file-per-module breaks rule 4 at nine records (`ids.mjs`'s file column is a default the loader does not enforce — `core:id-owner` checks the folder) |
| `RUN` | `qa/runs/<RUN>.json` | a new id every run, never overwritten · `at` `scope` `codeVersion` (git HEAD of the code root) `env {os, node, healthcheck}` · `results[] {tc, verdict: pass\|fail\|partial\|blocked, steps[] {n, exitCode, evidence}}` · a red healthcheck still writes the RUN, verdicts `blocked`, evidence = the healthcheck output |
| — | `qa/evidence/<TC>-<RUN>-s<n>-<pass\|fail\|skip>.log` | the captured stdout+stderr of each step — the file name alone says which test, which run, which step, what happened · no id, not an artifact |
| `DEF` | `qa/<module>/findings/<DEF>.json` | `tc` `scenario` `usecase` `run` (or `evidence[]` given by hand — a client's screenshot from LINE counts, a sentence does not) · `severity` · `reproduce` · **`routing: dev\|design\|req`** · `cr` (`null` for dev; the CR `finding` opened for design/req) · `raisedAt` · `status`: draft → verified only when a later RUN passes its TC — dev never closes a DEF |
| edges | `trace.qa.json` | `TC covers SCN` · `TC covers AC` · `RUN ran TC` · `DEF found-in TC` — `from` is always a qa id (G-core-007); `DEF.cr` reaches the CR as a `refs` edge |
| — | `export/qa-<module>.md` | the report a person reads — never read back by a script |

`scripts/init.mjs` is not a command: every command calls it first; idempotently writes `project.json → plugins.qa.root` and appends G-qa-* to `gates.json`.

## Commands (≤ 6)
| command | in | out | DoD (a command that produces a real result) |
|---|---|---|---|
| `cases <module>` | SCN AC UC + the records behind the handoff | one TC per SCN with steps, `data`, `expect`, `runnable`/`gaps` · `covers` edges · **a DEF `routing: dev` per TC it could not make runnable** ("handoff ไม่ครบ": no method/path, a path with `//` or an unresolved `{…}`, `request: null`, no `run.healthcheck`) | asks nobody — a question it would have to ask is written down as that DEF · refused on a frozen SCN (exit 1, naming the CR) · re-running creates only what is missing and keeps `lastRun` |
| `run <module\|TC\|UC>` | runnable TCs | a new RUN · one evidence file per step · TC `lastRun`/`lastVerdict`/`status` · DEFs whose TC passed → `verified` | never runs without a healthcheck (green → run; red → RUN with every verdict `blocked`) · `expect` decides pass/fail, never the session · a ui step is `skip` and the TC `partial` — printed, not hidden |
| `finding <TC> --routing dev\|design\|req --reproduce "…" [--severity s1..s4] [--kind display\|screen\|report\|rule\|other] [--touches ids] [--evidence <file>]` | a failing TC (its last RUN), or an evidence file for what was seen outside a RUN | DEF with routing · routing design/req → `openCr()` with `source: finding`, `finding: <DEF>`, `kind` (default `rule`), `touches`, `request` = the reproduce text — the CR id is written on the DEF before the command answers | refused without a failing RUN or `--evidence` that exists (exit 2) · dev routing writes `cr: null` and names the TSK · the same TC + routing twice is one DEF, not two |
| `report <module>` | REQ UC SCN AC TC RUN DEF | `export/qa-<module>.md` + the numbers printed: REQ → UC → SCN → TC → last verdict · AC with no SCN (a spec gap, not a test gap) · TC not runnable and why · open DEF by routing · RUN history with code versions | every number is counted from records — nothing is estimated · a module with no TC is refused (exit 1: `/qa:cases <module>`) |

`NEXT`: SCN under a `verified` TSK with no TC → `cases` · runnable TC with no RUN → `run` · a TC whose last verdict is fail with no DEF → `finding` · DEF routing dev open → `/dev:task <TSK> --verify` then `run <TC>` · DEF routing design/req → the CR's own next (change) · every runnable TC passed → `report`.

## Gates it appends to gates.json (each backed by a function in `scripts/checks.mjs`)
| gate id | check | severity | rule |
|---|---|---|---|
| G-qa-001 | `qa:scn-without-tc` | error | a SCN whose UC has a `verified` TSK and no TC `covers` it — built and never tested |
| G-qa-002 | `qa:tc-verified-needs-run` | error | a TC at `verified` with no RUN in which it passed |
| G-qa-003 | `qa:def-routing-needs-cr` | error | a DEF routed to design or req with `cr: null` (change's `finding-needs-def` guards the other direction) |
| G-qa-004 | `qa:evidence-missing` | error | a RUN step or a DEF names an evidence file that is not on disk |
| G-qa-005 | `qa:def-closed-needs-green-run` | error | a DEF at `verified` with no RUN after `raisedAt` in which its TC passed — nobody closes a finding by typing |
| G-qa-006 | `qa:tc-not-runnable` | warn | a TC with `runnable: false`, with its `gaps[]` — the handoff is incomplete somewhere upstream |
| LIMIT | `qa:ui-runner` | — | steps on a `data-testid` are recorded and skipped: no browser runner exists here, so a TC of only ui steps never passes by script. Printed every run |
| LIMIT | `qa:no-duplicate-unit` | — | an E2E step must not re-prove what a dev unit test proves; no script can tell scope from text. Printed every run |

`gates.json` grows to ~61 gates / ~430 lines; the phase-4 decision (core file, exempt from G-core-005, never read whole) stands.

## Cold Start Test
Close every session. Reopen with only the files on disk. Ask: `REQ-rental-001 สร้างแล้ว ทดสอบแล้ว ผ่านไหม หลักฐานอยู่ไหน`.
It must be answered from `/core:query REQ-rental-001` (`<- UC-rental-001 (satisfies)`), `/core:query UC-rental-001` (`<- TSK-001 [verified] (implements)` · `<- SCN-rental-001 (verifies)`), `/core:query SCN-rental-001` (`<- TC-rental-001 (covers)`), `/core:query TC-rental-001` (`lastRun`, `lastVerdict`) and `/core:query RUN-001` (`codeVersion`, the step verdicts, the evidence paths) — never from memory.

**Phase DoD** (docs/phase-plan.md row 6, testproject §8, on `test/rentpoint` with the phase-5 slice up under docker compose): `cases rental` → one TC per SCN (17) without a question asked, `runnable` and `gaps` printed per TC, a DEF `routing: dev` for every handoff gap it hit · `run rental` → RUN-001 with `codeVersion` = the TSK-001 commit, an evidence file per executed step under `qa/evidence/`, verdicts from `expect` · **DEF-rental-001** (ยืนยันจองได้ทั้งที่ยังไม่ชำระมัดจำ) → `routing: dev`, `cr: null`, no file under `change/` · **DEF-rental-002** (§8's root cause, not its symptom: the slice answers fee 3,000 → 900 as GD-rental-002 says and the phase-5 unit test asserts word for word, so a 1,000 can only appear on code that breaks what measures it — what is provable is that no SCN covers the boundary, AC-rental-004; raised from evidence captured on the running slice) → `routing: design`, a CR `source: finding` under `change/open/` naming the DEF written by the same command · `report rental` → `export/qa-rental.md` with counts that match `query` · `gates.mjs` exit 0 (warns and the two LIMITs only) · no file the AI reads > 300 lines · Cold Start 6 answered from `query` alone · every plugin's selftest still green.

approved: 2026-09-06
amended: 2026-09-06 — Phase DoD clause for DEF-rental-002 reworded from the 1,000 symptom to the root cause (owner's decision, /phase 6 build run 2, row 11); the approval above stands, nothing else changed
