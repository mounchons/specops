---
description: Turn a request into a CR before answering it. Takes the client's own words and the ids it names.
argument-hint: --kind display|screen|report|rule|other --source client|external|internal|finding --title "..." --request "..." [--touches ids] [--fields ENT-nnn.attr] [--finding DEF-x] [--module m] [--app a]
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/open.mjs" $ARGUMENTS
```

Show what it wrote, then stop. Do not decide the lane here and do not start any downstream work — the CR is on disk before anything is said back, and `/change:impact` is what reads the graph.

`--request` is the client's sentence, copied. A summary loses the one thing that cannot be reconstructed six weeks later: what they actually asked for.

`--touches` names ids that already exist. A change that creates something new (a screen, a report) touches nothing — that is normal, and it is why `--module` and `--app` exist.

It refuses, rather than writing a CR a gate would immediately call an error:

| refusal | what it means |
|---|---|
| `--touches X does not exist` | the id is wrong, or the thing was never designed |
| a display change with nothing to display | no `--fields` — it is a screen change, not a display change |
| `ENT-nnn has no attribute "x"` | the data does not exist yet; that is never lane `ui` |
| `--source finding` with no `--finding` | a defect that routed to spec has a DEF; without it nobody can tell which test found this |
| `--app is required` | a screen or report belongs to one app, and mock and dev are generated per app |
