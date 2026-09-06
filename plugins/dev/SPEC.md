# dev — one-page spec (constitution rule 2)

> Phase 5 · brief §5.5 · test project RentPoint §7: slice "ลูกค้าจองอุปกรณ์" (UC-rental-001) on C# ASP.NET Core 8 + EF Core + PostgreSQL 16 under docker compose · Class B test: "ช่องหมายเหตุ" → GAP, not code · delete when the plugin ships.
> Names are proposals. Inputs, outputs and DoD are not. Every command persists before it answers (rule 7).
> dev writes code, and the code is not the record. The record is: which slice, which files, which command proved it, which commit. A TSK with no `proof[]` is a claim (P6); a file with no IMP is code nobody owns (P7); a field the design never declared is a GAP, never a commit (Class B).

## Reads (inputs)
| id kinds | from | required |
|---|---|---|
| `UC` `AC` `SCN` — the slice; `ENT` `STM` `API` `ACL` — its shape; `MCK` — the testids the UI must carry; `THM` — the tokens dev references, never sets; `CALC` `GD` + `req/<m>/golden/*.mjs` — the numbers and the answer key | registry / `query` (by id, never by folder) | `plan` `task` `handoff` |
| `DEC` (client-signed technical decisions, if design wrote any) · `STK` | registry | `stack` |
| `isFrozen(id)` | `plugins/change/scripts/checks.mjs` | `plan` `task` `revise` — refused on a frozen UC/UI/AC |
| the client project: files under each `CMP.root`, `git status` and `git log` of the code root | disk · git | `task` `revise` |

**Code root** = the directory that contains `.sdlc/` (override `--code-root <path>`), persisted on every CMP as `codeRoot` so a second machine reads it from disk. It must be a git repository: a TSK closes on a commit, and a commit is the only "done" a script can verify.

## Writes (outputs — only under `.sdlc/dev/`, `trace.dev.json`, and the client project's code)
| id kinds minted | file | notes |
|---|---|---|
| `CMP` | `dev/components.json` | one per app (+ `CMP-api` when apps share a backend) · `language framework version orm db testRunner skills[] root codeRoot` · `run {compose, up, down, healthcheck, test}` · `config {env[], secrets[]}` · `confirmedBy: STK` · `decidedFrom: [DEC…]` — `stack` asks once and never guesses; a project with no CMP cannot `plan` |
| `TSK` | `dev/tasks/<module>/<TSK>.json` | one per unit of work = one vertical slice (CRUD = 1) · `usecase` `acceptance[AC]` `scenarios[SCN]` `screens[UI]` `mocks[MCK]` `acls[ACL]` `apps[]` `components[CMP]` `calcs[CALC]` `golden[GD]` · `screenOrigin: usecase|baseline|master|nfr` + `group` + `module` — a screen no use case produced is still work, and its task carries `usecase: null` and is finished against its ACL rows · `origin: new|bound|changed` · `order` (topological over `dependsOn` inside a rank; the ranks are `baseline → master → usecase → nfr`, refused if cyclic) · `verify` (the command that proves it — from `CMP.run.test`) · `proof[] {cmd, result, exitCode, at}` · `attempts` · `blocked {at, reason}` after 3 failed verifies · `commit` on close · `abandoned[] {at, reason, was}` when a start is undone · `cr` when origin is changed |
| `IMP` | `dev/impl/<TSK>.json` | one per file the slice touches · `path` (relative to `codeRoot`, must be under a `CMP.root`) · `component: CMP` · `kind: source\|test\|migration\|config` · `implements: [TSK]` · a `test` IMP carries `golden: [GD…]` |
| `GAP` | `dev/gaps.json` | `question` (the request, verbatim) · `about: UI\|UC\|API` · `class: B` · `asks: field\|action\|route` · `openWith` = the exact `/change:open …` line · `cr: null` until the owner runs it · `answer` closes it — never a guess |
| edges | `trace.dev.json` | `TSK implements UC` · `TSK implements AC` · `IMP implements TSK` · `TSK uses GD` · `TSK implements UI` and `TSK enforces ACL` for a task with no use case — never an edge to a `BR` (the UC carries the rule; G-dev-006) |
| — | the client project | source, tests, migrations, `docker-compose.yml` — written by the session under `task`, owned by an IMP or warned about |
| — | `export/handoff-<module>.md` | the manifest qa reads — never read back by a script |

