---
description: Optional. Write the prompt that turns an L1 wireframe into a visual comp, and say where the answer goes.
argument-hint: <app> [MCK-x,UI-y]
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/sync-design.mjs" $ARGUMENTS
```

Show the list of prompt files and stop. **LIMIT** (constitution rule 1): no script here sends a prompt or fetches an answer — no gate can check that a comp matches its wireframe, so nothing pretends to. The owner sends it, and the file that comes back goes in `mock/<app>/design/`.

Nothing depends on this command. `approve`, every gate and the baseline hash look at the JSON only, so a project that never runs `sync-design` is complete, and a comp that drifts from the wireframe cannot make a gate go green or red.

The prompt says "ห้ามเพิ่ม ห้ามลด" for the same reason `/mock:wireframe` does: the control list is what the client signs. A comp with an extra button is a conversation to have before the signature, not after.
