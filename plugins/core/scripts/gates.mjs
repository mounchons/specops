#!/usr/bin/env node
/**
 * gates.mjs — constitution rule 1 made executable: a rule that no script can check is a LIMIT
 * line, not a rule. gates.json lists gates; each names a check `<plugin>:<name>`. Core provides
 * its own checks below; other plugins export `CHECKS` from <pluginRoot>/scripts/checks.mjs and
 * register their root in project.json → plugins.<name>.root. Unknown check ⇒ LIMIT.
 *
 *   node gates.mjs [--json] [--plugin req]      exit 0 clean | 1 errors | 2 unusable
 *
 * Check signature: (ctx) => [{ subject, message, severity? }]  where ctx = { stateDir, project, state, registry }
 */
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs, resolveStateDir, stateExists, CORE_FILES, readJson, orExit2, rel, walk } from "./paths.mjs";
import { loadState } from "./artifacts.mjs";
import { validate, STATUSES, PREFIXES, prefixOf } from "./ids.mjs";
import { isStale, buildRegistry } from "./registry.mjs";

export const MAX_LINES = 300;

export const CHECKS = {
  "core:id-shape": ({ state }) =>
    state.artifacts.filter((a) => !validate(a.id).ok).map((a) => ({ subject: a.file, message: `${a.id}: ${validate(a.id).reason}` })),

  "core:id-owner": ({ state }) =>
    state.artifacts
      .filter((a) => a.plugin && a.owner && a.plugin !== a.owner)
      .map((a) => ({ subject: a.file, message: `${a.id} is owned by ${a.owner} but lives under ${a.plugin}/` })),

  "core:unique-id": ({ state }) => {
    const seen = new Map();
    const out = [];
    for (const a of state.artifacts) {
      if (seen.has(a.id)) out.push({ subject: a.file, message: `${a.id} also defined in ${seen.get(a.id)}` });
      else seen.set(a.id, a.file);
    }
    return out;
  },

  "core:status-value": ({ state }) =>
    state.artifacts.filter((a) => !STATUSES.includes(a.status)).map((a) => ({ subject: a.file, message: `${a.id} status "${a.status}" not in ${STATUSES.join("|")}` })),

  "core:file-lines": ({ state }) =>
    state.files.filter((f) => f.lines > MAX_LINES).map((f) => ({ subject: f.file, message: `${f.lines} lines > ${MAX_LINES} — split by module/aggregate/screen` })),

  "core:dangling-ref": ({ state }) => {
    const ids = new Set(state.artifacts.map((a) => a.id));
    return state.edges.filter((e) => !ids.has(e.to)).map((e) => ({ subject: e.file, message: `${e.from} ${e.rel} ${e.to} — target does not exist` }));
  },

  "core:trace-owner": ({ state }) =>
    state.edges
      .filter((e) => e.rel !== "refs" && PREFIXES[prefixOf(e.from)] && PREFIXES[prefixOf(e.from)].owner !== e.owner)
      .map((e) => ({ subject: e.file, message: `edge ${e.from} -${e.rel}-> ${e.to} written by ${e.owner} but ${e.from} is owned by ${PREFIXES[prefixOf(e.from)].owner}` })),

  "core:parse-problems": ({ state }) => state.problems.map((p) => ({ subject: p.file, message: p.reason, severity: p.severity })),

  "core:project-apps": ({ project }) => {
    const apps = project.apps ?? [];
    const out = [];
    if (apps.length === 0) out.push({ subject: "project.json", message: "apps[] is empty — declare at least one app {name, type, auth, owns}" });
    for (const a of apps) {
      if (!a.name || !a.type) out.push({ subject: "project.json", message: `app ${JSON.stringify(a)} needs name and type` });
      if (!["backoffice-web", "customer-web", "mobile", "desktop", "api"].includes(a.type)) out.push({ subject: "project.json", message: `app ${a.name}: unknown type ${a.type}` });
    }
    return out;
  },

  "core:registry-fresh": ({ stateDir }) => (isStale(stateDir) ? [{ subject: "registry.json", message: "stale — run registry.mjs --build", severity: "warn" }] : []),
};

async function loadPluginChecks(project) {
  const all = { ...CHECKS };
  for (const [name, cfg] of Object.entries(project.plugins ?? {})) {
    if (name === "core" || !cfg?.root) continue;
    const file = path.join(cfg.root, "scripts", "checks.mjs");
    if (!fs.existsSync(file)) continue;
    try {
      const mod = await import(pathToFileURL(file).href);
      for (const [k, fn] of Object.entries(mod.CHECKS ?? {})) all[k] = fn;
    } catch (e) {
      all[`${name}:__load_error`] = () => [{ subject: file, message: e.message }];
    }
  }
  return all;
}

export async function runGates(stateDir, { plugin = null } = {}) {
  const project = readJson(CORE_FILES.project(stateDir));
  const gatesFile = readJson(CORE_FILES.gates(stateDir), { gates: [] });
  const state = loadState(stateDir);
  const registry = buildRegistry(stateDir);
  const checks = await loadPluginChecks(project);
  const ctx = { stateDir, project, state, registry };

  const results = [];
  for (const g of gatesFile.gates ?? []) {
    if (plugin && g.plugin !== plugin) continue;
    const fn = checks[g.check];
    if (!fn) {
      results.push({ gate: g.id, severity: "limit", subject: g.check, message: `no script implements this check — "${g.rule}" is a LIMIT, not a rule` });
      continue;
    }
    let findings;
    try {
      findings = fn(ctx) ?? [];
    } catch (e) {
      results.push({ gate: g.id, severity: "error", subject: g.check, message: `check crashed: ${e.message}` });
      continue;
    }
    for (const f of findings) results.push({ gate: g.id, severity: f.severity ?? g.severity ?? "error", subject: f.subject, message: f.message });
  }
  const counts = { error: 0, warn: 0, limit: 0 };
  for (const r of results) counts[r.severity] = (counts[r.severity] ?? 0) + 1;
  return { results, counts, gatesRun: (gatesFile.gates ?? []).length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  orExit2(stateExists(stateDir), `no state dir at ${stateDir}`);
  const out = await runGates(stateDir, { plugin: flags.plugin ?? null });
  if (flags.json) console.log(JSON.stringify(out, null, 2));
  else {
    for (const r of out.results) console.log(`${r.severity.toUpperCase().padEnd(5)} ${r.gate}  ${r.subject}: ${r.message}`);
    console.log(`gates=${out.gatesRun}  error=${out.counts.error}  warn=${out.counts.warn}  limit=${out.counts.limit}`);
  }
  process.exit(out.counts.error ? 1 : 0);
}
