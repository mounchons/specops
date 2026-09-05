---
description: Roles that trace to real people, and a permission row for every screen. Default deny, written down.
argument-hint: "[--records <file.json>]"
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/rbac.mjs" $ARGUMENTS
```

Bare, it prints the role x screen matrix and what is still denied. With `--records`:

```json
{ "roles": [
    { "key": "manager", "title": "เจ้าของร้าน", "stk": "STK-001", "apps": ["backoffice"] },
    { "key": "customer", "title": "ลูกค้าผู้เช่า", "stk": "STK-003", "apps": ["customer"] }
  ],
  "grants": [
    { "role": "@manager", "ui": "*", "allow": ["view", "create", "edit", "delete"], "dataScope": "all" },
    { "role": "@customer", "ui": "UI-rental-004", "allow": ["view"], "dataScope": "own", "because": "BR-rental-009@v1" }
  ] }
```

A row is written for every (role, screen in an app that role uses), and a row grants **nothing** until a `grant` says otherwise. That is what default deny looks like on disk: the screens nobody decided about are visibly denied instead of quietly open.

`dataScope: own` is the field that keeps one customer's records off another customer's page. Cite the rule that says so in `because` — then a later change to that rule leads back here through the graph.

Every role must name the `STK` it comes from. A role invented here matches nobody in the client's organisation and will be handed out by guesswork.
