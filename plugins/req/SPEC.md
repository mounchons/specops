# req — one-page spec (constitution rule 2)

> Phase 1 · brief §5.1 · test project RentPoint, module `rental` · delete this file when the plugin ships.
> Names are proposals. Inputs, outputs and DoD are not. Every command persists before it answers (rule 7).

## Reads (inputs)
| id kinds | from | required |
|---|---|---|
| raw notes · transcript · file/image the user gives | chat text or a path | `capture` |
| `modules[]` `apps[]` | `project.json` (core) | yes — `<module>` must be listed |
| bank questions: category · text · 2–4 options · ⭐ owner default | `plugins/req/assets/question-bank.json` | `ask` |
| `REQ` `NFR` `Q` `BR@v` `EX` `CALC@v` `GD` `STK` | `req/**` — always through `/core:query`, never by opening the folder | `ask` `rules` `calc` `golden` `export` |
| `CR` (phase 3, referenced only) | `change/open/` | `rules --cr` when versioning an approved BR |

## Writes (outputs — only under `.sdlc/req/` and `trace.req.json`)
| id kinds minted | file | notes |
|---|---|---|
| `SRC` | `req/sources.json` + `req/sources/SRC-nnn.<ext>` | raw input copied to disk so provenance survives Cold Start · `kind: text\|file\|image\|chat` |
| `STK` | `req/stakeholders.json` | real people/parties in the client org · every REQ.actor points here |
| `REQ` `NFR` | `req/<module>/requirements.json` | `actor` `goal` `provenance: {src, loc}` `derivedFrom: [SRC]` |
| `Q` `DQ` | `req/<module>/questions.json` | bank key · options · `answer` · open = `draft`, answered = `reviewed` · `--defer` re-mints as DQ |
| `UL` | `req/<module>/glossary.json` | term + agreed meaning |
| `BR@vN` | `req/<module>/rules.json` | `derivedFrom: [REQ, Q]` · never edited in place · old version `retired` + `retiredReason` + `supersededBy` |
| `EX` | `req/<module>/examples/<BR-lineage>.json` | Given/When/Then · ≤5 per BR@v · `derivedFrom: [BR@v]` |
| `CALC@vN` | `req/<module>/calc.json` | `formula` `numberType` `rounding {mode, unit, at}` `boundary[]` · `derivedFrom: [exactly one BR@v]` |
| `GD` | `req/<module>/golden/GD-<module>-nnn.json` + `golden/CALC-<module>-nnn@vN.mjs` | `rows[{input, expected}]` filled by running the script · `signedBy` `signedAt` `evidence` |
| edges | `trace.req.json` | `EX verifies BR@v` · `GD verifies CALC@v` — every `from` is a req id (G-core-007) |
| document | `export/requirement-<module>.md` | Thai, for the client · output only, never read back (rule 4) |

A file nearing 300 lines splits before writing: `questions/<category>.json`, `rules/<nnn-range>.json` (G-core-005).
`scripts/init.mjs` is not a command: every command calls it first; idempotently writes `project.json → plugins.req.root` and appends G-req-* to `gates.json`.

## Commands (≤ 6)
| command | in | out | DoD (a command that produces a real result) |
|---|---|---|---|
| `capture <module> [--file <path>]` | text pasted in chat, or a file/image | SRC (raw copied) · STK · REQ/NFR with actor + goal + provenance · UL · Q for anything not stated | every REQ has actor and goal · nothing guessed: unknown → Q · all on disk before the summary is shown |
| `ask <module> [--answer Q=opt,…] [--defer Q] [--category c]` | bank + existing REQ/Q/BR | one round = next 3 unasked bank questions, 2–4 options each (⭐ = owner default) · an answer mints BR@v1, or retires a draft BR and mints @vN+1 with `supersedes` | answers on disk before the next round is printed · no unanswered question left → prints "bank exhausted" |
| `rules <module> [--retire BR@v --reason … [--replace …]] [--cr CR-nnn]` | REQ + answered Q + BR | Example Mapping per BR: EX (≤5) · BR found while mapping · new Q/DQ for the unknowns · withdrawn BR → `retired` + @vN+1 | every non-retired BR has ≥1 EX · retire never deletes · versioning a BR that carries `approval` needs `--cr` |
| `calc <BR@v>` | a BR with numbers | CALC@v1: formula · numberType · rounding mode + unit + **where** it rounds · boundary cases | pinned to exactly one BR version · a retired BR retires its CALC |
| `golden <CALC@v> [--run] [--sign <STK> --evidence <path>]` | CALC + `golden/*.mjs` | script exporting `compute(input)` · GD rows filled by **running** it · `--sign` sets signedBy/evidence → `approved` | expected values come from the run, never typed · without signedBy status stays ≤ `reviewed` |
| `export <module> [--sign <STK> --evidence <path>]` | everything above, via query | `export/requirement-<module>.md` (Thai) · `--sign` = client signed the document → the module's REQ/BR/CALC/EX become `approved` with `approval: {by, at, evidence, docHash}` | file is written · nothing reads it back · without `--sign` no status changes |

`NEXT`: no REQ → capture · unasked bank question or BR without EX → ask / rules · BR with numbers and no CALC → calc · CALC without signed GD → golden · open Q → **stop** (blocks CP1) · else export.

## Gates it appends to gates.json (each backed by a function in `scripts/checks.mjs`)
| gate id | check | severity | rule |
|---|---|---|---|
| G-req-001 | `req:req-actor-goal` | error | every REQ has non-empty `actor` and `goal` |
| G-req-002 | `req:actor-is-stk` | error | every REQ.actor is an existing STK |
| G-req-003 | `req:br-has-example` | error | every BR@v with status ≠ retired has ≥1 EX |
| G-req-004 | `req:ex-cap` | error | no BR@v has more than 5 EX |
| G-req-005 | `req:calc-pins-one-br` | error | CALC.derivedFrom holds exactly one BR@v |
| G-req-006 | `req:golden-match` | error | re-running `golden/CALC-…@vN.mjs` on every GD row reproduces `expected` |
| G-req-007 | `req:golden-signed` | error | a GD with status approved has `signedBy` and `evidence` |
| G-req-008 | `req:br-one-active` | error | a BR lineage has at most one version that is not retired |
| G-req-009 | `req:br-version-needs-cr` | error | BR/CALC @vN+1 whose predecessor carries `approval` names a CR in `derivedFrom` |
| G-req-010 | `req:open-question` | warn | open Q exist (blocks CP1) — listed by id |

## Cold Start Test
Close every session. Reopen with only the files on disk. Ask: `BR-rental-012 เวอร์ชันไหน active และเพราะอะไร` and `BR เวอร์ชันไหนของ module rental approved แล้ว และพิสูจน์ด้วย EX อะไร`.
It must be answered from `/core:query BR-rental-012` (lineage: v1 retired + retiredReason + supersededBy → v2 with its EX) and `/core:next`, never from memory.

**Phase DoD** (docs/phase-plan.md row 1, on `test/rentpoint`): RentPoint §1 captured · 12 BR per §2 incl. BR-012 v1 retired → v2 · 3 CALC with GD matching §3 on re-run · EX ≤5 per BR · no artifact file > 300 lines · `export/requirement-rental.md` written · `gates.mjs` exit 0.

approved: 2026-09-05
