#!/usr/bin/env node
/**
 * rules.mjs — Example Mapping on disk: rule · example · question.
 *
 *   node rules.mjs <module>                                          the map: rules, their examples, the questions in the way
 *   node rules.mjs <module> --br "…" [--from REQ-rental-001]         a rule found while mapping
 *   node rules.mjs <module> --ex BR-rental-001@v1 --given "…" --when "…" --then "…"
 *   node rules.mjs <module> --retire BR-rental-012@v1 --reason "…" [--replace "…"] [--cr CR-001]
 *   node rules.mjs <module> --question "…" [--category freeze-point] [--defer]
 *
 * A withdrawn rule is retired, never deleted: the reason it was withdrawn is the part that stops
 * the same argument happening twice. Five examples per rule is the cap — the sixth example is
 * usually a second rule wearing a disguise.
 */
import { parseArgs, resolveStateDir, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { lineageOf, prefixOf } from "../../core/scripts/ids.mjs";
import { ensureInit } from "./init.mjs";
import { FILES, allReq, mintId, upsert, findById, byPrefix, versionNum, addEdges, requireModule, now } from "./lib.mjs";

export const EX_CAP = 5;
const stripInternal = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "__file"));
const examplesOf = (records, brId) => byPrefix(records, "EX").filter((e) => (e.derivedFrom ?? []).includes(brId));

export function addRule(stateDir, module, { text, from, closes }) {
  const records = allReq(stateDir);
  const derivedFrom = [];
  if (from) {
    orExit2(findById(records, from), `no such requirement: ${from}`);
    derivedFrom.push(from);
  }
  const q = closes ? findById(records, closes) : null;
  if (closes) {
    orExit2(q, `no such question: ${closes}`);
    derivedFrom.push(closes);
  }
  const id = `${mintId(records.map((r) => r.id), "BR", module)}@v1`;
  upsert(FILES.rules(stateDir, module), { id, title: text, status: "draft", origin: "example-mapping", derivedFrom, foundAt: now() });
  if (q) upsert(q.__file, { ...stripInternal(q), status: "reviewed", answer: { text, at: now() }, mints: id });
  return id;
}

/** Close a question whose answer creates no rule — the bank never asked it, so `ask` cannot. */
export function closeQuestion(stateDir, qid, note) {
  const q = findById(allReq(stateDir), qid);
  orExit2(q, `no such question: ${qid}`);
  orExit2(String(note ?? "").trim(), "--note is the answer — a question closed without one is a question nobody answered");
  upsert(q.__file, { ...stripInternal(q), status: "reviewed", answer: { text: note, at: now() }, mints: null });
  return q.id;
}

export function addExample(stateDir, module, { brId, given, when, then, title }) {
  const records = allReq(stateDir);
  const br = findById(records, brId);
  orExit2(br, `no such rule: ${brId}`);
  orExit2(prefixOf(brId) === "BR", `--ex takes a BR@vN, got ${brId}`);
  orExit2(br.status !== "retired", `${brId} is retired — put the example on the version that replaced it (${br.supersededBy ?? "none yet"})`);
  const have = examplesOf(records, brId);
  orExit2(have.length < EX_CAP, `${brId} already has ${have.length} examples — the cap is ${EX_CAP}; a sixth example usually means a second rule`);

  const id = mintId(records.map((r) => r.id), "EX", module);
  upsert(FILES.examples(stateDir, module, lineageOf(brId)), {
    id,
    title: title ?? `${given} → ${then}`,
    status: "draft",
    given,
    when,
    then,
    derivedFrom: [brId],
  });
  addEdges(stateDir, [{ from: id, rel: "verifies", to: brId }]);
  return id;
}

export function retireRule(stateDir, module, { brId, reason, replace, cr }) {
  const records = allReq(stateDir);
  const br = findById(records, brId);
  orExit2(br, `no such rule: ${brId}`);
  orExit2(br.status !== "retired", `${brId} is already retired`);
  orExit2(String(reason ?? "").trim(), "--reason is required — a rule withdrawn without a reason gets re-proposed next month");
  orExit2(!br.approval || cr, `${brId} carries the client's approval — name the CR that asked for the change with --cr`);

  let next = null;
  if (replace) {
    next = `${lineageOf(brId)}@v${versionNum(brId) + 1}`;
    const derivedFrom = [brId, ...(cr ? [cr] : [])];
    upsert(FILES.rules(stateDir, module), { id: next, title: replace, status: "draft", supersedes: brId, derivedFrom, replacedAt: now() });
  }
  upsert(br.__file, { ...stripInternal(br), status: "retired", retiredReason: reason, retiredAt: now(), ...(next ? { supersededBy: next } : {}) });
  return { retired: brId, next };
}

