#!/usr/bin/env node
/**
 * ask.mjs — the question bank, three at a time.
 *
 *   node ask.mjs <module> [--category c] [--count 3]        put the next round on disk and print it
 *   node ask.mjs <module> --answer Q-rental-001=b [--rule "…"]
 *   node ask.mjs <module> --answer Q-rental-012=c --rule "…" --supersedes BR-rental-012@v1 --reason "…"
 *   node ask.mjs <module> --defer Q-rental-004
 *
 * A round is written as Q records before it is printed, and an answer is written before the next
 * round can be asked for (rule 7). The option's ruleTemplate is a starting point; --rule replaces it
 * with the wording the owner actually used, because a rule is only useful in the client's own words.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, resolveStateDir, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { lineageOf } from "../../core/scripts/ids.mjs";
import { ensureInit } from "./init.mjs";
import { FILES, allReq, mintId, upsert, findById, versionNum, requireModule, now } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const BANK_FILE = path.resolve(here, "..", "assets", "question-bank.json");

export const bank = () => JSON.parse(fs.readFileSync(BANK_FILE, "utf8")).questions;

const questionsOf = (records, module) => records.filter((r) => /^(Q|DQ)-/.test(String(r.id)) && String(r.id).includes(`-${module}-`));

/** The next questions nobody has put to the owner yet, bank order, optionally one category. */
export function pending(records, module, { category = null, count = 3 } = {}) {
  const asked = new Set(questionsOf(records, module).map((q) => q.bankKey).filter(Boolean));
  return bank()
    .filter((q) => !asked.has(q.key) && (!category || q.category === category))
    .slice(0, count);
}

export function openRound(stateDir, module, opts) {
  const records = allReq(stateDir);
  const ids = records.map((r) => r.id);
  const round = pending(records, module, opts);
  const minted = [];
  for (const q of round) {
    const id = mintId(ids, "Q", module);
    ids.push(id);
    // the options are not copied into the record: the bank is their one home, and a second copy
    // is the thing that disagrees with the first within a month (DESIGN, anti-patterns)
    const rec = { id, title: q.text, status: "draft", category: q.category, bankKey: q.key, askedAt: now() };
    upsert(FILES.questions(stateDir, module, q.category), rec);
    minted.push({ ...rec, options: q.options });
  }
  return minted;
}

export function answer(stateDir, module, { qid, optionKey, rule, supersedes, reason, noRule }) {
  const records = allReq(stateDir);
  const q = findById(records, qid);
  orExit2(q, `no such question: ${qid}`);
  const bankQ = bank().find((b) => b.key === q.bankKey);
  orExit2(bankQ, `${qid} did not come from the question bank — answer it with /req:rules ${module} --br "…" instead`);
  const option = bankQ.options.find((o) => o.key === optionKey);
  orExit2(option, `question ${qid} has no option "${optionKey}" — options are ${bankQ.options.map((o) => o.key).join(", ")}`);

  const template = option.ruleTemplate ?? null;
  const title = String(rule ?? template ?? "").trim();
  const answered = { option: optionKey, text: option.text, at: now() };

  // "we do not do that" is the absence of a rule, not a rule: record the answer, mint nothing.
  if (noRule || !title) {
    orExit2(!supersedes, "--supersedes needs a replacement rule — pass --rule \"…\"");
    upsert(q.__file, { ...stripInternal(q), status: "reviewed", answer: answered, mints: null });
    return { brId: null, retired: null };
  }

  const ids = records.map((r) => r.id);
  let brId;
  const derivedFrom = [qid];
  if (supersedes) {
    const old = findById(records, supersedes);
    orExit2(old, `no such rule to supersede: ${supersedes}`);
    orExit2(old.status !== "retired", `${supersedes} is already retired`);
    orExit2(!old.approval, `${supersedes} carries the client's approval — a new version needs the CR that asked for it: /req:rules ${module} --retire ${supersedes} --reason "…" --replace "…" --cr CR-nnn`);
    brId = `${lineageOf(supersedes)}@v${versionNum(supersedes) + 1}`;
    derivedFrom.push(supersedes);
    upsert(old.__file, { ...stripInternal(old), status: "retired", retiredReason: reason ?? `superseded via ${qid}`, retiredAt: now(), supersededBy: brId });
  } else {
    brId = `${mintId(ids, "BR", module)}@v1`;
  }

  const rulesFile = FILES.rules(stateDir, module);
  upsert(rulesFile, { id: brId, title, status: "draft", category: q.category, derivedFrom, answeredAt: now() });
  upsert(q.__file, { ...stripInternal(q), status: "reviewed", answer: answered, mints: brId });
  return { brId, retired: supersedes ?? null };
}

