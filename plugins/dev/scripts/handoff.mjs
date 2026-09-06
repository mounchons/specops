#!/usr/bin/env node
/**
 * handoff.mjs — the one document qa reads. Written from the records, never from memory.
 *
 *   node handoff.mjs <module> [--state-dir X]
 *
 * It refuses while any task of the module is below `verified`: a manifest that lists work nobody has
 * proved is a list of things qa will find broken, and finding them is not the point of qa.
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs, resolveStateDir, stateExists, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { loadState } from "../../core/scripts/artifacts.mjs";
import { ensureInit } from "./init.mjs";
import { FILES, allCmps, allTsks, allImps, byId, taskModule, originOf, byBuildOrder, of } from "./lib.mjs";

const raw = (a) => a?.raw ?? {};

export function handoff(stateDir, module) {
  ensureInit(stateDir);
  const tsks = allTsks(stateDir).filter((t) => taskModule(t) === module).sort(byBuildOrder);
  orExit2(tsks.length, `module "${module}" has no task — /dev:plan ${module} first`);
  const notDone = tsks.filter((t) => t.status !== "verified");
  if (notDone.length) return { module, notDone, tsks };

  const state = loadState(stateDir);
  const imps = allImps(stateDir);
  const cmps = allCmps(stateDir);
  const lines = [
    `# Handoff — ${module}`,
    ``,
    `${tsks.length} slice(s) verified · เขียนจาก record ไม่ใช่จากความจำ · qa เขียน TC จากเอกสารนี้ได้โดยไม่ต้องถามใคร`,
    ``,
    `## ขึ้นระบบ`,
    ...cmps.map((c) => `- **${c.id}** (${c.language} ${c.framework} ${c.version} · ${c.orm} · ${c.db})\n  - up: \`${c.run?.up ?? "—"}\`\n  - healthcheck: \`${c.run?.healthcheck ?? "—"}\`\n  - test: \`${c.run?.test ?? "—"}\`\n  - down: \`${c.run?.down ?? "—"}\`\n  - env: ${(c.config?.env ?? []).join(", ") || "—"} · secrets: ${(c.config?.secrets ?? []).join(", ") || "—"}`),
    ``,
  ];

  for (const t of tsks) {
    const mine = imps.filter((i) => (i.implements ?? []).includes(t.id));
    const tests = mine.filter((i) => i.kind === "test");
    const proof = (t.proof ?? []).at(-1);
    lines.push(
      `## ${t.id} — ${t.title}`,
      ``,
      `${t.usecase ?? `${originOf(t)} · ${t.group}`} · commit \`${String(t.commit ?? "").slice(0, 8)}\` · proof \`${proof?.cmd ?? "—"}\` exit ${proof?.exitCode ?? "—"} เมื่อ ${proof?.at ?? "—"}`,
      ``,
      `### acceptance ที่ทำแล้ว`,
      ...(t.acceptance ?? []).map((id) => { const a = raw(byId(state, id)); return `- **${id}** given ${a.given} · when ${a.when} · **then ${a.then}**`; }),
      ``,
      `### scenario ที่ต้องกลายเป็น TC`,
      ...(t.scenarios ?? []).map((id) => { const s = raw(byId(state, id)); return `- **${id}** (${s.flow ?? "—"}) ${s.title ?? ""} → ${s.expected ?? s.then ?? ""}`; }),
      ``,
      `### หน้าจอและ testid`,
      ...(t.mocks ?? []).flatMap((id) => {
        const m = raw(byId(state, id));
        const controls = (m.zones ?? []).flatMap((z) => z.controls ?? []);
        return [`- **${m.id}** → ${m.ui} (${m.app}) ${m.title}`, ...controls.map((c) => `  - \`data-testid="${c.testid}"\` ← ${c.from}`)];
      }),
      ``,
      `### endpoint`,
      ...of(state, "API").map((a) => a.raw).filter((a) => (t.screens ?? []).some((ui) => (a.derivedFrom ?? []).includes(ui) || a.ui === ui)).map((a) => `- **${a.id}** \`${a.method ?? ""} ${a.path ?? a.route ?? ""}\` ${a.title ?? ""}`),
      ``,
      `### unit test และ golden ที่ใช้`,
      ...(tests.length ? tests.map((i) => `- \`${i.path}\` (${i.component}) asserts ${(i.golden ?? []).join(", ") || "—"}`) : ["- (ไม่มี test IMP)"]),
      ...(t.golden ?? []).flatMap((id) => { const g = raw(byId(state, id)); return (g.rows ?? []).map((r) => `  - ${id} \`${r.label}\`: in ${JSON.stringify(r.input)} → **${JSON.stringify(r.expected)}**`); }),
      ``,
      `### ไฟล์ทั้งหมดของ slice นี้`,
      ...mine.map((i) => `- \`${i.path}\` (${i.kind}, ${i.component}) — ${i.id}`),
      ``,
    );
  }
  lines.push(`> เอกสารนี้ render ให้ qa อ่าน ไม่มีสคริปต์ใดอ่านกลับ (rule 4) — ความจริงอยู่ที่ TSK/IMP บนดิสก์`);

  const file = FILES.handoffDoc(stateDir, module);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
  return { module, notDone: [], tsks, file, imps };
}

if (isMain(import.meta.url)) {
  const { _, flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  orExit2(stateExists(stateDir), `no state dir at ${stateDir}`);
  orExit2(_[0], "usage: handoff.mjs <module>");
  const r = handoff(stateDir, _[0]);

  if (r.notDone.length) {
    console.log(`CANNOT HAND OFF ${r.module} — ${r.notDone.length} of ${r.tsks.length} task(s) are not verified:`);
    for (const t of r.notDone) console.log(`  ${t.id.padEnd(9)} [${t.status.padEnd(11)}] ${t.title}${t.blocked ? "  BLOCKED" : ""}`);
    console.log(`\nqa writes test cases against work that is proved, not against work in progress`);
    process.exit(1);
  }

  console.log(`HANDOFF ${r.module}  ${r.tsks.length} slice(s) · ${r.imps.length} file(s)`);
  for (const t of r.tsks) console.log(`  ${t.id.padEnd(9)} ${String(t.usecase ?? `${originOf(t)}/${t.group}`).padEnd(20)} ${String(t.commit ?? "").slice(0, 8)}  ${(t.acceptance ?? []).length} AC · ${(t.scenarios ?? []).length} SCN · ${(t.acls ?? []).length} ACL · ${(t.golden ?? []).length} GD`);
  console.log(`\nwritten: ${r.file}`);
  console.log(`next: /qa:cases ${r.module} — the scenarios are already listed, one test case each`);
  process.exit(0);
}
