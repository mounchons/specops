# mock — one-page spec (constitution rule 2)

> Phase 4 · brief §5.4 · test project RentPoint: app `customer`, 7 UI (login · profile · home · UC-001 · UC-002 · UC-005 · UC-007) · delete when the plugin ships.
> Names are proposals. Inputs, outputs and DoD are not. Every command persists before it answers (rule 7).
> An MCK is the UI's structure drawn, nothing more: the UI says what is on the screen, the MCK says where, the THM says how it looks. mock adds no field, action, route or state the UI does not declare — that is dev's Class B line, drawn one phase earlier.

## Reads (inputs)
| id kinds | from | required |
|---|---|---|
| `UI` `RPT` — `fields[]` `actions[]` `zones[]` `states[]` `kind` `app` | registry / `query` (design records by id) | `wireframe` `approve` |
| `ACL` — which roles may `view` the screen | registry | `wireframe` (the role strip on the mock) |
| `THM` — own | `mock/theme.json` | `wireframe` — refused without it |
| `isFrozen(id)` | `plugins/change/scripts/checks.mjs` | `wireframe` `approve` — refused on a frozen UI unless `--cr` names the CR that froze it |
| `STK` | registry | `approve --sign` |

## Writes (outputs — only under `.sdlc/mock/`, `.sdlc/export/`, and `trace.mock.json`)
| id kinds minted | file | notes |
|---|---|---|
| `THM` | `mock/theme.json` | `THM-001` only · `tokens {color.primary color.surface color.text spacing.unit radius font.family font.scale}` · `components[]` = the inventory dev may use (`button input select table card alert modal nav badge`) · `answeredBy`, `answeredAt` — the owner's answers, never defaults written silently |
| `MCK` | `mock/<app>/MCK-<module>-nnn.json` — one record per file | `ui: UI-x` · `app` · `zones[{name, controls[]}]` · every control `{testid, kind, from}` where `from` is `field:<name>` or `action:<name>` and `testid` = `field-<name>` / `action-<name>` · `states[]` copied from the UI · `roles[]` from ACL · `theme: THM-001` · `hash` (sha256 of the record without `hash` `signed` `renderedAt`) · `cr: CR-nnn` when drawn under a change · `signed {at, by, evidence, hash}` after approve |
| — | `mock/<app>/MCK-<module>-nnn.html` | static Bootstrap 5 (CDN), one page per MCK, every control carries `data-testid` · rendered from the JSON, never edited by hand, never read back by a script — the JSON is the truth |
| — | `export/mock-baseline-<app>@<date>.md` | the list the client signs: every UI/MCK of the app with its hash, the signer, the evidence path · written by `approve` · never read back (rule 4) |
| edges | `trace.mock.json` | `MCK mocks UI` — every `from` is an MCK (G-core-007) |

**No new id for the baseline** (DESIGN §4.1: no prefix → it is a field, not an artifact). The baseline *is* `signed{}` on every MCK of the app plus the export document; `mock/baseline/` from the brief is not written because a JSON with no `id` under a plugin folder is a core parse warning on every run. Re-signing after a CR closes overwrites `signed{}`; the earlier signed lists stay in `export/` and in git.

`scripts/init.mjs` is not a command: every command calls it first; idempotently writes `project.json → plugins.mock.root` and appends G-mock-* to `gates.json`.

