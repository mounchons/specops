#!/usr/bin/env node
/**
 * init.mjs — how design plugs in. Not a command: every design command calls ensureInit() first,
 * and running it twice changes nothing.
 *
 *   node init.mjs [--state-dir X]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, resolveStateDir, stateExists, CORE_FILES, readJson, writeJson, orExit2, isMain } from "../../core/scripts/paths.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DESIGN_ROOT = process.env.CLAUDE_PLUGIN_ROOT ?? path.resolve(here, "..");
export const VERSION = "0.1.0";

export const DESIGN_GATES = [
  { id: "G-design-001", plugin: "design", check: "design:ent-kind", severity: "error", rule: "every ENT has kind aggregate|entity|reference|lookup|vo" },
  { id: "G-design-002", plugin: "design", check: "design:stm-exit", severity: "error", rule: "every state machine state that is not final has a transition out" },
  { id: "G-design-003", plugin: "design", check: "design:uc-satisfies-req", severity: "error", rule: "every UC satisfies at least one REQ" },
  { id: "G-design-004", plugin: "design", check: "design:br-enforced", severity: "error", rule: "every live BR of a module with use cases is enforced by at least one step" },
  { id: "G-design-005", plugin: "design", check: "design:ac-then-verbatim", severity: "error", rule: "every AC.then is copied verbatim from an EX of a rule the use case enforces" },
  { id: "G-design-006", plugin: "design", check: "design:ui-app-origin", severity: "error", rule: "every UI names a declared app and an origin usecase|master|baseline|nfr" },
  { id: "G-design-007", plugin: "design", check: "design:ui-usecase-traces-uc", severity: "error", rule: "a UI with origin usecase displays a UC — otherwise it is scope creep" },
  { id: "G-design-008", plugin: "design", check: "design:login-per-app", severity: "error", rule: "every app whose auth is not none has a login screen" },
  { id: "G-design-009", plugin: "design", check: "design:master-owner-ui", severity: "error", rule: "every reference entity has a master screen in the app that owns master data" },
  { id: "G-design-010", plugin: "design", check: "design:role-management-ui", severity: "error", rule: "the app that owns roles has users, roles and permission-matrix screens" },
  { id: "G-design-011", plugin: "design", check: "design:role-traces-stk", severity: "error", rule: "every ROLE derives from a stakeholder" },
  { id: "G-design-012", plugin: "design", check: "design:ui-has-acl", severity: "error", rule: "every UI has at least one ACL row — default deny means an unlisted screen is unreachable" },
  { id: "G-design-013", plugin: "design", check: "design:write-action-has-api", severity: "error", rule: "every UI action that writes across an app boundary names an API" },
  { id: "G-design-014", plugin: "design", check: "design:flow-has-scn", severity: "error", rule: "every use case flow and every NFR has a scenario" },
  { id: "G-design-015", plugin: "design", check: "design:lookup-undecided", severity: "warn", rule: "a lookup entity has no decision yet: master screen or seed data" },
  { id: "G-design-016", plugin: "design", check: "design:flow-without-ac", severity: "warn", rule: "every use case flow has at least one acceptance criterion — a scenario cut from steps alone is not a promise" },
];

/** Idempotent. Returns { registered, gatesAdded }. */
export function ensureInit(stateDir) {
  orExit2(stateExists(stateDir), `no state dir at ${stateDir} — run core's init.mjs first`);
  const projectFile = CORE_FILES.project(stateDir);
  const project = readJson(projectFile);
  project.plugins ??= {};
  const registered = project.plugins.design?.root !== DESIGN_ROOT || project.plugins.design?.version !== VERSION;
  if (registered) {
    project.plugins.design = { root: DESIGN_ROOT, version: VERSION };
    writeJson(projectFile, project);
  }

  const gatesFile = CORE_FILES.gates(stateDir);
  const gates = readJson(gatesFile, { schemaVersion: "1.0", gates: [] });
  gates.gates ??= [];
  const have = new Set(gates.gates.map((g) => g.id));
  const added = DESIGN_GATES.filter((g) => !have.has(g.id));
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
  console.log(`INIT design  ${stateDir}`);
  console.log(`  plugins.design.root ${registered ? "written" : "already current"}  gates added ${gatesAdded} of ${DESIGN_GATES.length}`);
  process.exit(0);
}
