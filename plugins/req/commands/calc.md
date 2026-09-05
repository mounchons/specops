---
description: Pin one rule version to a calculation contract — formula, number type, rounding mode and the point it rounds at.
argument-hint: <BR@v> --formula "…" --number-type integer|decimal --round none|ceil|half-up [--unit 100] [--at "…"]
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/calc.mjs" $ARGUMENTS
```

Example:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/calc.mjs" BR-rental-002@v1 \
  --formula "deposit = ceil(fee * 0.30 / 100) * 100" \
  --number-type integer --round ceil --unit 100 \
  --at "ปัดขึ้นหลังคูณ 30% แล้ว ไม่ใช่ก่อน" \
  --boundary "fee 3000 -> 900 พอดี ไม่ปัดเพิ่ม; fee 1250 -> 375 ปัดเป็น 400"
```

`--at` is required whenever anything rounds, because the mode alone is not a contract: 30% of 2,400 rounded up to the hundred is 800, and rounding the rate first gives 720. Say which.

`--boundary` is a `;`-separated list of the values where the answer changes. Take them from the examples on the rule; if the rule has none yet, go back to `/req:rules` first — a calculation written before anyone gave an example is a guess with a formula on it.

One CALC pins exactly one `BR@vN`. When the rule gets a new version the calculation needs one too; it does not follow automatically.

Next: `/req:golden <CALC@v>` — the expected values come from running a script, never from typing.
