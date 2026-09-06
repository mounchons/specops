---
description: Walk the graph from what the CR touches, count what is hit, and let the walk decide the lane.
argument-hint: <CR-nnn> [--lane ui|full] [--json]
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/impact.mjs" $ARGUMENTS
```

Show the lane with its reasons, the affected list and the "to create" table verbatim, then stop. The lane is an output, never an input: `--lane` is accepted only for `--kind other`, the one kind with no rule a script can read, and the decision is then recorded as the owner's.

**The walk goes one way.** It follows the edges that point *at* the touched ids — API and ACL at a screen, MCK at a UI, TC at a scenario, TSK and IMP at a use case — and stops at `SCN` / `TC` / `IMP`. It never follows the edges the touched record itself points at: a screen names the use case it displays, and changing the screen does not change the use case. Walk both ways and every display change drags the whole design back in.

**The discriminator** (P5, "will the user see or do something no artifact declares?"), for a `display` change, is three answers a script can read:

1. every named field already exists on its entity
2. every touched screen already has a role with `view` on it
3. no `CALC` is touched or in the blast radius

All three yes → lane `ui`. Anything else → `full`. `screen`, `report` and `rule` are `full` by construction — a report has totals, and a total is a number nobody has signed.

The "next would be" column is a preview computed live. change does not mint ids it does not own, so no such id is written to the CR — only the kind, the count and the command that mints it.
