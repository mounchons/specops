#!/usr/bin/env node
/**
 * golden.mjs — the answer key, produced by running and signed by a person.
 *
 *   node golden.mjs <CALC@v> --script <file.mjs>            install the implementation (exports compute(input))
 *   node golden.mjs <CALC@v> --row '{"rate":800,…}' [--label "…"]
 *   node golden.mjs <CALC@v> --run                          fill every expected from a real run
 *   node golden.mjs <CALC@v> --sign STK-001 --evidence <path>
 *
 * Nothing here lets a human type an expected value: --run writes what the script computed, and only
 * a GD whose rows all came from a run can be signed. dev's unit tests then quote these values
 * verbatim, so a wrong key is worse than a missing one (DESIGN P6).
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs, resolveStateDir, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { prefixOf } from "../../core/scripts/ids.mjs";
import { ensureInit } from "./init.mjs";
import { FILES, allReq, mintId, upsert, findById, byPrefix, addEdges, runGolden, now } from "./lib.mjs";

const moduleOfCalc = (calcId) => /^CALC-([a-z0-9-]+)-/.exec(calcId)?.[1] ?? null;

/** One GD per calculation version; it is created the first time anything is added to it. */
export function gdFor(stateDir, calcId, { create = true } = {}) {
  const records = allReq(stateDir);
  const found = byPrefix(records, "GD").find((g) => (g.derivedFrom ?? []).includes(calcId));
  if (found || !create) return found ?? null;
  const module = moduleOfCalc(calcId);
  const id = mintId(records.map((r) => r.id), "GD", module);
  const rec = { id, title: `answer key ของ ${calcId}`, status: "draft", derivedFrom: [calcId], rows: [] };
  upsert(FILES.golden(stateDir, module, id), rec);
  addEdges(stateDir, [{ from: id, rel: "verifies", to: calcId }]);
  return { ...rec, __file: FILES.golden(stateDir, module, id) };
}

const save = (gd) => upsert(gd.__file, Object.fromEntries(Object.entries(gd).filter(([k]) => k !== "__file")));

export function installScript(stateDir, calcId, from) {
  orExit2(fs.existsSync(from), `no such file: ${from}`);
  const src = fs.readFileSync(from, "utf8");
  orExit2(/export\s+(function\s+compute|const\s+compute)/.test(src), `${from} must export compute(input) — the check re-runs it in a child process`);
  const dest = FILES.goldenScript(stateDir, moduleOfCalc(calcId), calcId);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, src, "utf8");
  return dest;
}

export function addRow(stateDir, calcId, input, label) {
  const gd = gdFor(stateDir, calcId);
  gd.rows = [...(gd.rows ?? []), { label: label ?? null, input }];
  gd.status = "draft";
  delete gd.ranAt;
  for (const r of gd.rows) delete r.expected;
  save(gd);
  return gd;
}

export function run(stateDir, calcId) {
  const gd = gdFor(stateDir, calcId, { create: false });
  orExit2(gd, `no golden dataset for ${calcId} yet — add a row first`);
  orExit2((gd.rows ?? []).length, `${gd.id} has no rows — add inputs before running`);
  const script = FILES.goldenScript(stateDir, moduleOfCalc(calcId), calcId);
  const res = runGolden(script, gd.rows.map((r) => r.input));
  orExit2(res.ok, `golden script failed: ${res.error}`);
  gd.rows = gd.rows.map((r, i) => ({ ...r, expected: res.values[i] }));
  gd.ranAt = now();
  gd.status = "reviewed";
  delete gd.signedBy;
  delete gd.signedAt;
  delete gd.evidence;
  save(gd);
  return gd;
}

export function sign(stateDir, calcId, signedBy, evidence) {
  const gd = gdFor(stateDir, calcId, { create: false });
  orExit2(gd, `no golden dataset for ${calcId}`);
  orExit2(gd.ranAt && (gd.rows ?? []).every((r) => "expected" in r), `${gd.id} has rows nobody ran — /req:golden ${calcId} --run first`);
  orExit2(prefixOf(signedBy) === "STK" && findById(allReq(stateDir), signedBy), `--sign takes an existing STK id, got ${signedBy}`);
  orExit2(evidence, "--evidence <path> is required: an approval with no evidence is hearsay");
  gd.signedBy = signedBy;
  gd.signedAt = now();
  gd.evidence = evidence;
  gd.status = "approved";
  save(gd);
  return gd;
}

if (isMain(import.meta.url)) {
  const { _, flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  const calcId = _[0];
  orExit2(calcId && prefixOf(calcId) === "CALC", "usage: golden.mjs <CALC@v> [--script f.mjs | --row '{…}' | --run | --sign STK-nnn --evidence path]");
  ensureInit(stateDir);
  orExit2(findById(allReq(stateDir), calcId), `no such calculation: ${calcId}`);

  if (typeof flags.script === "string") {
    console.log(`SCRIPT ${path.basename(installScript(stateDir, calcId, flags.script))} installed for ${calcId}`);
    process.exit(0);
  }
  if (typeof flags.row === "string") {
    let input;
    try {
      input = JSON.parse(flags.row);
    } catch (e) {
      orExit2(false, `--row must be JSON: ${e.message}`);
    }
    const gd = addRow(stateDir, calcId, input, typeof flags.label === "string" ? flags.label : null);
    console.log(`ROW ${gd.id} now has ${gd.rows.length} input(s) — expected values cleared, re-run to fill them`);
    process.exit(0);
  }
  if (flags.run) {
    const gd = run(stateDir, calcId);
    console.log(`RUN ${gd.id}  ${gd.rows.length} row(s) from ${path.basename(FILES.goldenScript(stateDir, moduleOfCalc(calcId), calcId))}`);
    for (const r of gd.rows) console.log(`  ${JSON.stringify(r.input)} -> ${JSON.stringify(r.expected)}${r.label ? `   (${r.label})` : ""}`);
    console.log(`  next: /req:golden ${calcId} --sign <STK> --evidence <path>`);
    process.exit(0);
  }
  if (typeof flags.sign === "string") {
    const gd = sign(stateDir, calcId, flags.sign, typeof flags.evidence === "string" ? flags.evidence : null);
    console.log(`SIGNED ${gd.id} by ${gd.signedBy} at ${gd.signedAt}  evidence=${gd.evidence}`);
    process.exit(0);
  }

  const gd = gdFor(stateDir, calcId, { create: false });
  if (!gd) {
    console.log(`no golden dataset for ${calcId} yet — /req:golden ${calcId} --script <file.mjs> then --row '{…}' then --run`);
    process.exit(0);
  }
  console.log(`${gd.id}  [${gd.status}]  ${gd.rows.length} row(s)${gd.signedBy ? `  signed by ${gd.signedBy}` : "  unsigned"}`);
  for (const r of gd.rows) console.log(`  ${JSON.stringify(r.input)} -> ${"expected" in r ? JSON.stringify(r.expected) : "(not run)"}${r.label ? `   (${r.label})` : ""}`);
  process.exit(0);
}
