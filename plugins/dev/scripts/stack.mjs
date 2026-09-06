#!/usr/bin/env node
/**
 * stack.mjs — the stack is a decision, and decisions live on disk. Asked once, remembered forever.
 *
 *   node stack.mjs [--records <file.json>] [--confirmed-by STK-nnn] [--code-root <path>] [--state-dir X]
 *
 * With no --records it prints what has to be answered, per app, and stops. Nothing has a default:
 * a stack nobody chose is the stack the first file happens to use, and by then it is in the code
 * instead of in the record.
 *
 *   {"by":"STK-001","components":{"api":{"language":"csharp",…},"backoffice":{…}}}
 */
import path from "node:path";
import { parseArgs, resolveStateDir, stateExists, readJson, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { ensureRegistry } from "../../core/scripts/query.mjs";
import { prefixOf } from "../../core/scripts/ids.mjs";
import { ensureInit } from "./init.mjs";
import { FILES, questions, list, now, project, codeRootOf, readItems, writeItems, allCmps } from "./lib.mjs";

const get = (o, key) => key.split(".").reduce((v, k) => (v == null ? v : v[k]), o);

export function writeStack(stateDir, records, { by = null, codeRoot = null } = {}) {
  ensureInit(stateDir);
  const bank = questions();
  const p = project(stateDir);
  const apps = (p.apps ?? []).map((a) => a.name);
  const given = records.components ?? {};

  const missingApps = apps.filter((a) => !given[a]);
  orExit2(missingApps.length === 0, `no stack for ${missingApps.join(", ")} — every app the project declares gets its own component, or dev cannot tell which files belong to which`);

  for (const [name, c] of Object.entries(given)) {
    const missing = bank.filter((q) => {
      const v = get(c, q.key);
      return v === undefined || String(v).trim() === "";
    }).map((q) => q.key);
    orExit2(missing.length === 0, `component "${name}": no answer for ${missing.join(", ")} — dev does not guess a stack`);
  }

  const signer = by ?? records.by ?? null;
  orExit2(signer, `--confirmed-by STK-nnn is required — a stack is a decision, and the graph knows whose`);
  const reg = ensureRegistry(stateDir);
  orExit2(prefixOf(signer) === "STK" && reg.index[signer], `--confirmed-by ${signer} is not a stakeholder in req/stakeholders.json`);

  const root = codeRoot ? path.relative(stateDir, codeRootOf(stateDir, codeRoot)).split(path.sep).join("/") || "." : "..";
  const existing = readItems(FILES.components(stateDir));
  const items = [];
  for (const [name, c] of Object.entries(given)) {
    const id = `CMP-${name}`;
    const was = existing.find((x) => x.id === id);
    items.push({
      id,
      title: c.title ?? name,
      status: "approved",
      app: apps.includes(name) ? name : null,
      language: String(c.language),
      framework: String(c.framework),
      version: String(c.version),
      orm: String(c.orm),
      db: String(c.db),
      testRunner: String(c.testRunner),
      skills: Array.isArray(c.skills) ? c.skills : list(c.skills),
      root: String(c.root).replace(/\\/g, "/").replace(/\/$/, ""),
      codeRoot: root,
      run: { compose: get(c, "run.compose"), up: get(c, "run.up"), down: get(c, "run.down"), healthcheck: get(c, "run.healthcheck"), test: get(c, "run.test") },
      config: { env: Array.isArray(c.config?.env) ? c.config.env : list(get(c, "config.env")), secrets: Array.isArray(c.config?.secrets) ? c.config.secrets : list(get(c, "config.secrets")) },
      confirmedBy: signer,
      decidedFrom: Array.isArray(c.decidedFrom) ? c.decidedFrom : [],
      confirmedAt: now(),
      firstConfirmedAt: was?.firstConfirmedAt ?? now(),
    });
  }
  writeItems(FILES.components(stateDir), items.sort((a, b) => a.id.localeCompare(b.id)));
  return { items, replaced: existing.length > 0 };
}

if (isMain(import.meta.url)) {
  const { flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  orExit2(stateExists(stateDir), `no state dir at ${stateDir}`);

  if (!flags.records) {
    ensureInit(stateDir);
    const bank = questions();
    const p = project(stateDir);
    const have = allCmps(stateDir);
    console.log(`STACK — ${bank.length} คำถาม ต่อ component · ตอบครบแล้วรัน --records <file.json> --confirmed-by STK-nnn`);
    console.log(`  {"by":"STK-nnn","components":{"<app หรือ backend ที่ใช้ร่วม>":{ … }}}\n`);
    console.log(`components ที่ต้องมีอย่างน้อย: ${(p.apps ?? []).map((a) => `${a.name} (${a.type})`).join(" · ")}`);
    console.log(`เพิ่ม backend ที่ทุก app ใช้ร่วมกันได้ เช่น "api" — จะได้ CMP-api\n`);
    for (const q of bank) console.log(`  ${q.key.padEnd(18)} ${q.ask}\n  ${" ".repeat(18)} เช่น ${q.example}`);
    console.log(have.length ? `\nตอนนี้มี: ${have.map((c) => `${c.id} (${c.language} ${c.framework} ${c.version})`).join(" · ")} — ตอบใหม่เพื่อทับค่า` : `\nยังไม่มี CMP — /dev:plan ถูกปฏิเสธจนกว่าจะมี`);
    process.exit(0);
  }

  const { items, replaced } = writeStack(stateDir, readJson(String(flags.records)), {
    by: typeof flags["confirmed-by"] === "string" ? flags["confirmed-by"] : null,
    codeRoot: typeof flags["code-root"] === "string" ? flags["code-root"] : null,
  });
  console.log(`STACK ${items.length} component(s) ${replaced ? "overwritten" : "written"} · confirmed by ${items[0].confirmedBy}`);
  for (const c of items) {
    console.log(`  ${c.id.padEnd(16)} ${c.language} ${c.framework} ${c.version} · ${c.orm} · ${c.db} · ${c.testRunner}`);
    console.log(`  ${" ".repeat(16)} root ${c.root} · test: ${c.run.test} · up: ${c.run.up}`);
    if (c.skills.length) console.log(`  ${" ".repeat(16)} skills ${c.skills.join(" ")} — LIMIT: no script can see whether a session has them`);
  }
  console.log(`\nnext: /dev:plan <module> — one task per use case, in an order the graph decides`);
  process.exit(0);
}