## Commands (≤ 6)
| command | in | out | DoD (a command that produces a real result) |
|---|---|---|---|
| `theme [--records <file.json>]` | the owner's answers | `THM-001` | without `--records`: prints the 7 questions, each with the Bootstrap 5 default beside it, exit 1 — the owner answers, `default` is an answer, silence is not · with `--records`: writes the THM before printing it · a second run overwrites tokens, never the id |
| `wireframe <app> [UI-x,…] [--cr CR-nnn]` | UI + ACL + THM | one MCK + one HTML per UI of the app (or the listed ones) · `mocks` edges | refused without a THM · refused on a frozen UI unless `--cr` names the CR that froze it, and the MCK then carries `cr` · every UI field and action becomes exactly one control with a `data-testid`; nothing else does · a UI with 0 fields is drawn with zones and actions only and **printed** as such, not padded · re-running re-renders and creates only what is missing · a signed MCK is regenerated only under `--cr` (otherwise G-mock-003 would go red by the tool's own hand) |
| `approve <app> --sign STK-nnn --evidence <path>` | every MCK of the app | `signed{}` on each · status `approved` · `export/mock-baseline-<app>@<date>.md` | refused without signer or evidence, or if the evidence path does not exist · refused while any UI of the app has no MCK — a baseline with holes is not a scope · refused while any MCK of the app is frozen by an open CR · **the baseline is the scope of the quotation** |
| `sync-design <app> [UI-x]` *(optional — nothing in core or in `approve` depends on it)* | MCK | `mock/<app>/design/<MCK>.prompt.md` + the path where the returned file goes | writes the prompt for Claude Design from the MCK and THM · LIMIT: no script can send it or fetch the answer; the owner does, and the returned file lands in `mock/<app>/design/` where no gate reads it |

`NEXT`: an app with UI and no THM → `theme` · an app with UI but fewer MCK than UI → `wireframe <app>` · every MCK drawn, none signed → `approve <app>` · a signed MCK with a hash mismatch → `/change:open` (or `wireframe --cr` if a CR is already open for it).

## Gates it appends to gates.json (each backed by a function in `scripts/checks.mjs`)
| gate id | check | severity | rule |
|---|---|---|---|
| G-mock-001 | `mock:control-matches-ui` | error | every control of an MCK maps to a field or action of the UI it mocks, and every field and action of that UI has exactly one control — no affordance the design did not declare, nothing the design declared left out · testids unique within the MCK |
| G-mock-002 | `mock:theme-first` | error | an MCK exists while no THM does, or names a THM that does not exist — dev never sets its own values, so there must be values to reference |
| G-mock-003 | `mock:baseline-hash` | error | a signed MCK whose current hash ≠ `signed.hash` and that carries no `cr` naming an open CR freezing its UI — the screen was edited after the client signed it, without a change request |
| G-mock-004 | `mock:ui-without-fields` | warn | an MCK drawn from a UI that declares no fields — the wireframe is zones and buttons only, which is what the design said, and the owner should know that is what the client will sign |

`gates.json` on RentPoint is 293 lines before these four; after `mock:init` it is ~320. It is a core file that G-core-005 already excludes (no command reads it whole; `gates.mjs` reads it programmatically), so this is a rule-4 wording question for the owner, not a gate failure — decided at approve, recorded in the DoD.

## Cold Start Test
Close every session. Reopen with only the files on disk. Ask: `ลูกค้าเซ็น baseline ของ customer วันไหน มีหน้าไหนแก้หลังจากนั้น`.
It must be answered from `/core:query MCK-rental-001` (`signed.at` · `signed.by` · `signed.evidence` · `signed.hash`), `/core:check` (G-mock-003 names every MCK edited after signing, with the UI and the CR if any) and `/core:next`, never from memory.

**Phase DoD** (docs/phase-plan.md row 4, on `test/rentpoint`): `theme` with the owner's answers → `THM-001` · `wireframe customer` → 7 MCK + 7 HTML, every control `data-testid`-ed to a UI field/action, the 4 usecase screens printed as "0 fields" · `approve customer --sign STK-001 --evidence <path>` → 7 × `signed{}`, `export/mock-baseline-customer@<date>.md` · editing one MCK JSON by hand after signing → `gates.mjs` exit 1 on G-mock-003 naming it; `wireframe customer` (no `--cr`) refuses to overwrite it; restoring it → exit 0 · `wireframe backoffice` refuses `UI-rental-003` (frozen by CR-001) and accepts it with `--cr CR-001` · `gates.mjs` exit 0 at the end (warns only) · no file the AI reads > 300 lines.

approved: 2026-09-05
