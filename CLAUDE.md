# specops — CLAUDE.md

Human-driven SDLC marketplace for Claude Code. Requirement → design → mock → dev → qa, with change control
and traceability enforced by **scripts**, not prose. This file is the only governing document and must stay
under 150 lines (rule 3). Anything longer belongs in a script, a gate, or a one-page plugin spec.

## Constitution — 10 rules

1. A rule no script can check is a **LIMIT line**, not a rule. `gates.mjs` prints it every run; it never passes silently and never blocks.
2. A plugin that is not built yet has a **one-page spec**: inputs, outputs, DoD. Nothing else. (`docs/plugin-spec-template.md`)
3. Gates live in `.sdlc/gates.json` only. This file stays ≤ 150 lines.
4. A file the AI reads is ≤ **300 lines** (gate G-core-005). `.sdlc/export/` is output only and is never an input.
5. **One file, one owner** (W1). A plugin writes only `.sdlc/<plugin>/**` and `.sdlc/trace.<plugin>.json`.
6. Commands take **ids**; scripts hand back **slices** (`/core:query`). Never open an artifact file to "look around".
7. **Persist before answering.** A decision that is not on disk did not happen. Every command's DoD includes the write.
8. Every phase closes with a **Cold Start Test** on a real project (`docs/phase-plan.md`).
9. **No new command** until the previous phase's DoD is green.
10. **Human drives, AI executes.** No orchestrator, no subagent, no model routing.

## State dir `.sdlc/`

```
project.json            core · apps[] {name,type,auth,owns} · modules[] · plugins{name:{root}}
gates.json              core · the only home of gates
registry.json           core · CACHE, rebuilt by registry.mjs — delete freely
req/<module>/*.json     req    design/<module>/*.json  design    design/*.json  (project-scoped: domain, api, rbac)
change/open|closed/     change   mock/<app>/  mock   dev/*.json  dev   qa/<module>/  qa
trace.<plugin>.json     edges {from, rel, to} — `from` must be an id the plugin owns (G-core-007)
export/                 rendered documents for the client — never read back
```

State dir override: `--state-dir <path>` or `$SPECOPS_STATE_DIR`.

## Artifact conventions (every plugin, no exceptions)

- A JSON file is `{ id, … }` or `{ schemaVersion, items: [ {id,…} ] }` or `[ {id,…} ]`. Markdown with frontmatter `id:` also counts.
- Every record: `id`, `status` ∈ `draft → reviewed → approved → implemented → verified → retired`, and `derivedFrom: [ids]` where it applies.
- Ids come from **one table**: `plugins/core/scripts/ids.mjs`. Prefix → owner. A plugin mints only its own prefixes.
  Removed on purpose: `FUN-` (use `UC`), `CHG-` (use `CR`), `FE-` (use `TSK`).
- Any known id that appears anywhere inside a record becomes a `refs` edge automatically. Named edges go in `trace.<plugin>.json`.
- `UC` steps carry `enforces: [BR-…@vN]`. `UI` records carry `app` and `origin: usecase|master|baseline|nfr`.
- Versioned kinds (`BR`, `CALC`) never change in place: a change mints `@vN+1` through a `CR`.

## How a plugin plugs in

1. `plugins/<name>/.claude-plugin/plugin.json` + `commands/*.md` (≤ 6) + `scripts/`.
2. Its `init` writes `project.json → plugins.<name>.root` and appends its gates to `gates.json` (`check: "<name>:<check>"`).
3. `scripts/checks.mjs` exports `CHECKS` (`{ "<name>:<check>": (ctx) => [{subject, message, severity?}] }`) and optionally `NEXT`
   (`[(ctx) => [{action, reason, stop?}]]`). `ctx = { stateDir, project, state, registry }`. Core loads both automatically.
4. Import shared code from core: `paths.mjs` `ids.mjs` `artifacts.mjs` `registry.mjs` `query.mjs`. Never copy them.
5. Scripts are dependency-free Node ≥ 20 ESM. Exit codes: `0` ok · `1` findings · `2` unusable arguments/environment.

## Build order and where we are

| phase | plugin | status |
|---|---|---|
| 0 | core | **built** — `node plugins/core/scripts/selftest.mjs` is the proof |
| 1 | req | next — capture · ask (question bank) · rules (Example Mapping) · calc · golden · export, per module, EX cap 5/BR |
| 2 | design | domain(kind) · usecase · **screens = 3 generators + matrix** · api · rbac · scenario |
| 3 | change | open · impact (graph walk over all trace files) · apply · close · lane ui/full |
| 4 | mock | wireframe L1 · theme · approve --sign (baseline) · sync-design (optional) |
| 5 | dev | stack · plan · task (vertical slice, verify + proof) · revise (Class A/B) · handoff |
| 6 | qa | cases · run · finding (routing dev/design/req → CR) · report |
| 7+ | reserved | hotfix lane · UAT signoff · MIG · design:reverse · product mode (`BR.scope`) |

## Driving the build remotely (owner types short commands, never pastes)

`/phase` shows the build-state table and asks which step · `/phase 1` runs the next undone step of phase 1 ·
`/phase 1 spec|approve|build|dod` runs one step · plain text works too: "ทำต่อ" = `/phase`, "อนุมัติ" = `/phase <current> approve`.
State is computed by `node scripts/build-state.mjs` from files on disk (SPEC.md · checks.mjs · docs/dod/phase-n.md), never from chat.
Model per step — the owner switches with `/model`, the AI never routes: spec · dod → **Fable** (writes, verifies) · build → **Opus**.
`build-state.mjs` prints it; the running model self-checks and refuses a mismatched step (LIMIT: no script can see the model).

## Running core by hand

```bash
node plugins/core/scripts/init.mjs --name rentpoint --apps backoffice:backoffice-web,customer:customer-web
node plugins/core/scripts/next.mjs            # the callsheet
node plugins/core/scripts/gates.mjs           # ERROR / WARN / LIMIT, exit 1 on errors
node plugins/core/scripts/query.mjs UI-loan-001
node plugins/core/scripts/status.mjs
node plugins/core/scripts/ids.mjs             # the id table
```

## Source of this design

`docs/DESIGN.md` is the rationale (read it first; it tells you how to decide when the brief is silent). `docs/SPECOPS-BRIEF.md` is the build brief (all seven plugins, one page each). `docs/testproject-rentpoint.md` is the only test
project. `docs/PROMPTS.md` holds the per-phase prompts. Decision record in graph-brain: **specops - Master Decision Record**.
