---
description: Close a CR once every artifact it touched is back at approved. Moves it to closed/ and unfreezes the graph.
argument-hint: <CR-nnn> --sign STK-nnn --evidence <path>
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/close.mjs" $ARGUMENTS
```

Show the result and stop. If it exits 1 it has printed the artifacts that are not ready and the commands still owed — show that list; do not close anything by hand and do not edit a status to make it pass (P6: green that lies is worse than red that does not).

**A change is done when the owning plugins say so, not when the work feels finished.** Everything in `touches` and everything the impact walked has to be back at `approved` or beyond. That is the whole point of the freeze: the artifacts that depended on what moved get looked at again before the next change lands on them.

| it refuses | because |
|---|---|
| a CR that was never applied | nobody was ever told to do anything |
| no `--sign` | a change closes when a person says it is done, and the graph knows which person |
| no `--evidence`, or a path that does not exist | a closed change with no evidence is a claim |
| anything still `draft` or `reviewed` | exit 1, with the list |

The `touches` edges stay in `trace.change.json` after closing. The CR stops freezing things; it does not stop being the answer to "why does this screen look like this".
