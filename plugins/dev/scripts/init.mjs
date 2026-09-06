#!/usr/bin/env node
/**
 * init.mjs — how dev plugs in. Not a command: every dev command calls ensureInit() first,
 * and running it twice changes nothing.
 *
 *   node init.mjs [--state-dir X]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, resolveStateDir, stateExists, CORE_FILES, readJson, writeJson, orExit2, isMain } from "../../core/scripts/paths.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEV_ROOT = process.env.CLAUDE_PLUGIN_ROOT ?? path.resolve(here, "..");
export const VERSION = "0.1.0";

/**
 * G-dev-008 names a check no function implements, on purpose: gates.mjs prints it as a LIMIT on
 * every run (constitution rule 1). A session's installed skills are invisible to a script, so the
 * honest form of that rule is a line that never passes silently and never blocks.
 */
export const DEV_GATES = [
  { id: "G-dev-001", plugin: "dev", check: "dev:tsk-needs-proof", severity: "error", rule: "a task at implemented or beyond has no proof entry that exited 0 — done is a run, not a status" },
  { id: "G-dev-002", plugin: "dev", check: "dev:imp-in-layout", severity: "error", rule: "an implementation unit's path is outside its component's root, or its file does not exist" },
  { id: "G-dev-003", plugin: "dev", check: "dev:tsk-frozen", severity: "error", rule: "a task that has started and is not verified, whose use case, screen or acceptance criterion an open CR freezes" },
  { id: "G-dev-004", plugin: "dev", check: "dev:gd-verbatim", severity: "error", rule: "a test file names a golden dataset and does not contain one of its expected values literally" },
  { id: "G-dev-005", plugin: "dev", check: "dev:file-without-imp", severity: "warn", rule: "a source or test file under a component root that no implementation unit owns" },
  { id: "G-dev-006", plugin: "dev", check: "dev:trace-uc-not-br", severity: "error", rule: "an edge written by dev points at a business rule — dev traces the use case, and the use case carries the rule" },
  { id: "G-dev-007", plugin: "dev", check: "dev:gap-open", severity: "warn", rule: "a gap with no CR and no answer — code is waiting on a question nobody has put upstream" },
  { id: "G-dev-008", plugin: "dev", check: "dev:skill-installed", severity: "limit", rule: "every skill a component names is installed in the session writing it — no script can see what a session has loaded" },
];

/** Idempotent. Returns { registered, gatesAdded }. */
export function ensureInit(stateDir) {
  orExit2(stateExists(stateDir), `no state dir at ${stateDir} — run core's init.mjs first`);
  const projectFile = CORE_FILES.project(stateDir);
  const project = readJson(projectFile);
  project.plugins ??= {};
  const registered = project.plugins.dev?.root !== DEV_ROOT || project.plugins.dev?.version !== VERSION;
  if (registered) {
    project.plugins.dev = { root: DEV_ROOT, version: VERSION };
    writeJson(projectFile, project);
  }

  const gatesFile = CORE_FILES.gates(stateDir);
  const gates = readJson(gatesFile, { schemaVersion: "1.0", gates: [] });
  gates.gates ??= [];
  const have = new Set(gates.gates.map((g) => g.id));
  const added = DEV_GATES.filter((g) => !have.has(g.id));
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
  console.log(`INIT dev  ${stateDir}`);
  console.log(`  plugins.dev.root ${registered ? "written" : "already current"}  gates added ${gatesAdded} of ${DEV_GATES.length}`);
  console.log(`  G-dev-008 is a LIMIT on purpose — gates.mjs prints it every run and it never blocks`);
  process.exit(0);
}
