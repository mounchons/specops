#!/usr/bin/env node
/**
 * init.mjs — create <stateDir> with project.json + gates.json. Refuses to overwrite.
 *
 *   node init.mjs --name <project> [--apps backoffice:backoffice-web,driver:mobile] [--state-dir X]
 *
 * Registers core's own root in project.json → plugins.core.root so gates.mjs can find plugin checks
 * the same way for every plugin that comes later (each plugin's init adds its own entry).
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs, resolveStateDir, stateExists, CORE_FILES, writeJson, orExit2, isMain } from "./paths.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const CORE_ROOT = process.env.CLAUDE_PLUGIN_ROOT ?? path.resolve(here, "..");

export const CORE_GATES = [
  { id: "G-core-001", plugin: "core", check: "core:id-shape", severity: "error", rule: "every artifact id matches the ids registry (ids.mjs)" },
  { id: "G-core-002", plugin: "core", check: "core:id-owner", severity: "error", rule: "an artifact lives under the plugin that owns its prefix (W1)" },
  { id: "G-core-003", plugin: "core", check: "core:unique-id", severity: "error", rule: "an id is defined exactly once" },
  { id: "G-core-004", plugin: "core", check: "core:status-value", severity: "error", rule: "status is one of draft|reviewed|approved|implemented|verified|retired" },
  { id: "G-core-005", plugin: "core", check: "core:file-lines", severity: "error", rule: "no artifact file the AI reads exceeds 300 lines" },
  { id: "G-core-006", plugin: "core", check: "core:dangling-ref", severity: "error", rule: "every referenced id exists" },
  { id: "G-core-007", plugin: "core", check: "core:trace-owner", severity: "error", rule: "a trace edge is written only by the plugin that owns its `from` id" },
  { id: "G-core-008", plugin: "core", check: "core:parse-problems", severity: "error", rule: "every artifact file parses and holds records with ids" },
  { id: "G-core-009", plugin: "core", check: "core:project-apps", severity: "error", rule: "project.json declares at least one app with a known type" },
  { id: "G-core-010", plugin: "core", check: "core:registry-fresh", severity: "warn", rule: "registry.json matches the artifacts on disk" },
];

export function parseApps(spec) {
  if (!spec) return [];
  return String(spec)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [name, type = "backoffice-web"] = s.split(":");
      const owns = type === "backoffice-web" ? ["master", "roles", "users"] : [];
      const auth = type === "api" ? "token" : type === "mobile" ? "pin" : "username";
      return { name, type, auth, owns };
    });
}

export function initState(stateDir, { name, apps = [] }) {
  orExit2(!stateExists(stateDir), `state dir already initialised: ${stateDir}`);
  const project = {
    schemaVersion: "1.0",
    name,
    createdAt: new Date().toISOString(),
    language: { content: "th", ids: "en" },
    apps,
    modules: [],
    plugins: { core: { root: CORE_ROOT, version: "0.1.0" } },
    phase: { current: 0, note: "0 core · 1 req · 2 design · 3 change · 4 mock · 5 dev · 6 qa" },
  };
  writeJson(CORE_FILES.project(stateDir), project);
  writeJson(CORE_FILES.gates(stateDir), {
    schemaVersion: "1.0",
    note: "The only home of gates. A gate whose check has no script prints LIMIT and never passes silently. Plugins append their gates here in their own init.",
    gates: CORE_GATES,
  });
  for (const d of ["req", "design", "change/open", "change/closed", "mock", "dev", "qa", "export"]) fs.mkdirSync(path.join(stateDir, d), { recursive: true });
  return project;
}

if (isMain(import.meta.url)) {
  const { flags } = parseArgs();
  orExit2(typeof flags.name === "string", "usage: init.mjs --name <project> [--apps name:type,...]");
  const stateDir = resolveStateDir(flags);
  const project = initState(stateDir, { name: flags.name, apps: parseApps(flags.apps) });
  console.log(`INIT ${stateDir}`);
  console.log(`  project=${project.name} apps=${project.apps.length} gates=${CORE_GATES.length}`);
  if (project.apps.length === 0) console.log("  NEXT: declare apps in project.json (or re-run with --apps) — G-core-009 stays red until then");
  process.exit(0);
}
