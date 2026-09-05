---
description: Create the .sdlc state dir (project.json + core gates). Run once per project.
argument-hint: --name <project> [--apps backoffice:backoffice-web,customer:customer-web,driver:mobile]
allowed-tools: Bash
---

Run exactly this, passing the user's arguments through unchanged:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" $ARGUMENTS
```

Then:
1. Show the script output verbatim.
2. If `apps=0`, ask the user for the app list as `name:type` pairs. Valid types: `backoffice-web` `customer-web` `mobile` `desktop` `api`. Do **not** invent apps.
3. Do not create any other file. `.sdlc/` is written by scripts only; every later plugin adds its own files through its own `init`.

State dir override: `--state-dir <path>` or `$SPECOPS_STATE_DIR`. Default is `./.sdlc`.
