#!/usr/bin/env node
/**
 * close.mjs — a change is done when the plugins that own what it touched have re-approved it.
 *
 *   node close.mjs <CR> --sign STK-nnn --evidence <path> [--state-dir X]
 *
 * Exit 1 (a finding, not a bad argument) while anything it touched or affected is still draft or
 * reviewed: closing then would unfreeze work that nobody has looked at since the change landed.
 */
import fs from "node:fs";
import { parseArgs, resolveStateDir, stateExists, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { ensureRegistry } from "../../core/scripts/query.mjs";
import { prefixOf } from "../../core/scripts/ids.mjs";
import { ensureInit } from "./init.mjs";
import { FILES, atLeast, readCr, writeCr, now } from "./lib.mjs";

export function closeCr(stateDir, id, { sign = null, evidence = null } = {}) {
  ensureInit(stateDir);
  const cr = readCr(stateDir, id);
  orExit2(cr, `no such CR: ${id}`);
  orExit2(cr.__open, `${id} is already closed`);
  orExit2(cr.applied, `${id} was never applied — /change:apply ${id} first, or the change closes with nobody having done it`);
  orExit2(sign, `--sign STK-nnn is required — somebody signs a change off, and the graph knows who they are`);
  orExit2(evidence, `--evidence <path> is required — a closed change with no evidence is a claim`);
  orExit2(fs.existsSync(evidence), `--evidence ${evidence} does not exist`);

  const reg = ensureRegistry(stateDir);
  orExit2(prefixOf(sign) === "STK" && reg.index[sign], `--sign ${sign} is not a stakeholder in req/stakeholders.json`);

  // A DEF is never in this list. A defect leaves `draft` only when a later run passes its test case
  // (G-qa-005 — dev does not close a finding, a green run does), so nobody can re-approve one and a
  // CR opened from a finding would be unclosable by construction: its own DEF sits in `affected`
  // because the defect text names the artifact the change touches.
  const ids = [...new Set([...(cr.touches ?? []), ...(cr.impact?.affected ?? []).map((a) => a.id)])].filter((aid) => prefixOf(aid) !== "DEF");
  const notReady = ids
    .map((aid) => ({ id: aid, status: reg.index[aid]?.status ?? "(missing)" }))
    .filter((a) => !atLeast(a.status, "approved"));
  if (notReady.length) return { cr, notReady };

  cr.closed = { at: now(), by: sign, evidence };
  cr.status = "verified";
  const file = writeCr(stateDir, cr, { closed: true });
  fs.rmSync(FILES.open(stateDir, cr.id), { force: true });
  return { cr, file, notReady: [] };
}

if (isMain(import.meta.url)) {
  const { _, flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  orExit2(stateExists(stateDir), `no state dir at ${stateDir}`);
  orExit2(_[0], "usage: close.mjs <CR> --sign STK-nnn --evidence <path>");
  const { cr, file, notReady } = closeCr(stateDir, _[0], { sign: typeof flags.sign === "string" ? flags.sign : null, evidence: typeof flags.evidence === "string" ? flags.evidence : null });

  if (notReady.length) {
    console.log(`CANNOT CLOSE ${cr.id} — ${notReady.length} artifact(s) it touched are not back at approved:`);
    for (const a of notReady) console.log(`  ${a.id.padEnd(16)} [${a.status}]`);
    console.log(`\nthe owning plugin re-approves what it owns. The commands are on the CR:`);
    (cr.applied?.commands ?? []).forEach((c, i) => console.log(`  ${String(i + 1).padStart(2)}. ${c}`));
    process.exit(1);
  }

  console.log(`CLOSE ${cr.id}  signed by ${cr.closed.by} · evidence ${cr.closed.evidence}`);
  console.log(`  moved to ${file}`);
  console.log(`  touches edges kept — the change stays in the graph, it just stops freezing anything`);
  process.exit(0);
}
