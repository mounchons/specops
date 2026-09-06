---
description: One vertical slice per unit of work, in a build order the graph decides.
argument-hint: <module>
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/plan.mjs" $ARGUMENTS
```

Show the table and stop. Do not reorder it by hand and do not split a task: **one use case is one slice, CRUD included**, and one capability is one slice however many apps show it. A task that is "just the API half" is a task nobody can prove with a running command.

Not every screen has a use case. The baseline pages every app has (login, profile, users, roles, settings…), the master maintenance a use case selects from, and the screens an NFR asks for are all generated on purpose (DESIGN.md P4) and are all work. `plan` mints one task per (origin, generatorKey) for them: `usecase: null`, `screenOrigin` + `group`, the screens of that capability in every app, the `apps[]` so the slice can print how each one signs in, and the `ACL` rows it has to enforce. Their build order is a rank — `baseline → master → usecase → nfr` — because a screen no use case produced names no state transition to sort on: sign-in comes before everything, a master comes before the use case that selects from it, and a screen that reads what the others wrote comes last.

The order comes from the state machine: a use case that moves a booking `confirmed → out` cannot be built before the one that produces `confirmed`. Where the design's steps name no transition, no dependency is invented — those tasks fall back to use-case order and the command **prints which ones**, so the gap is visible instead of guessed at.

| the plan is missing | the input to fix |
|---|---|
| a task | the `UC` — `/design:usecase <module>` |
| acceptance on a task | `AC` on that use case; the command refuses without at least one. A task with no use case has no AC by construction — it is finished against the `ACL` rows on its screens, and is refused without at least one of those |
| a `verify` command | `run.test` on a component — `/dev:stack` |
| golden rows | `CALC` + `GD` for the rules the use case enforces — `/req:calc`, `/req:golden` |

It refuses to plan a use case an open CR has frozen (exit 1, naming the change) and refuses a dependency cycle (exit 2) — a build order that cannot exist is better said out loud than resolved by guessing.

Re-running creates only what is missing; a task already on disk keeps its proof, its attempts and its commit.
