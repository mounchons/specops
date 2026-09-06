---
description: Draw every screen of one app at L1 — zones, controls, a data-testid on each, and an HTML page you can open.
argument-hint: <app> [UI-x,UI-y] [--cr CR-nnn]
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/wireframe.mjs" $ARGUMENTS
```

Show the table and the "not drawn" list verbatim, then stop. Do not add a control, a zone or a state by hand: **every field and action the screen declares becomes exactly one control, and nothing else does** (G-mock-001). A wireframe with a search box the design never mentioned is scope the client did not buy — and after they sign it, it is scope you owe them.

| the drawing lacks | the input to fix |
|---|---|
| a field | the `UI`'s `fields[]` — `/design:screens`, which takes it from the use case |
| a button | the `UI`'s `actions[]` |
| a role on the strip | an `ACL` row granting `view` — `/design:rbac` |
| a colour or a radius | `/mock:theme` — the mock never hard-codes one |

It refuses two things, and both refusals are the mechanism rather than an obstacle: a screen an **open CR has frozen** (redraw it with `--cr CR-nnn`, and the wireframe records which change it was drawn under), and a **signed** drawing that would have to change (that is what `/change:open` is for). Re-running is otherwise safe: it creates what is missing, re-renders every HTML page, and leaves identical drawings alone.

The HTML is written from the JSON and read back by nothing. Edits to it are lost on the next run; the JSON is the record, and its `hash` is what the client signs.
