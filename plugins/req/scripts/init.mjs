#!/usr/bin/env node
/**
 * init.mjs — how req plugs in. Not a command: every req command calls ensureInit() first, and
 * running it twice changes nothing.
 *
 *   node init.mjs [--state-dir X] [--module rental]
 *
 * Writes project.json → plugins.req.root (so gates.mjs and next.mjs can find checks.mjs) and
 * appends the G-req gates to gates.json, which stays the only home of gates (rule 3).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, resolveStateDir, stateExists, CORE_FILES, readJson, writeJson, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { requireModule } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REQ_ROOT = process.env.CLAUDE_PLUGIN_ROOT ?? path.resolve(here, "..");
export const VERSION = "0.1.0";

export const REQ_GATES = [
  { id: "G-req-001", plugin: "req", check: "req:req-actor-goal", severity: "error", rule: "every REQ has a non-empty actor and goal" },
  { id: "G-req-002", plugin: "req", check: "req:actor-is-stk", severity: "error", rule: "every REQ.actor is an existing STK" },
  { id: "G-req-003", plugin: "req", check: "req:br-has-example", severity: "error", rule: "every BR@v that is not retired has at least one EX" },
  { id: "G-req-004", plugin: "req", check: "req:ex-cap", severity: "error", rule: "no BR@v has more than 5 EX" },
  { id: "G-req-005", plugin: "req", check: "req:calc-pins-one-br", severity: "error", rule: "a CALC pins exactly one BR version" },
  { id: "G-req-006", plugin: "req", check: "req:golden-match", severity: "error", rule: "re-running the golden script reproduces every expected value in the GD" },
  { id: "G-req-007", plugin: "req", check: "req:golden-signed", severity: "error", rule: "a GD with status approved carries signedBy and evidence" },
  { id: "G-req-008", plugin: "req", check: "req:br-one-active", severity: "error", rule: "a BR or CALC lineage has at most one version that is not retired" },
  { id: "G-req-009", plugin: "req", check: "req:br-version-needs-cr", severity: "error", rule: "a new version of an approved BR or CALC names the CR that asked for it" },
  { id: "G-req-010", plugin: "req", check: "req:open-question", severity: "warn", rule: "open questions block CP1" },
];

/** Idempotent. Returns { registered, gatesAdded } so a caller can say what actually changed. */
export function ensureInit(stateDir) {
  orExit2(stateExists(stateDir), `no state dir at ${stateDir} — run core's init.mjs first`);
  const projectFile = CORE_FILES.project(stateDir);
  const project = readJson(projectFile);
  project.plugins ??= {};
  const registered = project.plugins.req?.root !== REQ_ROOT || project.plugins.req?.version !== VERSION;
  if (registered) {
    project.plugins.req = { root: REQ_ROOT, version: VERSION };
    writeJson(projectFile, project);
  }

  const gatesFile = CORE_FILES.gates(stateDir);
  const gates = readJson(gatesFile, { schemaVersion: "1.0", gates: [] });
  gates.gates ??= [];
  const have = new Set(gates.gates.map((g) => g.id));
  const added = REQ_GATES.filter((g) => !have.has(g.id));
  if (added.length) {
    gates.gates.push(...added);
    writeJson(gatesFile, gates);
  }
  return { registered, gatesAdded: added.length };
}

if (isMain(import.meta.url)) {
  const { flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  const { registered, gatesAdded } = ensureInit(stateDir);
  console.log(`INIT req  ${stateDir}`);
  console.log(`  plugins.req.root ${registered ? "written" : "already current"}  gates added ${gatesAdded} of ${REQ_GATES.length}`);
  if (typeof flags.module === "string") {
    requireModule(stateDir, flags.module, { create: true });
    console.log(`  module "${flags.module}" declared in project.json modules[]`);
  }
  process.exit(0);
}
