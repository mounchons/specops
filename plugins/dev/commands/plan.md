---
description: One vertical slice per use case, in a build order the state machine decides.
argument-hint: <module>
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/plan.mjs" $ARGUMENTS
```

Show the table and stop. Do not reorder it by hand and do not split a task: **one use case is one slice, CRUD included**. A task that is "just the API half" is a task nobody can prove with a running command.

The order comes from the state machine: a use case that moves a booking `confirmed → out` cannot be built before the one that produces `confirmed`. Where the design's steps name no transition, no dependency is invented — those tasks fall back to use-case order and the command **prints which ones**, so the gap is visible instead of guessed at.

| the plan is missing | the input to fix |
|---|---|
| a task | the `UC` — `/design:usecase <module>` |
| acceptance on a task | `AC` on that use case; the command refuses without at least one |
| a `verify` command | `run.test` on a component — `/dev:stack` |
| golden rows | `CALC` + `GD` for the rules the use case enforces — `/req:calc`, `/req:golden` |

It refuses to plan a use case an open CR has frozen (exit 1, naming the change) and refuses a dependency cycle (exit 2) — a build order that cannot exist is better said out loud than resolved by guessing.

Re-running creates only what is missing; a task already on disk keeps its proof, its attempts and its commit.
