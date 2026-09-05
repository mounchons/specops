---
description: Drive the specops build from a phone — /phase, /phase 1, /phase 1 spec|approve|build|dod. Reads docs/PROMPTS.md so nothing needs pasting.
argument-hint: [phase] [spec|approve|build|dod]
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

You are driving the build of this marketplace. The user is remote and cannot paste prompts; you read them from disk.

1. Run `node scripts/build-state.mjs` and show the table.
2. Parse `$ARGUMENTS`:
   - empty → present the current phase's next step as a **numbered choice** (1 = do next step, 2 = re-run DoD, 3 = show the prompt text only) and **stop**. Do not start work without a choice.
   - `<n>` → next undone step of phase n.
   - `<n> spec` → write `plugins/<plugin>/SPEC.md` from `docs/plugin-spec-template.md` + `docs/SPECOPS-BRIEF.md §5.<n>` (one page), then stop and say "พิมพ์ `/phase <n> approve` เพื่ออนุมัติ".
   - `<n> approve` → append a line `approved: <today ISO date>` to SPEC.md. Nothing else.
   - `<n> build` → refuse unless SPEC.md is approved. Then execute the "ขั้น 2" block of `P<n>` in `docs/PROMPTS.md` exactly.
   - `<n> dod` → execute the "ขั้น 3" block of `P<n>`: run against `test/rentpoint`, then write `docs/dod/phase-<n>.md` as a table `| DoD item | PASS/FAIL | proof command | output |`. A row without a real command output is FAIL.
3. Before any build/dod step read, in order: `CLAUDE.md`, `docs/DESIGN.md`, `docs/SPECOPS-BRIEF.md §5.<n>`, `docs/testproject-rentpoint.md`.
4. Constitution rule 9: never touch phase n+1 while `docs/dod/phase-<n>.md` has a FAIL or does not exist.
5. Finish every run with: the build-state table again, one line "ต่อไป: /phase … " — nothing more. If you hit a decision the docs do not cover, stop and ask in one short question with numbered options (DESIGN.md §4).
