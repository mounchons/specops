---
description: Build the answer key for a calculation by running it, then have a stakeholder sign it. dev's unit tests quote these values verbatim.
argument-hint: <CALC@v> [--script <file.mjs>] [--row '{…}'] [--run] [--sign STK-nnn --evidence <path>]
allowed-tools: Bash
---

Four steps, in order.

1. Write the implementation to a scratch `compute.mjs` — one exported function, no dependencies, no I/O:

```js
export function compute(input) {
  const fee = input.days * input.rate;
  return Math.ceil((fee * 0.3) / 100) * 100;
}
```

2. Install it, add the input rows from the rule's examples, run, sign:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/golden.mjs" CALC-rental-002@v1 --script compute.mjs
node "${CLAUDE_PLUGIN_ROOT}/scripts/golden.mjs" CALC-rental-002@v1 --row '{"days":3,"rate":800}' --label "ขอบเขต: ปัดขึ้น"
node "${CLAUDE_PLUGIN_ROOT}/scripts/golden.mjs" CALC-rental-002@v1 --run
node "${CLAUDE_PLUGIN_ROOT}/scripts/golden.mjs" CALC-rental-002@v1 --sign STK-001 --evidence docs/evidence/line-2026-09-05.png
```

Show `--run` output verbatim and **read the numbers back to the owner before signing**. The script has no idea whether its formula matches the rule; the owner does. Adding a row clears every expected value, so `--run` again after any change.

Never edit an expected value by hand. If a number looks wrong, the formula is wrong, or the rule is — fix that and re-run. `G-req-006` re-runs the script on every `/core:check` and turns red the day the two disagree.
