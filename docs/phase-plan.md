# specops — phase plan and DoD

Test project: **RentPoint** (`docs/testproject-rentpoint.md`, brand new, module `rental`, apps `backoffice` + `customer`). State dir lives in `test/rentpoint/.sdlc/`.
Each phase ends with its Cold Start Test green **and** `node plugins/core/scripts/gates.mjs` exit 0 on the test project.

| phase | plugin | DoD (must be green before the next phase starts) | cold start question |
|---|---|---|---|
| 0 | core | `selftest.mjs` passes · empty folder → `/core:next` says init → after init says fill apps → after apps says install req | "what do I do now?" |
| 1 | req | RentPoint §1 captured · 12 BR per §2 incl. BR-012 v1 retired → v2 · 3 CALC with GD matching §3 on re-run · EX ≤ 5 per BR · no artifact file > 300 lines · `req:export` writes `export/requirement-rental.md` | "which version of BR-rental-012 is active, and why?" |
| 2 | design | screen matrix matches RentPoint §5 without being asked (login / master / roles / permission for both apps, `origin: baseline|master`) · V-checks: every ROLE has a management UI, every reference ENT has an owner UI, every app with auth has login, every BR is `enforces`-ed by ≥ 1 UC step | "why does app customer have a login screen, and which BR does the booking-list screen enforce?" |
| 3 | change | CR-001/002/003 from RentPoint §6 get lanes ui / full / full with the listed impact · after `apply CR-001` design refuses to regenerate the touched UI until the CR closes | "what is frozen right now and why?" |
| 4 | mock | app `customer`: theme + MCK for every UI · `approve --sign --evidence` writes baseline · editing one MCK after signing turns a gate red | "what did the client sign, and when?" |
| 5 | dev | slice "ลูกค้าจองอุปกรณ์" (RentPoint §7) runs under docker compose · `TSK` has verify + proof + commit · unit tests assert GD values verbatim · asking for a "หมายเหตุ" field opens a `GAP` instead of code | "which class implements UC-rental-001 and which GD do its unit tests use?" |
| 6 | qa | `TC` from `SCN` without asking · one `RUN` with evidence · DEF-001 routes to dev with no CR · DEF-002 routes to design and opens a CR automatically (RentPoint §8) | "is REQ-rental-001 built, tested, and passing — with evidence?" |

## Reserved after phase 6
hotfix lane (`TSK.origin: hotfix` + CR back-filled within N days) · `qa:signoff` (UAT by client) · `MIG` data migration · `design:reverse` for brownfield ·
product mode (`BR.scope: core | tenant:<id>`, impact reports affected tenants) · discovery timebox lives in the quotation template, not in a plugin.
