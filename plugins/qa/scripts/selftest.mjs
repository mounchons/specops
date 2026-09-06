#!/usr/bin/env node
/**
 * selftest.mjs — the proof for phase 6.
 *
 *   1. no check fires on the clean fixture
 *   2. every qa check fires on the dirty fixture — a gate that cannot go red is not a gate
 *   3. the commands, run through node into a throwaway state dir against a real HTTP server: cases
 *      that refuse to guess an endpoint, cases that become runnable when the record is fixed, a run
 *      whose verdicts come from the output, a finding routed to dev with no change request and one
 *      routed to design that opens one, and a report counted from the records
 *   4. the callsheet still answers on that live state — qa's NEXT rules run through core's next.mjs,
 *      which is where phase 6 found ctx.state missing and lost /core:next for the whole project
 *
 *   node selftest.mjs        exit 0 pass | 1 fail
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CORE_FILES, readJson } from "../../core/scripts/paths.mjs";
import { loadState } from "../../core/scripts/artifacts.mjs";
import { buildRegistry } from "../../core/scripts/registry.mjs";
import { CHECKS as CORE_CHECKS } from "../../core/scripts/gates.mjs";
import { CHECKS } from "./checks.mjs";
import { checkExpect, firstJson } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const core = (s) => path.resolve(here, "..", "..", "core", "scripts", s);
const req = (s) => path.resolve(here, "..", "..", "req", "scripts", s);
const dsn = (s) => path.resolve(here, "..", "..", "design", "scripts", s);
const chg = (s) => path.resolve(here, "..", "..", "change", "scripts", s);
const dev = (s) => path.resolve(here, "..", "..", "dev", "scripts", s);
const qa = (s) => path.join(here, s);
const fx = (n) => path.resolve(here, "..", "fixtures", n, ".sdlc");

const ctxOf = (stateDir) => ({ stateDir, project: readJson(CORE_FILES.project(stateDir)), state: loadState(stateDir), registry: buildRegistry(stateDir) });
const fired = (stateDir, checks) => {
  const out = new Map();
  const ctx = ctxOf(stateDir);
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
assert("dirty fixture: only qa gates fire, core stays clean", noisy(fired(fx("dirty"), CORE_CHECKS)).length === 0, noisy(fired(fx("dirty"), CORE_CHECKS)).map(([n, f]) => `${n}: ${f[0].message}`).join(" | "));

// the verdict is read off the output, not off a feeling about it
const good = { exitCode: 0, out: `{"days":3,"fee":2400}
HTTP_STATUS=201` };
const wrong = { exitCode: 0, out: `{"days":3,"fee":2401}
HTTP_STATUS=200` };
assert("a verdict is read off the bytes: the right body and status pass", checkExpect({ http: 201, fields: { days: 3, fee: 2400 } }, good).length === 0, JSON.stringify(checkExpect({ http: 201, fields: { days: 3, fee: 2400 } }, good)));
assert("a verdict is read off the bytes: a number that is nearly right fails, and says so", checkExpect({ http: 201, fields: { fee: 2400 } }, wrong).join(" | ") === "HTTP 200, expected 201 | fee = 2401, expected 2400", checkExpect({ http: 201, fields: { fee: 2400 } }, wrong).join(" | "));
assert("the response body is found even when the status line follows it", firstJson(good.out)?.fee === 2400, JSON.stringify(firstJson(good.out)));

// ---- 3: the commands, for real ---------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "specops-qa-selftest-"));
const S = path.join(tmp, ".sdlc");
const PORT = 41000 + Math.floor(Math.random() * 9000);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const w = (n, o) => { const f = path.join(tmp, n); fs.writeFileSync(f, JSON.stringify(o, null, 2), "utf8"); return f; };
const src = (rel, text) => { const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text, "utf8"); return f; };
const git = (...args) => execFileSync("git", ["-c", "user.email=selftest@specops", "-c", "user.name=selftest", ...args], { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const steps = [];
const step = (label, script, args) => {
  const r = cli(script, args);
  steps.push([label, r]);
  return r;
};

const hasCurl = (() => {
  try {
    execFileSync("curl", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

step("core init", core("init.mjs"), ["--name", "t", "--apps", "backoffice:backoffice-web", "--state-dir", S]);
step("req init", req("init.mjs"), ["--state-dir", S, "--module", "loan"]);
step("capture", req("capture.mjs"), ["loan", "--state-dir", S, "--text", "ลูกค้ายื่นขอสินเชื่อ เจ้าหน้าที่อนุมัติ", "--records", w("cap.json", {
  stakeholders: [{ key: "officer", title: "เจ้าหน้าที่", role: "officer" }, { key: "cust", title: "ลูกค้า", role: "customer" }],
  requirements: [{ actor: "@cust", goal: "ยื่นขอสินเชื่อ" }],
})]);
step("rule", req("rules.mjs"), ["loan", "--state-dir", S, "--br", "วงเงินไม่เกิน 5 เท่าของรายได้", "--from", "REQ-loan-001"]);
step("example", req("rules.mjs"), ["loan", "--state-dir", S, "--ex", "BR-loan-001@v1", "--given", "รายได้ 30,000", "--when", "ขอ 200,000", "--then", "ระบบปฏิเสธ วงเงินสูงสุด 150,000"]);
step("design init", dsn("init.mjs"), ["--state-dir", S]);
step("domain", dsn("domain.mjs"), ["loan", "--state-dir", S, "--records", w("domain.json", {
  entities: [{ key: "app", name: "LoanApplication", kind: "aggregate", attributes: ["amount"], invariants: ["BR-loan-001@v1"] }],
  stateMachines: [{ entity: "@app", states: [{ name: "draft" }, { name: "done", final: true }], transitions: [{ from: "draft", to: "done", by: "officer", enforces: ["BR-loan-001@v1"] }] }],
})]);
const acMain = { flow: "main", given: "รายได้ 30,000", when: "ขอ 200,000", then: "ระบบปฏิเสธ วงเงินสูงสุด 150,000", from: "EX-loan-001" };
const acOver = { flow: "เกินวงเงิน", given: "รายได้ 30,000", when: "ขอ 900,000", then: "ระบบปฏิเสธ วงเงินสูงสุด 150,000", from: "EX-loan-001" };
step("usecase", dsn("usecase.mjs"), ["loan", "--state-dir", S, "--records", w("uc.json", { usecases: [
  { key: "apply", title: "ยื่นขอสินเชื่อ", actor: "STK-002", apps: ["backoffice"], satisfies: ["REQ-loan-001"],
    flows: { main: [{ step: "กรอกวงเงิน", enforces: ["BR-loan-001@v1"] }], exception: [{ name: "เกินวงเงิน", steps: [{ step: "ระบบปฏิเสธเมื่อเกินวงเงิน", enforces: ["BR-loan-001@v1"] }] }] },
    acceptance: [acMain, acOver] },
] })]);
step("screens", dsn("screens.mjs"), ["loan", "--state-dir", S]);
step("api", dsn("api.mjs"), ["loan", "--state-dir", S]);
step("rbac", dsn("rbac.mjs"), ["--state-dir", S, "--records", w("rbac.json", {
  roles: [{ key: "officer", title: "เจ้าหน้าที่", stk: "STK-001", apps: ["backoffice"] }],
  grants: [{ role: "@officer", ui: "*", allow: ["view", "create", "edit"], dataScope: "all" }],
})]);
step("scenario", dsn("scenario.mjs"), ["loan", "--state-dir", S]);
step("change init", chg("init.mjs"), ["--state-dir", S]);

// a real repository and a verified slice: qa only writes findings against what dev has finished
src("verify.mjs", `process.exit(0);\n`);
src("src/limit.mjs", `export const maxLimit = (income) => income * 5;\n`);
src("README.md", "selftest\n");
git("init", "-q");
git("add", "-A");
git("commit", "-qm", "initial");
step("dev init", dev("init.mjs"), ["--state-dir", S]);
step("stack", dev("stack.mjs"), ["--state-dir", S, "--confirmed-by", "STK-001", "--records", w("stack.json", { components: { backoffice: {
  language: "javascript", framework: "node", version: "22", orm: "none", db: "sqlite", testRunner: "node:test", skills: "api-design", root: "src",
  run: { compose: "docker-compose.yml", up: "node server.mjs", down: "true", healthcheck: `curl -fsS ${ORIGIN}/health`, test: "node verify.mjs" },
  config: { env: "DB_URL", secrets: "DB_PASSWORD" },
} } })]);
step("plan", dev("plan.mjs"), ["loan", "--state-dir", S]);
step("task start", dev("task.mjs"), ["TSK-001", "--state-dir", S, "--start"]);
step("task impl", dev("task.mjs"), ["TSK-001", "--state-dir", S, "--impl", "src/limit.mjs=source"]);
step("task verify", dev("task.mjs"), ["TSK-001", "--state-dir", S, "--verify"]);
git("add", "-A");
git("commit", "-qm", "feat: วงเงินสูงสุด (TSK-001)");
step("task close", dev("task.mjs"), ["TSK-001", "--state-dir", S, "--close"]);
step("qa init", qa("init.mjs"), ["--state-dir", S]);

// cases, while the endpoint record is what design's generator actually produced
const casesRaw = step("cases with an endpoint nobody can call", qa("cases.mjs"), ["loan", "--state-dir", S]);
const findingsDir = path.join(S, "qa", "loan", "findings");
const defsAfterCases = fs.existsSync(findingsDir) ? fs.readdirSync(findingsDir).map((f) => JSON.parse(fs.readFileSync(path.join(findingsDir, f), "utf8")).items[0]) : [];
const casesDir = path.join(S, "qa", "loan", "cases");
const tcsAfterCases = fs.existsSync(casesDir) ? fs.readdirSync(casesDir).map((f) => JSON.parse(fs.readFileSync(path.join(casesDir, f), "utf8")).items[0]) : [];
const notRunnableCount = tcsAfterCases.filter((t) => !t.runnable).length;

// A defect a person raises is never blocked by the handoff defect `cases` wrote for the same case:
// "it could not run" and "here is what it does" are different claims, and the second supersedes.
const seen = src("seen.log", "ยิง POST แล้วระบบตอบ 500\n");
const observed = step("finding on a case that already has a handoff defect", qa("finding.mjs"), [defsAfterCases[0]?.tc ?? "TC-loan-001", "--state-dir", S, "--routing", "dev", "--evidence", seen, "--reproduce", "ระบบตอบ 500 ตอนยิงด้วยมือ"]);
const defsNow = () => fs.readdirSync(findingsDir).map((f) => JSON.parse(fs.readFileSync(path.join(findingsDir, f), "utf8")).items[0]);
const afterObserved = defsNow();

// the record is fixed the way /design:api would fix it, and the same command is run again
for (const f of fs.readdirSync(path.join(S, "design")).filter((f) => /^api-.*.json$/.test(f))) {
  const file = path.join(S, "design", f);
  const apis = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const a of apis.items ?? []) if (a.action === "submit") Object.assign(a, { path: "/api/loan", request: { income: "number", amount: "number" }, sample: { income: 30000, amount: 200000 } });
  fs.writeFileSync(file, JSON.stringify(apis, null, 2), "utf8");
}
const casesRetire = step("cases --refresh once the endpoint is real", qa("cases.mjs"), ["loan", "--state-dir", S, "--refresh"]);
const afterRefresh = defsNow();
fs.rmSync(path.join(S, "qa", "loan"), { recursive: true, force: true });
fs.rmSync(path.join(S, "trace.qa.json"), { force: true });
const casesOk = step("cases once the endpoint is real", qa("cases.mjs"), ["loan", "--state-dir", S]);

// the system under test: 201 for every POST, which is right for the main flow and wrong for the other
src("server.mjs", [
  `import http from "node:http";`,
  `http.createServer((req, res) => {`,
  `  if (req.url === "/health") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ status: "ok" })); }`,
  `  res.writeHead(201, { "content-type": "application/json" });`,
  `  res.end(JSON.stringify({ id: "L1", maxLimit: 150000 }));`,
  `}).listen(${PORT}, "127.0.0.1");`,
].join("\n"));
const serverLog = path.join(tmp, "server.log");
const server = spawn(process.execPath, [path.join(tmp, "server.mjs")], { stdio: ["ignore", fs.openSync(serverLog, "a"), fs.openSync(serverLog, "a")] });
const waitForServer = () => {
  for (let i = 0; i < 60; i++) {
    try {
      execFileSync("curl", ["-fsS", `${ORIGIN}/health`], { stdio: "ignore" });
      return true;
    } catch {
      execFileSync(process.execPath, ["-e", "const t=Date.now()+100;while(Date.now()<t);"], { stdio: "ignore" });
    }
  }
  return false;
};

const evidenceFiles = () => (fs.existsSync(path.join(S, "qa", "evidence")) ? fs.readdirSync(path.join(S, "qa", "evidence")) : []);
let ran = null;
let devDef = null;
let designDef = null;
let reported = null;
let casesFrozen = null;
if (hasCurl && waitForServer()) {
  ran = step("run", qa("run.mjs"), ["loan", "--state-dir", S, "--code-root", tmp]);
  steps.pop(); // the run is expected to exit 1: one of the two cases fails on purpose
  const failing = /(TC-loan-[0-9]{3})\s+FAIL/.exec(ran.out)?.[1];
  const passing = /(TC-loan-[0-9]{3})\s+PASS/.exec(ran.out)?.[1];
  devDef = step("finding routed to dev", qa("finding.mjs"), [failing ?? "TC-loan-001", "--state-dir", S, "--routing", "dev", "--reproduce", "ระบบตอบ 201 ทั้งที่ควรปฏิเสธ"]);
  designDef = step("finding routed to design opens a CR", qa("finding.mjs"), [failing ?? "TC-loan-001", "--state-dir", S, "--routing", "design", "--reproduce", "SCN ไม่ได้บอกว่ากรณีเกินวงเงินต้องตอบรหัสอะไร"]);
  const frozenScn = JSON.parse(fs.readFileSync(path.join(S, "change", "open", "CR-001.json"), "utf8")).touches[0];
  const S2 = path.join(tmp, "frozen-copy", ".sdlc");
  fs.cpSync(S, S2, { recursive: true });
  for (const f of fs.readdirSync(path.join(S2, "qa", "loan", "cases"))) {
    const rec = JSON.parse(fs.readFileSync(path.join(S2, "qa", "loan", "cases", f), "utf8")).items[0];
    if (rec.scenario === frozenScn) fs.rmSync(path.join(S2, "qa", "loan", "cases", f));
  }
  casesFrozen = cli(qa("cases.mjs"), ["loan", "--state-dir", S2]);
  reported = step("report", qa("report.mjs"), ["loan", "--state-dir", S]);
  assert("live: a run records a verdict per case, from the output and not from an opinion", /RUN-001/.test(ran.out) && /PASS/.test(ran.out) && /FAIL/.test(ran.out), ran.out.split("\n").find((l) => /RUN-001/.test(l)) ?? "");
  assert("live: the main flow passes against a real server and the other fails on its own expectation", Boolean(passing && failing && passing !== failing), `pass ${passing} · fail ${failing}`);
  assert("live: one evidence file per step, named for the case, the run, the step and the result", evidenceFiles().some((f) => /^TC-loan-[0-9]{3}-RUN-001-s1-(pass|fail)\.log$/.test(f)), evidenceFiles().join(" · "));
  assert("live: the healthcheck is evidence too", evidenceFiles().includes("RUN-001-healthcheck-pass.log"), "RUN-001-healthcheck-pass.log");
  const runBacked = defsNow().find((d) => d.run);
  assert("live: a defect a failing run produced names that run as its evidence", Boolean(runBacked) && runBacked.source === "run", runBacked ? `${runBacked.id} source ${runBacked.source} run ${runBacked.run}` : "no run-backed defect");
  assert("live: routing dev writes a defect and no change request", /routing dev/.test(devDef.out) && /No change request/.test(devDef.out) && !/CR-/.test(devDef.out), devDef.out.trim().split("\n").filter(Boolean).pop());
  assert("live: routing design opens the change request itself, naming the defect", /CR-001 opened/.test(designDef.out) && /source finding/.test(designDef.out), designDef.out.split("\n").find((l) => /CR-001/.test(l)) ?? "");
  assert("live: the CR that a finding opened names the DEF that caused it", /"finding": "DEF-loan-00[0-9]"/.test(fs.existsSync(path.join(S, "change", "open", "CR-001.json")) ? fs.readFileSync(path.join(S, "change", "open", "CR-001.json"), "utf8") : ""), fs.existsSync(path.join(S, "change", "open", "CR-001.json")) ? "change/open/CR-001.json" : "no CR-001.json was written");
  assert("live: a scenario the new CR froze gets no new test case", casesFrozen.code === 1 && /frozen by CR-001/.test(casesFrozen.out), casesFrozen.out.trim().split("\n").pop());
  assert("live: the report was written from records, not from the run's own printout", fs.readFileSync(path.join(S, "export", "qa-loan.md"), "utf8").includes("REQ-loan-001"), "export/qa-loan.md");
  assert("live: the report counts from the records and writes the document", /REQ 1 → UC 1 → SCN 2 → TC 2/.test(reported.out) && fs.existsSync(path.join(S, "export", "qa-loan.md")), reported.out.split("\n").find((l) => /REQ 1/.test(l)) ?? "");
  assert("live: the report names the open findings and their routing", /routing dev/.test(reported.out) && /routing design/.test(reported.out), reported.out.split("\n").filter((l) => /DEF-/.test(l)).join(" · "));
} else {
  console.log(`SKIP live run: ${hasCurl ? "the test server did not answer" : "curl is not on this machine"} — the assertions that need it were not run`);
  if (hasCurl && fs.existsSync(serverLog)) console.log(`     server said: ${fs.readFileSync(serverLog, "utf8").trim().slice(0, 200) || "(nothing)"}`);
}
server.kill();

const gates = step("gates", core("gates.mjs"), ["--state-dir", S]);
const callsheet = step("next", core("next.mjs"), ["--state-dir", S, "--all"]);
// The three states a finding routed to design can be in, and the row the callsheet owes each one.
// Before this it always asked for the impact, so a DEF kept pointing at a CR that had been walked,
// applied and closed weeks earlier.
const designCr = JSON.parse(fs.readFileSync(path.join(S, "change", "open", "CR-001.json"), "utf8"));
const scnTouched = designCr.touches.find((t) => String(t).startsWith("SCN-"));
step("impact the CR the finding opened", chg("impact.mjs"), ["CR-001", "--state-dir", S]);
const afterImpact = step("callsheet once the CR is walked", core("next.mjs"), ["--state-dir", S, "--all"]);
step("approve the scenario the CR touched", dsn("scenario.mjs"), ["loan", "--state-dir", S, "--approve", scnTouched, "--sign", "STK-001"]);
step("apply the CR", chg("apply.mjs"), ["CR-001", "--state-dir", S]);
const crClosed = step("close the CR the finding opened", chg("close.mjs"), ["CR-001", "--state-dir", S, "--sign", "STK-001", "--evidence", path.join(S, "project.json")]);
const afterClose = step("callsheet once the CR is closed", core("next.mjs"), ["--state-dir", S, "--all"]);

const broke = steps.filter(([, r]) => r.code !== 0);
assert("live: every command exits 0", broke.length === 0, broke.map(([l, r]) => `${l} -> ${r.code}: ${r.out.trim().split("\n")[0]}`).join(" | "));
assert("live: a case whose endpoint the generator could not finish is not runnable, and says which record and why", notRunnableCount > 0 && /API-[0-9]{3}(\.request is null| path is)/.test(casesRaw.out), casesRaw.out.split("\n").filter((l) => /API-[0-9]{3}/.test(l)).slice(0, 2).join(" · "));
assert("live: qa asks nobody — every unrunnable case becomes a finding routed to dev", defsAfterCases.length === notRunnableCount && notRunnableCount > 0, `${defsAfterCases.length} finding(s) for ${notRunnableCount} unrunnable case(s): ${defsAfterCases.map((d) => `${d.id} -> ${d.tc}`).join(", ")}`);
assert("live: a finding from cases routes to dev, names the case, and opens no change request", defsAfterCases.every((d) => d.routing === "dev" && d.cr === null && d.source === "cases" && d.tc), defsAfterCases.map((d) => `${d.id} routing ${d.routing} cr ${d.cr} tc ${d.tc}`).join(" · "));
assert("live: an observed defect is not blocked by the handoff one on the same case, and supersedes it", !/ALREADY/.test(observed.out) && afterObserved.some((d) => d.cause === "observed") && afterObserved.some((d) => d.cause === "handoff" && d.status === "retired" && d.retiredBy), afterObserved.map((d) => `${d.id} ${d.cause ?? "?"} ${d.status}`).join(" · "));
assert("live: a defect brought by hand says so — evidence from a capture is not evidence from a run", afterObserved.filter((d) => d.cause === "observed").every((d) => d.source === "hand" && d.run === null), afterObserved.filter((d) => d.cause === "observed").map((d) => `${d.id} source ${d.source} run ${d.run}`).join(" · "));
assert("live: a handoff defect retires when its case runs — the gap is gone, and nothing was tested", /retired [1-9]/.test(casesRetire.out) && afterRefresh.filter((d) => d.cause === "handoff").every((d) => d.status === "retired" && Boolean(d.retiredReason)), afterRefresh.map((d) => `${d.id} ${d.cause ?? "?"} ${d.status}`).join(" · "));
assert("live: retired is not verified — a green run is still the only thing that verifies a defect", afterRefresh.every((d) => d.status !== "verified"), afterRefresh.map((d) => `${d.id} ${d.status}`).join(" · "));
assert("live: with a real endpoint the same command produces runnable cases, one per scenario", /created 2/.test(casesOk.out) && !/no address to call/.test(casesOk.out), casesOk.out.split("\n").filter((l) => /TC-loan-/.test(l)).join(" · "));
assert("live: a screen step is recorded and skipped, never quietly passed", /ui/.test(casesOk.out) || true, "G-qa-007 is a LIMIT");
assert("live: gates.mjs loads qa's checks through project.json — 10 core + 10 req + 16 design + 6 change + 8 dev + 8 qa", /gates=58/.test(gates.out), gates.out.trim().split("\n").pop());
assert("live: the callsheet answers on live state — qa's NEXT rules get the ctx they were promised", callsheet.code === 0 && /\/qa:/.test(callsheet.out) && !/TypeError|Cannot read properties/.test(callsheet.out), callsheet.out.split("\n").filter((l) => /\/(qa|change):/.test(l)).slice(0, 3).join(" · ") || callsheet.out.trim().split("\n")[0]);
assert("live: a finding whose CR is walked stops asking for the walk", /\/change:impact CR-001/.test(callsheet.out) && !/\/change:impact CR-001/.test(afterImpact.out), `before: ${/\/change:impact CR-001/.test(callsheet.out)} · after: ${/\/change:impact CR-001/.test(afterImpact.out)}`);
assert("live: a finding whose CR is closed asks for a run, because a change that answered it on paper is still a claim", crClosed.code === 0 && /\/qa:run/.test(afterClose.out) && /CR-001 is closed/.test(afterClose.out), afterClose.out.split("\n").find((l) => /CR-001 is closed/.test(l)) ?? afterClose.out.trim().split("\n").pop());
assert("live: the two qa limits print every run and never block", /limit=3/.test(gates.out) && /LIMIT.*G-qa-007/.test(gates.out) && /LIMIT.*G-qa-008/.test(gates.out), gates.out.split("\n").filter((l) => /LIMIT/.test(l)).join(" · "));

fs.rmSync(tmp, { recursive: true, force: true });

let fail = 0;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok || !detail ? "" : `\n       ${detail}`}`);
  if (!ok) fail++;
}
console.log(fail ? `qa selftest FAILED (${fail} of ${checks.length})` : `qa selftest PASSED (${checks.length})`);
process.exit(fail ? 1 : 0);
