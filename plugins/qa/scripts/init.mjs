#!/usr/bin/env node
/**
 * init.mjs — how qa plugs in. Not a command: every qa command calls ensureInit() first,
 * and running it twice changes nothing.
 *
 *   node init.mjs [--state-dir X]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, resolveStateDir, stateExists, CORE_FILES, readJson, writeJson, orExit2, isMain } from "../../core/scripts/paths.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const QA_ROOT = process.env.CLAUDE_PLUGIN_ROOT ?? path.resolve(here, "..");
export const VERSION = "0.1.0";

/**
 * G-qa-007 and G-qa-008 name checks no function implements, on purpose: gates.mjs prints them as
 * LIMITs on every run (constitution rule 1). There is no browser runner here, and no script can
 * tell whether an end-to-end step is re-proving a unit test. The honest form of both rules is a
 * line that never passes silently and never blocks.
 */
export const QA_GATES = [
  { id: "G-qa-001", plugin: "qa", check: "qa:scn-without-tc", severity: "error", rule: "a scenario whose use case has a verified task and no test case covering it — built and never tested" },
  { id: "G-qa-002", plugin: "qa", check: "qa:tc-verified-needs-run", severity: "error", rule: "a test case at verified with no run in which it passed — a verdict is the output of a command, not a status somebody typed" },
  { id: "G-qa-003", plugin: "qa", check: "qa:def-routing-needs-cr", severity: "error", rule: "a finding routed to design or req with no change request — a defect whose root cause is the spec is a change, not a bug" },
  { id: "G-qa-004", plugin: "qa", check: "qa:evidence-missing", severity: "error", rule: "a run step or a finding names an evidence file that is not on disk" },
  { id: "G-qa-005", plugin: "qa", check: "qa:def-closed-needs-green-run", severity: "error", rule: "a finding at verified with no run after it was raised in which its test case passed — dev does not close a finding, a green run does" },
  { id: "G-qa-006", plugin: "qa", check: "qa:tc-not-runnable", severity: "warn", rule: "a test case that cannot be executed, with the records that stopped it — the handoff is incomplete somewhere upstream" },
  { id: "G-qa-007", plugin: "qa", check: "qa:ui-runner", severity: "limit", rule: "a step on a data-testid is recorded and skipped — there is no browser runner here, so a test case of only screen steps never passes by script" },
  { id: "G-qa-008", plugin: "qa", check: "qa:no-duplicate-unit", severity: "limit", rule: "an end-to-end step must not re-prove what a dev unit test already proves — no script can tell scope from text" },
];

/** Idempotent. Returns { registered, gatesAdded }. */
export function ensureInit(stateDir) {
  orExit2(stateExists(stateDir), `no state dir at ${stateDir} — run core's init.mjs first`);
  const projectFile = CORE_FILES.project(stateDir);
  const project = readJson(projectFile);
  project.plugins ??= {};
  const registered = project.plugins.qa?.root !== QA_ROOT || project.plugins.qa?.version !== VERSION;
  if (registered) {
    project.plugins.qa = { root: QA_ROOT, version: VERSION };
    writeJson(projectFile, project);
  }

  const gatesFile = CORE_FILES.gates(stateDir);
  const gates = readJson(gatesFile, { schemaVersion: "1.0", gates: [] });
  gates.gates ??= [];
  const have = new Set(gates.gates.map((g) => g.id));
  const added = QA_GATES.filter((g) => !have.has(g.id));
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
  console.log(`INIT qa  ${stateDir}`);
  console.log(`  plugins.qa.root ${registered ? "written" : "already current"}  gates added ${gatesAdded} of ${QA_GATES.length}`);
  console.log(`  G-qa-007 and G-qa-008 are LIMITs on purpose — gates.mjs prints them every run and they never block`);
  process.exit(0);
}
