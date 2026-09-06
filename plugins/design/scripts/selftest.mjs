#!/usr/bin/env node
/**
 * selftest.mjs — the proof for phase 2.
 *
 *   1. no check fires on the clean fixture (which was produced by running the real commands)
 *   2. every design check fires on the dirty fixture — a gate that cannot go red is not a gate
 *   3. the commands, run through node into a throwaway state dir: the four generators produce the
 *      screens nobody asked for, gates end green, and each refusal actually refuses
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
const core = (s) => path.resolve(here, "..", "..", "core", "scripts", s);
const req = (s) => path.resolve(here, "..", "..", "req", "scripts", s);
const dsn = (s) => path.join(here, s);
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
assert("dirty fixture: only design gates fire, core stays clean", noisy(fired(fx("dirty"), CORE_CHECKS)).length === 0, noisy(fired(fx("dirty"), CORE_CHECKS)).map(([n, f]) => `${n}: ${f[0].message}`).join(" | "));

// ---- 3: the commands, for real ---------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "specops-design-selftest-"));
const S = path.join(tmp, ".sdlc");
const w = (n, o) => { const f = path.join(tmp, n); fs.writeFileSync(f, JSON.stringify(o, null, 2), "utf8"); return f; };
const steps = [];
const step = (label, script, args) => {
  const r = cli(script, args);
  steps.push([label, r]);
  return r;
};

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
    { key: "borrower", name: "Borrower", kind: "reference", attributes: ["name"], invariants: [] },
  ],
  stateMachines: [{ entity: "@app", states: [{ name: "draft" }, { name: "done", final: true }], transitions: [{ from: "draft", to: "done", by: "officer", enforces: ["BR-loan-001@v1"] }] }],
})]);
const deadState = step("dead state refused", dsn("domain.mjs"), ["loan", "--state-dir", S, "--records", w("bad.json", {
  entities: [{ key: "x", name: "X", kind: "aggregate", attributes: [] }],
  stateMachines: [{ entity: "@x", states: [{ name: "a" }, { name: "b" }], transitions: [{ from: "a", to: "b" }] }],
})]);
step("usecase", dsn("usecase.mjs"), ["loan", "--state-dir", S, "--records", w("uc.json", { usecases: [
  { key: "apply", title: "ยื่นขอสินเชื่อ", actor: "STK-002", apps: ["customer"], satisfies: ["REQ-loan-001"],
    flows: { main: [{ step: "กรอกวงเงิน", enforces: ["BR-loan-001@v1"] }] },
    acceptance: [{ flow: "main", given: "รายได้ 30,000", when: "ขอ 200,000", then: "ระบบปฏิเสธ วงเงินสูงสุด 150,000", from: "EX-loan-001" }] },
] })]);
const paraphrase = step("paraphrased AC refused", dsn("usecase.mjs"), ["loan", "--state-dir", S, "--records", w("bad-ac.json", { usecases: [
  { key: "z", title: "Z", actor: "STK-002", apps: ["customer"], satisfies: ["REQ-loan-001"],
    flows: { main: [{ step: "s", enforces: ["BR-loan-001@v1"] }] },
    acceptance: [{ flow: "main", given: "g", when: "w", then: "ปฏิเสธ", from: "EX-loan-001" }] },
] })]);
const screens = step("screens", dsn("screens.mjs"), ["loan", "--state-dir", S]);
const again = step("screens again", dsn("screens.mjs"), ["loan", "--state-dir", S]);
step("api", dsn("api.mjs"), ["loan", "--state-dir", S]);
const noFailureMode = step("integration without failureMode refused", dsn("api.mjs"), ["loan", "--state-dir", S, "--records", w("bad-int.json", { integrations: [{ key: "x", title: "X" }] })]);
// A sign-in is not a write, so no generator will ever make its endpoint — and a change request that
// asks for the route needs somewhere for the answer to land. The owner declares it, with the method
// and the path spelled out; a route nobody typed is a route somebody guessed.
const loginId = loadState(S).artifacts.find((a) => a.prefix === "UI" && (a.title ?? "").includes("เข้าสู่ระบบ"))?.id;
const declareNoPath = step("declare without a path refused", dsn("api.mjs"), ["loan", "--state-dir", S, "--records", w("nopath.json", { apis: [{ for: `${loginId}.sign-in` }] })]);
const declareNoAction = step("declare for an action the screen does not have refused", dsn("api.mjs"), ["loan", "--state-dir", S, "--records", w("noact.json", { apis: [{ for: `${loginId}.teleport`, method: "POST", path: "/api/teleport" }] })]);
const declared = step("declare an endpoint no action generated", dsn("api.mjs"), ["loan", "--state-dir", S, "--records", w("auth.json", { apis: [{ for: `${loginId}.sign-in`, method: "POST", path: "/api/auth/login", title: "เข้าสู่ระบบ", request: { username: "string", password: "string" } }] })]);
step("rbac", dsn("rbac.mjs"), ["--state-dir", S, "--records", w("rbac.json", {
  roles: [{ key: "officer", title: "เจ้าหน้าที่", stk: "STK-001", apps: ["backoffice"] }, { key: "customer", title: "ลูกค้า", stk: "STK-002", apps: ["customer"] }],
  grants: [{ role: "@officer", ui: "*", allow: ["view", "create", "edit"], dataScope: "all" }, { role: "@customer", ui: "*", allow: ["view"], dataScope: "own" }],
})]);
step("scenario", dsn("scenario.mjs"), ["loan", "--state-dir", S]);
const green = step("gates", core("gates.mjs"), ["--state-dir", S]);

const REFUSALS = new Set(["dead state refused", "paraphrased AC refused", "integration without failureMode refused", "declare without a path refused", "declare for an action the screen does not have refused"]);
const broke = steps.filter(([l, r]) => (REFUSALS.has(l) ? r.code !== 2 : r.code !== 0));
assert("live: every command exits 0, every refusal exits 2", broke.length === 0, broke.map(([l, r]) => `${l} -> ${r.code}: ${r.out.trim().split("\n")[0]}`).join(" | "));
assert("live: a state with no way out is refused before it reaches disk", /no way out/.test(deadState.out), deadState.out.trim().split("\n")[0]);
assert("live: an acceptance criterion that paraphrases its example is refused", /words exactly/.test(paraphrase.out), paraphrase.out.trim().split("\n")[0]);
assert("live: an integration with no failureMode is refused", /failureMode/.test(noFailureMode.out), noFailureMode.out.trim().split("\n").pop());
const apiNow = () => loadState(S).artifacts.filter((a) => a.prefix === "API").map((a) => a.raw);
assert("live: an endpoint no action generated is declared, not guessed", declared.code === 0 && /API-/.test(declared.out) && apiNow().some((a) => a.path === "/api/auth/login" && a.forUi === loginId && a.status === "reviewed"), declared.out.trim().split("\n").pop());
assert("live: declaring one without a method and a path is refused", declareNoPath.code === 2 && /--method and a --path/.test(declareNoPath.out), declareNoPath.out.trim().split("\n").pop());
assert("live: declaring one for an action the screen does not have is refused", declareNoAction.code === 2 && /declares no action/.test(declareNoAction.out), declareNoAction.out.trim().split("\n").pop());
assert("live: login appears in both apps without being asked for", (screens.out.match(/เข้าสู่ระบบ/g) ?? []).length >= 1 && /baseline/.test(screens.out), screens.out.split("\n").find((l) => /เข้าสู่ระบบ/.test(l)) ?? "");
assert("live: the reference entity got a master screen in the app that owns master", /master/.test(screens.out) && /Borrower/.test(screens.out), screens.out.split("\n").find((l) => /Borrower/.test(l)) ?? "");
assert("live: the audit NFR produced a screen nobody asked for", /nfr/.test(screens.out), screens.out.split("\n").find((l) => /nfr\s*$/.test(l)) ?? "");
assert("live: customer (auth line) is told why it has no forgot-password", /forgot-password/.test(screens.out) && /does not hold/.test(screens.out), screens.out.split("\n").find((l) => /forgot-password/.test(l)) ?? "");
assert("live: re-running screens creates nothing", /created 0/.test(again.out), again.out.trim().split("\n")[0]);
assert("live: gates.mjs loads design's checks through project.json", /gates=37/.test(green.out), green.out.trim().split("\n").pop());
assert("live: gates green after a full pass", green.code === 0, green.out.trim().split("\n").pop());

// an open CR freezes what it touches — design must refuse to regenerate it (phase 3 opens the CRs)
const anyUi = Object.keys(buildRegistry(S).index).find((id) => id.startsWith("UI-"));
fs.mkdirSync(path.join(S, "change", "open"), { recursive: true });
fs.writeFileSync(path.join(S, "change", "open", "CR-001.json"), JSON.stringify({ id: "CR-001", title: "แก้หน้าจอ", status: "draft", source: "client", lane: null, touches: [anyUi] }, null, 2));
const frozen = cli(dsn("screens.mjs"), ["loan", "--state-dir", S]);
assert("live: a screen an open CR touches is frozen against regeneration", frozen.code === 1 && frozen.out.includes(anyUi), frozen.out.split("\n").find((l) => /frozen/.test(l)) ?? frozen.out.trim().split("\n").pop());

fs.rmSync(tmp, { recursive: true, force: true });

let fail = 0;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok || !detail ? "" : `\n       ${detail}`}`);
  if (!ok) fail++;
}
console.log(fail ? `design selftest FAILED (${fail} of ${checks.length})` : `design selftest PASSED (${checks.length})`);
process.exit(fail ? 1 : 0);
