#!/usr/bin/env node
/**
 * selftest.mjs — the proof for phase 4.
 *
 *   1. no check fires on the clean fixture
 *   2. every mock check fires on the dirty fixture — a gate that cannot go red is not a gate
 *   3. the commands, run through node into a throwaway state dir: a real design to draw from, a
 *      theme the owner answered, a wireframe per screen, a signed baseline, and the two refusals
 *      the baseline exists for — a signed drawing that changed, and a screen an open CR froze
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
import { hashOf } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const core = (s) => path.resolve(here, "..", "..", "core", "scripts", s);
const req = (s) => path.resolve(here, "..", "..", "req", "scripts", s);
const dsn = (s) => path.resolve(here, "..", "..", "design", "scripts", s);
const chg = (s) => path.resolve(here, "..", "..", "change", "scripts", s);
const mk = (s) => path.join(here, s);
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
assert("dirty fixture: only mock gates fire, core stays clean", noisy(fired(fx("dirty"), CORE_CHECKS)).length === 0, noisy(fired(fx("dirty"), CORE_CHECKS)).map(([n, f]) => `${n}: ${f[0].message}`).join(" | "));

// ---- 3: the commands, for real ---------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "specops-mock-selftest-"));
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
step("mock init", mk("init.mjs"), ["--state-dir", S]);

// theme comes first, and wireframe says so
const noTheme = step("wireframe before theme refused", mk("wireframe.mjs"), ["customer", "--state-dir", S]);
const asked = step("theme questions", mk("theme.mjs"), ["--state-dir", S]);
const missingKey = step("theme with a key left out refused", mk("theme.mjs"), ["--state-dir", S, "--records", w("half.json", { by: "STK-001", tokens: { "color.primary": "#198754" } })]);
const themed = step("theme", mk("theme.mjs"), ["--state-dir", S, "--records", w("theme.json", { by: "STK-001", tokens: {
  "color.primary": "#198754", "color.surface": "default", "color.text": "default", "spacing.unit": "8", radius: "0", "font.family": "default", "font.scale": "16",
} })]);

const reg0 = buildRegistry(S);
const customerUis = Object.entries(reg0.index).filter(([id, r]) => id.startsWith("UI-") && r.app === "customer").map(([id]) => id);
const backofficeUi = Object.entries(reg0.index).find(([id, r]) => id.startsWith("UI-") && r.app === "backoffice")?.[0];
const borrower = Object.entries(reg0.index).find(([id, r]) => id.startsWith("ENT-") && r.title === "Borrower")?.[0];

const drew = step("wireframe customer", mk("wireframe.mjs"), ["customer", "--state-dir", S]);
const again = step("wireframe customer again", mk("wireframe.mjs"), ["customer", "--state-dir", S]);

// approve: the two refusals that make a baseline mean something
const noSign = step("approve without --sign refused", mk("approve.mjs"), ["customer", "--state-dir", S, "--evidence", w("sig.json", { by: "STK-001" })]);
const ghostEvidence = step("approve with evidence that does not exist refused", mk("approve.mjs"), ["customer", "--state-dir", S, "--sign", "STK-001", "--evidence", path.join(tmp, "nope.pdf")]);
const evidence = w("signoff.json", { signedBy: "STK-001", at: "2026-09-05" });
const holes = cli(mk("approve.mjs"), ["backoffice", "--state-dir", S, "--sign", "STK-001", "--evidence", evidence]);
const signed = step("approve customer", mk("approve.mjs"), ["customer", "--state-dir", S, "--sign", "STK-001", "--evidence", evidence]);

// a signed drawing that changed
const first = JSON.parse(fs.readFileSync(path.join(S, "mock", "customer", "MCK-loan-001.json"), "utf8"));
const untouched = JSON.stringify(first, null, 2);
const edited = JSON.parse(untouched);
edited.zones.find((z) => z.controls.length)?.controls.forEach((c) => { c.testid = `${c.testid}-x`; });
fs.writeFileSync(path.join(S, "mock", "customer", "MCK-loan-001.json"), JSON.stringify(edited, null, 2), "utf8");
const redAfterEdit = cli(core("gates.mjs"), ["--state-dir", S]);
const redraw = cli(mk("wireframe.mjs"), ["customer", "--state-dir", S]);
fs.writeFileSync(path.join(S, "mock", "customer", "MCK-loan-001.json"), untouched, "utf8");
const greenAgain = cli(core("gates.mjs"), ["--state-dir", S]);

// a screen an open CR froze
step("open CR", chg("open.mjs"), ["--state-dir", S, "--kind", "display", "--source", "client", "--title", "เพิ่มเบอร์โทร", "--request", "อยากเห็นเบอร์โทร", "--touches", backofficeUi, "--fields", `${borrower}.phone`]);
const frozen = cli(mk("wireframe.mjs"), ["backoffice", "--state-dir", S]);
const withCr = step("wireframe the frozen screen with --cr", mk("wireframe.mjs"), ["backoffice", backofficeUi, "--state-dir", S, "--cr", "CR-001"]);
const sync = step("sync-design", mk("sync-design.mjs"), ["customer", "--state-dir", S]);
const green = step("gates", core("gates.mjs"), ["--state-dir", S]);

const REFUSALS = new Set(["wireframe before theme refused", "theme with a key left out refused", "approve without --sign refused", "approve with evidence that does not exist refused"]);
const broke = steps.filter(([l, r]) => (REFUSALS.has(l) ? r.code !== 2 : r.code !== 0));
assert("live: every command exits 0, every refusal exits 2", broke.length === 0, broke.map(([l, r]) => `${l} -> ${r.code}: ${r.out.trim().split("\n")[0]}`).join(" | "));

const mckFiles = fs.readdirSync(path.join(S, "mock", "customer")).filter((f) => f.endsWith(".json"));
const html = fs.readFileSync(path.join(S, "mock", "customer", "MCK-loan-001.html"), "utf8");
const doc = fs.readdirSync(path.join(S, "export")).find((f) => f.startsWith("mock-baseline-customer@"));

assert("live: nothing is drawn before the tokens are decided", /no theme yet/.test(noTheme.out), noTheme.out.trim().split("\n").pop());
assert("live: the seven questions are put to the owner with their defaults", (asked.out.match(/default:/g) ?? []).length === 7, asked.out.split("\n").filter((l) => /default:/.test(l)).length + " question(s)");
assert("live: a key left out is refused, because a token nobody chose gets chosen later", /silence is not/.test(missingKey.out), missingKey.out.trim().split("\n").pop());
assert('live: "default" is recorded as an answer, not as silence', /color\.surface\s+#ffffff\s+default/.test(themed.out) && /color\.primary\s+#198754\s+owner/.test(themed.out), themed.out.split("\n").filter((l) => /color\./.test(l)).join(" · "));
assert("live: one wireframe per screen of the app", mckFiles.length === customerUis.length && new RegExp(`created ${customerUis.length}`).test(drew.out), `${mckFiles.length} mck vs ${customerUis.length} screens · ${drew.out.trim().split("\n")[0]}`);
assert("live: every control carries a data-testid bound to a declared field or action", /data-testid="action-/.test(html) && !/data-testid=""/.test(html), (html.match(/data-testid="[^"]*"/g) ?? []).slice(0, 3).join(" "));
assert("live: the theme's colour reaches the page rather than being hard-coded", /--mck-primary: #198754/.test(html), html.split("\n").find((l) => /mck-primary/.test(l)) ?? "");
assert("live: a screen that declares no fields is printed as such, not padded", /no field declared by the design/.test(drew.out), drew.out.split("\n").find((l) => /no field declared/.test(l)) ?? "");
assert("live: re-running creates nothing and re-renders everything", /created 0/.test(again.out) && new RegExp(`already there ${customerUis.length}`).test(again.out), again.out.trim().split("\n")[0]);
assert("live: a baseline with holes is not a scope", holes.code === 1 && /CANNOT APPROVE/.test(holes.out) && /no wireframe/.test(holes.out), holes.out.trim().split("\n").slice(0, 2).join(" · "));
assert("live: approve signs every drawing with its hash and writes the document the client reads", /wireframe\(s\) signed by STK-001/.test(signed.out) && Boolean(doc), `${signed.out.trim().split("\n")[0]} · ${doc ?? "no baseline document"}`);
assert("live: the signed hash is the hash of the drawing, so signing does not change it", JSON.parse(fs.readFileSync(path.join(S, "mock", "customer", "MCK-loan-001.json"), "utf8")).signed.hash === hashOf(JSON.parse(fs.readFileSync(path.join(S, "mock", "customer", "MCK-loan-001.json"), "utf8"))), "signed.hash != hashOf(record)");
assert("live: editing a signed drawing turns G-mock-003 red and names the file", redAfterEdit.code === 1 && /G-mock-003/.test(redAfterEdit.out) && /MCK-loan-001/.test(redAfterEdit.out), redAfterEdit.out.split("\n").find((l) => /G-mock-003/.test(l)) ?? "");
assert("live: wireframe refuses to redraw a signed screen without a CR", redraw.code === 1 && /signed by STK-001/.test(redraw.out), redraw.out.split("\n").find((l) => /signed by/.test(l)) ?? redraw.out.trim().split("\n").pop());
assert("live: putting the file back turns it green again", greenAgain.code === 0, greenAgain.out.trim().split("\n").pop());
assert("live: a screen an open CR froze is not drawn", frozen.code === 1 && frozen.out.includes(backofficeUi) && /frozen by CR-001/.test(frozen.out), frozen.out.split("\n").find((l) => /frozen by/.test(l)) ?? frozen.out.trim().split("\n").pop());
assert("live: --cr draws it and the wireframe records which change it was drawn under", withCr.code === 0 && JSON.parse(fs.readFileSync(path.join(S, "mock", "backoffice", fs.readdirSync(path.join(S, "mock", "backoffice")).find((f) => f.endsWith(".json") && JSON.parse(fs.readFileSync(path.join(S, "mock", "backoffice", f), "utf8")).ui === backofficeUi)), "utf8")).cr === "CR-001", withCr.out.trim().split("\n")[0]);
assert("live: sync-design writes prompts and says nothing reads them back", /LIMIT: no script sends these/.test(sync.out) && fs.existsSync(path.join(S, "mock", "customer", "design")), sync.out.trim().split("\n").pop());
assert("live: gates.mjs loads mock's checks through project.json", /gates=45/.test(green.out), green.out.trim().split("\n").pop());
assert("live: gates green with a signed baseline and an open CR", green.code === 0, green.out.trim().split("\n").pop());

fs.rmSync(tmp, { recursive: true, force: true });

let fail = 0;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok || !detail ? "" : `\n       ${detail}`}`);
  if (!ok) fail++;
}
console.log(fail ? `mock selftest FAILED (${fail} of ${checks.length})` : `mock selftest PASSED (${checks.length})`);
process.exit(fail ? 1 : 0);
