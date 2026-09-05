# DoD — phase 0 (core)

Run 2026-09-05 on Windows 11 · Node v22.19.0 · state dir `test/rentpoint/.sdlc` (created by this run from an empty folder).
Every output cell is pasted from the command that ran; a row without real output does not pass, by rule.

| DoD item | result | proof command | output |
|---|---|---|---|
| selftest passes (6 checks incl. CLI regression) | PASS | `node plugins/core/scripts/selftest.mjs` | 6/6 PASS · selftest PASSED · exit 0 |
| empty folder → next says init | PASS | `node plugins/core/scripts/next.mjs --state-dir test/rentpoint/.sdlc` | 1. /core:init --name <project> --apps <name:type,...> · exit 0 |
| after init (no apps) → next says fill apps | PASS | `node plugins/core/scripts/next.mjs --state-dir test/rentpoint/.sdlc` | project=rentpoint apps=0 gates=10 → 1. edit .sdlc/project.json → apps[] · exit 0 |
| after apps (edited project.json per testproject §1) → next says install req = Cold Start "ต้องทำอะไรตอนนี้" | PASS | `node plugins/core/scripts/next.mjs --state-dir test/rentpoint/.sdlc` | 1. install plugin "req" and run /req:init · exit 0 |
| dirty fixture → 8 errors + 1 LIMIT, exit 1 | PASS | `node plugins/core/scripts/gates.mjs --state-dir plugins/core/fixtures/dirty/.sdlc` | gates=11  error=8  warn=1  limit=1 · exit 1 |
| init refuses an existing state dir | PASS | `node plugins/core/scripts/init.mjs --name rentpoint --state-dir test/rentpoint/.sdlc` | ERROR state dir already initialised: … · exit 2 |
| gates.mjs exit 0 on test/rentpoint | PASS | `node plugins/core/scripts/gates.mjs --state-dir test/rentpoint/.sdlc` | gates=10  error=0  warn=1  limit=0 · exit 0 |
