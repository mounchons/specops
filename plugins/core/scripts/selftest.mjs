#!/usr/bin/env node
/**
 * selftest.mjs — the proof for phase 0's DoD. Runs gates on both fixtures and asserts the counts,
 * then the other half of the plugin contract: the callsheet. A NEXT rule is handed the ctx
 * CLAUDE.md promises CHECKS (`state` included), and a rule that throws costs one row, not the whole
 * callsheet — phase 6 found that one the hard way, with qa's first NEXT rule reading ctx.state.
 *   node selftest.mjs        exit 0 pass | 1 fail
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runGates } from "./gates.mjs";
import { computeNext } from "./next.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (n) => path.resolve(here, "..", "fixtures", n, ".sdlc");

/** Run a core script the way a user does — through node — and capture output + exit code. */
function cli(script, args) {
  try {
    return { out: execFileSync("node", [path.join(here, script), ...args], { encoding: "utf8" }), code: 0 };
  } catch (e) {
    return { out: (e.stdout ?? "") + (e.stderr ?? ""), code: e.status ?? 1 };
  }
}

const clean = await runGates(fx("clean"));
const dirty = await runGates(fx("dirty"));
const firedDirty = new Set(dirty.results.filter((r) => r.severity === "error").map((r) => r.gate));
const expectDirty = ["G-core-001", "G-core-002", "G-core-003", "G-core-004", "G-core-005", "G-core-006", "G-core-007", "G-core-008"];

// ---- the callsheet contract: a fake plugin whose first NEXT rule reads ctx.state and whose second throws
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "specops-core-next-"));
const S = path.join(tmp, ".sdlc");
fs.cpSync(fx("clean"), S, { recursive: true });
const pluginRoot = path.join(tmp, "faulty");
fs.mkdirSync(path.join(pluginRoot, "scripts"), { recursive: true });
fs.writeFileSync(
  path.join(pluginRoot, "scripts", "checks.mjs"),
  [
    "export const CHECKS = {};",
    "export const NEXT = [",
    '  (ctx) => [{ action: "reads ctx.state", reason: String(ctx.state.artifacts.length) + " artifact(s)" }],',
    "  () => { throw new TypeError(\"Cannot read properties of undefined (reading 'artifacts')\"); },",
    "];",
    "",
  ].join("\n"),
  "utf8"
);
const projectFile = path.join(S, "project.json");
const project = JSON.parse(fs.readFileSync(projectFile, "utf8"));
project.plugins.faulty = { root: pluginRoot, version: "0.0.0" };
fs.writeFileSync(projectFile, JSON.stringify(project, null, 2), "utf8");

let nextActions = null;
let nextThrew = null;
try {
  nextActions = await computeNext(S, { all: true });
} catch (e) {
  nextThrew = e.message;
}
const nextCli = cli("next.mjs", ["--state-dir", S, "--all"]);
fs.rmSync(tmp, { recursive: true, force: true });

const checks = [
  ["clean: 0 errors", clean.counts.error === 0],
  ["clean: 0 limits", clean.counts.limit === 0],
  ["dirty: 8 errors", dirty.counts.error === 8],
  ["dirty: every core gate fires", expectDirty.every((g) => firedDirty.has(g))],
  ["dirty: 1 LIMIT for a check no script implements", dirty.counts.limit === 1],
  ["cli: gates.mjs prints and exits 1 on dirty", (() => { const r = cli("gates.mjs", ["--state-dir", fx("dirty")]); return r.code === 1 && r.out.includes("error=8") && r.out.includes("limit=1"); })()],
  ["next: a plugin NEXT rule is handed ctx.state, as CLAUDE.md promises CHECKS", !nextThrew && (nextActions ?? []).some((a) => a.action === "reads ctx.state" && /^[0-9]+ artifact\(s\)$/.test(a.reason))],
  ["next: a throwing NEXT rule costs one row and names its plugin — the callsheet still answers", !nextThrew && (nextActions ?? []).some((a) => a.action.startsWith("fix faulty's NEXT rule — it threw:"))],
  ["cli: next.mjs exits 0 with a broken rule installed", nextCli.code === 0 && /fix faulty's NEXT rule/.test(nextCli.out)],
];
let fail = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) fail++;
}
console.log(fail ? `selftest FAILED (${fail})` : "selftest PASSED");
process.exit(fail ? 1 : 0);
