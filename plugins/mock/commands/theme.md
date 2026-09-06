---
description: The seven questions that decide every colour, radius and font in the system. dev never picks one; it references a token.
argument-hint: [--records <file.json>] [--by STK-nnn]
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/theme.mjs" $ARGUMENTS
```

With no `--records` it prints the seven questions with the Bootstrap 5 value beside each and stops. Put them to the owner as they are — do not answer on their behalf and do not add questions. Then write their answers to a file and run it again:

```json
{"by":"STK-001","tokens":{"color.primary":"#0d6efd","color.surface":"default","color.text":"default","spacing.unit":"8","radius":"0","font.family":"default","font.scale":"16"}}
```

`"default"` is an answer and is recorded as one, with `source: default` in the output. A **missing** key is not: the command refuses and names it. A token nobody chose does not stay unchosen — it gets chosen later by whoever writes the first stylesheet, and then it is in the code instead of in the record.

`components[]` is the inventory dev may use. Anything outside it is a component nobody costed.

Re-running overwrites the token values and keeps `THM-001`: the theme is one record with a history in git, not a new id every time the client changes their mind about a colour.
