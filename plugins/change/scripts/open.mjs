#!/usr/bin/env node
/**
 * open.mjs — every request becomes a CR before anything is said back (rule 7).
 *
 *   node open.mjs --kind display|screen|report|rule|other --source client|external|internal|finding
 *   node open.mjs --amend CR-nnn --kind <k> --reason "…"     correct the kind of a CR nobody has applied
 *                 --title "..." --request "the client's own words"
 *                 [--touches UI-x,ENT-y] [--fields ENT-y.attr] [--finding DEF-x]
 *                 [--module <m>] [--app <a>] [--state-dir X]
 *
 * It refuses rather than writes a CR a gate would immediately call an error: an id that does not
 * exist, a finding with no DEF, a display change with nothing to display.
 */
import { parseArgs, resolveStateDir, stateExists, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { ensureRegistry } from "../../core/scripts/query.mjs";
import { loadState } from "../../core/scripts/artifacts.mjs";
import { prefixOf } from "../../core/scripts/ids.mjs";
import { ensureInit } from "./init.mjs";
import { KINDS, SOURCES, list, now, mintCrId, readCr, writeCr, addEdges, project, resolveModule, resolveApp } from "./lib.mjs";

/** "ENT-006.phone" -> { ent, attr }. Anything else is not a field reference. */
export function parseField(spec) {
  const m = /^(ENT-[0-9]{3})\.([A-Za-z_][\w-]*)$/.exec(String(spec));
  return m ? { ent: m[1], attr: m[2] } : null;
}

export function openCr(stateDir, o) {
  ensureInit(stateDir);
  orExit2(KINDS.includes(o.kind), `--kind must be one of ${KINDS.join("|")}`);
  orExit2(SOURCES.includes(o.source), `--source must be one of ${SOURCES.join("|")}`);
  orExit2(String(o.title ?? "").trim(), "--title is required");
  orExit2(String(o.request ?? "").trim(), "--request is required — the client's own words, not a summary of them");

  const reg = ensureRegistry(stateDir);
  const state = loadState(stateDir);
  const touches = list(o.touches);
  for (const id of touches) orExit2(reg.index[id], `--touches ${id} does not exist — a change cannot touch something nobody has designed`);

  const fields = list(o.fields);
  orExit2(o.kind !== "display" || fields.length, `a display change with nothing to display is not a display change — name the fields as ENT-nnn.attribute, or open it as --kind screen`);
  for (const spec of fields) {
    const f = parseField(spec);
    orExit2(f, `--fields ${spec} is not a field reference — the shape is ENT-nnn.attribute`);
    const ent = state.artifacts.find((a) => a.id === f.ent);
    orExit2(ent, `--fields ${spec}: ${f.ent} does not exist`);
    orExit2((ent.raw.attributes ?? []).includes(f.attr), `--fields ${spec}: ${f.ent} (${ent.title}) has no attribute "${f.attr}" — this is not a display change, it is a new field: open it as --kind screen or --kind other`);
  }

  orExit2(o.source !== "finding" || o.finding, `--source finding must name the defect it came from: --finding DEF-<module>-nnn`);
  if (o.finding) {
    orExit2(prefixOf(o.finding) === "DEF" && reg.index[o.finding], `--finding ${o.finding} is not an existing DEF`);
  }

  const p = project(stateDir);
  const touchedRecords = touches.map((id) => state.artifacts.find((a) => a.id === id)).filter(Boolean).map((a) => a.raw);
  const module = resolveModule(p, o.module, touches);
  const app = resolveApp(p, o.app, o.kind, touchedRecords);

  const cr = {
    id: mintCrId(stateDir),
    title: String(o.title).trim(),
    status: "draft",
    kind: o.kind,
    source: o.source,
    request: String(o.request).trim(),
    module,
    app,
    touches,
    fields,
    finding: o.finding ?? null,
    lane: null,
    impact: null,
    applied: null,
    closed: null,
    openedAt: now(),
  };
  const file = writeCr(stateDir, cr);
  addEdges(stateDir, touches.map((to) => ({ from: cr.id, rel: "touches", to })));
  return { cr, file };
}

/**
 * The kind of a change is a judgement made when it was opened, and `impact` reads it to decide the
 * lane — so a wrong kind is a wrong lane and, for a CR opened by `qa:finding` (which defaults to
 * `rule`), a full lane nobody asked for. Correcting it is not editing history: the old value, who
 * changed it and why are kept on the record, and the lane and impact decided from the old kind are
 * cleared, because keeping them would be a decision nobody made.
 */
export function amendCr(stateDir, id, { kind = null, reason = null } = {}) {
  ensureInit(stateDir);
  const cr = readCr(stateDir, id);
  orExit2(cr, `no such CR: ${id}`);
  orExit2(cr.__open, `${id} is closed — a closed change is history; open a new CR`);
  orExit2(!cr.applied, `${id} was applied on ${String(cr.applied?.at).slice(0, 10)} — the plugins have already been told what to do, so what the change *is* cannot move under them; close it and open a new CR`);
  orExit2(KINDS.includes(kind), `--kind must be one of ${KINDS.join("|")}`);
  orExit2(String(reason ?? "").trim(), `--reason is required — a kind that changed with nobody's reason on it is the same as one nobody checked`);
  orExit2(kind !== cr.kind, `${id} is already kind "${kind}"`);
  orExit2(kind !== "display" || (cr.fields ?? []).length, `a display change with nothing to display is not a display change — this CR names no fields`);

  const from = cr.kind;
  cr.kind = kind;
  cr.amendments = [...(cr.amendments ?? []), { at: now(), field: "kind", from, to: kind, reason: String(reason).trim() }];
  cr.lane = null;
  cr.impact = null;
  cr.status = "draft";
  const file = writeCr(stateDir, cr);
  return { cr, file, from };
}

if (isMain(import.meta.url)) {
  const { flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  orExit2(stateExists(stateDir), `no state dir at ${stateDir}`);

  if (typeof flags.amend === "string") {
    const { cr, file, from } = amendCr(stateDir, flags.amend, { kind: typeof flags.kind === "string" ? flags.kind : null, reason: typeof flags.reason === "string" ? flags.reason : null });
    console.log(`AMEND ${cr.id}  kind ${from} -> ${cr.kind}`);
    console.log(`  reason: ${cr.amendments.at(-1).reason}`);
    console.log(`  lane and impact cleared — they were decided from kind "${from}"`);
    console.log(`  written: ${file}`);
    console.log(`
next: /change:impact ${cr.id}${cr.kind === "other" ? " --lane ui|full — \"other\" has no discriminator, so the lane is recorded as the owner’s" : ""}`);
    process.exit(0);
  }

  const { cr, file } = openCr(stateDir, flags);
  console.log(`OPEN ${cr.id}  ${cr.kind} · ${cr.source} · module ${cr.module}${cr.app ? ` · app ${cr.app}` : ""}`);
  console.log(`  ${cr.title}`);
  console.log(`  request: ${cr.request}`);
  console.log(`  touches: ${cr.touches.length ? cr.touches.join(", ") : "(nothing yet — a new capability freezes nothing)"}`);
  if (cr.fields.length) console.log(`  fields:  ${cr.fields.join(", ")}`);
  if (cr.finding) console.log(`  finding: ${cr.finding}`);
  console.log(`  written: ${file}`);
  console.log(`\nnext: /change:impact ${cr.id} — the lane is decided by the graph, not by the request`);
  process.exit(0);
}
