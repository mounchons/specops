#!/usr/bin/env node
/**
 * capture.mjs — turn what the client said into artifacts, and keep the raw words next to them.
 *
 *   node capture.mjs <module> [--new-module] (--text "…" | --source <path>) --records <file.json>
 *
 * The reading is the AI's job; the writing, the ids and the refusals are this script's.
 * --records is a JSON file the AI writes first:
 *   { stakeholders: [{key,title,role?,note?}],
 *     requirements: [{kind?:"REQ"|"NFR", actor, goal, title?, loc?}],
 *     glossary:     [{term, meaning}],
 *     questions:    [{category, text}] }
 * `actor` is either an existing STK id or "@key" naming a stakeholder in the same payload — nothing
 * is guessed here: an actor that resolves to neither is an error, not a new stakeholder.
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs, resolveStateDir, readJson, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { ensureInit } from "./init.mjs";
import { FILES, allReq, mintId, upsert, readItems, writeItems, requireModule, now } from "./lib.mjs";

const TEXT_EXT = new Set([".txt", ".text", ".log", ".csv"]);

/** Raw input lands on disk before anything is derived from it — provenance has to survive Cold Start. */
function keepSource(stateDir, { text, source }, ids) {
  const id = mintId(ids, "SRC");
  let ext = ".txt";
  let title = "pasted text";
  let bytes;
  if (source) {
    const e = path.extname(source).toLowerCase();
    // never .json/.md: core would walk it as an artifact file and count its lines (G-core-005)
    ext = e && !TEXT_EXT.has(e) && e !== ".json" && e !== ".md" ? e : ".txt";
    title = path.basename(source);
    bytes = fs.readFileSync(source);
  } else {
    bytes = Buffer.from(text, "utf8");
  }
  const file = FILES.rawSource(stateDir, id, ext);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return {
    id,
    title,
    status: "reviewed",
    kind: source ? "file" : "text",
    capturedAt: now(),
    bytes: bytes.length,
    raw: path.relative(stateDir, file).split(path.sep).join("/"),
  };
}

/**
 * Check the whole payload before a byte is written. A capture that half-applies leaves a source
 * document on disk with nothing derived from it, and no way to tell that from a real one.
 */
function validate(stateDir, records) {
  const known = new Set(readItems(FILES.stakeholders(stateDir)).map((r) => r.id));
  for (const s of records.stakeholders ?? []) {
    orExit2(String(s.title ?? "").trim(), `every stakeholder needs a title — got ${JSON.stringify(s)}`);
    if (s.key) known.add(`@${s.key}`);
  }
  for (const r of records.requirements ?? []) {
    orExit2(String(r.goal ?? "").trim(), `every requirement needs a goal — got ${JSON.stringify(r)}`);
    orExit2(
      known.has(r.actor),
      `actor ${JSON.stringify(r.actor ?? null)} is not a stakeholder — mint one in this payload as {key,title} and write "@key", or use an existing STK id`,
    );
  }
  for (const u of records.glossary ?? []) orExit2(String(u.term ?? "").trim() && String(u.meaning ?? "").trim(), `every glossary entry needs term and meaning — got ${JSON.stringify(u)}`);
  for (const q of records.questions ?? []) orExit2(String(q.text ?? "").trim(), `every question needs text — got ${JSON.stringify(q)}`);
}

export function capture(stateDir, module, { text, source, records }) {
  validate(stateDir, records);
  const existing = allReq(stateDir).map((r) => r.id);
  const written = { SRC: [], STK: [], REQ: [], NFR: [], UL: [], Q: [] };

  const src = keepSource(stateDir, { text, source }, existing);
  upsert(FILES.sources(stateDir), src);
  existing.push(src.id);
  written.SRC.push(src.id);

  const stkFile = FILES.stakeholders(stateDir);
  const byKey = new Map();
  for (const s of records.stakeholders ?? []) {
    const id = mintId(existing, "STK");
    existing.push(id);
    upsert(stkFile, { id, title: s.title, status: "reviewed", role: s.role ?? null, note: s.note ?? null, derivedFrom: [src.id] });
    if (s.key) byKey.set(`@${s.key}`, id);
    written.STK.push(id);
  }

  const reqFile = FILES.requirements(stateDir, module);
  for (const r of records.requirements ?? []) {
    const kind = r.kind === "NFR" ? "NFR" : "REQ";
    const actor = byKey.get(r.actor) ?? r.actor;
    const id = mintId(existing, kind, module);
    existing.push(id);
    upsert(reqFile, {
      id,
      title: r.title ?? r.goal,
      status: "draft",
      actor,
      goal: r.goal,
      provenance: { src: src.id, loc: r.loc ?? null },
      derivedFrom: [src.id],
    });
    written[kind].push(id);
  }

  const ulFile = FILES.glossary(stateDir, module);
  for (const u of records.glossary ?? []) {
    const id = mintId(existing, "UL", module);
    existing.push(id);
    upsert(ulFile, { id, title: u.term, status: "reviewed", meaning: u.meaning, derivedFrom: [src.id] });
    written.UL.push(id);
  }

  for (const q of records.questions ?? []) {
    const category = q.category ?? "open";
    const file = FILES.questions(stateDir, module, category);
    const id = mintId(existing, "Q", module);
    existing.push(id);
    upsert(file, { id, title: q.text, status: "draft", category, origin: "capture", derivedFrom: [src.id] });
    written.Q.push(id);
  }

  return { src, written };
}

if (isMain(import.meta.url)) {
  const { _, flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  const module = _[0];
  orExit2(module, "usage: capture.mjs <module> (--text \"…\" | --source <path>) --records <file.json> [--new-module]");
  ensureInit(stateDir);
  requireModule(stateDir, module, { create: Boolean(flags["new-module"]) });

  const text = typeof flags.text === "string" ? flags.text : null;
  const source = typeof flags.source === "string" ? flags.source : null;
  orExit2(text || source, "give the raw input: --text \"…\" or --source <path>");
  orExit2(!source || fs.existsSync(source), `no such file: ${source}`);
  orExit2(typeof flags.records === "string" && fs.existsSync(flags.records), "--records <file.json> is required — extract first, then let the script mint the ids");

  const { src, written } = capture(stateDir, module, { text, source, records: readJson(flags.records) });
  console.log(`CAPTURE ${module}  source ${src.id} (${src.bytes} bytes) -> ${src.raw}`);
  for (const [kind, ids] of Object.entries(written)) if (ids.length) console.log(`  ${kind.padEnd(4)} ${ids.length}  ${ids.join(" ")}`);
  console.log("  next: /req:ask " + module + "  (the bank asks what the client did not think to say)");
  process.exit(0);
}
