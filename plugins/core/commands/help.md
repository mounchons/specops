---
description: How specops core works — state dir, ids, gates, and the five commands.
---

Print this, verbatim:

**specops core** — everything else in the marketplace stands on these five commands.

| command | does |
|---|---|
| `/core:init --name X --apps a:type,b:type` | create `.sdlc/` with `project.json` + core gates |
| `/core:status` | what exists, by plugin and status, from disk |
| `/core:next` | what may be done now (the callsheet) — never runs it |
| `/core:query <id>` | a slice of the graph around one id — the only way to read artifacts |
| `/core:check` | run gates.json — ERROR / WARN / LIMIT |

Id table: `node "${CLAUDE_PLUGIN_ROOT}/scripts/ids.mjs"` · validate: `node ".../ids.mjs" BR-loan-001@v1`
Selftest (phase-0 DoD proof): `node "${CLAUDE_PLUGIN_ROOT}/scripts/selftest.mjs"`

Ten-rule constitution lives in the marketplace `CLAUDE.md`. Rule 1: a rule no script can check is a LIMIT, not a rule.
