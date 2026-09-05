---
description: Generate every screen from four sources and print the screen x app matrix. Takes no wish list.
argument-hint: <module> [--app <name>] [--json]
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/screens.mjs" $ARGUMENTS
```

Show the matrix and the "not generated, and why" list verbatim, then stop. Do not add screens by hand and do not edit the files it writes — anything missing means an input is missing:

| the matrix lacks | the input to fix |
|---|---|
| a transaction screen | the use case, or its `apps[]` |
| a master screen | the entity's `kind` (or a lookup with no decision) |
| login / users / roles / permission-matrix | `project.json` `apps[].auth` and `owns[]` |
| an audit log, an import page | the `NFR` that would force it |

Four generators: **G1** one screen per (use case, app it is used from) · **G2** one per reference entity in the app that owns master data · **G3** the shell every app of that type has · **G4** what an NFR forces.

Re-running is safe: it creates only what is missing and leaves the rest alone. It exits 1 if a screen an open `CR` has frozen would have to change — close the change first.

The matrix is what the client is quoted on. `origin: baseline` screens are the same set in every project, which is why they are priced as a package rather than one by one.
