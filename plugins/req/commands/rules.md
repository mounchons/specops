---
description: Example Mapping — rules, the examples that prove them, and the questions in the way. Retiring a rule keeps it.
argument-hint: <module> [--ex BR@v --given … --when … --then …] [--br "…"] [--retire BR@v --reason …]
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/rules.mjs" $ARGUMENTS
```

With no flags this prints the map: every rule, its examples, and the open questions. Show it verbatim.

```bash
# an example that proves one rule version — at most five per rule
node "${CLAUDE_PLUGIN_ROOT}/scripts/rules.mjs" rental --ex BR-rental-002@v1 \
  --given "ค่าเช่ารวม 2,400" --when "คิดมัดจำ" --then "ได้ 800"

# a rule found while mapping, not from the bank — --closes answers a question capture left open
node "${CLAUDE_PLUGIN_ROOT}/scripts/rules.mjs" rental --br "…" --from REQ-rental-003 --closes Q-rental-001

# a question whose answer creates no rule
node "${CLAUDE_PLUGIN_ROOT}/scripts/rules.mjs" rental --close Q-rental-002 --note "เจ้าของยืนยันว่าไม่มีเงื่อนไขนี้"

# a rule the owner withdraws
node "${CLAUDE_PLUGIN_ROOT}/scripts/rules.mjs" rental --retire BR-rental-012@v1 \
  --reason "เจ้าของเปลี่ยนใจในรอบที่ 2" --replace "…"

# something the mapping turned up that nobody can answer yet
node "${CLAUDE_PLUGIN_ROOT}/scripts/rules.mjs" rental --question "…" --category freeze-point
```

Write examples in the client's numbers, not invented ones, and prefer the boundary: the value where the rule changes its mind is the one that catches a wrong implementation. When a rule needs a sixth example, it is two rules — split it and say so.

A retired rule stays on disk with its reason. `--replace` mints `@vN+1`; `--cr CR-nnn` is required when the client had already approved the version being replaced.
