---
description: Render the Thai requirement document for the client, and — with --sign — record that they signed it.
argument-hint: <module> [--sign STK-nnn --evidence <path>]
allowed-tools: Bash
---

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/export.mjs" $ARGUMENTS
```

Writes `export/requirement-<module>.md`: stakeholders, glossary, requirements, rules with their examples, calculations with their signed answer keys, the rules that were withdrawn and why, and the questions still open.

Show the script output — the path, the line count and the hash — not the document. Nothing in specops reads `export/` back (rule 4); it exists for a person.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/export.mjs" rental --sign STK-001 --evidence docs/evidence/approval-2026-09-05.pdf
```

`--sign` is what req has instead of an `approve` command: the client signed **this** document, so every REQ / NFR / BR / CALC / EX it renders becomes `approved` and carries who signed, when, and the hash of what they saw. Run it only when the evidence exists — a path to a file that is not there is worse than no signature, because the gate will believe it.

Export before signing and let the owner read it first. After signing, changing any of those records needs a `CR` (`G-req-009`), which is the point: that is the line between the work quoted and the work billed.
