---
description: Print a slice of the trace graph around one id (record, upstream, downstream, open CRs). Use this instead of reading artifact files.
argument-hint: <id> [--depth 2] [--no-body] [--json]
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/query.mjs" $ARGUMENTS
```

Constitution rule 6: commands take ids, scripts hand slices. When you need to know about `UI-loan-003`, run this — do **not** open `screens.json`.
A lineage id without `@vN` (e.g. `BR-loan-001`) returns every version.
If the output ends with `OPEN CR touching: CR-xxx`, that artifact is frozen until the CR is applied.
