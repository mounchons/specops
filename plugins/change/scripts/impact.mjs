#!/usr/bin/env node
/**
 * impact.mjs — walk the graph, count what is hit, and let the walk decide the lane.
 *
 *   node impact.mjs <CR> [--lane ui|full] [--json] [--state-dir X]
 *
 * The discriminator is P5 made checkable: "will the user see or do something no artifact declares?"
 * For a display change that question has three answers a script can read — the fields already exist
 * on the entity, the roles that open the screen already have view on it, and no calculation is in
 * the blast radius. All three yes, and nothing new is being declared: lane ui. Anything else is
 * full. screen / report / rule never pass that test by construction; only `other` has no answer,
 * and there the owner says which lane and the reason is recorded as theirs.
 */
import { parseArgs, resolveStateDir, stateExists, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { ensureRegistry } from "../../core/scripts/query.mjs";
import { loadState } from "../../core/scripts/artifacts.mjs";
import { prefixOf } from "../../core/scripts/ids.mjs";
import { ensureInit } from "./init.mjs";
import { LANES, TO_CREATE, dependents, countByPrefix, nextIdPreview, readCr, writeCr, now } from "./lib.mjs";
import { parseField } from "./open.mjs";

const SCREEN_PREFIXES = new Set(["UI", "RPT"]);

/** The three readable answers behind "nothing new is being declared". */
function displayReasons(cr, state, affectedIds) {
  const reasons = [];
  const screens = (cr.touches ?? []).filter((id) => SCREEN_PREFIXES.has(prefixOf(id)));
  if (screens.length === 0) {
    reasons.push({ ok: false, why: `no screen in touches — a display change that names no screen is a request nobody can place` });
    return { reasons, screens };
  }

  for (const spec of cr.fields ?? []) {
    const f = parseField(spec);
    const ent = f && state.artifacts.find((a) => a.id === f.ent);
    const has = ent && (ent.raw.attributes ?? []).includes(f.attr);
    reasons.push({ ok: Boolean(has), why: has ? `${spec} already exists on ${ent.title} — nothing new is declared` : `${spec} is not an attribute that exists — the data has to be designed first` });
  }

  const acls = state.artifacts.filter((a) => a.prefix === "ACL");
  for (const ui of screens) {
    const rows = acls.filter((a) => a.raw.ui === ui && (a.raw.allow ?? []).includes("view"));
    reasons.push({ ok: rows.length > 0, why: rows.length ? `${ui} is already viewable by ${rows.map((r) => r.raw.role).join(", ")} (${rows.map((r) => r.id).join(", ")})` : `${ui} has no role with view — someone would gain access they do not have` });
  }

  const calcs = affectedIds.filter((id) => prefixOf(id) === "CALC");
  reasons.push({ ok: calcs.length === 0, why: calcs.length ? `${calcs.join(", ")} is in the blast radius — a number is changing, and numbers are signed` : `no CALC is touched or affected — no number changes` });
  return { reasons, screens };
}

const KIND_REASON = {
  screen: "a screen the client has never seen is a capability no artifact declares — the use case has to exist before the screen does",
  report: "a report carries totals, and a total is a number nobody has signed yet — a report is always full",
  rule: "a rule change re-versions the BR and everything that enforces it",
};

export function computeImpact(stateDir, id, { lane: laneFlag = null } = {}) {
  ensureInit(stateDir);
  const cr = readCr(stateDir, id);
  orExit2(cr, `no such CR: ${id}`);
  orExit2(cr.__open, `${id} is closed — a closed change is history; open a new CR`);

  const reg = ensureRegistry(stateDir);
  const state = loadState(stateDir);
  const walked = dependents(reg, cr.touches ?? []);
  const affected = [...walked].map(([aid, m]) => ({ id: aid, depth: m.depth, rel: m.rel, via: m.via, status: reg.index[aid]?.status ?? "(missing)" }));
  const affectedIds = affected.map((a) => a.id);

  let lane;
  let decidedBy;
  let reasons;
  if (cr.kind === "other") {
    orExit2(LANES.includes(laneFlag), `kind "other" has no discriminator a script can read — the owner decides: --lane ui|full`);
    lane = laneFlag;
    decidedBy = "owner";
    reasons = [`lane set by the owner: ${laneFlag} — "other" is the kind with no rule, so the decision is recorded as a person's`];
  } else {
    orExit2(!laneFlag, `--lane is only for kind "other" — the lane of a ${cr.kind} change is decided by the graph, not by whoever is asking`);
    if (cr.kind === "display") {
      const { reasons: rs } = displayReasons(cr, state, affectedIds);
      lane = rs.every((r) => r.ok) ? "ui" : "full";
      decidedBy = "discriminator";
      reasons = rs.map((r) => `${r.ok ? "yes" : "no "} · ${r.why}`);
    } else {
      lane = "full";
      decidedBy = "kind";
      reasons = [`no  · ${KIND_REASON[cr.kind]}`];
    }
  }

  const screens = (cr.touches ?? []).filter((t) => SCREEN_PREFIXES.has(prefixOf(t))).length;
  const toCreate = (TO_CREATE[cr.kind] ?? TO_CREATE.other)({ screens });

  cr.lane = lane;
  cr.impact = { at: now(), decidedBy, reasons, affected, counts: countByPrefix(affectedIds), toCreate };
  cr.status = "reviewed";
  const file = writeCr(stateDir, cr);
  return { cr, file, reg };
}

function print(cr, reg) {
  console.log(`IMPACT ${cr.id}  ${cr.kind} · ${cr.source} · module ${cr.module}${cr.app ? ` · app ${cr.app}` : ""}`);
  console.log(`  ${cr.title}`);
  console.log(`\nlane ${cr.lane}  (decided by ${cr.impact.decidedBy})`);
  for (const r of cr.impact.reasons) console.log(`  ${r}`);

  const counts = Object.entries(cr.impact.counts).map(([p, n]) => `${p} ${n}`).join(" · ");
  console.log(`\naffected ${cr.impact.affected.length}${counts ? `:  ${counts}` : ""}`);
  for (const a of cr.impact.affected) {
    const via = a.via ? `${a.rel} <- ${a.via}` : "touched";
    console.log(`  ${a.id.padEnd(16)} [${a.status}] ${via}`);
  }

  console.log(`\nto create:`);
  if (cr.impact.toCreate.length === 0) console.log(`  (nothing — the owner set the lane by hand)`);
  for (const t of cr.impact.toCreate) {
    const next = nextIdPreview(reg, t.kind, cr.module);
    console.log(`  ${t.kind.padEnd(5)} ${String(t.count).padEnd(3)} ${t.by.padEnd(22)} next would be ${next}`);
  }
  console.log(`\nnext: /change:apply ${cr.id} — apply names the commands; it does not run them`);
}

if (isMain(import.meta.url)) {
  const { _, flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  orExit2(stateExists(stateDir), `no state dir at ${stateDir}`);
  orExit2(_[0], "usage: impact.mjs <CR> [--lane ui|full]");
  const { cr, reg } = computeImpact(stateDir, _[0], { lane: typeof flags.lane === "string" ? flags.lane : null });
  if (flags.json) console.log(JSON.stringify(cr, null, 2));
  else print(cr, reg);
  process.exit(0);
}
