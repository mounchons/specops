# DoD — phase 0 (core)

| DoD item | result | proof command | output |
|---|---|---|---|
| selftest passes | PASS | `node plugins/core/scripts/selftest.mjs` | selftest PASSED (5/5) |
| empty folder → next says init | PASS | `node plugins/core/scripts/next.mjs --state-dir /tmp/x` | 1. /core:init --name … |
| after init → next says fill apps | PASS | `init.mjs --name t && next.mjs` | edit .sdlc/project.json → apps[] |
| after apps → next says install req | PASS | `next.mjs` | install plugin "req" |
| dirty fixture → 8 errors + 1 LIMIT | PASS | `gates.mjs --state-dir plugins/core/fixtures/dirty/.sdlc` | error=8 warn=1 limit=1 |