export function defer(stateDir, module, qid) {
  const records = allReq(stateDir);
  const q = findById(records, qid);
  orExit2(q, `no such question: ${qid}`);
  const dq = `${mintId(records.map((r) => r.id), "DQ", module)}`;
  upsert(FILES.questions(stateDir, module, q.category ?? "open"), { id: dq, title: q.title, status: "draft", category: q.category, bankKey: q.bankKey, deferredFrom: qid, derivedFrom: [qid] });
  upsert(q.__file, { ...stripInternal(q), status: "retired", retiredReason: "deferred to CP2", supersededBy: dq });
  return dq;
}

const stripInternal = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "__file"));

if (isMain(import.meta.url)) {
  const { _, flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  const module = _[0];
  orExit2(module, "usage: ask.mjs <module> [--answer Q=opt [--rule \"…\"]] [--defer Q] [--category c] [--count 3]");
  ensureInit(stateDir);
  requireModule(stateDir, module);

  if (typeof flags.defer === "string") {
    const dq = defer(stateDir, module, flags.defer);
    console.log(`DEFER ${flags.defer} -> ${dq}  (blocks CP2, not CP1)`);
    process.exit(0);
  }

  if (typeof flags.answer === "string") {
    const pairs = flags.answer.split(",").map((s) => s.trim()).filter(Boolean);
    orExit2(pairs.length === 1 || !flags.rule, "--rule applies to one answer — answer one question per call when you want to reword the rule");
    for (const pair of pairs) {
      const [qid, optionKey] = pair.split("=");
      orExit2(qid && optionKey, `--answer wants Q-<module>-nnn=<option>, got "${pair}"`);
      const { brId, retired } = answer(stateDir, module, {
        qid,
        optionKey,
        rule: typeof flags.rule === "string" ? flags.rule : null,
        supersedes: typeof flags.supersedes === "string" ? flags.supersedes : null,
        reason: typeof flags.reason === "string" ? flags.reason : null,
        noRule: Boolean(flags["no-rule"]),
      });
      console.log(`ANSWER ${qid}=${optionKey} -> ${brId ?? "(no rule — the answer says this does not apply)"}${retired ? `  (retired ${retired})` : ""}`);
    }
    console.log("  next: /req:rules " + module + " --ex <BR@v> …   (a rule with no example is not a rule yet)");
    process.exit(0);
  }

  const round = openRound(stateDir, module, { category: typeof flags.category === "string" ? flags.category : null, count: Number(flags.count ?? 3) });
  if (round.length === 0) {
    console.log(`BANK EXHAUSTED for ${module} — every question has been put to the owner`);
    process.exit(0);
  }
  console.log(`ROUND ${module}  ${round.length} question(s) written to disk, answer with /req:ask ${module} --answer <id>=<option>`);
  for (const q of round) {
    console.log(`\n${q.id}  [${q.category}]  ${q.title}`);
    for (const o of q.options) console.log(`   ${o.key}) ${o.text}${o.star ? "   ⭐ owner default" : ""}`);
  }
  process.exit(0);
}
