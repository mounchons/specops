#!/usr/bin/env node
/**
 * selftest.mjs — the proof for phase 5.
 *
 *   1. no check fires on the clean fixture
 *   2. every dev check fires on the dirty fixture — a gate that cannot go red is not a gate
 *   3. the commands, run through node into a throwaway state dir with a real git repository: a
 *      stack the owner answered, two slices planned in order, one taken from the printed slice to a
 *      commit, three failed verifies that block the second, and the Class A / Class B line
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
import { CHECKS, NEXT, goldenMisses } from "./checks.mjs";
import { byBuildOrder, originOf } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const core = (s) => path.resolve(here, "..", "..", "core", "scripts", s);
const req = (s) => path.resolve(here, "..", "..", "req", "scripts", s);
const dsn = (s) => path.resolve(here, "..", "..", "design", "scripts", s);
const chg = (s) => path.resolve(here, "..", "..", "change", "scripts", s);
const dev = (s) => path.join(here, s);
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
assert("dirty fixture: only dev gates fire, core stays clean", noisy(fired(fx("dirty"), CORE_CHECKS)).length === 0, noisy(fired(fx("dirty"), CORE_CHECKS)).map(([n, f]) => `${n}: ${f[0].message}`).join(" | "));

// the answer key is matched on whole numbers: 800 is not found inside 2800
const gd = { id: "GD-x-001", rows: [{ label: "row", expected: { fee: 800 } }] };
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "specops-dev-gd-"));
fs.writeFileSync(path.join(tmpDir, "a.js"), "assert(fee === 2800)");
fs.writeFileSync(path.join(tmpDir, "b.js"), "assert(fee === 800)");
assert("golden values match on whole numbers, not on substrings", goldenMisses({ path: "a.js", golden: ["GD-x-001"] }, new Map([["GD-x-001", gd]]), tmpDir).length === 1 && goldenMisses({ path: "b.js", golden: ["GD-x-001"] }, new Map([["GD-x-001", gd]]), tmpDir).length === 0, "2800 must not satisfy 800");
fs.rmSync(tmpDir, { recursive: true, force: true });

// ---- 3: the commands, for real ---------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "specops-dev-selftest-"));
const S = path.join(tmp, ".sdlc");
const w = (n, o) => { const f = path.join(tmp, n); fs.writeFileSync(f, JSON.stringify(o, null, 2), "utf8"); return f; };
const src = (rel, text) => { const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text, "utf8"); return f; };
const git = (...args) => execFileSync("git", ["-c", "user.email=selftest@specops", "-c", "user.name=selftest", ...args], { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const steps = [];
const step = (label, script, args) => {
  const r = cli(script, args);
  steps.push([label, r]);
  return r;
};

step("core init", core("init.mjs"), ["--name", "t", "--apps", "backoffice:backoffice-web", "--state-dir", S]);
step("req init", req("init.mjs"), ["--state-dir", S, "--module", "loan"]);
step("capture", req("capture.mjs"), ["loan", "--state-dir", S, "--text", "ลูกค้ายื่นขอสินเชื่อ เจ้าหน้าที่อนุมัติ", "--records", w("cap.json", {
  stakeholders: [{ key: "officer", title: "เจ้าหน้าที่", role: "officer" }, { key: "cust", title: "ลูกค้า", role: "customer" }],
  requirements: [{ actor: "@cust", goal: "ยื่นขอสินเชื่อ" }, { kind: "NFR", actor: "@officer", goal: "audit ต้องอ่านย้อนหลังได้ 2 ปี" }],
})]);
step("rule", req("rules.mjs"), ["loan", "--state-dir", S, "--br", "วงเงินไม่เกิน 5 เท่าของรายได้", "--from", "REQ-loan-001"]);
step("example", req("rules.mjs"), ["loan", "--state-dir", S, "--ex", "BR-loan-001@v1", "--given", "รายได้ 30,000", "--when", "ขอ 200,000", "--then", "ระบบปฏิเสธ วงเงินสูงสุด 150,000"]);
step("design init", dsn("init.mjs"), ["--state-dir", S]);
step("domain", dsn("domain.mjs"), ["loan", "--state-dir", S, "--records", w("domain.json", {
  entities: [{ key: "app", name: "LoanApplication", kind: "aggregate", attributes: ["amount"], invariants: ["BR-loan-001@v1"] }],
  stateMachines: [{ entity: "@app", states: [{ name: "draft" }, { name: "done", final: true }], transitions: [{ from: "draft", to: "done", by: "officer", enforces: ["BR-loan-001@v1"] }] }],
})]);
const ac = { flow: "main", given: "รายได้ 30,000", when: "ขอ 200,000", then: "ระบบปฏิเสธ วงเงินสูงสุด 150,000", from: "EX-loan-001" };
step("usecase", dsn("usecase.mjs"), ["loan", "--state-dir", S, "--records", w("uc.json", { usecases: [
  { key: "apply", title: "ยื่นขอสินเชื่อ", actor: "STK-002", apps: ["backoffice"], satisfies: ["REQ-loan-001"], flows: { main: [{ step: "กรอกวงเงิน", enforces: ["BR-loan-001@v1"] }] }, acceptance: [ac] },
  { key: "approve", title: "อนุมัติสินเชื่อ", actor: "STK-001", apps: ["backoffice"], satisfies: ["REQ-loan-001"], flows: { main: [{ step: "ตรวจแล้วกดอนุมัติ สถานะ draft → done", enforces: ["BR-loan-001@v1"] }] }, acceptance: [ac] },
] })]);
step("screens", dsn("screens.mjs"), ["loan", "--state-dir", S]);
step("api", dsn("api.mjs"), ["loan", "--state-dir", S]);
step("rbac", dsn("rbac.mjs"), ["--state-dir", S, "--records", w("rbac.json", {
  roles: [{ key: "officer", title: "เจ้าหน้าที่", stk: "STK-001", apps: ["backoffice"] }],
  grants: [{ role: "@officer", ui: "*", allow: ["view", "create", "edit"], dataScope: "all" }],
})]);
step("scenario", dsn("scenario.mjs"), ["loan", "--state-dir", S]);
step("change init", chg("init.mjs"), ["--state-dir", S]);
step("dev init", dev("init.mjs"), ["--state-dir", S]);

// a real repository: a task closes on a commit
src("verify.mjs", `import fs from "node:fs";\nprocess.exit(fs.existsSync("FAIL") ? 1 : 0);\n`);
src("README.md", "selftest\n");
git("init", "-q");
git("add", "-A");
git("commit", "-qm", "initial");

const asked = step("stack questions", dev("stack.mjs"), ["--state-dir", S]);
const oneApp = { language: "javascript", framework: "node", version: "22", orm: "none", db: "sqlite", testRunner: "node:test", skills: "api-design", run: { compose: "docker-compose.yml", up: "docker compose up -d", down: "docker compose down -v", healthcheck: "curl -fsS http://localhost:8080/health", test: "node verify.mjs" }, config: { env: "DB_URL", secrets: "DB_PASSWORD" } };
const missingApp = step("stack without every app refused", dev("stack.mjs"), ["--state-dir", S, "--confirmed-by", "STK-001", "--records", w("half.json", { components: { api: { ...oneApp, root: "src" } } })]);
const stacked = step("stack", dev("stack.mjs"), ["--state-dir", S, "--confirmed-by", "STK-001", "--records", w("stack.json", { components: { api: { ...oneApp, root: "src" }, backoffice: { ...oneApp, root: "web" } } })]);

const planned = step("plan", dev("plan.mjs"), ["loan", "--state-dir", S]);
const planAgain = step("plan again", dev("plan.mjs"), ["loan", "--state-dir", S]);
// what dev would put on the callsheet the moment the plan exists — every task still draft
const devNext = NEXT.flatMap((r) => r({ stateDir: S, project: readJson(CORE_FILES.project(S)), state: loadState(S), registry: buildRegistry(S) })).find((a) => /\/dev:task/.test(a.action));
const started = step("task TSK-001 --start", dev("task.mjs"), ["TSK-001", "--state-dir", S, "--start"]);
const closeNoProof = step("close with no proof refused", dev("task.mjs"), ["TSK-001", "--state-dir", S, "--close"]);

src("src/limit.mjs", `export const maxLimit = (income) => income * 5;\n`);
src("src/limit.test.mjs", `import test from "node:test";\nimport assert from "node:assert";\nimport { maxLimit } from "./limit.mjs";\ntest("cap", () => assert.equal(maxLimit(30000), 150000));\n`);
const implied = step("impl", dev("task.mjs"), ["TSK-001", "--state-dir", S, "--impl", "src/limit.mjs=source,src/limit.test.mjs=test"]);
const verified = step("verify", dev("task.mjs"), ["TSK-001", "--state-dir", S, "--verify"]);
const closeDirty = cli(dev("task.mjs"), ["TSK-001", "--state-dir", S, "--close"]);
git("add", "-A");
git("commit", "-qm", "feat: วงเงินสูงสุด (TSK-001)");
const closed = step("close", dev("task.mjs"), ["TSK-001", "--state-dir", S, "--close"]);

const handoffEarly = cli(dev("handoff.mjs"), ["loan", "--state-dir", S]);

// the second slice: three red runs block it, and a green one lets it go
step("task TSK-002 --start", dev("task.mjs"), ["TSK-002", "--state-dir", S, "--start"]);
src("src/approve.mjs", `export const approve = (id) => ({ id, status: "done" });\n`);
step("impl 2", dev("task.mjs"), ["TSK-002", "--state-dir", S, "--impl", "src/approve.mjs=source"]);
fs.writeFileSync(path.join(tmp, "FAIL"), "");
const red = [1, 2, 3].map(() => cli(dev("task.mjs"), ["TSK-002", "--state-dir", S, "--verify"]));
fs.rmSync(path.join(tmp, "FAIL"));
const startBlocked = cli(dev("task.mjs"), ["TSK-002", "--state-dir", S, "--start"]);
const green = step("verify 2 after the fix", dev("task.mjs"), ["TSK-002", "--state-dir", S, "--verify"]);
git("add", "-A");
git("commit", "-qm", "feat: อนุมัติ (TSK-002)");
step("close 2", dev("task.mjs"), ["TSK-002", "--state-dir", S, "--close"]);

// The screens no use case produced — login, profile, the masters, the NFR page — are tasks too, and
// they go through the same four steps. There is no second lane: the manifest is only writable once
// they are built as well, which is the point of planning them in the first place.
const tasksNow = () => fs.readdirSync(path.join(S, "dev", "tasks", "loan")).flatMap((f) => JSON.parse(fs.readFileSync(path.join(S, "dev", "tasks", "loan", f), "utf8")).items);
const rest = tasksNow().filter((t) => t.status === "draft").sort(byBuildOrder);
const screenStart = step(`task ${rest[0]?.id} --start`, dev("task.mjs"), [rest[0]?.id ?? "TSK-003", "--state-dir", S, "--start"]);
for (const t of rest) {
  if (t.id !== rest[0].id) step(`start ${t.id}`, dev("task.mjs"), [t.id, "--state-dir", S, "--start"]);
  src(`src/${t.id}.mjs`, `export const ok = () => true;\n`);
  step(`impl ${t.id}`, dev("task.mjs"), [t.id, "--state-dir", S, "--impl", `src/${t.id}.mjs=source`]);
  step(`verify ${t.id}`, dev("task.mjs"), [t.id, "--state-dir", S, "--verify"]);
  git("add", "-A");
  git("commit", "-qm", `feat: ${t.title} (${t.id})`);
  step(`close ${t.id}`, dev("task.mjs"), [t.id, "--state-dir", S, "--close"]);
}
const handed = step("handoff", dev("handoff.mjs"), ["loan", "--state-dir", S]);

// Class A / Class B
const reg = buildRegistry(S);
const ui = Object.entries(reg.index).find(([id, r]) => id.startsWith("UI-") && (r.title ?? "").includes("ยื่นขอ"))?.[0];
const login = Object.entries(reg.index).find(([id, r]) => id.startsWith("UI-") && (r.title ?? "").includes("เข้าสู่ระบบ"))?.[0];
const classB = step("revise Class B", dev("revise.mjs"), [ui, "--state-dir", S, "--field", "note", "--request", "ขอช่องหมายเหตุในหน้ายื่นขอ"]);
const classA = step("revise Class A", dev("revise.mjs"), [ui, "--state-dir", S, "--action", "submit"]);
step("open CR on a screen no task owns", chg("open.mjs"), ["--state-dir", S, "--kind", "screen", "--source", "client", "--title", "แก้หน้า login", "--request", "ขอแก้หน้าเข้าสู่ระบบ", "--app", "backoffice", "--touches", login]);
const frozenRevise = step("revise a frozen screen refused", dev("revise.mjs"), [login, "--state-dir", S, "--field", "captcha"]);
// A file that is not source in any language but decides whether the thing runs. Nobody claims it,
// so the sweep has to say so — before this it only looked at .mjs and a Dockerfile was invisible.
src("src/package.json", `{ "name": "loan", "type": "module" }\n`);
const gates = step("gates", core("gates.mjs"), ["--state-dir", S]);

const REFUSALS = new Set(["stack without every app refused", "close with no proof refused", "revise a frozen screen refused"]);
const broke = steps.filter(([l, r]) => (REFUSALS.has(l) ? r.code !== 2 : r.code !== 0));
assert("live: every command exits 0, every refusal exits 2", broke.length === 0, broke.map(([l, r]) => `${l} -> ${r.code}: ${r.out.trim().split("\n")[0]}`).join(" | "));

const taskDir = path.join(S, "dev", "tasks", "loan");
const taskFiles = fs.existsSync(taskDir) ? fs.readdirSync(taskDir).sort() : [];
const tsk1 = taskFiles.flatMap((f) => JSON.parse(fs.readFileSync(path.join(taskDir, f), "utf8")).items);
const gapFile = path.join(S, "dev", "gaps.json");
assert("live: the stack is asked, never guessed", /language/.test(asked.out) && /ยังไม่มี CMP/.test(asked.out), asked.out.trim().split("\n").pop());
assert("live: an app with no stack is refused", /no stack for backoffice/.test(missingApp.out), missingApp.out.trim().split("\n").pop());
assert("live: one component per app plus the shared backend", /CMP-api/.test(stacked.out) && /CMP-backoffice/.test(stacked.out) && /LIMIT/.test(stacked.out), stacked.out.split("\n").filter((l) => /CMP-/.test(l)).join(" · "));
assert("live: one task per use case, ordered, with acceptance and a verify command", /TSK-001/.test(planned.out) && /UC-loan-001/.test(planned.out) && /verify for every task: node verify.mjs/.test(planned.out), planned.out.split("\n").filter((l) => /TSK-/.test(l)).join(" · "));
assert("live: the state machine's arrow becomes a dependency, and the rest say so", /no state transition in the design's steps/.test(planned.out), planned.out.split("\n").find((l) => /no state transition/.test(l)) ?? "");
assert("live: plan is idempotent", /created 0/.test(planAgain.out), planAgain.out.trim().split("\n")[0]);
assert("live: one file per task, so a module's tasks never grow into the one file rule 4 refuses", taskFiles.length === tsk1.length && taskFiles.every((f) => /^TSK-[0-9]{3}\.json$/.test(f)), `dev/tasks/loan/ holds ${taskFiles.join(", ") || "(nothing)"}`);

// A screen the baseline generator made is work nobody wrote a use case for, and before this the plan
// walked past all of it: 15 of RentPoint's 28 screens, login among them.
const screenTsks = tsk1.filter((t) => originOf(t) !== "usecase");
const ucTsks = tsk1.filter((t) => originOf(t) === "usecase");
assert("live: plan mints a task for the screens no use case produced", screenTsks.length > 0 && screenTsks.every((t) => t.usecase === null && t.acceptance.length === 0 && t.acls.length > 0), screenTsks.map((t) => `${t.id} ${originOf(t)}/${t.group} ${t.screens.length} UI ${t.acls.length} ACL`).join(" · ") || "no screen task");
assert("live: one task per capability, not per screen", screenTsks.some((t) => t.group === "login") && new Set(screenTsks.map((t) => `${originOf(t)}/${t.group}`)).size === screenTsks.length, screenTsks.map((t) => `${originOf(t)}/${t.group}`).join(" · "));
const ranked = [...tsk1].sort(byBuildOrder);
const rank = (t) => ["baseline", "master", "usecase", "nfr"].indexOf(originOf(t));
assert("live: build order puts sign-in before every use case, because nothing can be done signed out", ucTsks.length > 0 && ranked[0]?.group === "login" && ranked.every((t, i) => i === 0 || rank(ranked[i - 1]) <= rank(t)), ranked.map((t) => `${t.id}:${originOf(t)}`).join(" "));
assert("live: the slice of a screen task names the apps and their sign-in, and asks for no use case", /no use case:/.test(screenStart.out) && /signs in with/.test(screenStart.out) && /ACL-/.test(screenStart.out) && screenStart.code === 0, screenStart.out.split("\n").find((l) => /no use case:/.test(l)) ?? screenStart.out.trim().split("\n")[0]);
assert("live: the callsheet starts the build at sign-in, not at the first use case", devNext?.action === `/dev:task ${ranked[0]?.id} --start`, `${devNext?.action ?? "no /dev:task action"} — ${devNext?.reason ?? ""}`);
assert("live: --start prints the slice, acceptance verbatim and the golden section", /SLICE TSK-001/.test(started.out) && /ระบบปฏิเสธ วงเงินสูงสุด 150,000/.test(started.out) && /— verify —/.test(started.out), started.out.split("\n").find((l) => /AC-loan-001/.test(l)) ?? "");
assert("live: a task with no proof cannot close", /has no proof/.test(closeNoProof.out), closeNoProof.out.trim().split("\n").pop());
assert("live: every file is claimed by an IMP under its component", /IMP-001/.test(implied.out) && /CMP-api/.test(implied.out), implied.out.split("\n").filter((l) => /IMP-/.test(l)).join(" · "));
assert("live: verify runs the command and records what it said", /exit 0/.test(verified.out) && /node verify.mjs/.test(verified.out), verified.out.trim().split("\n")[0]);
assert("live: an uncommitted tree cannot close — the person commits, not the script", closeDirty.code === 1 && /uncommitted change/.test(closeDirty.out), closeDirty.out.split("\n").find((l) => /uncommitted/.test(l)) ?? "");
assert("live: close records the commit that carries the task id", /CLOSE TSK-001/.test(closed.out) && /TSK-001/.test(closed.out) && tsk1.find((t) => t.id === "TSK-001")?.commit, closed.out.split("\n").find((l) => /commit/.test(l)) ?? "");
assert("live: handoff refuses while a task is unproved", handoffEarly.code === 1 && /TSK-002/.test(handoffEarly.out), handoffEarly.out.trim().split("\n")[0]);
assert("live: three red runs block the task and a fourth is refused", red.every((r) => r.code === 1) && /BLOCKED after 3/.test(red[2].out) && startBlocked.code === 2, red[2].out.trim().split("\n").pop());
assert("live: a green run clears the block", green.code === 0 && /exit 0/.test(green.out), green.out.trim().split("\n")[0]);
assert("live: handoff writes the manifest qa reads", /HANDOFF loan/.test(handed.out) && fs.existsSync(path.join(S, "export", "handoff-loan.md")), handed.out.trim().split("\n")[0]);
assert("live: the manifest carries acceptance, testids and the golden rows", /given รายได้ 30,000/.test(fs.readFileSync(path.join(S, "export", "handoff-loan.md"), "utf8")), "handoff-loan.md");
assert("live: Class B writes a GAP and the /change:open line, and no code", /CLASS B/.test(classB.out) && /\/change:open/.test(classB.out) && fs.existsSync(gapFile) && !fs.existsSync(path.join(tmp, "src", "note.mjs")), classB.out.split("\n").find((l) => /change:open/.test(l)) ?? "");
assert("live: Class B says where it looked", /looked in .*fields\[\]/.test(classB.out), classB.out.split("\n").find((l) => /looked in/.test(l)) ?? "");
assert("live: Class A reopens the task instead of asking upstream", /CLASS A/.test(classA.out) && /origin "changed"/.test(classA.out), classA.out.trim().split("\n").filter(Boolean).pop());
assert("live: a frozen screen cannot be revised", /frozen by CR-001/.test(frozenRevise.out), frozenRevise.out.trim().split("\n").pop());
assert("live: the orphan sweep counts the files that decide whether it runs, not only source", /G-dev-005/.test(gates.out) && /src\/package\.json/.test(gates.out), gates.out.split("\n").find((l) => /G-dev-005/.test(l))?.slice(0, 160) ?? "G-dev-005 did not fire");
assert("live: one file per implementation unit, so a slice of 22 files cannot cross rule 4", fs.readdirSync(path.join(S, "dev", "impl")).every((n) => fs.statSync(path.join(S, "dev", "impl", n)).isDirectory()) && fs.readdirSync(path.join(S, "dev", "impl", "TSK-001")).every((n) => /^IMP-[0-9]{3}\.json$/.test(n)), fs.readdirSync(path.join(S, "dev", "impl")).map((n) => `${n}/${fs.readdirSync(path.join(S, "dev", "impl", n)).join(",")}`).join(" · "));
assert("live: gates.mjs loads dev's checks through project.json — 10 core + 10 req + 16 design + 6 change + 8 dev", /gates=50/.test(gates.out), gates.out.trim().split("\n").pop());
assert("live: the skill gate is a LIMIT that prints every run and never blocks", /limit=1/.test(gates.out) && /LIMIT.*G-dev-008/.test(gates.out) && gates.code === 0, gates.out.split("\n").find((l) => /G-dev-008/.test(l)) ?? gates.out.trim().split("\n").pop());

fs.rmSync(tmp, { recursive: true, force: true });

let fail = 0;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok || !detail ? "" : `\n       ${detail}`}`);
  if (!ok) fail++;
}
console.log(fail ? `dev selftest FAILED (${fail} of ${checks.length})` : `dev selftest PASSED (${checks.length})`);
process.exit(fail ? 1 : 0);
