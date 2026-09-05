---
description: Entities with a kind and state machines with a way out of every state. Kind is what makes master screens appear later.
argument-hint: <module> [--records <file.json>] [--lookup ENT-nnn=master|seed]
allowed-tools: Bash
---

Read the rules first — `/core:query BR-<module>-001` and the glossary — then write a scratch `domain.json`:

```json
{
  "entities": [
    { "key": "booking", "name": "Booking", "kind": "aggregate",
      "attributes": ["code", "pickupDate", "returnDate", "status", "total"],
      "invariants": ["BR-rental-004@v1", "BR-rental-005@v1"] },
    { "key": "equipment", "name": "Equipment", "kind": "reference",
      "attributes": ["name", "ratePerDay", "status"], "invariants": ["BR-rental-006@v1"] }
  ],
  "stateMachines": [
    { "entity": "@booking",
      "states": [{ "name": "draft" }, { "name": "confirmed" }, { "name": "closed", "final": true }],
      "transitions": [{ "from": "draft", "to": "confirmed", "by": "staff", "enforces": ["BR-rental-004@v1"] }] }
  ]
}
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/domain.mjs" $ARGUMENTS --records domain.json
```

`kind`: **aggregate** owns a lifecycle and other records · **entity** belongs to one · **reference** is master data someone maintains (→ a master screen) · **lookup** is a short list (ask: its own screen, or seed data?) · **vo** has no identity and no screen.

Never guess a lookup. The script writes it with no decision and reports it; the owner answers with `--lookup ENT-nnn=master` or `=seed`.

Every state that is not `final` needs a transition out, and the script refuses the file otherwise — a record that reaches a dead state can never be touched again, and that is found in production, not in review.
