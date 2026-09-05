# design — one-page spec (constitution rule 2)

> Phase 2 · brief §5.2 · test project RentPoint, module `rental`, apps `backoffice` + `customer` · delete when the plugin ships.
> Names are proposals. Inputs, outputs and DoD are not. Every command persists before it answers (rule 7) and reads req only through `/core:query`.
> Same split as req: the AI reads and writes a records payload; the scripts mint ids, place files, generate what is generatable, and refuse what the gates refuse.

## Reads (inputs)
| id kinds | from | required |
|---|---|---|
| `REQ` `NFR` `BR@v` `EX` `UL` `STK` | `req/**` via query — never by opening the folder | all commands |
| `apps[] {name, type, auth, owns}` · `modules[]` | `project.json` (core) | `screens` `rbac` |
| baseline catalogue per app type: login · forgot-password · profile · home · users · roles · permission-matrix · audit-log · settings | `plugins/design/references/app-baselines/<type>.json` | `screens` (G3) |
| own records `ENT` `STM` `UC` `AC` `UI` `ROLE` `ACL` | `design/**` | later commands |
| open `CR` touching a UI / UC (phase 3) | `change/open/` via query | `screens` refuses to regenerate a frozen UI |

## Writes (outputs — only under `.sdlc/design/` and `trace.design.json`)
| id kinds minted | file | notes |
|---|---|---|
| `ENT` `STM` | `design/domain.json` → `design/domain/<ENT>.json` past 300 lines | `kind: aggregate\|entity\|reference\|lookup\|vo` · attributes · invariants `[BR@v]` · lookup carries `lookupAs: master\|seed\|null` · STM `states[] {name, final?}` `transitions[] {from, to, by: ROLE?, enforces: [BR@v]}` |
| `UC` `AC` | `design/<module>/usecases/<UC>.json` | one file per UC: `actor: STK` · `apps[]` (the apps this UC is used from) · `precondition` · `flows {main, alt[], exception[]}` each a step list with `enforces: [BR@v]` · `crud: ENT?` (CRUD = one UC) · AC records `{given, when, then}` with `then` **verbatim** from an `EX.then` · `derivedFrom: [REQ, EX]` |
| `UI` `RPT` | `design/<module>/screens/<app>.json` | `app` mandatory · `origin: usecase\|master\|baseline\|nfr` · `kind` (list · form · detail · login · …) · `fields[] → ENT.attribute` · `actions[] {name, writes, api?}` · `zones` · `states` · `roles[]` · RPT `columns[] → ENT.field` `totals[] → CALC` · `derivedFrom: [UC \| ENT \| app-type baseline \| NFR]` |
| `API` `INT` | `design/api.json` | endpoint contract per write action that crosses an app boundary · INT with `failureMode` |
| `ROLE` `ACL` | `design/rbac.json` (ROLE) + `design/rbac/<ROLE>.json` (its ACL rows) | ROLE `derivedFrom: [STK]` · ACL `role × resource(UI\|API\|ENT) × action × dataScope` · default deny: a UI with no row is unreachable |
| `SCN` | `design/<module>/scenarios/<UC>.json` | one per UC flow (main / each alt / each exception) + one per NFR · `expected` states the observable result · `derivedFrom: [UC, AC?]` or `[NFR]` |
| `DEC` `ADR` | `design/decisions.json` · `design/adr/ADR-nnn.md` | DEC = a technical decision the client signs (with evidence) · ADR = design's own reasoning |
| edges | `trace.design.json` | `UC satisfies REQ` · `UC enforces BR@v` (rolled up from its steps) · `UI displays UC` · `UI displays ENT` (master) · `SCN verifies UC` — every `from` is a design id (G-core-007) |
| document | `export/design-<module>.md` | Thai: domain · use cases · **screen matrix entity/UC × app with origin** · roles · scenarios · output only, never read back |

`scripts/init.mjs` is not a command: every command calls it first; idempotently writes `project.json → plugins.design.root` and appends G-design-* to `gates.json`.

