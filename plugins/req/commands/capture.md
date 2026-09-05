---
description: Turn what the client said into REQ / STK / UL / Q, with the raw words kept on disk as SRC.
argument-hint: <module> [--new-module] [--source <path>]
allowed-tools: Bash
---

Two files first, then one command.

1. Write the client's words **verbatim** to a scratch file and add `--source raw.txt` to the arguments. If the user pointed at a file or image instead, skip this and pass their path.
2. Read them and write a scratch `records.json`:

```json
{
  "stakeholders": [{ "key": "manager", "title": "เจ้าของร้าน", "role": "manager" }],
  "requirements": [{ "kind": "REQ", "actor": "@manager", "goal": "ดูรายงานรายได้รายเดือน", "loc": "บรรทัด 8" }],
  "glossary":     [{ "term": "มัดจำ", "meaning": "เงินที่เก็บล่วงหน้าและคืนเมื่อปิดรายการ" }],
  "questions":    [{ "category": "calculation", "text": "ลดราคาได้กี่เปอร์เซ็นต์" }]
}
```

`actor` is `@key` from the same payload or an existing `STK-nnn`. `kind` is `REQ` or `NFR`.

3. Run it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/capture.mjs" $ARGUMENTS --records records.json
```

Then show the output verbatim.

What goes in `questions[]`: everything the text implies but does not say — a number without a rounding rule, a role without a permission, a status without who may change it. Anything you would otherwise have to assume belongs there. Do not write a requirement for it; an assumption that reaches design as a REQ is indistinguishable from something the client asked for.

`--new-module` is required the first time a module is used; it is what adds it to `project.json` `modules[]`.