`scripts/init.mjs` is not a command: every command calls it first; idempotently writes `project.json → plugins.dev.root` and appends G-dev-* to `gates.json`.

## Commands (≤ 6)
| command | in | out | DoD (a command that produces a real result) |
|---|---|---|---|
| `stack [--records <file.json>] [--confirmed-by STK]` | the owner's answers per app | `CMP` per app + shared api · `run` + `config` | without `--records`: prints the questions per app (language framework version orm db testRunner skills run compose) and exits 0 — nothing is guessed · with them: every app answered or refused (exit 2) · `confirmedBy` must be a STK · re-running overwrites values, keeps ids · **asked once, remembered for the project** |
| `plan <module>` | UC AC SCN UI MCK CALC GD | one TSK per live UC, `order` topological, `verify` from `CMP.run.test`, `implements` edges | refused without CMP · refused for a UC that `isFrozen()` (exit 1, naming the CR) · every TSK has ≥ 1 AC and a `verify` · `dependsOn` from ENT/STM (a UC that moves a state depends on the UC that creates it) · cycle → exit 2 · re-running creates only what is missing |
| `task <TSK> [--start \| --impl <path>=<kind> \| --verify \| --close \| --abandon]` | the TSK + its slice | `--start`: the slice printed (UC flows, AC verbatim, ENT/STM, API + INT with its failure mode, ACL, MCK testids, CALC + GD rows, CMP stack), `status: approved`, `startedAt`, `startCommit` · `--impl`: an IMP per file (path must be under the component's root) · `--verify`: runs `verify`, appends `proof {cmd, result, exitCode, at}`; 3 failures → `blocked` · `--close`: `status: verified`, `commit` · `--abandon`: back to `draft`, `abandoned[] {at, reason, was}` | closes only when the last proof exits 0 **and** HEAD ≠ `startCommit` **and** the commit message contains the TSK id **and** the code root is clean — the diff was committed by a person (P8) · refused on a frozen UC/UI · a test IMP with `golden` must contain every `expected` scalar of each GD literally (G-dev-004), or `--close` refuses naming the missing value · `--abandon` is refused (exit 2) the moment there is anything to lose: a proof that ran, a file an IMP claims, or a task already verified — real work that has to be undone is a change request, not an eraser |
| `revise <UI\|UC> --field x \| --action x \| --route x [--request "…"]` | a change to existing code | Class A: `TSK origin: changed` (the thing exists on the UI/API — rearranging what design declared) · Class B: `GAP` + the `/change:open` line, **no code, no TSK** | the discriminator is a lookup, not a judgment: the named field/action/route exists on the artifact → A, else → B · refused (exit 1, asks) when any target file differs from the last commit — a person edited it, and a script does not overwrite a person · refused on a frozen artifact without `--cr` |
| `handoff <module>` | TSK IMP CMP MCK | `export/handoff-<module>.md`: per TSK the AC done, controls + testids, real endpoints, unit tests + the GD they use, `run.up` + `healthcheck` | refused while any TSK of the module is below `verified` (exit 1, lists them) · qa writes TC from it without asking anyone |

`NEXT`: apps with no CMP → `stack` · CMP but no TSK for a module with UC → `plan` · first TSK by `order` not started → `task --start` · started with no proof → `task --verify` · proof green, no commit → `task --close` · a GAP with `cr: null` → the `openWith` line · every TSK verified → `handoff`.

## Gates it appends to gates.json (each backed by a function in `scripts/checks.mjs`)
| gate id | check | severity | rule |
|---|---|---|---|
| G-dev-001 | `dev:tsk-needs-proof` | error | a TSK at `implemented` or beyond has no `proof[]` entry with `exitCode: 0` — done is a run, not a status |
| G-dev-002 | `dev:imp-in-layout` | error | an IMP's path is outside its component's `root`, or its file does not exist |
| G-dev-003 | `dev:tsk-frozen` | error | a TSK below `verified` whose UC, UI or AC an open CR freezes, unless `TSK.cr` names that CR |
| G-dev-004 | `dev:gd-verbatim` | error | a test IMP names a GD and its file lacks one of the GD's `expected` scalars as a literal |
| G-dev-005 | `dev:file-without-imp` | warn | a source or test file under a `CMP.root` that no IMP owns (extensions from the CMP's language) |
| G-dev-006 | `dev:trace-uc-not-br` | error | an edge in `trace.dev.json` points at a BR — dev traces the use case, the use case carries the rule |
| G-dev-007 | `dev:gap-open` | warn | a GAP with `cr: null` and no `answer` — code is waiting on a question nobody has put upstream |
| LIMIT | `dev:skill-installed` | — | `CMP.skills[]` names Claude skills; no script can see what the running session has installed. Printed every run. |

`gates.json` grows to ~380 lines with these seven; the phase-4 decision (core file, exempt from G-core-005, not read whole by any command) stands.

## Cold Start Test
Close every session. Reopen with only the files on disk. Ask: `class ไหน implement UC-rental-001 และ unit test ใช้ GD ไหน`.
It must be answered from `/core:query UC-rental-001` (`<- TSK-001 (implements)`), `/core:query TSK-001` (`proof[]`, `commit`, `-> IMP-… (implements)`, `-> GD-rental-001 (uses)`) and `/core:query IMP-nnn` (`path`, `golden`), never from memory.

**Phase DoD** (docs/phase-plan.md row 5, testproject §7, on `test/rentpoint` — which is made a git repository first): `stack` with §7's answers → CMP-api (C# · ASP.NET Core 8 · EF Core · PostgreSQL 16 · xunit) · CMP-backoffice · CMP-customer, `run.compose` = api + postgres · `plan rental` → 9 TSK, TSK-001 = UC-rental-001 with AC, SCN, CALC-001/002, GD-001/002, `verify` = the dotnet test command · `task TSK-001 --start` prints the slice · the session writes the endpoint (create Booking → BR-006 maintenance check → CALC-001/002 → draft → audit BR-010), the unit tests whose expected values are GD-rental-001/002 word for word, the migration, `docker-compose.yml` · `--impl` per file · `docker compose up` + `healthcheck` green · `--verify` exit 0 with the test count · a commit naming TSK-001 · `--close` → `verified` with `commit` · `revise UI-rental-001 --field note` → GAP-001 + the `/change:open` line, no file written · `handoff rental` refused (8 TSK not verified) with the list · `gates.mjs` exit 0 (warns only) · no file the AI reads > 300 lines. Requires `dotnet` 8 SDK and `docker` on the machine that runs the DoD: if either is absent the row is FAIL with the missing tool named, never skipped.

approved: 2026-09-05
amended: 2026-09-06 — `plan` mints a task for work that is not a use case. It walked `UC` only, so 15 of RentPoint's 28 screens (11 baseline, 3 master, 1 nfr) were in no TSK at all — login among them, and with it the identity that 7 `dataScope: own` ACL rows depend on. One task per (origin, generatorKey): one capability across however many apps show it, `usecase: null`, finished against its ACL rows instead of acceptance criteria it was never given, ordered by rank because a screen no use case produced names no state transition to sort on. The phase-5 DoD row "`plan rental` → 9 TSK" reads 21 after this; the 9 it named are unchanged and `plan` is still idempotent.
amended: 2026-09-06 — `task --abandon`. TSK-010 started, its slice turned out to declare no endpoint, dev opened GAP-002, the owner opened CR-005 — and the screen the task had started against became frozen by it. `approved` under that freeze is a standing G-dev-003 error and no command could clear it: `--start` refuses a frozen task, nothing reverses one. `--abandon` puts a task that produced nothing back to `draft` and keeps the attempt in `abandoned[]`; it refuses the moment there is a proof, an IMP or a close. `sliceOf` also collects `INT` now — INT-001 LINE Login served the customer login screen the whole time and the slice never printed it, which is how a session ends up in `design/` looking for how a screen signs in (rule 6).
