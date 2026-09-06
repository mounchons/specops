#!/usr/bin/env node
/**
 * approve.mjs — the client signs a list of drawings, and that list is the scope of the quotation.
 *
 *   node approve.mjs <app> --sign STK-nnn --evidence <path> [--state-dir X]
 *
 * Signing stores the hash of every drawing as it was on the day. From then on G-mock-003 goes red
 * the moment one of them differs, which is the whole mechanism: nobody has to remember what was
 * agreed, and nobody can quietly change it.
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs, resolveStateDir, stateExists, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { ensureRegistry } from "../../core/scripts/query.mjs";
import { loadState } from "../../core/scripts/artifacts.mjs";
import { prefixOf } from "../../core/scripts/ids.mjs";
import { ensureInit } from "./init.mjs";
import { FILES, allMcks, writeMck, hashOf, controlsOf, readTheme, requireApp, screensOf, isFrozen, now, today } from "./lib.mjs";
import { renderMck } from "./render.mjs";

function baselineDoc(app, mcks, signer, evidence, at) {
  const lines = [
    `# Baseline — ${app} · ${at.slice(0, 10)}`,
    ``,
    `เซ็นโดย ${signer} เมื่อ ${at} · หลักฐาน \`${evidence}\``,
    `รายการนี้คือขอบเขตของใบเสนอราคา: หน้าจอที่ไม่อยู่ในตารางนี้ ไม่ได้ถูกเสนอราคา`,
    ``,
    `| MCK | หน้าจอ | ชื่อ | controls | hash ที่เซ็น |`,
    `|---|---|---|---|---|`,
    ...mcks.map((m) => `| ${m.id} | ${m.ui} | ${m.title} | ${controlsOf(m).length} | \`${m.hash}\` |`),
    ``,
    `${mcks.length} หน้าจอ · แก้หลังจากนี้ต้องผ่าน \`/change:open\` — ถ้าไฟล์ไหนเปลี่ยนโดยไม่มี CR gate G-mock-003 จะแดงและบอกว่าไฟล์ไหน`,
    ``,
    `> เอกสารนี้ถูก render ออกมาให้ลูกค้าอ่าน ไม่มีสคริปต์ใดอ่านกลับ (rule 4) — ความจริงอยู่ที่ \`signed{}\` บนแต่ละ MCK`,
  ];
  return lines.join("\n") + "\n";
}

export function approve(stateDir, app, { sign = null, evidence = null } = {}) {
  ensureInit(stateDir);
  requireApp(stateDir, app);
  orExit2(sign, `--sign STK-nnn is required — a baseline is something a person signed`);
  orExit2(evidence, `--evidence <path> is required — a signature with no evidence is a claim`);
  orExit2(fs.existsSync(evidence), `--evidence ${evidence} does not exist`);
  const reg = ensureRegistry(stateDir);
  orExit2(prefixOf(sign) === "STK" && reg.index[sign], `--sign ${sign} is not a stakeholder in req/stakeholders.json`);

  const theme = readTheme(stateDir);
  orExit2(theme, `no theme yet — nothing has been drawn`);
  const state = loadState(stateDir);
  const screens = screensOf(state, app);
  const mcks = allMcks(stateDir).filter((m) => m.app === app);

  const holes = screens.filter((s) => !mcks.some((m) => m.ui === s.id)).map((s) => ({ id: s.id, title: s.title }));
  const frozen = mcks.map((m) => ({ m, f: isFrozen(m.ui, { stateDir }) })).filter((x) => x.f.frozen).map((x) => ({ id: x.m.id, ui: x.m.ui, by: x.f.by, lane: x.f.lane }));
  if (holes.length || frozen.length) return { app, holes, frozen, signed: [] };

  const at = now();
  const signed = [];
  for (const m of mcks.sort((a, b) => a.id.localeCompare(b.id))) {
    const body = { ...m, hash: hashOf(m), status: "approved", signed: { at, by: sign, evidence, hash: hashOf(m) } };
    writeMck(stateDir, body);
    fs.writeFileSync(FILES.html(stateDir, app, m.id), renderMck(body, theme), "utf8");
    signed.push(body);
  }
  const doc = FILES.baselineDoc(stateDir, app, today());
  fs.mkdirSync(path.dirname(doc), { recursive: true });
  fs.writeFileSync(doc, baselineDoc(app, signed, sign, evidence, at), "utf8");
  return { app, holes: [], frozen: [], signed, doc, at };
}

if (isMain(import.meta.url)) {
  const { _, flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  orExit2(stateExists(stateDir), `no state dir at ${stateDir}`);
  orExit2(_[0], "usage: approve.mjs <app> --sign STK-nnn --evidence <path>");
  const r = approve(stateDir, _[0], { sign: typeof flags.sign === "string" ? flags.sign : null, evidence: typeof flags.evidence === "string" ? flags.evidence : null });

  if (r.holes.length || r.frozen.length) {
    console.log(`CANNOT APPROVE ${r.app} — a baseline with holes is not a scope`);
    for (const h of r.holes) console.log(`  ${h.id.padEnd(15)} ${h.title} — no wireframe · /mock:wireframe ${r.app}`);
    for (const f of r.frozen) console.log(`  ${f.id.padEnd(15)} ${f.ui} — frozen by ${f.by} (lane ${f.lane}) · close the change first`);
    process.exit(1);
  }

  console.log(`APPROVE ${r.app}  ${r.signed.length} wireframe(s) signed by ${flags.sign} · evidence ${flags.evidence}`);
  for (const m of r.signed) console.log(`  ${m.id.padEnd(15)} ${m.ui.padEnd(15)} ${m.hash}  ${m.title}`);
  console.log(`\nbaseline document: ${r.doc}`);
  console.log(`from here G-mock-003 goes red if any of these ${r.signed.length} drawings changes without a CR`);
  process.exit(0);
}
