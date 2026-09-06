# change — one-page spec (constitution rule 2)

> Phase 3 · brief §5.3 · test project RentPoint §6: CR-001 display → `ui`, CR-002 screen → `full`, CR-003 report → `full` · delete when the plugin ships.
> Names are proposals. Inputs, outputs and DoD are not. Every command persists before it answers (rule 7).
> The graph is read through core's registry (every owner's edges); change never opens another plugin's folder — and, under W1, never writes one.

## Reads (inputs)
| id kinds | from | required |
|---|---|---|
| every artifact + every edge of every `trace.*.json` | core `registry.mjs` / `query.mjs` | `impact` `apply` `close` |
| `ENT.attributes` · `ACL` (role may view the screen) · `CALC` on the path | registry (design / req records by id) | `impact` — the `display` discriminator |
| `DEF` (phase 6, referenced only) | `qa/<module>/findings.json` | `open --source finding` |
| own `CR` | `change/open/` · `change/closed/` | all commands |

## Writes (outputs — only under `.sdlc/change/` and `trace.change.json`)
| id kinds minted | file | notes |
|---|---|---|
| `CR` | `change/open/CR-nnn.json` → `change/closed/CR-nnn.json` on close | `kind: display\|screen\|report\|rule\|other` · `source: client\|external\|internal\|finding` · `request` (the client's words) · `touches: [ids]` · `fields: ["ENT-nnn.attr"]` · `lane: null\|ui\|full` · `impact {affected[], toCreate{}, counts{}, decidedBy, reasons[]}` · `applied {at, commands[]}` · `closed {at, by, evidence}` · `finding: DEF-…` when source is finding |
| edges | `trace.change.json` | `CR touches <id>` for every touched id — the edge that freezes (every `from` is a CR: G-core-007) |
| — | nothing else | `apply` does **not** write `status: draft` into req/ or design/ (that is W1): it records what must happen on the CR and names the owning plugin's command with `--cr CR-nnn`; freezing is enforced by `isFrozen()` in every plugin's checks, not by mutating the frozen record |

`scripts/init.mjs` is not a command: every command calls it first; idempotently writes `project.json → plugins.change.root` and appends G-change-* to `gates.json`.
`scripts/checks.mjs` also exports **`isFrozen(id, ctx) → { frozen, by: CR, lane }`** — an id is frozen while an open CR lists it in `touches` or in `impact.affected`. mock/dev/qa call it before they start; design's `screens` already refuses on `touches` and moves to `isFrozen` in phase 4.

## Commands (≤ 6)
| command | in | out | DoD (a command that produces a real result) |
|---|---|---|---|
| `open --kind k --source s --title "…" --request "…" [--touches UI-x,ENT-y] [--fields ENT-y.attr] [--finding DEF-x]` | the request, the ids it names (if known) | CR `draft`, `lane: null` · `touches` edges | written before anything is said back · every touched id exists (core G-core-006) · `source: finding` without `--finding` is refused · a `display` CR without `--fields` is refused (nothing to display) |
| `impact <CR>` | CR + the whole graph | `affected[]` = transitive dependents of the touched ids (edges pointing *at* them: UI displays UC, ACL/API → UI, MCK → UI, SCN → UC, TC → SCN, TSK/IMP → UC/UI), expanded until SCN/TC/IMP · `toCreate` by kind (screen → UC UI API ACL SCN · report → CALC+GD RPT UI SCN TC · rule → BR@vN+1 EX SCN) · `counts` per prefix · **lane** + the reasons · written on the CR | discriminator, checkable: `display` is `ui` **iff** every field exists on its ENT ∧ the screen's roles already have `view` on it ∧ no CALC is touched or affected — else `full` · `screen` `report` `rule` → `full` (a report with totals is always full) · `other` → `--lane ui\|full` from the owner, refused otherwise · re-running overwrites the impact |
| `apply <CR> [--sign STK --evidence <path>]` | CR with a lane | `applied {at, commands[]}` — the exact commands per plugin in order for that lane: `ui` → `/design:screens` `/mock:wireframe` `/dev:revise` `/qa:cases` · `full` → `/req:rules --retire … --cr` or `/req:ask` · `/design:domain` … down the line · BR/CALC in `touches` are listed with their next version id `@vN+1` | refuses without a lane · refuses a CR already applied · writes nothing outside `change/` · from here every listed artifact answers `isFrozen() = true` until close |
| `close <CR> --sign STK --evidence <path>` | applied CR | moved to `change/closed/` · `closed {at, by, evidence}` · touches edges kept | refuses while any touched or affected artifact is `draft` or `reviewed` — the change is done when the owning plugins re-approved what it touched · refuses without evidence |

`NEXT` (core already puts open CRs first): CR without lane → `impact` · lane, not applied → `apply` · applied → the first command in `applied.commands` not yet reflected on disk · every touched/affected artifact ≥ approved → `close`.

## Gates it appends to gates.json (each backed by a function in `scripts/checks.mjs`)
| gate id | check | severity | rule |
|---|---|---|---|
| G-change-001 | `change:cr-shape` | error | every CR has `kind` and `source` from the lists, a `request`, and `lane` ∈ null · ui · full |
| G-change-002 | `change:finding-needs-def` | error | a CR with `source: finding` names an existing DEF in `finding` |
| G-change-003 | `change:display-needs-fields` | error | a `display` CR names ≥1 `ENT.attr` and every one exists on its ENT |
| G-change-004 | `change:stale-open` | warn | an open CR older than 14 days with no `impact` |
| G-change-005 | `change:frozen` | warn | lists every artifact with status ≥ approved that an open CR freezes, with the CR and its lane — printed every run, this is the Cold Start answer |
| G-change-006 | `change:closed-clean` | error | a closed CR has `closed.by` and `closed.evidence`, and nothing it touched is still `draft` |

## Cold Start Test
Close every session. Reopen with only the files on disk. Ask: `ตอนนี้อะไรถูกแช่แข็งอยู่ เพราะ CR ไหน และเป็น lane อะไร`.
It must be answered from `/core:check` (G-change-005 lists frozen ids · CR · lane), `/core:query CR-001` (touches, impact, lane, applied) and `/core:next` (open CRs first), never from memory.

**Phase DoD** (docs/phase-plan.md row 3, on `test/rentpoint`): CR-001 → `ui` with impact = the booking-list UI, its ACL/API dependents, and `toCreate` MCK 1 · TSK revise 1 · TC 1, touching no BR/UC · CR-002 → `full`, toCreate UC 1 · UI 1 (customer) · API 1 · ACL 1 · SCN 1, no BR · CR-003 → `full`, toCreate CALC-rental-004+GD · RPT 1 · UI 1 · SCN 1 · TC 1 and `/req:ask` named first · after `apply CR-001`, `/design:screens rental` exits 1 naming the touched UI · `gates.mjs` exit 0 (warns only) · no file > 300 lines.

approved: 2026-09-05
