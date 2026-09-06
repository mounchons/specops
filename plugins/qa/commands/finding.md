---
description: Routing is the whole command — a bug for dev, or a change request the spec has to answer.
argument-hint: <TC-nnn> --routing dev|design|req --reproduce "…" [--severity s1..s4] [--kind rule|display|screen|report|other] [--touches ids] [--evidence <file>]
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/finding.mjs" $ARGUMENTS
```

Show the finding and, when there is one, the change request it opened. Then stop.

**Ask the owner for the routing; never infer it from how the complaint was worded.** It is the field that decides whether the work is billable, and "the system does the wrong thing" is said the same way in both cases.

| routing | when | what happens |
|---|---|---|
| `dev` | the code does not do what the spec already says | a defect, no change request, nothing to bill |
| `design` | the spec is incomplete or ambiguous — the case it got wrong was never described | a `CR` with `source: finding` is opened here, touching the scenario |
| `req` | what the client wants has changed | the same, and the change goes back to `/req:ask` |

The defect is written before the change request, because change refuses a CR whose finding does not exist yet. Persist, then answer.

It refuses unless the case actually failed in its last run, or `--evidence` names a file that exists. A client's screenshot counts; a sentence does not. `--touches` defaults to the scenario, which is usually the artifact that has to change — pass ids explicitly when it is not.

The same case routed the same way twice is one defect, not one per run. And nothing here closes a defect: `/qa:run` does, when its case passes.
