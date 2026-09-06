---
description: One executable test case per scenario, written without asking anyone. What it would have had to ask becomes a finding.
argument-hint: <module>
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/cases.mjs" $ARGUMENTS
```

Show the table and the "not runnable" list, then stop. Do not fill a gap in by hand and do not go looking in `design/` for the endpoint the record failed to give — that is the thing this command is measuring.

**qa asks nobody.** The brief is exact about it: if a test case cannot be built from the records, the handoff is incomplete, and that is a finding rather than a conversation. So every case carries `runnable` and, when it is false, `gaps[]` naming the record that stopped it: an API path with an empty segment, a `request` nobody filled in, a component with no healthcheck.

A gap only becomes a `DEF` when dev has already called that use case **verified**. A scenario for something nobody has built yet is simply not runnable — that is a schedule, not a defect.

| the case is missing | the input to fix |
|---|---|
| a case at all | the `SCN` — `/design:scenario <module>` |
| an address to call | `API.path` — `/design:api <module>` |
| a body to send | `API.request` |
| an origin | `run.healthcheck` on a component — `/dev:stack` |
| expected numbers | `CALC` + `GD` — `/req:calc`, `/req:golden` |

Steps come out `via: http` (a curl line a person can re-run, executed without a shell) or `via: ui` (a `data-testid` the wireframe promised, recorded and skipped — `G-qa-007` says so on every run).

It refuses to write a case for a scenario an open CR has frozen (exit 1, naming the change): a scenario being rewritten is not a scenario to test against. Re-running creates only what is missing and keeps every verdict already on disk.
