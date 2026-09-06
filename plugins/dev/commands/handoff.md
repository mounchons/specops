---
description: The one document qa reads — acceptance done, testids, endpoints, unit tests and their golden rows.
argument-hint: <module>
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/handoff.mjs" $ARGUMENTS
```

Show the summary and the path, then stop. The document is written from the records — tasks, implementation units, components, wireframes — never from what the session remembers doing.

It refuses while any task of the module is below `verified`, and lists them. A manifest that includes unproved work is a list of things qa will find broken, and finding those is not what qa is for.

What qa gets, per slice: the acceptance criteria with `then` verbatim, the scenarios that become test cases, every `data-testid` with the field or action behind it, the real endpoints, the unit tests with the `GD` rows they assert, the files, the commit, and the proof command with its exit code. Plus `run.up` and `healthcheck` for the whole system.

`export/handoff-<module>.md` is rendered for a person to read; no script reads it back (rule 4). The truth stays in the `TSK` and `IMP` records.
