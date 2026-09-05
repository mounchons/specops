#!/usr/bin/env node
/**
 * selftest.mjs — the proof for phase 1. Three kinds of evidence, in order of how much they prove:
 *
 *   1. every req check stays quiet on the clean fixture
 *   2. every req check fires on the dirty fixture — a gate that cannot go red is not a gate
 *   3. the commands themselves, run through node into a throwaway state dir, end with gates green;
 *      then one expected value is edited by hand and G-req-006 turns red. That last step is the
 *      whole point of a golden dataset: the check re-runs the script instead of believing the file.
 *
 *   node selftest.mjs        exit 0 pass | 1 fail
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CORE_FILES, readJson } from "../../core/scripts/paths.mjs";
import { loadState } from "../../core/scripts/artifacts.mjs";
import { buildRegistry } from "../../core/scripts/registry.mjs";
import { CHECKS as CORE_CHECKS } from "../../core/scripts/gates.mjs";
import { CHECKS } from "./checks.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const coreScript = (s) => path.resolve(here, "..", "..", "core", "scripts", s);
const reqScript = (s) => path.join(here, s);
const fx = (n) => path.resolve(here, "..", "fixtures", n, ".sdlc");

const ctxOf = (stateDir) => ({ stateDir, project: readJson(CORE_FILES.project(stateDir)), state: loadState(stateDir), registry: buildRegistry(stateDir) });
const fired = (stateDir, checks) => {
  const ctx = ctxOf(stateDir);
  const out = new Map();
  for (const [name, fn] of Object.entries(checks)) out.set(name, fn(ctx) ?? []);
  return out;
};

function cli(script, args, cwd) {
  try {
    return { out: execFileSync(process.execPath, [script, ...args], { encoding: "utf8", cwd, stdio: ["ignore", "pipe", "pipe"] }), code: 0 };
  } catch (e) {
    return { out: (e.stdout ?? "") + (e.stderr ?? ""), code: e.status ?? 1 };
  }
}

const checks = [];
const assert = (name, ok, detail = "") => checks.push([name, Boolean(ok), detail]);

// ---- 1 + 2: the fixtures ---------------------------------------------------
const clean = fired(fx("clean"), { ...CORE_CHECKS, ...CHECKS });
const cleanNoise = [...clean].filter(([name, f]) => f.length && name !== "core:registry-fresh");
assert("clean fixture: no check fires", cleanNoise.length === 0, cleanNoise.map(([n, f]) => `${n}: ${f[0].message}`).join(" | "));

const dirty = fired(fx("dirty"), CHECKS);
for (const name of Object.keys(CHECKS)) {
  const f = dirty.get(name) ?? [];
  assert(`dirty fixture: ${name} fires`, f.length > 0, f[0]?.message ?? "no finding");
}
const dirtyCore = fired(fx("dirty"), CORE_CHECKS);
const coreNoise = [...dirtyCore].filter(([name, f]) => f.length && name !== "core:registry-fresh");
assert("dirty fixture: only req gates fire, core stays clean", coreNoise.length === 0, coreNoise.map(([n, f]) => `${n}: ${f[0].message}`).join(" | "));

// ---- 3: the commands, for real ---------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "specops-req-selftest-"));
const S = path.join(tmp, ".sdlc");
const steps = [];
const step = (label, script, args) => {
  const r = cli(script, args);
  steps.push([label, r]);
  return r;
};

step("core init", coreScript("init.mjs"), ["--name", "t", "--apps", "backoffice:backoffice-web", "--state-dir", S]);
step("req init", reqScript("init.mjs"), ["--state-dir", S, "--module", "loan"]);

const records = path.join(tmp, "records.json");
fs.writeFileSync(records, JSON.stringify({
  stakeholders: [{ key: "cust", title: "ลูกค้าผู้เช่า", role: "customer" }],
  requirements: [{ kind: "REQ", actor: "@cust", goal: "จองอุปกรณ์ผ่านเว็บ" }],
}), "utf8");
step("capture", reqScript("capture.mjs"), ["loan", "--state-dir", S, "--text", "ลูกค้าจองอุปกรณ์ผ่านเว็บ คิดค่าเช่ารายวัน", "--records", records]);
step("ask round", reqScript("ask.mjs"), ["loan", "--state-dir", S, "--category", "calculation", "--count", "1"]);
step("answer", reqScript("ask.mjs"), ["loan", "--state-dir", S, "--answer", "Q-loan-001=a", "--rule", "ค่าเช่า = จำนวนวัน × อัตราต่อวัน"]);
step("example", reqScript("rules.mjs"), ["loan", "--state-dir", S, "--ex", "BR-loan-001@v1", "--given", "rate 800 · 3 วัน", "--when", "คิดค่าเช่า", "--then", "2,400"]);
step("calc", reqScript("calc.mjs"), ["BR-loan-001@v1", "--state-dir", S, "--formula", "fee = days * rate", "--number-type", "integer", "--round", "none"]);

const compute = path.join(tmp, "compute.mjs");
fs.writeFileSync(compute, "export function compute(input) {\n  return input.days * input.rate;\n}\n", "utf8");
step("golden --script", reqScript("golden.mjs"), ["CALC-loan-001@v1", "--state-dir", S, "--script", compute]);
step("golden --row", reqScript("golden.mjs"), ["CALC-loan-001@v1", "--state-dir", S, "--row", '{"days":3,"rate":800}']);
const beforeRun = step("sign before run", reqScript("golden.mjs"), ["CALC-loan-001@v1", "--state-dir", S, "--sign", "STK-001", "--evidence", "e.png"]);
const run = step("golden --run", reqScript("golden.mjs"), ["CALC-loan-001@v1", "--state-dir", S, "--run"]);
step("golden --sign", reqScript("golden.mjs"), ["CALC-loan-001@v1", "--state-dir", S, "--sign", "STK-001", "--evidence", "docs/evidence/line.png"]);
step("export", reqScript("export.mjs"), ["loan", "--state-dir", S]);

const green = step("gates green", coreScript("gates.mjs"), ["--state-dir", S]);
assert("live: every command exits 0", steps.filter(([l, r]) => r.code !== 0 && l !== "sign before run").length === 0, steps.filter(([l, r]) => r.code !== 0 && l !== "sign before run").map(([l, r]) => `${l} -> ${r.code}: ${r.out.trim().split("\n")[0]}`).join(" | "));
assert("live: signing an unrun GD is refused (exit 2)", beforeRun.code === 2, `exit ${beforeRun.code}`);
assert("live: --run took the value from the script, not the file", run.out.includes("-> 2400"), run.out.trim().split("\n").slice(0, 2).join(" "));
assert("live: gates.mjs loads req's checks through project.json", green.out.includes("gates=20"), green.out.trim().split("\n").pop());
assert("live: gates green after a full pass", green.code === 0, green.out.trim().split("\n").pop());

// hand-edit the answer key — the one thing a golden dataset exists to catch
const gdFile = path.join(S, "req/loan/golden/GD-loan-001.json");
const gdFileBody = JSON.parse(fs.readFileSync(gdFile, "utf8"));
gdFileBody.items[0].rows[0].expected = 9999;
fs.writeFileSync(gdFile, JSON.stringify(gdFileBody, null, 2) + "\n", "utf8");
const tampered = cli(coreScript("gates.mjs"), ["--state-dir", S]);
assert("live: editing an expected value by hand turns G-req-006 red", tampered.code === 1 && tampered.out.includes("G-req-006"), tampered.out.split("\n").find((l) => l.includes("G-req-006")) ?? tampered.out.trim().split("\n").pop());

fs.rmSync(tmp, { recursive: true, force: true });

let fail = 0;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok || !detail ? "" : `\n       ${detail}`}`);
  if (!ok) fail++;
}
console.log(fail ? `req selftest FAILED (${fail} of ${checks.length})` : `req selftest PASSED (${checks.length})`);
process.exit(fail ? 1 : 0);