export function addQuestion(stateDir, module, { text, category, deferred }) {
  const records = allReq(stateDir);
  const cat = category ?? "open";
  const id = mintId(records.map((r) => r.id), deferred ? "DQ" : "Q", module);
  upsert(FILES.questions(stateDir, module, cat), { id, title: text, status: "draft", category: cat, origin: "example-mapping" });
  return id;
}

export function map(stateDir, module) {
  const records = allReq(stateDir).filter((r) => String(r.id).includes(`-${module}-`));
  const rules = byPrefix(records, "BR").sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const open = [...byPrefix(records, "Q"), ...byPrefix(records, "DQ")].filter((q) => q.status === "draft");
  return {
    rules: rules.map((r) => ({ id: r.id, status: r.status, title: r.title, examples: examplesOf(records, r.id) })),
    open,
  };
}

if (isMain(import.meta.url)) {
  const { _, flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  const module = _[0];
  orExit2(module, "usage: rules.mjs <module> [--br … | --ex BR@v --given … --when … --then … | --retire BR@v --reason … | --question …]");
  ensureInit(stateDir);
  requireModule(stateDir, module);

  if (typeof flags.br === "string") {
    const id = addRule(stateDir, module, { text: flags.br, from: typeof flags.from === "string" ? flags.from : null, closes: typeof flags.closes === "string" ? flags.closes : null });
    console.log(`RULE ${id}${flags.closes ? `  (closes ${flags.closes})` : ""}`);
    process.exit(0);
  }
  if (typeof flags.close === "string") {
    console.log(`CLOSED ${closeQuestion(stateDir, flags.close, typeof flags.note === "string" ? flags.note : null)}  (answered, no rule)`);
    process.exit(0);
  }
  if (typeof flags.ex === "string") {
    orExit2(typeof flags.given === "string" && typeof flags.when === "string" && typeof flags.then === "string", "an example is --given … --when … --then …");
    console.log(`EXAMPLE ${addExample(stateDir, module, { brId: flags.ex, given: flags.given, when: flags.when, then: flags.then, title: typeof flags.title === "string" ? flags.title : null })} verifies ${flags.ex}`);
    process.exit(0);
  }
  if (typeof flags.retire === "string") {
    const { retired, next } = retireRule(stateDir, module, {
      brId: flags.retire,
      reason: typeof flags.reason === "string" ? flags.reason : null,
      replace: typeof flags.replace === "string" ? flags.replace : null,
      cr: typeof flags.cr === "string" ? flags.cr : null,
    });
    console.log(`RETIRED ${retired}${next ? ` -> ${next}` : ""}  (kept on disk; the reason is the point)`);
    process.exit(0);
  }
  if (typeof flags.question === "string") {
    console.log(`QUESTION ${addQuestion(stateDir, module, { text: flags.question, category: typeof flags.category === "string" ? flags.category : null, deferred: Boolean(flags.defer) })}`);
    process.exit(0);
  }

  const { rules, open } = map(stateDir, module);
  console.log(`EXAMPLE MAP ${module}  ${rules.filter((r) => r.status !== "retired").length} live rule(s), ${rules.filter((r) => r.status === "retired").length} retired`);
  for (const r of rules) {
    console.log(`\n${r.id}  [${r.status}]  ${r.title}`);
    if (r.examples.length === 0 && r.status !== "retired") console.log(`   (no example yet — /req:rules ${module} --ex ${r.id} --given … --when … --then …)`);
    for (const e of r.examples) console.log(`   ${e.id}  given ${e.given} · when ${e.when} · then ${e.then}`);
  }
  if (open.length) {
    console.log(`\nopen questions (${open.length}):`);
    for (const q of open) console.log(`   ${q.id}  [${q.category}]  ${q.title}`);
  }
  process.exit(0);
}
