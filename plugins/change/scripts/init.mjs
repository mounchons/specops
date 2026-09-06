#!/usr/bin/env node
/**
 * init.mjs — how change plugs in. Not a command: every change command calls ensureInit() first,
 * and running it twice changes nothing.
 *
 *   node init.mjs [--state-dir X]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, resolveStateDir, stateExists, CORE_FILES, readJson, writeJson, orExit2, isMain } from "../../core/scripts/paths.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const CHANGE_ROOT = process.env.CLAUDE_PLUGIN_ROOT ?? path.resolve(here, "..");
export const VERSION = "0.1.0";

export const CHANGE_GATES = [
  { id: "G-change-001", plugin: "change", check: "change:cr-shape", severity: "error", rule: "every CR has a kind and a source from the lists, a request in the client's own words, and lane null|ui|full" },
  { id: "G-change-002", plugin: "change", check: "change:finding-needs-def", severity: "error", rule: "a CR with source finding names an existing DEF" },
  { id: "G-change-003", plugin: "change", check: "change:display-needs-fields", severity: "error", rule: "a display CR names at least one ENT.attribute and every one exists on its entity" },
  { id: "G-change-004", plugin: "change", check: "change:stale-open", severity: "warn", rule: "an open CR older than 14 days that still has no impact" },
  { id: "G-change-005", plugin: "change", check: "change:frozen", severity: "warn", rule: "every artifact at approved or beyond that an open CR freezes, with the CR and its lane" },
  { id: "G-change-006", plugin: "change", check: "change:closed-clean", severity: "error", rule: "a closed CR records who signed and the evidence, and nothing it touched is still draft" },
];

/** Idempotent. Returns { registered, gatesAdded }. */
export function ensureInit(stateDir) {
  orExit2(stateExists(stateDir), `no state dir at ${stateDir} — run core's init.mjs first`);
  const projectFile = CORE_FILES.project(stateDir);
  const project = readJson(projectFile);
  project.plugins ??= {};
  const registered = project.plugins.change?.root !== CHANGE_ROOT || project.plugins.change?.version !== VERSION;
  if (registered) {
    project.plugins.change = { root: CHANGE_ROOT, version: VERSION };
    writeJson(projectFile, project);
  }

  const gatesFile = CORE_FILES.gates(stateDir);
  const gates = readJson(gatesFile, { schemaVersion: "1.0", gates: [] });
  gates.gates ??= [];
  const have = new Set(gates.gates.map((g) => g.id));
  const added = CHANGE_GATES.filter((g) => !have.has(g.id));
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
  console.log(`INIT change  ${stateDir}`);
  console.log(`  plugins.change.root ${registered ? "written" : "already current"}  gates added ${gatesAdded} of ${CHANGE_GATES.length}`);
  process.exit(0);
}
