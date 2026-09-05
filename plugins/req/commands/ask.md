---
description: Put the next three question-bank questions to the owner, then write the answer and the rule it mints.
argument-hint: <module> [--answer Q-x=b [--rule "…"]] [--defer Q-x] [--category c]
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/ask.mjs" $ARGUMENTS
```

With no flags this writes the next round of three questions to disk and prints them. Show them verbatim, including the ⭐ on the owner's default, and stop — the human answers.

To record an answer, one call per question:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/ask.mjs" <module> --answer Q-rental-004=a --rule "การจองยืนยันได้เมื่อรับชำระมัดจำแล้วเท่านั้น"
```

- `--rule` is the owner's own wording. Without it the option's template is used; write the template down as-is only when it already says what the owner means.
- `--no-rule` records an answer that mints nothing ("we do not do that").
- `--supersedes BR-rental-012@v1 --reason "…"` when the answer withdraws a rule from an earlier round: the old version is retired, never deleted, and `@v2` carries the new wording.
- `--defer Q-x` moves a question to CP2 as a `DQ`.

Ask for the next round only after the previous answers are on disk — the script enforces nothing about pace, but a round answered from memory is a round that did not happen.

`BANK EXHAUSTED` means every question has been put to the owner; the remaining unknowns are now `Q` records from `capture` and `rules`, not bank questions.
