---
description: The callsheet — name the next allowed action(s) from disk state. Never runs them.
argument-hint: [--all]
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/next.mjs" $ARGUMENTS
```

Print the numbered actions verbatim, then stop. The human picks; you do not start any of them.
Rules: an open CR always appears first · core gate errors block everything · the next uninstalled plugin in build order (req → design → change → mock → dev → qa) is the last suggestion.
