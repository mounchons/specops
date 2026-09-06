#!/usr/bin/env node
/**
 * sync-design.mjs — optional. Writes the prompt that turns an L1 wireframe into a visual comp, and
 * says where the file that comes back goes. Nothing in core, in the gates or in `approve` depends
 * on this command, and nothing reads what lands in mock/<app>/design/.
 *
 *   node sync-design.mjs <app> [MCK-x,UI-y] [--state-dir X]
 *
 * LIMIT: no script here sends the prompt or fetches the answer. The owner does that, and the
 * returned file is a reference — the JSON stays the record, because the record is what the baseline
 * hash and every gate look at.
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs, resolveStateDir, stateExists, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { ensureInit } from "./init.mjs";
import { FILES, allMcks, controlsOf, readTheme, requireApp, list } from "./lib.mjs";

export function promptFor(mck, theme) {
  const tokens = Object.entries(theme.tokens ?? {}).map(([k, v]) => `- \`${k}\`: ${v}`);
  const zones = (mck.zones ?? []).map((z) => `### ${z.name}\n${(z.controls ?? []).length ? z.controls.map((c) => `- ${c.kind} \`${c.testid}\` (${c.from})`).join("\n") : "- (ว่าง — หน้าจอนี้ไม่ได้ประกาศอะไรในโซนนี้)"}`);
  return [
    `# ${mck.id} — ${mck.title}`,
    ``,
    `หน้าจอ ${mck.ui} ของแอป ${mck.app} · kind ${mck.kind} · roles ${(mck.roles ?? []).join(", ") || "—"}`,
    ``,
    `ทำเป็นภาพ high-fidelity จากโครงสร้างนี้ **ห้ามเพิ่ม ห้ามลด**: ทุก control ด้านล่างต้องมีอยู่ครบและต้องไม่มีอะไรเกิน — โครงสร้างนี้คือสิ่งที่ลูกค้าเซ็น`,
    ``,
    `## tokens (${theme.id})`,
    ...tokens,
    ``,
    `## zones และ controls (${controlsOf(mck).length} ตัว)`,
    ...zones,
    ``,
    `## states`,
    (mck.states ?? []).map((s) => `- ${s}`).join("\n") || "- (ไม่ระบุ)",
    ``,
    `> ไฟล์ที่ได้กลับมาให้วางไว้ที่ \`mock/${mck.app}/design/\` — เป็นภาพอ้างอิงเท่านั้น ไม่มี gate ใดอ่าน และไม่ใช่ record`,
  ].join("\n") + "\n";
}

export function syncDesign(stateDir, app, { only = [] } = {}) {
  ensureInit(stateDir);
  requireApp(stateDir, app);
  const theme = readTheme(stateDir);
  orExit2(theme, `no theme yet — /mock:theme first`);
  const mcks = allMcks(stateDir).filter((m) => m.app === app && (only.length === 0 || only.includes(m.id) || only.includes(m.ui)));
  orExit2(mcks.length, only.length ? `none of ${only.join(", ")} is a wireframe of ${app}` : `app ${app} has no wireframes — /mock:wireframe ${app} first`);

  const dir = FILES.designDir(stateDir, app);
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  for (const m of mcks.sort((a, b) => a.id.localeCompare(b.id))) {
    const file = path.join(dir, `${m.id}.prompt.md`);
    fs.writeFileSync(file, promptFor(m, theme), "utf8");
    written.push({ id: m.id, file });
  }
  return { app, dir, written };
}

if (isMain(import.meta.url)) {
  const { _, flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  orExit2(stateExists(stateDir), `no state dir at ${stateDir}`);
  orExit2(_[0], "usage: sync-design.mjs <app> [MCK-x,UI-y]");
  const r = syncDesign(stateDir, _[0], { only: list(_[1]) });
  console.log(`SYNC-DESIGN ${r.app}  ${r.written.length} prompt(s)`);
  for (const w of r.written) console.log(`  ${w.id.padEnd(15)} ${w.file}`);
  console.log(`\nLIMIT: no script sends these or fetches the answer — the owner does, and the files that come back go in ${r.dir}`);
  console.log(`nothing reads them: the JSON stays the record, so the baseline hash and every gate are unaffected`);
  process.exit(0);
}
