#!/usr/bin/env node
/**
 * export.mjs — the one file in .sdlc written for a person to read.
 *
 *   node export.mjs <module> [--sign STK-001 --evidence <path>]
 *
 * export/ is output only and is never read back (rule 4), so nothing downstream may depend on the
 * wording here. --sign is req's approve: the client signed this document, so the records it renders
 * become `approved` and carry the evidence that says who signed what, when.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseArgs, resolveStateDir, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { prefixOf } from "../../core/scripts/ids.mjs";
import { ensureInit } from "./init.mjs";
import { FILES, allReq, upsert, findById, byPrefix, requireModule, project, now } from "./lib.mjs";

const SIGNS = ["REQ", "NFR", "BR", "CALC", "EX"];
const inModule = (r, m) => String(r.id).includes(`-${m}-`);
const live = (rs) => rs.filter((r) => r.status !== "retired");
const stripInternal = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "__file"));

const ROUND_TH = { none: "ไม่ปัด", ceil: "ปัดขึ้น", floor: "ปัดลง", "half-up": "ปัดครึ่งขึ้น", "half-down": "ปัดครึ่งลง", "half-even": "ปัดครึ่งคู่" };

export function render(stateDir, module) {
  const all = allReq(stateDir);
  const mine = all.filter((r) => inModule(r, module));
  const stk = byPrefix(all, "STK");
  const src = byPrefix(all, "SRC");
  const reqs = [...byPrefix(mine, "REQ"), ...byPrefix(mine, "NFR")];
  const rules = byPrefix(mine, "BR").sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const calcs = byPrefix(mine, "CALC");
  const golden = byPrefix(mine, "GD");
  const glossary = byPrefix(mine, "UL");
  const open = [...byPrefix(mine, "Q"), ...byPrefix(mine, "DQ")].filter((q) => q.status === "draft");
  const exOf = (brId) => byPrefix(mine, "EX").filter((e) => (e.derivedFrom ?? []).includes(brId));
  const nameOf = (id) => findById(all, id)?.title ?? id;

  const L = [];
  L.push(`# ข้อกำหนดความต้องการ — ${project(stateDir).name} · โมดูล ${module}`, "");
  L.push(`> จัดทำจากสิ่งที่ตกลงกันไว้ ณ ${now().slice(0, 10)} · ทุกข้อในเอกสารนี้อ้างอิงรหัสที่ตรวจสอบย้อนกลับได้`, "");

  L.push("## ผู้เกี่ยวข้อง", "", "| รหัส | ผู้เกี่ยวข้อง | บทบาท |", "|---|---|---|");
  for (const s of stk) L.push(`| ${s.id} | ${s.title} | ${s.role ?? "—"} |`);
  L.push("");

  if (glossary.length) {
    L.push("## ศัพท์ที่ตกลงความหมายแล้ว", "", "| รหัส | คำ | ความหมาย |", "|---|---|---|");
    for (const u of glossary) L.push(`| ${u.id} | ${u.title} | ${u.meaning} |`);
    L.push("");
  }

  L.push("## สิ่งที่ต้องการ", "", "| รหัส | ผู้ใช้ | ต้องการ |", "|---|---|---|");
  for (const r of reqs) L.push(`| ${r.id} | ${nameOf(r.actor)} | ${r.goal} |`);
  L.push("");

  L.push("## กฎธุรกิจ", "");
  for (const r of live(rules)) {
    L.push(`### ${r.id} — ${r.title}`, "");
    const exs = exOf(r.id);
    if (exs.length) {
      L.push("| ตัวอย่าง | เมื่อ | ทำ | ผลลัพธ์ |", "|---|---|---|---|");
      for (const e of exs) L.push(`| ${e.id} | ${e.given} | ${e.when} | ${e.then} |`);
      L.push("");
    }
  }

  if (calcs.length) {
    L.push("## การคำนวณ", "");
    for (const c of live(calcs)) {
      const gd = golden.find((g) => (g.derivedFrom ?? []).includes(c.id));
      L.push(`### ${c.id} — ${c.title}`, "");
      L.push(`- สูตร: \`${c.formula}\``);
      L.push(`- ชนิดตัวเลข: ${c.numberType === "integer" ? "จำนวนเต็ม" : "ทศนิยม"} · การปัด: ${ROUND_TH[c.rounding?.mode] ?? c.rounding?.mode}${c.rounding?.unit > 1 ? ` เป็นหน่วย ${c.rounding.unit}` : ""}${c.rounding?.at ? ` · ปัดที่: ${c.rounding.at}` : ""}`);
      if ((c.boundary ?? []).length) L.push(`- กรณีขอบเขต: ${c.boundary.join(" · ")}`);
      if (gd) {
        L.push("", `ชุดตัวเลขอ้างอิง ${gd.id}${gd.signedBy ? ` (ลงนามโดย ${nameOf(gd.signedBy)} ${String(gd.signedAt).slice(0, 10)})` : " (ยังไม่ลงนาม)"}:`, "", "| ข้อมูลเข้า | ผลลัพธ์ |", "|---|---|");
        for (const row of gd.rows ?? []) L.push(`| ${JSON.stringify(row.input)} | ${JSON.stringify(row.expected ?? null)} |`);
      }
      L.push("");
    }
  }

  const retired = rules.filter((r) => r.status === "retired");
  if (retired.length) {
    L.push("## กฎที่ถอนแล้ว (เก็บไว้เพื่ออ้างอิง)", "", "| รหัส | กฎเดิม | เหตุผลที่ถอน | แทนด้วย |", "|---|---|---|---|");
    for (const r of retired) L.push(`| ${r.id} | ${r.title} | ${r.retiredReason ?? "—"} | ${r.supersededBy ?? "—"} |`);
    L.push("");
  }

  if (open.length) {
    L.push("## คำถามที่ยังรอคำตอบ", "", "| รหัส | คำถาม |", "|---|---|");
    for (const q of open) L.push(`| ${q.id} | ${q.title} |`);
    L.push("");
  }

  if (src.length) {
    L.push("## ที่มาของข้อมูล", "", "| รหัส | ต้นทาง | เก็บเมื่อ |", "|---|---|---|");
    for (const s of src) L.push(`| ${s.id} | ${s.title} | ${String(s.capturedAt).slice(0, 10)} |`);
    L.push("");
  }
  return L.join("\n");
}

export function signModule(stateDir, module, { by, evidence, docHash }) {
  const approval = { by, at: now(), evidence, docHash };
  const touched = [];
  for (const r of allReq(stateDir)) {
    if (!inModule(r, module) || !SIGNS.includes(prefixOf(r.id))) continue;
    if (r.status === "retired") continue;
    upsert(r.__file, { ...stripInternal(r), status: "approved", approval });
    touched.push(r.id);
  }
  return touched;
}

if (isMain(import.meta.url)) {
  const { _, flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  const module = _[0];
  orExit2(module, "usage: export.mjs <module> [--sign STK-001 --evidence <path>]");
  ensureInit(stateDir);
  requireModule(stateDir, module);

  const md = render(stateDir, module);
  const file = FILES.exportDoc(stateDir, module);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, md, "utf8");
  const docHash = crypto.createHash("sha256").update(md).digest("hex").slice(0, 16);
  console.log(`EXPORT ${path.relative(stateDir, file).split(path.sep).join("/")}  ${md.split("\n").length} lines  sha256:${docHash}`);

  if (typeof flags.sign === "string") {
    orExit2(findById(allReq(stateDir), flags.sign) && prefixOf(flags.sign) === "STK", `--sign takes an existing STK id, got ${flags.sign}`);
    orExit2(typeof flags.evidence === "string", "--evidence <path> is required: an approval with no evidence is hearsay");
    const touched = signModule(stateDir, module, { by: flags.sign, evidence: flags.evidence, docHash });
    console.log(`SIGNED by ${flags.sign}  ${touched.length} record(s) now approved  evidence=${flags.evidence}`);
  } else {
    console.log("  not signed — statuses unchanged. /req:export " + module + " --sign <STK> --evidence <path> when the client signs it.");
  }
  process.exit(0);
}