## Commands (≤ 6)
| command | in | out | DoD (a command that produces a real result) |
|---|---|---|---|
| `domain <module> [--lookup ENT=master\|seed]` | REQ BR UL (query) + records payload `{entities[], stateMachines[]}` | ENT with `kind` · attributes · invariants naming BR@v · STM per aggregate with a lifecycle | every ENT has a kind · every STM state that is not `final` has ≥1 transition out · a lookup with no `lookupAs` is written and reported, never guessed |
| `usecase <module>` | REQ BR ENT STM EX + payload `{usecases[]}` | UC per capability (CRUD of one ENT = one UC) with `apps[]`, flows whose steps carry `enforces` · AC per flow with `then` copied from an EX | refuses an AC whose `then` matches no EX verbatim · refuses a UC that satisfies no REQ · every live BR of the module is enforced by ≥1 step, or the command lists which are not |
| `screens <module> [--app a]` | UC ENT ROLE apps baselines NFR · **no payload** — generated | **G1** one UI per (UC, app in UC.apps) `origin: usecase` · **G2** master UI per ENT kind reference (and lookup decided master) in the app that `owns: master`, read-only elsewhere `origin: master` · **G3** baseline set per app type (login for auth≠none, users/roles/permission-matrix in the app that owns them, home for all) `origin: baseline` · **G4** from NFR (audit → audit-log, …) `origin: nfr` · RPT the client asked for · prints the **matrix** entity/UC × app | idempotent: re-running changes nothing already generated · refuses to touch a UI an open CR touches · a lookup ENT with `lookupAs: null` is skipped and named |
| `api <module>` | UC UI ENT + payload `{apis[], integrations[]}` | API per write action that crosses an app boundary · INT with failure mode · UI.action.api back-filled | every UI action with `writes: true` and an app boundary names an API |
| `rbac` | STK UC UI ENT + payload `{roles[], acl[]}` | ROLE (one per STK party that uses an app) `derivedFrom: [STK]` · ACL rows · data scope from BR (`ลูกค้าเห็นเฉพาะของตัวเอง` → `dataScope: own`) | every ROLE traces to a STK · every UI has ≥1 ACL row · default deny |
| `scenario <module>` | UC AC NFR — generated, `--expected SCN=…` to fill | SCN per UC flow + per NFR with `expected` · re-renders `export/design-<module>.md` | every UC flow and every NFR has ≥1 SCN · an SCN without `expected` is `draft` and listed |

`NEXT`: no ENT for a module → domain · lookup undecided → domain --lookup · BR not enforced → usecase · UC without a UI → screens · write action without API → api · no ROLE → rbac · flow without SCN → scenario · else "design of `<module>` complete — /mock:theme".

## Gates it appends to gates.json (each backed by a function in `scripts/checks.mjs`)
| gate id | check | severity | rule |
|---|---|---|---|
| G-design-001 | `design:ent-kind` | error | every ENT has `kind` ∈ aggregate · entity · reference · lookup · vo |
| G-design-002 | `design:stm-exit` | error | every STM state not marked `final` has ≥1 transition out |
| G-design-003 | `design:uc-satisfies-req` | error | every UC traces `satisfies` to ≥1 REQ |
| G-design-004 | `design:br-enforced` | error | every live BR@v of a module with UCs is named in `enforces` of ≥1 step |
| G-design-005 | `design:ac-then-verbatim` | error | every AC.then equals the `then` of an EX of a BR the UC enforces |
| G-design-006 | `design:ui-app-origin` | error | every UI has `app` ∈ project.apps and `origin` ∈ usecase · master · baseline · nfr |
| G-design-007 | `design:ui-usecase-traces-uc` | error | a UI with `origin: usecase` has a `displays` edge to a UC — otherwise it is scope creep |
| G-design-008 | `design:login-per-app` | error | every app with `auth ≠ none` has a UI `origin: baseline, kind: login` |
| G-design-009 | `design:master-owner-ui` | error | every ENT `kind: reference` (or lookup with `lookupAs: master`) has a UI `origin: master` in the app that `owns: master` |
| G-design-010 | `design:role-management-ui` | error | the app that `owns: roles` has baseline UIs users · roles · permission-matrix — every ROLE is managed there |
| G-design-011 | `design:role-traces-stk` | error | every ROLE has `derivedFrom` naming an STK |
| G-design-012 | `design:ui-has-acl` | error | every UI has ≥1 ACL row |
| G-design-013 | `design:write-action-has-api` | error | every UI action with `writes: true` that crosses an app boundary names an API |
| G-design-014 | `design:flow-has-scn` | error | every UC flow and every NFR has ≥1 SCN |
| G-design-015 | `design:lookup-undecided` | warn | a lookup ENT still has `lookupAs: null` — ask the owner: master screen or seed data |

## Cold Start Test
Close every session. Reopen with only the files on disk. Ask: `ทำไม app customer มีหน้า login` and `UI รายการจองบังคับ BR อะไร`.
It must be answered from `/core:query UI-rental-<login>` (origin baseline · app customer · derivedFrom app type customer-web, auth line) and `/core:query UI-rental-<booking-list>` → `displays UC-rental-002` → steps `enforces` (BR-rental-009 data scope, …), never from memory.

**Phase DoD** (docs/phase-plan.md row 2, on `test/rentpoint`): screen matrix equals RentPoint §5 without any screen being asked for · ENT kinds equal §4 · V-checks green: every ROLE managed, every reference ENT has an owner UI, both apps have login, all 11 live BR enforced · every UC flow and NFR has an SCN · `gates.mjs` exit 0 · no file > 300 lines.

approved: 2026-09-05
