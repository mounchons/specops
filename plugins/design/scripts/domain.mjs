#!/usr/bin/env node
/**
 * domain.mjs — the world the rules are about: entities with a kind, and the lifecycle of the ones
 * that have one.
 *
 *   node domain.mjs <module> --records <file.json>
 *   node domain.mjs <module> --lookup ENT-008=master        decide a lookup: its own screen, or seed data
 *
 * `kind` is not decoration: it is what tells `screens` which entities need a master screen (G2).
 * A lookup is never guessed — it is written with lookupAs null and reported until someone decides.
 *
 * --records payload:
 *   { "entities": [ { key, name, kind, attributes[], invariants[BR@v], note? } ],
 *     "stateMachines": [ { entity: "@key"|ENT-nnn, states[{name, final?}], transitions[{from,to,by?,enforces[]}] } ] }
 */
import fs from "node:fs";
import { parseArgs, resolveStateDir, readJson, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { prefixOf } from "../../core/scripts/ids.mjs";
import { ensureInit } from "./init.mjs";
import { FILES, allDesign, allReq, byPrefix, findById, mintId, minter, upsert, requireModule, stripInternal, now } from "./lib.mjs";

export const KINDS = ["aggregate", "entity", "reference", "lookup", "vo"];
export const LOOKUP_AS = ["master", "seed"];

function validate(stateDir, records) {
  const req = allReq(stateDir);
  const keys = new Set((records.entities ?? []).map((e) => `@${e.key}`));
  for (const e of records.entities ?? []) {
    orExit2(String(e.name ?? "").trim(), `every entity needs a name — got ${JSON.stringify(e)}`);
    orExit2(KINDS.includes(e.kind), `${e.name}: kind must be one of ${KINDS.join("|")}, got ${JSON.stringify(e.kind ?? null)}`);
    for (const br of e.invariants ?? []) orExit2(findById(req, br), `${e.name} names ${br} as an invariant, but no such rule exists`);
  }
  const existing = new Set(byPrefix(allDesign(stateDir), "ENT").map((r) => r.id));
  for (const m of records.stateMachines ?? []) {
    orExit2(keys.has(m.entity) || existing.has(m.entity), `state machine names entity ${JSON.stringify(m.entity)}, which is neither in this payload nor on disk`);
    const states = new Set((m.states ?? []).map((s) => s.name));
    orExit2(states.size >= 2, `state machine of ${m.entity} needs at least two states`);
    for (const t of m.transitions ?? []) {
      orExit2(states.has(t.from) && states.has(t.to), `transition ${t.from} -> ${t.to} of ${m.entity} names a state that is not declared`);
      for (const br of t.enforces ?? []) orExit2(findById(req, br), `transition ${t.from} -> ${t.to} enforces ${br}, but no such rule exists`);
    }
    // the check gate says the same thing; saying it here means the bad file never reaches disk
    for (const s of m.states ?? []) {
      if (s.final) continue;
      orExit2((m.transitions ?? []).some((t) => t.from === s.name), `state "${s.name}" of ${m.entity} has no way out and is not marked final — a state you cannot leave is either an end or a bug`);
    }
  }
}

export function writeDomain(stateDir, module, records) {
  validate(stateDir, records);
  const ids = allDesign(stateDir).map((r) => r.id);
  const nextEnt = minter(ids, "ENT");
  const nextStm = minter([...ids], "STM");
  const file = FILES.domain(stateDir);
  const byKey = new Map();
  const written = { ENT: [], STM: [] };

  for (const e of records.entities ?? []) {
    const id = nextEnt();
    byKey.set(`@${e.key}`, id);
    upsert(file, {
      id,
      title: e.name,
      status: "draft",
      kind: e.kind,
      ...(e.kind === "lookup" ? { lookupAs: LOOKUP_AS.includes(e.lookupAs) ? e.lookupAs : null } : {}),
      attributes: e.attributes ?? [],
      invariants: e.invariants ?? [],
      note: e.note ?? null,
      derivedFrom: e.invariants ?? [],
    });
    written.ENT.push(id);
  }

  for (const m of records.stateMachines ?? []) {
    const entity = byKey.get(m.entity) ?? m.entity;
    const id = nextStm();
    upsert(FILES.states(stateDir), {
      id,
      title: `วงจรสถานะของ ${findById(allDesign(stateDir), entity)?.title ?? entity}`,
      status: "draft",
      entity,
      states: m.states ?? [],
      transitions: (m.transitions ?? []).map((t) => ({ from: t.from, to: t.to, by: t.by ?? null, enforces: t.enforces ?? [] })),
      derivedFrom: [entity, ...new Set((m.transitions ?? []).flatMap((t) => t.enforces ?? []))],
    });
    written.STM.push(id);
  }
  return written;
}

export function decideLookup(stateDir, entId, as) {
  orExit2(LOOKUP_AS.includes(as), `--lookup takes ENT-nnn=master or ENT-nnn=seed, got ${JSON.stringify(as)}`);
  const ent = findById(allDesign(stateDir), entId);
  orExit2(ent, `no such entity: ${entId}`);
  orExit2(ent.kind === "lookup", `${entId} is kind ${ent.kind}, not lookup — only a lookup has this decision`);
  upsert(ent.__file, { ...stripInternal(ent), lookupAs: as, decidedAt: now() });
  return ent;
}

if (isMain(import.meta.url)) {
  const { _, flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  const module = _[0];
  orExit2(module, "usage: domain.mjs <module> (--records <file.json> | --lookup ENT-nnn=master|seed)");
  ensureInit(stateDir);
  requireModule(stateDir, module);

  if (typeof flags.lookup === "string") {
    const [entId, as] = flags.lookup.split("=");
    const ent = decideLookup(stateDir, entId, as);
    console.log(`LOOKUP ${entId} (${ent.title}) -> ${as}${as === "master" ? "  — screens will generate a master screen for it" : "  — seed data, no screen"}`);
    process.exit(0);
  }

  orExit2(typeof flags.records === "string" && fs.existsSync(flags.records), "--records <file.json> is required — read the requirements first, then let the script mint the ids");
  const written = writeDomain(stateDir, module, readJson(flags.records));
  const all = allDesign(stateDir);
  console.log(`DOMAIN ${module}  ENT ${written.ENT.length}  STM ${written.STM.length}`);
  for (const id of written.ENT) {
    const e = findById(all, id);
    console.log(`  ${id.padEnd(8)} ${String(e.kind).padEnd(10)} ${e.title}${e.kind === "lookup" && !e.lookupAs ? "   ⚠ master screen or seed? /design:domain " + module + " --lookup " + id + "=master|seed" : ""}`);
  }
  for (const id of written.STM) {
    const m = findById(all, id);
    console.log(`  ${id.padEnd(8)} ${m.states.map((s) => s.name + (s.final ? "*" : "")).join(" → ")}`);
  }
  const undecided = byPrefix(all, "ENT").filter((e) => e.kind === "lookup" && !e.lookupAs);
  if (undecided.length) console.log(`\n${undecided.length} lookup(s) undecided — G-design-015 warns until someone answers: ${undecided.map((e) => e.id).join(", ")}`);
  console.log(`  next: /design:usecase ${module}`);
  process.exit(0);
}
