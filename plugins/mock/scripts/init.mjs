#!/usr/bin/env node
/**
 * init.mjs — how mock plugs in. Not a command: every mock command calls ensureInit() first,
 * and running it twice changes nothing.
 *
 *   node init.mjs [--state-dir X]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, resolveStateDir, stateExists, CORE_FILES, readJson, writeJson, orExit2, isMain } from "../../core/scripts/paths.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MOCK_ROOT = process.env.CLAUDE_PLUGIN_ROOT ?? path.resolve(here, "..");
export const VERSION = "0.1.0";

export const MOCK_GATES = [
  { id: "G-mock-001", plugin: "mock", check: "mock:control-matches-ui", severity: "error", rule: "every control of a wireframe maps to a field or action of the screen it mocks, and every field and action of that screen has exactly one control" },
  { id: "G-mock-002", plugin: "mock", check: "mock:theme-first", severity: "error", rule: "a wireframe exists while no theme does, or names a theme that does not exist" },
  { id: "G-mock-003", plugin: "mock", check: "mock:baseline-hash", severity: "error", rule: "a signed wireframe whose current hash differs from the one that was signed, with no open CR to account for it" },
  { id: "G-mock-004", plugin: "mock", check: "mock:ui-without-fields", severity: "warn", rule: "a wireframe drawn from a screen that declares no fields — zones and buttons only is what the client will sign" },
];

/** Idempotent. Returns { registered, gatesAdded }. */
export function ensureInit(stateDir) {
  orExit2(stateExists(stateDir), `no state dir at ${stateDir} — run core's init.mjs first`);
  const projectFile = CORE_FILES.project(stateDir);
  const project = readJson(projectFile);
  project.plugins ??= {};
  const registered = project.plugins.mock?.root !== MOCK_ROOT || project.plugins.mock?.version !== VERSION;
  if (registered) {
    project.plugins.mock = { root: MOCK_ROOT, version: VERSION };
    writeJson(projectFile, project);
  }

  const gatesFile = CORE_FILES.gates(stateDir);
  const gates = readJson(gatesFile, { schemaVersion: "1.0", gates: [] });
  gates.gates ??= [];
  const have = new Set(gates.gates.map((g) => g.id));
  const added = MOCK_GATES.filter((g) => !have.has(g.id));
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
  console.log(`INIT mock  ${stateDir}`);
  console.log(`  plugins.mock.root ${registered ? "written" : "already current"}  gates added ${gatesAdded} of ${MOCK_GATES.length}`);
  process.exit(0);
}
