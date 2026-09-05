# specops

Human-driven SDLC marketplace for Claude Code. State in `.sdlc/`, rules in scripts, changes through `CR`.

```
/plugin marketplace add mounchons/specops
/plugin install core@specops
/core:init --name myproject --apps backoffice:backoffice-web,customer:customer-web
/core:next
```

Read `CLAUDE.md` (the constitution) → `docs/DESIGN.md` (why) → `docs/SPECOPS-BRIEF.md` (what) → `docs/PROMPTS.md` (per-phase prompts).
Test project: `docs/testproject-rentpoint.md`. Phase 0 (core) is built; phase 1 (req) is next.
