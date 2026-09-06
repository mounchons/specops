#!/usr/bin/env node
/**
 * theme.mjs — the one place a colour, a radius or a font is decided. dev never picks one; it
 * references a token, and a token exists only because the owner answered a question here.
 *
 *   node theme.mjs [--records <file.json>] [--by STK-nnn] [--state-dir X]
 *
 * With no --records it prints the seven questions with the Bootstrap 5 value beside each and stops
 * (exit 0, the same way /req:ask puts its questions). With --records it writes THM-001 first and
 * prints it after. "default" is an answer and is recorded as one; a missing key is not, and the
 * command refuses — a token nobody chose is a decision that will be made later by whoever writes
 * the first stylesheet.
 */
import { parseArgs, resolveStateDir, stateExists, readJson, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { ensureRegistry } from "../../core/scripts/query.mjs";
import { prefixOf } from "../../core/scripts/ids.mjs";
import { ensureInit } from "./init.mjs";
import { THEME_ID, questions, readTheme, writeTheme, now } from "./lib.mjs";

export function writeThemeFrom(stateDir, records, by) {
  ensureInit(stateDir);
  const bank = questions();
  const answers = records.tokens ?? {};
  const missing = bank.questions.filter((q) => answers[q.key] === undefined || String(answers[q.key]).trim() === "").map((q) => q.key);
  orExit2(missing.length === 0, `no answer for ${missing.join(", ")} — "default" is an answer, silence is not: a token nobody chose gets chosen later by whoever writes the first stylesheet`);

  const signer = by ?? records.by ?? null;
  orExit2(signer, `--by STK-nnn is required — a theme is the owner's answers, and the graph knows whose`);
  const reg = ensureRegistry(stateDir);
  orExit2(prefixOf(signer) === "STK" && reg.index[signer], `--by ${signer} is not a stakeholder in req/stakeholders.json`);

  const tokens = {};
  const chose = [];
  for (const q of bank.questions) {
    const given = String(answers[q.key]).trim();
    const isDefault = given.toLowerCase() === "default";
    tokens[q.key] = isDefault ? q.default : given;
    chose.push({ key: q.key, value: tokens[q.key], source: isDefault ? "default" : "owner" });
  }

  const previous = readTheme(stateDir);
  const thm = {
    id: THEME_ID,
    title: records.title ?? previous?.title ?? "ธีมของระบบ",
    status: "approved",
    tokens,
    components: records.components ?? bank.components,
    answeredBy: signer,
    answeredAt: now(),
  };
  writeTheme(stateDir, thm);
  return { thm, chose, replaced: Boolean(previous) };
}

if (isMain(import.meta.url)) {
  const { flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  orExit2(stateExists(stateDir), `no state dir at ${stateDir}`);

  if (!flags.records) {
    const bank = questions();
    const have = readTheme(stateDir);
    console.log(`THEME — ${bank.questions.length} คำถาม · ตอบครบทุกข้อแล้วรัน --records <file.json>`);
    console.log(`  {"by":"STK-nnn","tokens":{ "<key>": "<value>" | "default", … }}\n`);
    for (const q of bank.questions) {
      const current = have?.tokens?.[q.key];
      console.log(`  ${q.key.padEnd(14)} ${q.ask}`);
      console.log(`  ${" ".repeat(14)} default: ${q.default}${current !== undefined ? `   ตอนนี้: ${current}` : ""}`);
    }
    console.log(`\ncomponents ที่ dev ใช้ได้: ${bank.components.join(" ")}`);
    console.log(have ? `\n${THEME_ID} มีอยู่แล้ว — ตอบใหม่เพื่อทับค่า tokens (id เดิม)` : `\nยังไม่มี ${THEME_ID} — /mock:wireframe ถูกปฏิเสธจนกว่าจะมีธีม`);
    process.exit(0);
  }

  const records = readJson(String(flags.records));
  const { thm, chose, replaced } = writeThemeFrom(stateDir, records, typeof flags.by === "string" ? flags.by : null);
  console.log(`THEME ${thm.id}  ${replaced ? "overwritten" : "written"} · answered by ${thm.answeredBy}`);
  for (const c of chose) console.log(`  ${c.key.padEnd(14)} ${String(c.value).padEnd(34)} ${c.source}`);
  console.log(`  components     ${thm.components.join(" ")}`);
  console.log(`\nnext: /mock:wireframe <app> — โครงสร้างมาจาก UI ส่วนหน้าตาอ้าง ${thm.id} ทุกจุด`);
  process.exit(0);
}
