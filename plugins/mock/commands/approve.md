---
description: The client signs the drawings for one app. The signed list, with hashes, is the scope of the quotation.
argument-hint: <app> --sign STK-nnn --evidence <path>
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/approve.mjs" $ARGUMENTS
```

Show the signed list and the path of the baseline document, then stop. If it exits 1 it has printed what is missing — show that list and do not sign around it.

**A baseline with holes is not a scope.** Every screen of the app must have a wireframe, and none of them may be frozen by an open change request. Those two conditions are the whole refusal; there is no flag to skip them.

Signing stores each drawing's `hash` in `signed{at, by, evidence, hash}`. From that moment `G-mock-003` goes red if any of them differs, and it names the file — nobody has to remember what was agreed, and nobody can quietly change it. The way to change a signed screen is `/change:open`, then `/mock:wireframe <app> --cr CR-nnn`, then approve again.

`--evidence` is a path that must exist: the signed PDF, the email, the minutes. A signature with no evidence is a claim.

`export/mock-baseline-<app>@<date>.md` is written for the client to read. No script reads it back — the truth is `signed{}` on each record.
