---
description: A new run every time, one evidence file per step, and a verdict that is what a command said.
argument-hint: <module|TC-nnn|UC-nnn>
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs" $ARGUMENTS
```

Show the verdicts and the evidence paths, then stop. **Do not restate what the output "really means".** `expect` on the step decides pass or fail, against the bytes the step produced; a session's reading of those bytes is recorded nowhere, on purpose (P6).

A run is never overwritten. `RUN-002` does not edit `RUN-001`, and the evidence of both stays on disk — that is what makes "it used to pass" a question anyone can answer later.

It checks the component's `run.healthcheck` first. Green, and the steps run. Red, and the run is still written, with every verdict `blocked` and the healthcheck output as the evidence: a page of failures that all mean "the server is down" is not a test result.

| verdict | what it means |
|---|---|
| `pass` | every step ran and matched `expect` |
| `fail` | a step ran and did not match — the problems are listed, then `/qa:finding` |
| `partial` | what ran passed, and something was skipped (a screen step with no browser runner) |
| `blocked` | nothing ran: the case is not runnable, or the system is not up |

Evidence is `qa/evidence/<TC>-<RUN>-s<n>-<pass|fail|skip>.log`. The name alone says which case, which run, which step and what happened, so a folder listing is already a report.

A green run is also the only thing that closes a finding. dev fixing the code does not close it, and neither does saying so.
