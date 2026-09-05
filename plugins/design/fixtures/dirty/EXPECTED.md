# dirty fixture — expected gate output

Run from this folder: `node ../../../core/scripts/gates.mjs --state-dir .sdlc`
(`project.json` points `plugins.design.root` at `../..`, which resolves to `plugins/design` from here.)

One violation per design gate. Core stays clean on purpose — anything core reports here is a fixture
bug, and `selftest.mjs` asserts that separately.

| gate | fires on | why |
|---|---|---|
| G-design-001 | design/domain.json | `ENT-001` has kind `widget` |
| G-design-002 | design/domain-states.json | state `stuck` has no way out and is not final |
| G-design-003 | design/loan/usecases/UC-loan-001.json | `UC-loan-001` satisfies no REQ |
| G-design-004 | req/loan/rules.json | `BR-loan-002@v1` is enforced by no step |
| G-design-005 | design/loan/usecases/UC-loan-001.json | `AC-loan-001` says "ระบบปฏิเสธ", `EX-loan-001` says "ระบบปฏิเสธ วงเงินสูงสุด 150,000" |
| G-design-006 | design/loan/screens/backoffice-baseline.json | `UI-loan-002` names app `warehouse` and origin `guesswork` |
| G-design-007 | design/loan/screens/customer-usecase.json | `UI-loan-001` claims origin usecase with no `displays` edge |
| G-design-008 | design screens | neither app has a login screen |
| G-design-009 | design screens | `ENT-002` is reference data with no master screen in backoffice |
| G-design-010 | design screens | backoffice owns roles but has no users / roles / permission-matrix |
| G-design-011 | design/rbac.json | `ROLE-001` derives from no STK |
| G-design-012 | both screen files | no ACL row exists at all |
| G-design-013 | design/loan/screens/customer-usecase.json | `UI-loan-001.submit` writes and names no API |
| G-design-014 | design/loan/usecases/… and req/loan/requirements.json | the main flow and `NFR-loan-001` have no SCN |
| G-design-015 | design/domain.json | `ENT-003` is a lookup with no decision (warn) |

The clean fixture next door is a full small design produced by running the real commands
(`core:init` → `req` → `domain` → `usecase` → `screens` → `api` → `rbac` → `scenario`): every gate
green, no screen added by hand.
