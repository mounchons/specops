---
description: A scenario per flow — including the ones that go wrong — and per NFR. Renders the Thai design document.
argument-hint: <module> [--expected SCN-nnn="…"]
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/scenario.mjs" $ARGUMENTS
```

Generates the missing scenarios — one per use-case flow (main, each alternate, each exception) and one per NFR — then writes `export/design-<module>.md`. Show the script output, not the document.

A scenario borrows `expected` from the acceptance criterion of its flow when there is one. The rest come back blank and are listed; fill each with the **observable** result:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/scenario.mjs" rental --expected SCN-rental-007="หน้ายืนยันแสดงผลภายใน 2 วินาทีที่ p95 ภายใต้ผู้ใช้พร้อมกัน 20 คน"
```

"ทำงานถูกต้อง" is not an expected result — qa has to turn this into a command with a pass criterion, and cannot invent the number. An NFR whose scenario says "เร็ว" is an NFR nobody will ever fail.

This is design's last step. `export/design-<module>.md` is written for the client and never read back (rule 4); the records stay `reviewed` — the client's signature lands in phase 4 on `mock:approve --sign`, where the baseline becomes the scope of the quotation.
