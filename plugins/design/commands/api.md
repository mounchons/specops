---
description: One endpoint per write action on a screen, generated; then refine them and declare the external systems.
argument-hint: <module> [--records <file.json>]
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/api.mjs" $ARGUMENTS
```

Run it bare first: every write action on every screen gets an endpoint and the screen's action is back-filled with its id. Then refine only what the generated guess got wrong, and declare anything outside the system:

```json
{ "apis": [
    { "for": "UI-rental-003.create", "method": "POST", "path": "/api/bookings",
      "request": { "customerId": "id", "lines": "[{equipmentId, days}]" },
      "response": { "id": "id", "total": "money", "deposit": "money" } }
  ],
  "integrations": [
    { "key": "line-login", "title": "LINE Login", "direction": "in",
      "failureMode": "LINE ล่ม → ลูกค้าเข้าระบบไม่ได้ · แสดงข้อความว่าเข้าสู่ระบบไม่ได้ชั่วคราว ห้ามสร้างบัญชีสำรองอัตโนมัติ",
      "usedBy": ["UI-rental-010"] }
  ] }
```

`failureMode` has no default and the script refuses an integration without one. "What happens when the payment gateway is down" is a question the client answers once, cheaply, now — or the code answers by itself, expensively, later.

An `api`-type app is the endpoint, so its own screens are not counted here.
