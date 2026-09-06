---
description: Ask the stack once, per app, and remember it for the project. Nothing here has a default.
argument-hint: [--records <file.json>] [--confirmed-by STK-nnn] [--code-root <path>]
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/stack.mjs" $ARGUMENTS
```

With no `--records` it prints what has to be answered, per app. Put the questions to the owner as they are and do not answer on their behalf — a stack nobody chose is the stack the first file happens to use, and by then it is in the code instead of in the record.

```json
{"by":"STK-001","components":{"api":{"language":"csharp","framework":"ASP.NET Core","version":"9","orm":"EF Core","db":"PostgreSQL 16","testRunner":"xunit","root":"src/Api","skills":"efcore-patterns","run":{"compose":"docker-compose.yml","up":"docker compose up -d","down":"docker compose down -v","healthcheck":"curl -fsS http://localhost:8080/health","test":"dotnet test"},"config":{"env":"ConnectionStrings__Db","secrets":"Db__Password"}}}}
```

Every app in `project.json` needs an entry, or the command refuses: without one, dev cannot say which component a file belongs to. Add a shared backend as an extra key (`"api"` → `CMP-api`).

`run.test` becomes the `verify` of every task in the project — the one command that decides whether a slice is done. `skills[]` names Claude skills a session should load for that component; no script can see whether a session has them, so `G-dev-008` prints that as a **LIMIT** on every run rather than pretending to check it.

Re-running overwrites the values and keeps the ids. `firstConfirmedAt` remembers when the stack was first agreed.
