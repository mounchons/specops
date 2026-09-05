#!/usr/bin/env node
/**
 * usecase.mjs — the script pages: who does what, in what order, and which rule version each step
 * enforces.
 *
 *   node usecase.mjs <module> --records <file.json>
 *   node usecase.mjs <module>                          which rules are not enforced by any step yet
 *
 * Two refusals matter here. A step's `enforces` is where a rule finally bites — a rule attached to
 * a whole use case never fires at delivery time, so `enforces` lives on steps. And an acceptance
 * criterion's `then` must be the `then` of a real example, word for word: the moment somebody
 * paraphrases it, the test and the rule have drifted and nobody notices for a month.
 *
 * --records payload:
 *   { "usecases": [ { key, title, actor: STK-nnn, apps: ["backoffice"], satisfies: [REQ-…],
 *                     crud?: ENT-nnn, readOnly?: bool, precondition?,
 *                     flows: { main: [{step, enforces?[]}], alt?: [{name, steps: []}], exception?: [...] },
 *                     acceptance: [ { flow, given, when, then, from: EX-… } ] } ] }
 */
import fs from "node:fs";
import { parseArgs, resolveStateDir, readJson, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { prefixOf } from "../../core/scripts/ids.mjs";
import { ensureInit } from "./init.mjs";
import { FILES, allDesign, allReq, byPrefix, findById, inModule, live, minter, upsert, addEdges, requireModule, now } from "./lib.mjs";

const flowsOf = (uc) => [
  { name: "main", steps: uc.flows?.main ?? [] },
  ...(uc.flows?.alt ?? []).map((f, i) => ({ name: f.name ?? `alt-${i + 1}`, steps: f.steps ?? [] })),
  ...(uc.flows?.exception ?? []).map((f, i) => ({ name: f.name ?? `exception-${i + 1}`, steps: f.steps ?? [] })),
];

function validate(stateDir, module, records) {
  const req = allReq(stateDir);
  const design = allDesign(stateDir);
  const apps = new Set((requireModule(stateDir, module).apps ?? []).map((a) => a.name));
  for (const uc of records.usecases ?? []) {
    orExit2(String(uc.title ?? "").trim(), `every use case needs a title — got ${JSON.stringify(uc.key ?? uc)}`);
    orExit2(prefixOf(uc.actor) === "STK" && findById(req, uc.actor), `${uc.title}: actor ${JSON.stringify(uc.actor ?? null)} is not a stakeholder`);
    orExit2((uc.satisfies ?? []).length, `${uc.title}: name the REQ it satisfies — a use case nobody asked for is scope creep`);
    for (const r of uc.satisfies) orExit2(findById(req, r) && /^(REQ|NFR)-/.test(r), `${uc.title}: ${r} is not a requirement on disk`);
    orExit2((uc.apps ?? []).length, `${uc.title}: name the app(s) it is used from — screens generates one UI per app`);
    for (const a of uc.apps) orExit2(apps.has(a), `${uc.title}: app "${a}" is not declared in project.json`);
    if (uc.crud) orExit2(findById(design, uc.crud), `${uc.title}: crud names ${uc.crud}, which is not an entity on disk`);
    orExit2(flowsOf(uc)[0].steps.length, `${uc.title}: the main flow has no steps`);
    for (const f of flowsOf(uc)) {
      for (const s of f.steps) {
        orExit2(String(s.step ?? "").trim(), `${uc.title} / ${f.name}: a step with no text`);
        for (const br of s.enforces ?? []) {
          const rule = findById(req, br);
          orExit2(rule && prefixOf(br) === "BR", `${uc.title} / ${f.name}: step enforces ${br}, which is not a rule on disk`);
          orExit2(rule.status !== "retired", `${uc.title} / ${f.name}: step enforces ${br}, which is retired — use ${rule.supersededBy ?? "the version that replaced it"}`);
        }
      }
    }
    const flowNames = new Set(flowsOf(uc).map((f) => f.name));
    const enforced = new Set(flowsOf(uc).flatMap((f) => f.steps.flatMap((s) => s.enforces ?? [])));
    for (const ac of uc.acceptance ?? []) {
      orExit2(flowNames.has(ac.flow), `${uc.title}: acceptance names flow "${ac.flow}" — the flows of this use case are ${[...flowNames].map((n) => `"${n}"`).join(", ")} (a named alternate or exception flow is referenced by its name)`);
      const ex = findById(req, ac.from);
      orExit2(ex && prefixOf(ac.from) === "EX", `${uc.title}: acceptance must come from an EX, got ${JSON.stringify(ac.from ?? null)}`);
      orExit2(
        String(ex.then).trim() === String(ac.then).trim(),
        `${uc.title}: acceptance "then" must be ${ac.from}'s words exactly.\n        EX says: ${JSON.stringify(ex.then)}\n        you wrote: ${JSON.stringify(ac.then)}`,
      );
      const br = (ex.derivedFrom ?? []).find((d) => prefixOf(d) === "BR");
      orExit2(enforced.has(br), `${uc.title}: acceptance quotes ${ac.from}, which proves ${br} — but no step of this use case enforces ${br}`);
    }
  }
}

export function writeUseCases(stateDir, module, records) {
  validate(stateDir, module, records);
  const ids = allDesign(stateDir).map((r) => r.id);
  const nextUc = minter(ids, "UC", module);
  const nextAc = minter([...ids], "AC", module);
  const written = [];

  for (const uc of records.usecases ?? []) {
    const id = nextUc();
    const flows = flowsOf(uc);
    const enforces = [...new Set(flows.flatMap((f) => f.steps.flatMap((s) => s.enforces ?? [])))];
    const file = FILES.usecase(stateDir, module, id);
    upsert(file, {
      id,
      title: uc.title,
      status: "draft",
      actor: uc.actor,
      apps: uc.apps,
      crud: uc.crud ?? null,
      readOnly: Boolean(uc.readOnly),
      precondition: uc.precondition ?? null,
      flows: flows.map((f) => ({ name: f.name, steps: f.steps.map((s) => ({ step: s.step, enforces: s.enforces ?? [] })) })),
      enforces,
      derivedFrom: [...uc.satisfies],
      writtenAt: now(),
    });
    const acs = [];
    for (const ac of uc.acceptance ?? []) {
      const acId = nextAc();
      upsert(file, { id: acId, title: `${ac.flow}: ${ac.when}`, status: "draft", usecase: id, flow: ac.flow, given: ac.given, when: ac.when, then: ac.then, derivedFrom: [id, ac.from] });
      acs.push(acId);
    }
    addEdges(stateDir, [
      ...uc.satisfies.map((r) => ({ from: id, rel: "satisfies", to: r })),
      ...enforces.map((br) => ({ from: id, rel: "enforces", to: br })),
    ]);
    written.push({ id, title: uc.title, apps: uc.apps, flows: flows.length, enforces, acs });
  }
  return written;
}

/** Live rules of the module that no step enforces — the gate says it too, this says it early. */
export function unenforced(stateDir, module) {
  const req = allReq(stateDir);
  const rules = live(byPrefix(req, "BR")).filter((r) => inModule(r, module));
  const enforced = new Set(byPrefix(allDesign(stateDir), "UC").flatMap((uc) => uc.enforces ?? []));
  return rules.filter((r) => !enforced.has(r.id));
}

if (isMain(import.meta.url)) {
  const { _, flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  const module = _[0];
  orExit2(module, "usage: usecase.mjs <module> [--records <file.json>]");
  ensureInit(stateDir);
  requireModule(stateDir, module);

  if (typeof flags.records === "string") {
    orExit2(fs.existsSync(flags.records), `no such file: ${flags.records}`);
    const written = writeUseCases(stateDir, module, readJson(flags.records));
    console.log(`USECASE ${module}  ${written.length} use case(s)`);
    for (const u of written) console.log(`  ${u.id}  ${u.title}\n     apps ${u.apps.join(", ")} · ${u.flows} flow(s) · ${u.acs.length} AC · enforces ${u.enforces.join(" ") || "(none)"}`);
  }

  const left = unenforced(stateDir, module);
  if (left.length) {
    console.log(`\n${left.length} live rule(s) no step enforces yet — G-design-004 stays red until they are:`);
    for (const r of left) console.log(`  ${r.id}  ${r.title}`);
  } else {
    console.log(`\nevery live rule of ${module} is enforced by at least one step`);
    console.log(`  next: /design:screens ${module}`);
  }
  process.exit(0);
}
