---
description: One slice from the printed spec to the commit that closes it. Four conditions, all checkable.
argument-hint: <TSK-nnn> --start | --impl "<path>=<kind>" [--golden GD-x] | --verify | --close
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/task.mjs" $ARGUMENTS
```

`--start` prints the whole slice: flows, the acceptance criteria word for word, entities and states, endpoints, permissions, the `data-testid`s the wireframe promised, the golden rows, the stack. **That printout is the spec** — do not open `design/` or `req/` to look for more (rule 6). Anything not in it is Class B: `/dev:revise` opens a GAP instead of code.

Then write the code, claim the files with `--impl`, and prove it:

| step | what it means |
|---|---|
| `--impl "src/Api/Bookings.cs=source,tests/BookingTests.cs=test"` | every file the slice touches gets an `IMP`. A file no `IMP` owns is code nobody can trace to a use case (G-dev-005). A `test` file inherits the task's `GD`s unless `--golden` says otherwise. |
| `--verify` | runs the component's `run.test` in the code root, records `{cmd, result, exitCode, at}`. Three failed attempts and the task is **blocked** — a fourth run of the same thing is not a plan. |
| `--close` | needs all four: the last proof exited 0 · HEAD moved since `--start` · the commit message names the task · nothing uncommitted outside `.sdlc/`. |

**Commit the diff yourself** — the human reads it, dev does not commit for them (P8). `.sdlc/` is excluded from the cleanliness check: the record is the record, the commit is the code.

A unit test whose expected values are not the signed `GD` values, character for character, fails `--close` and `G-dev-004` with the row it missed. Rounding the answer key to make a test pass is the one thing that makes the whole chain worthless.
