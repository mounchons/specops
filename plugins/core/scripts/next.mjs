#!/usr/bin/env node
/**
 * next.mjs — "what do I do now". Human drives, so this prints options; it never runs them.
 *
 * Rules run in order; the first rule that returns actions wins unless it is marked `continue`.
 * Other plugins add rules by exporting `NEXT` (array of (ctx) => actions[]) from
 * <pluginRoot>/scripts/checks.mjs — same file gates.mjs already loads.
 *
 *   node next.mjs [--json] [--all]
 */
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs, resolveStateDir, stateExists, CORE_FILES, readJson } from "./paths.mjs";
import { runGates } from "./gates.mjs";
import { buildRegistry } from "./registry.mjs";
import { PLUGINS, prefixOf } from "./ids.mjs";

const PHASE_ORDER = ["core", "req", "design", "change", "mock", "dev", "qa"];

export const NEXT = [
  // 0. no apps
  ({ project }) =>
    (project.apps ?? []).length === 0
      ? [{ action: "edit .sdlc/project.json → apps[]", reason: "screens, mock and dev are all generated per app; nothing downstream can start without the app list", stop: true }]
      : [],
  // 1. core gate errors
  ({ gates }) => {
    const errs = gates.results.filter((r) => r.severity === "error" && r.gate.startsWith("G-core"));
    return errs.length ? [{ action: `fix ${errs.length} core gate error(s) — run /core:check`, reason: errs.slice(0, 3).map((e) => `${e.gate} ${e.subject}: ${e.message}`).join(" · "), stop: true }] : [];
  },
  // 2. open CRs block everything they touch
  ({ registry }) => {
    const open = Object.entries(registry.index).filter(([id, r]) => prefixOf(id) === "CR" && r.file.includes("change/open/")).map(([id]) => id);
    return open.length ? [{ action: `resolve open CR: ${open.join(", ")} — /change:impact then /change:apply`, reason: "artifacts touched by an open CR are frozen for mock/dev/qa" }] : [];
  },
  // 3. next plugin in phase order that is not installed
  ({ project }) => {
    const missing = PHASE_ORDER.find((p) => !project.plugins?.[p]);
    return missing ? [{ action: `install plugin "${missing}" and run /${missing}:init`, reason: `phase ${PHASE_ORDER.indexOf(missing)} — ${missing} is the next plugin in build order` }] : [];
  },
];

async function loadPluginNext(project) {
  const rules = [...NEXT];
  for (const [name, cfg] of Object.entries(project.plugins ?? {})) {
    if (name === "core" || !cfg?.root) continue;
    const file = path.join(cfg.root, "scripts", "checks.mjs");
    if (!fs.existsSync(file)) continue;
    try {
      const mod = await import(pathToFileURL(file).href);
      rules.push(...(mod.NEXT ?? []));
    } catch {
      /* gates.mjs reports the load error */
    }
  }
  return rules;
}

export async function computeNext(stateDir, { all = false } = {}) {
  if (!stateExists(stateDir)) return [{ action: `/core:init --name <project> --apps <name:type,...>`, reason: `no state dir at ${stateDir}` }];
  const project = readJson(CORE_FILES.project(stateDir));
  const ctx = { stateDir, project, gates: await runGates(stateDir), registry: buildRegistry(stateDir) };
  const out = [];
  for (const rule of await loadPluginNext(project)) {
    const actions = rule(ctx) ?? [];
    out.push(...actions);
    if (!all && actions.some((a) => a.stop)) break;
    if (!all && out.length >= 3) break;
  }
  return out.length ? out : [{ action: "nothing blocked — pick the next module or unit of work", reason: "all installed plugins report clean" }];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  const actions = await computeNext(stateDir, { all: Boolean(flags.all) });
  if (flags.json) console.log(JSON.stringify(actions, null, 2));
  else actions.forEach((a, i) => console.log(`${i + 1}. ${a.action}\n   why: ${a.reason}`));
  process.exit(0);
}
