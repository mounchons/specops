#!/usr/bin/env node
/**
 * apply.mjs — hand the change to the plugins that own the artifacts.
 *
 *   node apply.mjs <CR> [--sign STK-nnn] [--evidence <path>] [--state-dir X]
 *
 * apply writes nothing outside change/. It does not reopen a req or design record as `draft` —
 * that file has an owner and it is not change (W1). What it does instead is record the exact
 * commands, in order, for this lane, and let every plugin's own `isFrozen()` refuse work on what
 * the CR touches until it closes. Freezing by writing into someone else's file would leave two
 * plugins responsible for one record; freezing by asking is a question with one answer.
 */
import { parseArgs, resolveStateDir, stateExists, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { ensureRegistry } from "../../core/scripts/query.mjs";
import { prefixOf } from "../../core/scripts/ids.mjs";
import { ensureInit } from "./init.mjs";
import { LANES, commandsFor, readCr, writeCr, now, versionBump } from "./lib.mjs";

export function applyCr(stateDir, id, { sign = null, evidence = null } = {}) {
  ensureInit(stateDir);
  const cr = readCr(stateDir, id);
  orExit2(cr, `no such CR: ${id}`);
  orExit2(cr.__open, `${id} is closed`);
  orExit2(LANES.includes(cr.lane), `${id} has no lane — run /change:impact ${id} first; the graph decides the lane, not the person applying`);
  orExit2(!cr.applied, `${id} was already applied at ${cr.applied?.at} — re-applying would rewrite the plan someone is working from; open a new CR instead`);
  if (sign) {
    const reg = ensureRegistry(stateDir);
    orExit2(prefixOf(sign) === "STK" && reg.index[sign], `--sign ${sign} is not a stakeholder in req/stakeholders.json`);
  }

  const commands = commandsFor(cr);
  cr.applied = { at: now(), by: sign, evidence, commands };
  cr.status = "approved";
  const file = writeCr(stateDir, cr);
  return { cr, file };
}

if (isMain(import.meta.url)) {
  const { _, flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  orExit2(stateExists(stateDir), `no state dir at ${stateDir}`);
  orExit2(_[0], "usage: apply.mjs <CR> [--sign STK-nnn] [--evidence <path>]");
  const { cr, file } = applyCr(stateDir, _[0], { sign: typeof flags.sign === "string" ? flags.sign : null, evidence: typeof flags.evidence === "string" ? flags.evidence : null });

  console.log(`APPLY ${cr.id}  lane ${cr.lane} · ${cr.kind} · module ${cr.module}${cr.app ? ` · app ${cr.app}` : ""}`);
  console.log(`\nrun these, in this order — one per session, the owner drives:`);
  cr.applied.commands.forEach((c, i) => console.log(`  ${String(i + 1).padStart(2)}. ${c}`));

  const versioned = (cr.touches ?? []).filter((t) => ["BR", "CALC"].includes(prefixOf(t)));
  if (versioned.length) {
    console.log(`\nversioned kinds never change in place:`);
    for (const v of versioned) console.log(`  ${v} -> ${versionBump(v)}  (minted by its owner, retired in the same command)`);
  }

  const frozen = [...new Set([...(cr.touches ?? []), ...(cr.impact?.affected ?? []).map((a) => a.id)])];
  console.log(`\nfrozen until ${cr.id} closes — isFrozen() answers true for ${frozen.length}: ${frozen.join(", ") || "(nothing)"}`);
  console.log(`written: ${file}`);
  console.log(`\nnext: /change:close ${cr.id} --sign STK-nnn --evidence <path> — once every one of them is back at approved`);
  process.exit(0);
}
