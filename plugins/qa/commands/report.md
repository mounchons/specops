---
description: Coverage counted from the records — REQ to UC to SCN to TC to the last verdict, with what is missing shown as loudly as what passed.
argument-hint: <module>
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/report.mjs" $ARGUMENTS
```

Show the counts and the path, then stop. Do not add a percentage, a "roughly", or a summary sentence about how the module is doing — every number here is the length of a list of ids, and adding one that is not makes the rest untrustworthy.

The report answers the question the whole marketplace exists for, for one module at a time: **this requirement — was it built, was it tested, did it pass, where is the evidence.** It walks REQ → UC → SCN → TC → the verdict of the last run that touched it, and prints the breaks in that chain by name:

- a scenario with no test case
- a test case that cannot be executed, and the record that stopped it
- an acceptance criterion no scenario covers — a hole in the design, not in the tests
- findings still open, by routing, with the change request when there is one
- the run history with the code version each run was against

`export/qa-<module>.md` is rendered for a person to read; no script reads it back (rule 4). The truth stays in the `TC`, `RUN` and `DEF` records, and `/core:query <id>` is how anything else asks about them.
