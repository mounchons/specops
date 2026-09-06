#!/usr/bin/env node
/**
 * report.mjs — coverage counted from the records, never estimated.
 *
 *   node report.mjs <module> [--state-dir X]
 *
 * The chain is REQ -> UC -> SCN -> TC -> the verdict of the last run that touched it. Every number
 * below is the length of a list of ids; there is no percentage anybody typed. What is missing is
 * printed as loudly as what passed, because a coverage report that only shows green is an advert.
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs, resolveStateDir, stateExists, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { loadState } from "../../core/scripts/artifacts.mjs";
import { ensureInit } from "./init.mjs";
import { FILES, allTcs, allRuns, allDefs, of, raw, moduleOf, now } from "./lib.mjs";

const VERDICT_MARK = { pass: "ผ่าน", fail: "ไม่ผ่าน", partial: "ผ่านบางส่วน", blocked: "รันไม่ได้" };

export function report(stateDir, module) {
  ensureInit(stateDir);
  const state = loadState(stateDir);
  const tcs = allTcs(stateDir).filter((t) => moduleOf(t.id) === module);
  orExit2(tcs.length, `module "${module}" has no test case — /qa:cases ${module} first`);

  const reqs = of(state, "REQ").filter((a) => a.module === module).map((a) => a.raw);
  const ucs = of(state, "UC").filter((a) => a.module === module).map((a) => a.raw);
  const scns = of(state, "SCN").filter((a) => a.module === module).map((a) => a.raw);
  const acs = of(state, "AC").filter((a) => a.module === module).map((a) => a.raw);
  const runs = allRuns(stateDir).filter((r) => (r.results ?? []).some((x) => moduleOf(x.tc) === module)).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const defs = allDefs(stateDir).filter((d) => moduleOf(d.id) === module);
  const tcByScn = new Map(tcs.map((t) => [t.scenario, t]));

  const chain = reqs.map((req) => {
    const mine = ucs.filter((u) => (u.derivedFrom ?? []).includes(req.id));
    const rows = mine.map((uc) => {
      const myScns = scns.filter((s) => s.usecase === uc.id);
      return { uc, scns: myScns.map((s) => ({ scn: s, tc: tcByScn.get(s.id) ?? null })) };
    });
    return { req, ucs: rows };
  });

  const verdictOf = (t) => (t ? (t.lastVerdict ?? "ยังไม่ได้รัน") : "ไม่มี TC");
  const counts = {
    req: reqs.length,
    uc: ucs.length,
    scn: scns.length,
    tc: tcs.length,
    scnWithoutTc: scns.filter((s) => !tcByScn.has(s.id)).map((s) => s.id),
    runnable: tcs.filter((t) => t.runnable).length,
    notRunnable: tcs.filter((t) => !t.runnable),
    pass: tcs.filter((t) => t.lastVerdict === "pass").length,
    fail: tcs.filter((t) => t.lastVerdict === "fail").length,
    partial: tcs.filter((t) => t.lastVerdict === "partial").length,
    blocked: tcs.filter((t) => t.lastVerdict === "blocked").length,
    never: tcs.filter((t) => !t.lastVerdict).length,
    // An acceptance criterion nobody wrote a scenario for is a hole in the design, not in the tests.
    // Per AC, not per flow: SCN.derivedFrom names the AC it was cut from, and four AC sharing one
    // flow are four promises. Comparing flows hid AC-rental-002/003/004 behind AC-rental-001.
    acWithoutScn: acs.filter((a) => !scns.some((s) => (s.derivedFrom ?? []).includes(a.id))).map((a) => a.id),
    openDefs: defs.filter((d) => d.status !== "verified"),
    closedDefs: defs.filter((d) => d.status === "verified"),
  };

  const lines = [
    `# QA — ${module}`,
    ``,
    `${now().slice(0, 10)} · นับจาก record บนดิสก์ทั้งหมด ไม่มีตัวเลขไหนที่คนพิมพ์เอง`,
    ``,
    `## สรุป`,
    ``,
    `| นับ | จำนวน |`,
    `|---|---|`,
    `| requirement | ${counts.req} |`,
    `| use case | ${counts.uc} |`,
    `| scenario | ${counts.scn} |`,
    `| test case | ${counts.tc} (รันได้ ${counts.runnable}) |`,
    `| ผ่าน / ไม่ผ่าน / ผ่านบางส่วน / รันไม่ได้ / ยังไม่ได้รัน | ${counts.pass} / ${counts.fail} / ${counts.partial} / ${counts.blocked} / ${counts.never} |`,
    `| finding ที่ยังไม่ปิด | ${counts.openDefs.length} |`,
    ``,
    `## REQ → UC → SCN → TC → ผลล่าสุด`,
    ``,
  ];
  for (const c of chain) {
    lines.push(`### ${c.req.id} — ${c.req.title ?? c.req.goal ?? ""}`, ``);
    if (c.ucs.length === 0) lines.push(`- ยังไม่มี use case ที่ตอบ requirement ข้อนี้`, ``);
    for (const u of c.ucs) {
      lines.push(`- **${u.uc.id}** ${u.uc.title ?? ""}`);
      for (const s of u.scns) {
        const t = s.tc;
        lines.push(`  - ${s.scn.id} (${s.scn.flow ?? "main"}) → ${t ? `${t.id} · **${VERDICT_MARK[t.lastVerdict] ?? verdictOf(t)}**${t.lastRun ? ` · ${t.lastRun}` : ""}` : "**ไม่มี TC**"}`);
        if (t && !t.runnable) for (const g of t.gaps ?? []) lines.push(`    - รันไม่ได้: ${g}`);
      }
      lines.push(``);
    }
  }

  lines.push(`## ที่ยังพัง / ยังรันไม่ได้`, ``);
  if (counts.notRunnable.length === 0) lines.push(`- ทุก TC รันได้`, ``);
  for (const t of counts.notRunnable) lines.push(`- **${t.id}** (${t.scenario}) — ${(t.gaps ?? []).join(" · ")}`);
  lines.push(``, `## finding`, ``);
  if (defs.length === 0) lines.push(`- ยังไม่มี finding`, ``);
  for (const d of defs)
    lines.push(`- **${d.id}** [${d.status}] routing **${d.routing}** · ${d.tc} · ${d.severity}${d.cr ? ` · ${d.cr}` : d.routing === "dev" ? ` · ไม่มี CR (โค้ดไม่ตรงสเปก ไม่คิดเงิน)` : ``}\n  - ${d.reproduce}`);
  lines.push(``, `## AC ที่ไม่มี scenario (ช่องว่างของดีไซน์ ไม่ใช่ของเทสต์)`, ``);
  lines.push(counts.acWithoutScn.length ? counts.acWithoutScn.map((a) => `- ${a}`).join("\n") : `- ไม่มี`);
  lines.push(``, `## ประวัติการรัน`, ``, `| run | เมื่อ | code | ผ่าน | ไม่ผ่าน | อื่น ๆ |`, `|---|---|---|---|---|---|`);
  for (const r of runs) {
    const mine = (r.results ?? []).filter((x) => moduleOf(x.tc) === module);
    const n = (v) => mine.filter((x) => x.verdict === v).length;
    lines.push(`| ${r.id} | ${String(r.at).slice(0, 19)} | \`${String(r.codeVersion ?? "-").slice(0, 8)}\` | ${n("pass")} | ${n("fail")} | ${mine.length - n("pass") - n("fail")} |`);
  }
  lines.push(``, `> เอกสารนี้ render ให้คนอ่าน ไม่มีสคริปต์ใดอ่านกลับ (rule 4) — ความจริงอยู่ที่ TC/RUN/DEF บนดิสก์`);

  const file = FILES.reportDoc(stateDir, module);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
  return { module, counts, runs, defs, file };
}

if (isMain(import.meta.url)) {
  const { _, flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  orExit2(stateExists(stateDir), `no state dir at ${stateDir}`);
  orExit2(_[0], "usage: report.mjs <module>");
  const { module, counts, runs, file } = report(stateDir, _[0]);

  console.log(`REPORT ${module}`);
  console.log(`  REQ ${counts.req} → UC ${counts.uc} → SCN ${counts.scn} → TC ${counts.tc} (runnable ${counts.runnable})`);
  console.log(`  pass ${counts.pass} · fail ${counts.fail} · partial ${counts.partial} · blocked ${counts.blocked} · never run ${counts.never}`);
  console.log(`  runs ${runs.length}${runs.length ? ` · latest ${runs[0].id} on ${String(runs[0].codeVersion ?? "-").slice(0, 8)}` : ""}`);
  if (counts.scnWithoutTc.length) console.log(`  scenario with no test case: ${counts.scnWithoutTc.join(", ")}`);
  if (counts.acWithoutScn.length) console.log(`  acceptance criteria no scenario covers (a design gap, not a test gap): ${counts.acWithoutScn.join(", ")}`);
  if (counts.notRunnable.length) {
    console.log(`\n  not runnable:`);
    for (const t of counts.notRunnable) console.log(`    ${t.id} (${t.scenario}) — ${(t.gaps ?? [])[0] ?? "?"}`);
  }
  if (counts.openDefs.length) {
    console.log(`\n  open findings:`);
    for (const d of counts.openDefs) console.log(`    ${d.id} routing ${d.routing}${d.cr ? ` · ${d.cr}` : ""}  ${d.title}`);
  }
  if (counts.closedDefs.length) console.log(`\n  closed by a green run: ${counts.closedDefs.map((d) => d.id).join(", ")}`);
  console.log(`\nwritten: ${file}`);
  process.exit(0);
}
