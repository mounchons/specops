---
description: Run every gate in .sdlc/gates.json. Exit 1 on errors. LIMIT lines are rules no script can check yet.
argument-hint: [--plugin <name>] [--json]
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gates.mjs" $ARGUMENTS
```

Show the output verbatim, then for each ERROR name the one edit that closes it (file + change). Do not edit anything yourself unless the user says so.
Severity meaning: `ERROR` blocks the next phase · `WARN` is reported and continues · `LIMIT` = a gate exists in gates.json but no script implements its check — it never passes silently and never blocks; it is printed every run until a script exists or the gate is deleted.
Rebuild the cache if asked: `node "${CLAUDE_PLUGIN_ROOT}/scripts/registry.mjs" --build`.
