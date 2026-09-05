#!/usr/bin/env node
/**
 * selftest.mjs — the proof for phase 0's DoD. Runs gates on both fixtures and asserts the counts.
 *   node selftest.mjs        exit 0 pass | 1 fail
 */
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runGates } from "./gates.mjs";

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

const checks = [
  ["clean: 0 errors", clean.counts.error === 0],
  ["clean: 0 limits", clean.counts.limit === 0],
  ["dirty: 8 errors", dirty.counts.error === 8],
  ["dirty: every core gate fires", expectDirty.every((g) => firedDirty.has(g))],
  ["dirty: 1 LIMIT for a check no script implements", dirty.counts.limit === 1],
  ["cli: gates.mjs prints and exits 1 on dirty", (() => { const r = cli("gates.mjs", ["--state-dir", fx("dirty")]); return r.code === 1 && r.out.includes("error=8") && r.out.includes("limit=1"); })()],
];
let fail = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) fail++;
}
console.log(fail ? `selftest FAILED (${fail})` : "selftest PASSED");
process.exit(fail ? 1 : 0);
