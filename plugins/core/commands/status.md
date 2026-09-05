---
description: One-screen status of the project from disk — artifacts by plugin and status, gate counts, open change requests.
argument-hint: "[--json]"
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/status.mjs" $ARGUMENTS
```

Show the output verbatim. Do not summarise it from memory of the conversation — the disk is the truth.
If `gates: error=N` with N > 0, tell the user to run `/core:check` before anything else.
