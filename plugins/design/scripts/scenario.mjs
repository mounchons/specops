#!/usr/bin/env node
/**
 * scenario.mjs — one scenario per flow, including the ones that go wrong, and one per NFR.
 * Also the last step of design: it renders the Thai document for the client.
 *
 *   node scenario.mjs <module>                                generate the missing ones, render the document
 *   node scenario.mjs <module> --expected SCN-rental-004="…"  say what the observable result is
 *
 * Alternate and exception flows get scenarios too, because those are the ones that ship broken:
 * everybody tests the happy path by accident. A scenario whose `expected` is empty stays draft and
 * is listed — qa turns these into test cases and cannot invent the answer.
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs, resolveStateDir, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { ensureInit } from "./init.mjs";
import { FILES, allDesign, allReq, byPrefix, findById, inModule, live, minter, upsert, addEdges, requireModule, project, stripInternal, now } from "./lib.mjs";

export function generate(stateDir, module) {
  const design = allDesign(stateDir);
  const req = allReq(stateDir);
  const have = byPrefix(design, "SCN").filter((s) => inModule(s, module));
  const next = minter(design.map((r) => r.id), "SCN", module);
  const created = [];

  for (const uc of byPrefix(design, "UC").filter((u) => inModule(u, module))) {
    for (const flow of uc.flows ?? []) {
      if (have.some((s) => s.usecase === uc.id && s.flow === flow.name)) continue;
      const id = next();
      const ac = byPrefix(design, "AC").find((a) => a.usecase === uc.id && a.flow === flow.name);
      upsert(FILES.scenarios(stateDir, module, uc.id), {
        id,
        title: `${uc.title} — ${flow.name}`,
        status: ac ? "draft" : "draft",
        usecase: uc.id,
        flow: flow.name,
        given: ac?.given ?? uc.precondition ?? null,
        when: ac?.when ?? flow.steps.map((s) => s.step).join(" → "),
        expected: ac?.then ?? null,
        enforces: [...new Set(flow.steps.flatMap((s) => s.enforces ?? []))],
        derivedFrom: [uc.id, ...(ac ? [ac.id] : [])],
        generatedAt: now(),
      });
      addEdges(stateDir, [{ from: id, rel: "verifies", to: uc.id }]);
      created.push(id);
    }
  }

  for (const nfr of byPrefix(req, "NFR").filter((n) => inModule(n, module))) {
    if (have.some((s) => (s.derivedFrom ?? []).includes(nfr.id))) continue;
    const id = next();
    upsert(FILES.scenarios(stateDir, module, "nfr"), {
      id,
      title: `${nfr.title ?? nfr.goal} — วัดได้จริง`,
      status: "draft",
      usecase: null,
      flow: "nfr",
      given: null,
      when: nfr.goal,
      expected: null,
      derivedFrom: [nfr.id],
      generatedAt: now(),
    });
    created.push(id);
  }
  return created;
}

export function setExpected(stateDir, scnId, text) {
  const scn = findById(allDesign(stateDir), scnId);
  orExit2(scn, `no such scenario: ${scnId}`);
  orExit2(String(text ?? "").trim(), "--expected needs the observable result, not an empty string");
  upsert(scn.__file, { ...stripInternal(scn), expected: text, status: "reviewed", decidedAt: now() });
  return scn.id;
}

export function render(stateDir, module) {
  const design = allDesign(stateDir);
  const req = allReq(stateDir);
  const p = project(stateDir);
  const name = (id) => findById(design, id)?.title ?? findById(req, id)?.title ?? id;
  const mine = design.filter((r) => inModule(r, module));
  const ents = byPrefix(design, "ENT");
  const stms = byPrefix(design, "STM");
  const ucs = byPrefix(mine, "UC");
  const screens = [...byPrefix(mine, "UI"), ...byPrefix(mine, "RPT")];
  const roles = byPrefix(design, "ROLE");
  const acl = byPrefix(design, "ACL");
  const scns = byPrefix(mine, "SCN");
  const apps = (p.apps ?? []).map((a) => a.name);

  const L = [];
  L.push(`# เอกสารออกแบบ — ${p.name} · โมดูล ${module}`, "");
  L.push(`> จัดทำ ${now().slice(0, 10)} · ทุกหัวข้ออ้างรหัสที่ตรวจย้อนกลับได้ถึงข้อกำหนดและกฎธุรกิจ`, "");

  L.push("## โครงสร้างข้อมูล", "", "| รหัส | สิ่งของ | ชนิด | กฎที่ต้องไม่ละเมิด |", "|---|---|---|---|");
  for (const e of ents) L.push(`| ${e.id} | ${e.title} | ${e.kind}${e.lookupAs ? ` (${e.lookupAs})` : ""} | ${(e.invariants ?? []).join(" ") || "—"} |`);
  L.push("");
  for (const m of stms) {
    L.push(`### วงจรสถานะ ${name(m.entity)} (${m.id})`, "", "| จาก | ไป | โดย | บังคับกฎ |", "|---|---|---|---|");
    for (const t of m.transitions ?? []) L.push(`| ${t.from} | ${t.to} | ${t.by ?? "—"} | ${(t.enforces ?? []).join(" ") || "—"} |`);
    L.push("");
  }

  L.push("## กรณีใช้งาน", "");
  for (const uc of ucs) {
    L.push(`### ${uc.id} — ${uc.title}`, "");
    L.push(`ผู้ใช้: ${name(uc.actor)} · ใช้จาก: ${(uc.apps ?? []).join(", ")}${uc.precondition ? ` · เงื่อนไขก่อนเริ่ม: ${uc.precondition}` : ""}`, "");
    for (const f of uc.flows ?? []) {
      L.push(`**${f.name}**`, "");
      f.steps.forEach((s, i) => L.push(`${i + 1}. ${s.step}${(s.enforces ?? []).length ? `  \`${s.enforces.join(" ")}\`` : ""}`));
      L.push("");
    }
    const acs = byPrefix(mine, "AC").filter((a) => a.usecase === uc.id);
    if (acs.length) {
      L.push("| เกณฑ์ยอมรับ | เมื่อ | ทำ | ต้องได้ |", "|---|---|---|---|");
      for (const a of acs) L.push(`| ${a.id} | ${a.given ?? "—"} | ${a.when} | ${a.then} |`);
      L.push("");
    }
  }

  L.push("## ผังหน้าจอ (หน้าจอ × แอป)", "", `| หน้าจอ | ${apps.join(" | ")} | ที่มา |`, `|---|${apps.map(() => "---|").join("")}---|`);
  const rows = new Map();
  for (const ui of screens) {
    const k = `${ui.origin}|${ui.generatorKey}|${ui.title}`;
    rows.set(k, { ...(rows.get(k) ?? {}), [ui.app]: ui.id });
  }
  const ORIGIN_TH = { usecase: "จากกรณีใช้งาน", master: "ข้อมูลหลัก", baseline: "พื้นฐานของแอปประเภทนี้", nfr: "จากข้อกำหนดเชิงคุณภาพ" };
  const order = { usecase: 0, master: 1, baseline: 2, nfr: 3 };
  for (const [k, cells] of [...rows.entries()].sort((a, b) => order[a[0].split("|")[0]] - order[b[0].split("|")[0]])) {
    const [origin, , title] = k.split("|");
    L.push(`| ${title} | ${apps.map((a) => cells[a] ?? "–").join(" | ")} | ${ORIGIN_TH[origin]} |`);
  }
  L.push("");

  if (roles.length) {
    L.push("## สิทธิ์การใช้งาน", "", "| บทบาท | มาจากผู้เกี่ยวข้อง | เข้าถึงหน้าจอที่อนุญาต |", "|---|---|---|");
    for (const r of roles) {
      const allowed = acl.filter((a) => a.role === r.id && (a.allow ?? []).length);
      L.push(`| ${r.title} | ${(r.derivedFrom ?? []).join(" ")} | ${allowed.length} หน้า${allowed.some((a) => a.dataScope === "own") ? " · บางหน้าเห็นเฉพาะของตัวเอง" : ""} |`);
    }
    L.push("");
  }

  L.push("## สถานการณ์ทดสอบ", "", "| รหัส | สถานการณ์ | ต้องได้ |", "|---|---|---|");
  for (const s of scns) L.push(`| ${s.id} | ${s.title} | ${s.expected ?? "**ยังไม่ระบุ**"} |`);
  L.push("");
  return L.join("\n");
}

if (isMain(import.meta.url)) {
  const { _, flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  const module = _[0];
  orExit2(module, "usage: scenario.mjs <module> [--expected SCN-nnn=\"…\"]");
  ensureInit(stateDir);
  requireModule(stateDir, module);

  if (typeof flags.expected === "string") {
    const i = flags.expected.indexOf("=");
    orExit2(i > 0, "--expected takes SCN-nnn=\"the observable result\"");
    console.log(`EXPECTED ${setExpected(stateDir, flags.expected.slice(0, i), flags.expected.slice(i + 1))}`);
  }

  const created = generate(stateDir, module);
  const scns = byPrefix(allDesign(stateDir), "SCN").filter((s) => inModule(s, module));
  const blank = scns.filter((s) => !s.expected);
  console.log(`SCENARIO ${module}  generated ${created.length}  total ${scns.length}  without an expected result ${blank.length}`);
  for (const s of blank) console.log(`  ${s.id}  ${s.title}`);

  const md = render(stateDir, module);
  const file = FILES.exportDoc(stateDir, module);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, md, "utf8");
  console.log(`EXPORT ${path.relative(stateDir, file).split(path.sep).join("/")}  ${md.split("\n").length} lines`);
  console.log(blank.length ? `  fill the blanks: /design:scenario ${module} --expected <SCN>="…"` : `  next: /core:check then /mock:theme`);
  process.exit(0);
}
