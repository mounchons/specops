# dirty fixture — what must fire

Two tasks and two implementation units on an otherwise clean design, each wrong in exactly one way.
`selftest.mjs` asserts that every `dev:*` check finds its case here and that no `core:*` check finds
anything: a fixture that also breaks core would prove nothing about dev.

| what is wrong | check |
|---|---|
| TSK-001 is `implemented` and its only proof exited 1 | `dev:tsk-needs-proof` |
| IMP-001 is `elsewhere/limit.mjs`, outside `CMP-api`'s root `src` | `dev:imp-in-layout` |
| TSK-001 and TSK-002 have started, and CR-001 freezes `UI-loan-001` | `dev:tsk-frozen` (2) |
| `src/limit.test.mjs` asserts `GD-loan-001` with a loose bound instead of 150000 and 62500 | `dev:gd-verbatim` (2) |
| `src/orphan.mjs` sits under a component root and no IMP owns it | `dev:file-without-imp` (warn) |
| `trace.dev.json` has `TSK-001 implements BR-loan-001@v1` | `dev:trace-uc-not-br` |
| GAP-001 has no CR and no answer | `dev:gap-open` (warn) |

`G-dev-008` (`dev:skill-installed`) has no function on purpose and therefore no fixture: gates.mjs
prints it as a **LIMIT** every run. A session's loaded skills are invisible to a script, so the honest
form of that rule is a line that never passes silently and never blocks.

**A known limit of `dev:gd-verbatim`**: it is a text match over the file, so a golden value written in
a *comment* satisfies it. The first version of this fixture failed for exactly that reason — the
comment explaining the breakage contained the numbers. The check catches a test that rounds the answer
key; it does not catch a test that mentions it and asserts something else. Tightening it means parsing
the test language, which is a different plugin.

The clean fixture is the same slice done right: a task verified with a green proof and a commit, two
IMPs under `src`, and a test that asserts 150000 and 62500 exactly.
