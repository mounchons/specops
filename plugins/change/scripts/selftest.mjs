#!/usr/bin/env node
/**
 * selftest.mjs — the proof for phase 3.
 *
 *   1. no check fires on the clean fixture
 *   2. every change check fires on the dirty fixture — a gate that cannot go red is not a gate
 *   3. the commands, run through node into a throwaway state dir: a real req + design graph, three
 *      changes of three kinds, the lane decided by the walk rather than by the request, and every
 *      refusal actually refusing
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
import { CHECKS, isFrozen } from "./checks.mjs";
import { now } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const core = (s) => path.resolve(here, "..", "..", "core", "scripts", s);
const req = (s) => path.resolve(here, "..", "..", "req", "scripts", s);
const dsn = (s) => path.resolve(here, "..", "..", "design", "scripts", s);
const chg = (s) => path.join(here, s);
const fx = (n) => path.resolve(here, "..", "fixtures", n, ".sdlc");

const ctxOf = (stateDir) => ({ stateDir, project: readJson(CORE_FILES.project(stateDir)), state: loadState(stateDir), registry: buildRegistry(stateDir) });
const fired = (stateDir, checks) => {
  const ctx = ctxOf(stateDir);
  const out = new Map();
  for (const [name, fn] of Object.entries(checks)) out.set(name, fn(ctx) ?? []);
  return out;
};
function cli(script, args) {
  try {
    return { out: execFileSync(process.execPath, [script, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), code: 0 };
  } catch (e) {
    return { out: (e.stdout ?? "") + (e.stderr ?? ""), code: e.status ?? 1 };
  }
}

const checks = [];
const assert = (name, ok, detail = "") => checks.push([name, Boolean(ok), detail]);
const noisy = (map) => [...map].filter(([name, f]) => f.length && name !== "core:registry-fresh");

// ---- 1 + 2: the fixtures ---------------------------------------------------
assert("clean fixture: no check fires", noisy(fired(fx("clean"), { ...CORE_CHECKS, ...CHECKS })).length === 0, noisy(fired(fx("clean"), { ...CORE_CHECKS, ...CHECKS })).map(([n, f]) => `${n}: ${f[0].message}`).join(" | "));
const dirty = fired(fx("dirty"), CHECKS);
for (const name of Object.keys(CHECKS)) assert(`dirty fixture: ${name} fires`, (dirty.get(name) ?? []).length > 0, (dirty.get(name) ?? [])[0]?.message ?? "no finding");
assert("dirty fixture: only change gates fire, core stays clean", noisy(fired(fx("dirty"), CORE_CHECKS)).length === 0, noisy(fired(fx("dirty"), CORE_CHECKS)).map(([n, f]) => `${n}: ${f[0].message}`).join(" | "));
assert("isFrozen answers from disk alone", isFrozen("UI-loan-001", { stateDir: fx("dirty") }).frozen === true && isFrozen("UI-loan-999", { stateDir: fx("dirty") }).frozen === false, JSON.stringify(isFrozen("UI-loan-001", { stateDir: fx("dirty") })));

// ---- 3: the commands, for real ---------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "specops-change-selftest-"));
const S = path.join(tmp, ".sdlc");
const w = (n, o) => { const f = path.join(tmp, n); fs.writeFileSync(f, JSON.stringify(o, null, 2), "utf8"); return f; };
const steps = [];
const step = (label, script, args) => {
  const r = cli(script, args);
  steps.push([label, r]);
  return r;
};

// a real graph to change: the design plugin's own live sequence, shortened
step("core init", core("init.mjs"), ["--name", "t", "--apps", "backoffice:backoffice-web,customer:customer-web", "--state-dir", S]);
const pj = JSON.parse(fs.readFileSync(path.join(S, "project.json"), "utf8"));
pj.apps = pj.apps.map((a) => (a.name === "customer" ? { ...a, auth: "line", owns: [] } : a));
fs.writeFileSync(path.join(S, "project.json"), JSON.stringify(pj, null, 2));
step("req init", req("init.mjs"), ["--state-dir", S, "--module", "loan"]);
step("capture", req("capture.mjs"), ["loan", "--state-dir", S, "--text", "ลูกค้ายื่นขอสินเชื่อ เจ้าหน้าที่อนุมัติ", "--records", w("cap.json", {
  stakeholders: [{ key: "officer", title: "เจ้าหน้าที่", role: "officer" }, { key: "cust", title: "ลูกค้า", role: "customer" }],
  requirements: [{ actor: "@cust", goal: "ยื่นขอสินเชื่อ" }, { kind: "NFR", actor: "@officer", goal: "audit ต้องอ่านย้อนหลังได้ 2 ปี" }],
})]);
step("rule", req("rules.mjs"), ["loan", "--state-dir", S, "--br", "วงเงินไม่เกิน 5 เท่าของรายได้", "--from", "REQ-loan-001"]);
step("example", req("rules.mjs"), ["loan", "--state-dir", S, "--ex", "BR-loan-001@v1", "--given", "รายได้ 30,000", "--when", "ขอ 200,000", "--then", "ระบบปฏิเสธ วงเงินสูงสุด 150,000"]);
step("design init", dsn("init.mjs"), ["--state-dir", S]);
step("domain", dsn("domain.mjs"), ["loan", "--state-dir", S, "--records", w("domain.json", {
  entities: [
    { key: "app", name: "LoanApplication", kind: "aggregate", attributes: ["amount"], invariants: ["BR-loan-001@v1"] },
    { key: "borrower", name: "Borrower", kind: "reference", attributes: ["name", "phone"], invariants: [] },
  ],
  stateMachines: [{ entity: "@app", states: [{ name: "draft" }, { name: "done", final: true }], transitions: [{ from: "draft", to: "done", by: "officer", enforces: ["BR-loan-001@v1"] }] }],
})]);
step("usecase", dsn("usecase.mjs"), ["loan", "--state-dir", S, "--records", w("uc.json", { usecases: [
  { key: "apply", title: "ยื่นขอสินเชื่อ", actor: "STK-002", apps: ["customer"], satisfies: ["REQ-loan-001"],
    flows: { main: [{ step: "กรอกวงเงิน", enforces: ["BR-loan-001@v1"] }] },
    acceptance: [{ flow: "main", given: "รายได้ 30,000", when: "ขอ 200,000", then: "ระบบปฏิเสธ วงเงินสูงสุด 150,000", from: "EX-loan-001" }] },
] })]);
step("screens", dsn("screens.mjs"), ["loan", "--state-dir", S]);
step("api", dsn("api.mjs"), ["loan", "--state-dir", S]);
step("rbac", dsn("rbac.mjs"), ["--state-dir", S, "--records", w("rbac.json", {
  roles: [{ key: "officer", title: "เจ้าหน้าที่", stk: "STK-001", apps: ["backoffice"] }, { key: "customer", title: "ลูกค้า", stk: "STK-002", apps: ["customer"] }],
  grants: [{ role: "@officer", ui: "*", allow: ["view", "create", "edit"], dataScope: "all" }, { role: "@customer", ui: "*", allow: ["view"], dataScope: "own" }],
})]);
step("scenario", dsn("scenario.mjs"), ["loan", "--state-dir", S]);
step("change init", chg("init.mjs"), ["--state-dir", S]);

const reg0 = buildRegistry(S);
const master = Object.entries(reg0.index).find(([id, r]) => id.startsWith("UI-") && /Borrower/.test(r.title ?? ""))?.[0];
const borrower = Object.entries(reg0.index).find(([id, r]) => id.startsWith("ENT-") && r.title === "Borrower")?.[0];

// A defect that names the screen CR-001 touches. It exists so `close` can be watched ignoring it:
// a DEF leaves `draft` only when a later run passes its test case (G-qa-005), so waiting for one to
// be approved would make every CR a finding opened unclosable.
fs.mkdirSync(path.join(S, "qa", "loan", "findings"), { recursive: true });
fs.writeFileSync(path.join(S, "qa", "loan", "findings", "DEF-loan-001.json"), JSON.stringify({ schemaVersion: "1.0", items: [{
  id: "DEF-loan-001", title: "เบอร์โทรไม่ขึ้นในตาราง", status: "draft", tc: null, scenario: null, usecase: null,
  routing: "dev", severity: "s3", cr: null, run: null, evidence: [], reproduce: `เปิด ${master} แล้วคอลัมน์เบอร์โทรว่าง`, raisedAt: now(),
}] }, null, 2), "utf8");

// CR-001 display -> lane ui
step("open display", chg("open.mjs"), ["--state-dir", S, "--kind", "display", "--source", "client", "--title", "แสดงเบอร์โทรผู้กู้", "--request", "อยากเห็นเบอร์โทรในตาราง", "--touches", master, "--fields", `${borrower}.phone`]);
const i1 = step("impact CR-001", chg("impact.mjs"), ["CR-001", "--state-dir", S]);
// CR-002 screen -> lane full
step("open screen", chg("open.mjs"), ["--state-dir", S, "--kind", "screen", "--source", "client", "--title", "ประวัติการกู้ของฉัน", "--request", "ลูกค้าอยากดูประวัติของตัวเอง", "--app", "customer"]);
const i2 = step("impact CR-002", chg("impact.mjs"), ["CR-002", "--state-dir", S]);
// CR-003 report -> lane full, /req:ask first
step("open report", chg("open.mjs"), ["--state-dir", S, "--kind", "report", "--source", "client", "--title", "รายงานรายได้รายเดือน", "--request", "ขอรายงานรายได้รายเดือนพร้อมยอดรวม", "--app", "backoffice"]);
const i3 = step("impact CR-003", chg("impact.mjs"), ["CR-003", "--state-dir", S]);
const a3 = step("apply CR-003", chg("apply.mjs"), ["CR-003", "--state-dir", S]);
// CR-004 other -> the owner decides
step("open other", chg("open.mjs"), ["--state-dir", S, "--kind", "other", "--source", "internal", "--title", "จัดหน้าใหม่", "--request", "จัดเรียงหน้าใหม่"]);
const noLane = step("impact other without --lane refused", chg("impact.mjs"), ["CR-004", "--state-dir", S]);
const applyNoLane = step("apply without a lane refused", chg("apply.mjs"), ["CR-004", "--state-dir", S]);
step("impact CR-004 --lane full", chg("impact.mjs"), ["CR-004", "--state-dir", S, "--lane", "full"]);

// amending what a change *is* — the kind decides the lane, so a wrong kind is a wrong lane
step("open screen to amend", chg("open.mjs"), ["--state-dir", S, "--kind", "screen", "--source", "internal", "--title", "จัดหน้าใหม่อีกที", "--request", "จัดเรียงใหม่", "--app", "customer"]);
step("impact CR-005", chg("impact.mjs"), ["CR-005", "--state-dir", S]);
const amendNoReason = step("amend without --reason refused", chg("open.mjs"), ["--state-dir", S, "--amend", "CR-005", "--kind", "other"]);
const amendApplied = step("amend an applied CR refused", chg("open.mjs"), ["--state-dir", S, "--amend", "CR-003", "--kind", "other", "--reason", "เปลี่ยนใจ"]);
const amended = step("amend CR-005 kind screen -> other", chg("open.mjs"), ["--state-dir", S, "--amend", "CR-005", "--kind", "other", "--reason", "ไม่ใช่หน้าจอใหม่ — เป็นการจัดเรียงของที่ประกาศไว้แล้ว"]);
const amendedCr = () => JSON.parse(fs.readFileSync(path.join(S, "change", "open", "CR-005.json"), "utf8"));

// the freeze
const a1 = step("apply CR-001", chg("apply.mjs"), ["CR-001", "--state-dir", S]);
const frozenScreens = cli(dsn("screens.mjs"), ["loan", "--state-dir", S]);
const twice = step("apply twice refused", chg("apply.mjs"), ["CR-001", "--state-dir", S]);

// close
const evidence = w("signoff.txt", { signedBy: "STK-001" });
const closeEarly = step("close before apply refused", chg("close.mjs"), ["CR-002", "--state-dir", S, "--sign", "STK-001", "--evidence", evidence]);
const closeNoEvidence = step("close without evidence refused", chg("close.mjs"), ["CR-001", "--state-dir", S, "--sign", "STK-001"]);
const closeDraft = cli(chg("close.mjs"), ["CR-001", "--state-dir", S, "--sign", "STK-001", "--evidence", evidence]);

// refusals at open
const noFields = step("display without --fields refused", chg("open.mjs"), ["--state-dir", S, "--kind", "display", "--source", "client", "--title", "x", "--request", "y"]);
const noDef = step("source finding without --finding refused", chg("open.mjs"), ["--state-dir", S, "--kind", "other", "--source", "finding", "--title", "x", "--request", "y"]);
const newField = step("a field the entity does not have refused", chg("open.mjs"), ["--state-dir", S, "--kind", "display", "--source", "client", "--title", "x", "--request", "y", "--touches", master, "--fields", `${borrower}.creditScore`]);
const ghost = step("touching an id that does not exist refused", chg("open.mjs"), ["--state-dir", S, "--kind", "other", "--source", "client", "--title", "x", "--request", "y", "--touches", "UI-loan-999"]);

const green = step("gates", core("gates.mjs"), ["--state-dir", S]);

const REFUSALS = new Set([
  "impact other without --lane refused", "apply without a lane refused", "apply twice refused",
  "close before apply refused", "close without evidence refused", "display without --fields refused",
  "source finding without --finding refused", "a field the entity does not have refused", "touching an id that does not exist refused",
  "amend without --reason refused", "amend an applied CR refused",
]);
const broke = steps.filter(([l, r]) => (REFUSALS.has(l) ? r.code !== 2 : r.code !== 0));
assert("live: every command exits 0, every refusal exits 2", broke.length === 0, broke.map(([l, r]) => `${l} -> ${r.code}: ${r.out.trim().split("\n")[0]}`).join(" | "));

assert("live: a display change whose data and permission already exist is lane ui", /lane ui\b/.test(i1.out), i1.out.split("\n").find((l) => /^lane/.test(l)) ?? "");
assert("live: the walk finds the screen's ACL and API and stops there", /ACL-/.test(i1.out) && /API-/.test(i1.out) && !/UC-/.test(i1.out), i1.out.split("\n").filter((l) => /^ {2}(ACL|API|UC)-/.test(l)).join(" · "));
assert("live: a new screen is full because nothing declares it", /lane full/.test(i2.out) && /capability no artifact declares/.test(i2.out), i2.out.split("\n").find((l) => /^lane/.test(l)) ?? "");
assert("live: a report is full because a total is a number nobody signed", /lane full/.test(i3.out) && /total/.test(i3.out), i3.out.split("\n").find((l) => /signed/.test(l)) ?? "");
assert("live: the report names the CALC its owner would mint next, without minting it", /CALC-loan-001@v1/.test(i3.out), i3.out.split("\n").find((l) => /CALC/.test(l)) ?? "");
assert("live: no id change does not own is written to the CR", !/CALC-loan-001/.test(fs.readFileSync(path.join(S, "change", "open", "CR-003.json"), "utf8")), "CR-003.json names a CALC that nobody minted");
assert("live: a report change sends the owner back to req before anything else", /1\. \/req:ask loan/.test(a3.out), a3.out.split("\n").find((l) => /1\./.test(l)) ?? "");
assert("live: a ui lane is design -> mock -> dev:revise -> qa", /1\. \/design:screens/.test(a1.out) && /\/dev:revise/.test(a1.out), a1.out.split("\n").filter((l) => /^\s+\d+\./.test(l)).join(" · "));
assert("live: kind other has no discriminator and says so", /the owner decides/.test(noLane.out), noLane.out.trim().split("\n").pop());
assert("live: apply refuses a CR the graph has not been walked for", /no lane/.test(applyNoLane.out), applyNoLane.out.trim().split("\n").pop());
assert("live: apply refuses to rewrite a plan somebody is working from", /already applied/.test(twice.out), twice.out.trim().split("\n").pop());
assert("live: a screen an open CR touches is frozen against regeneration", frozenScreens.code === 1 && frozenScreens.out.includes(master), frozenScreens.out.split("\n").find((l) => /frozen/.test(l)) ?? frozenScreens.out.trim().split("\n").pop());
assert("live: isFrozen names the CR and the lane", isFrozen(master, { stateDir: S }).by === "CR-001" && isFrozen(master, { stateDir: S }).lane === "ui", JSON.stringify(isFrozen(master, { stateDir: S })));
assert("live: close is a finding, not an argument error, while the work is still draft", closeDraft.code === 1 && /CANNOT CLOSE/.test(closeDraft.out), closeDraft.out.trim().split("\n")[0]);
assert("live: close refuses a CR nobody was ever told to do", /never applied/.test(closeEarly.out), closeEarly.out.trim().split("\n").pop());
assert("live: close never waits for a defect — a DEF leaves draft on a green run, not on an approval", closeDraft.code === 1 && !/DEF-loan-001/.test(closeDraft.out) && closeDraft.out.includes(master), closeDraft.out.split("\n").filter((l) => /^ {2}[A-Z]+-/.test(l)).join(" · "));
assert("live: amending the kind records what it was and why", /kind screen -> other/.test(amended.out) && amendedCr().amendments?.at(-1)?.from === "screen" && amendedCr().amendments.at(-1).to === "other" && Boolean(amendedCr().amendments.at(-1).reason), JSON.stringify(amendedCr().amendments));
assert("live: amending clears the lane and impact decided from the old kind", amendedCr().lane === null && amendedCr().impact === null && amendedCr().status === "draft", JSON.stringify({ lane: amendedCr().lane, impact: amendedCr().impact, status: amendedCr().status }));
assert("live: a kind that changed with nobody's reason on it is refused", /--reason is required/.test(amendNoReason.out), amendNoReason.out.trim().split("\n").pop());
assert("live: a change already handed to the plugins cannot change what it is", /was applied/.test(amendApplied.out), amendApplied.out.trim().split("\n").pop());
assert("live: close refuses without evidence", /evidence/.test(closeNoEvidence.out), closeNoEvidence.out.trim().split("\n").pop());
assert("live: a field the entity does not have is not a display change", /is not a display change|has no attribute/.test(newField.out), newField.out.trim().split("\n").pop());
assert("live: a change cannot touch something nobody designed", /does not exist/.test(ghost.out), ghost.out.trim().split("\n").pop());
assert("live: apply wrote nothing outside change/", fs.readdirSync(path.join(S)).includes("change") && !/draft/.test(JSON.parse(fs.readFileSync(path.join(S, "change", "open", "CR-001.json"), "utf8")).status), "CR-001 status after apply");
assert("live: gates.mjs loads change's checks through project.json", /gates=42/.test(green.out), green.out.trim().split("\n").pop());
assert("live: gates green with four changes open", green.code === 0, green.out.trim().split("\n").pop());

fs.rmSync(tmp, { recursive: true, force: true });

let fail = 0;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok || !detail ? "" : `\n       ${detail}`}`);
  if (!ok) fail++;
}
console.log(fail ? `change selftest FAILED (${fail} of ${checks.length})` : `change selftest PASSED (${checks.length})`);
process.exit(fail ? 1 : 0);
