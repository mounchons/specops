---
description: Use cases whose steps enforce rule versions, with acceptance criteria quoted word for word from the examples.
argument-hint: <module> [--records <file.json>]
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/usecase.mjs" $ARGUMENTS
```

With no flags it lists the rules no step enforces yet. With `--records <file.json>` it writes them:

```json
{ "usecases": [
  { "key": "book", "title": "ลูกค้าจองอุปกรณ์", "actor": "STK-003",
    "apps": ["customer", "backoffice"], "satisfies": ["REQ-rental-001"],
    "crud": null, "precondition": "ลูกค้าเข้าสู่ระบบแล้ว",
    "flows": {
      "main": [{ "step": "เลือกอุปกรณ์ที่ว่าง", "enforces": ["BR-rental-006@v1"] },
               { "step": "ระบบคิดค่าเช่าและมัดจำ", "enforces": ["BR-rental-001@v1", "BR-rental-002@v1"] }],
      "exception": [{ "name": "อุปกรณ์ซ่อมบำรุง", "steps": [{ "step": "ระบบไม่ให้เลือก", "enforces": ["BR-rental-006@v1"] }] }]
    },
    "acceptance": [{ "flow": "main", "given": "rate 800 · รับ 2026-09-03 · คืน 2026-09-05",
                     "when": "คิดค่าเช่า", "then": "3 วัน · ค่าเช่า 2,400", "from": "EX-rental-001" }] }
] }
```

Three things the script refuses, each for the same reason — so a mistake here cannot reach dev quietly:

- a step's `enforces` naming a retired rule version, or a rule that does not exist
- an acceptance `then` that is not the `then` of its `EX`, character for character
- an acceptance quoting an example whose rule no step of this use case enforces

`enforces` belongs on the **step**, never on the use case: a rule attached at the top never fires. CRUD of one entity is **one** use case with `crud: ENT-nnn` — four screens come out of it later, not four use cases.
