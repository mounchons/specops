---
description: Class A or Class B — decided by whether the name is in a list on disk, never by judgment.
argument-hint: <UI-x|UC-x> --field <name> | --action <name> | --route <path> [--request "…"] [--cr CR-nnn]
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/revise.mjs" $ARGUMENTS
```

Show the result and stop.

**Class A** — the field, action or route is already declared on the artifact. Rearranging what the design promised is work dev may do: the task reopens with `origin: changed`.

**Class B** — it is not there. dev writes a `GAP` with the exact `/change:open` line and **no code**. Show that line to the owner; do not run it for them, and do not "just add the field because it is obviously needed". The moment dev adds something upstream never declared, the design stops describing the system and the baseline the client signed stops being the scope.

The command prints *where it looked* (`UI-rental-001.fields[]`, which may be empty) so the answer is checkable rather than asserted.

It refuses when a file the task owns differs from the last commit: somebody edited it by hand, and a script does not overwrite a person — commit or discard first. It also refuses an artifact an open CR has frozen unless `--cr` names that change.
