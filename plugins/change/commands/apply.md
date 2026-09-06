---
description: Hand the change to the plugins that own the artifacts — the exact commands, in order, for this lane.
argument-hint: <CR-nnn> [--sign STK-nnn] [--evidence <path>]
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/apply.mjs" $ARGUMENTS
```

Print the numbered command list and stop. Do not run any of it — one unit of work per session, and the owner drives (P8).

**apply changes no artifact.** It does not write `status: draft` into a req or design record: that file has an owner and it is not change (W1). The freeze is a question every plugin asks instead — `isFrozen(id)` answers true for everything in `touches` and everything the impact walked, until the CR closes. `/design:screens` already refuses on that basis; mock, dev and qa do the same.

| lane | the order |
|---|---|
| `ui` | `/design:screens` → `/mock:wireframe` → `/dev:revise` → `/qa:cases` |
| `full` | back to whoever owns the top of the change — `/req:ask` for a report, `/req:rules` for a rule, `/design:usecase` for a screen — then down the whole line |

A `BR` or `CALC` in `touches` is listed with the version its owner will mint next. Versioned kinds never change in place: the old one retires in the same command that mints `@vN+1`.

It refuses a CR with no lane (`/change:impact` first) and a CR that was already applied — re-applying would rewrite a plan somebody is working from. If the change itself changed, that is a new CR.
