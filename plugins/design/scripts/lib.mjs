#!/usr/bin/env node
/**
 * lib.mjs — the plumbing every design command shares. Nothing here is a rule; rules live in checks.mjs.
 *
 * W1: writes only under <stateDir>/design/** and <stateDir>/trace.design.json, plus the one
 * sanctioned line in project.json (plugins.design.root) that init.mjs writes.
 * paths / ids / artifacts / registry / query come from core and are never copied. The record
 * plumbing below (readItems, upsert, mintId, addEdges) is per-plugin by the plugin contract;
 * when a third plugin needs it, it belongs in core as records.mjs rather than in three places.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CORE_FILES, readJson, walk, orExit2 } from "../../core/scripts/paths.mjs";
import { PREFIXES, lineageOf } from "../../core/scripts/ids.mjs";

export const SCHEMA = "1.0";
export const PLUGIN = "design";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REFERENCES = path.resolve(here, "..", "references");

const dDir = (s) => path.join(s, "design");
const mDir = (s, m) => path.join(s, "design", m);

/**
 * Where each record lands. Files are split on a key that is known before writing — app, origin,
 * use case — rather than when they happen to reach 300 lines: a split that depends on size moves
 * records between files as the project grows, and every id then has to be found again.
 */
export const FILES = {
  domain: (s) => path.join(dDir(s), "domain.json"),
  states: (s) => path.join(dDir(s), "domain-states.json"),
  api: (s, app, origin) => path.join(dDir(s), `api-${app}-${origin}.json`),
  integrations: (s) => path.join(dDir(s), "api-integrations.json"),
  rbac: (s) => path.join(dDir(s), "rbac.json"),
  acl: (s, role, origin) => path.join(dDir(s), "rbac", `${role}-${origin}.json`),
  decisions: (s) => path.join(dDir(s), "decisions.json"),
  usecase: (s, m, uc) => path.join(mDir(s, m), "usecases", `${uc}.json`),
  screens: (s, m, app, origin) => path.join(mDir(s, m), "screens", `${app}-${origin}.json`),
  scenarios: (s, m, uc) => path.join(mDir(s, m), "scenarios", `${uc}.json`),
  trace: (s) => path.join(s, "trace.design.json"),
  exportDoc: (s, m) => path.join(s, "export", `design-${m}.md`),
};

// ---- artifact files --------------------------------------------------------

export function readItems(file) {
  if (!fs.existsSync(file)) return [];
  const d = readJson(file);
  return Array.isArray(d) ? d : Array.isArray(d.items) ? d.items : d.id ? [d] : [];
}

/**
 * Pretty JSON, except that a list of scalars and a small flat object stay on one line.
 * Design records are wide — a screen carries fields, actions, zones, states — and at five lines per
 * array the files cross the 300-line limit long before the design is large. This keeps one action,
 * one state, one edge per line, which is also how a person reads them.
 */
export function stringify(value, indent = "") {
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every((v) => v === null || typeof v !== "object")) return JSON.stringify(value);
    return `[\n${value.map((v) => `${indent}  ${stringify(v, `${indent}  `)}`).join(",\n")}\n${indent}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) return "{}";
    if (keys.every((k) => value[k] === null || typeof value[k] !== "object")) {
      const oneLine = JSON.stringify(value);
      if (oneLine.length <= 120) return oneLine;
    }
    return `{\n${keys.map((k) => `${indent}  ${JSON.stringify(k)}: ${stringify(value[k], `${indent}  `)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

export function writeCompactJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${stringify(obj)}\n`, "utf8");
}

export function writeItems(file, items) {
  writeCompactJson(file, { schemaVersion: SCHEMA, items });
}

export function upsert(file, record) {
  const items = readItems(file);
  const i = items.findIndex((x) => x.id === record.id);
  if (i >= 0) items[i] = record;
  else items.push(record);
  writeItems(file, items);
  return record;
}

/** Every design record on disk, each tagged with the file it came from. */
export function allDesign(stateDir) {
  const out = [];
  for (const f of walk(dDir(stateDir), (p) => p.endsWith(".json"))) for (const r of readItems(f)) out.push({ ...r, __file: f });
  return out;
}

/** Every req record on disk. design reads req, never writes it. */
export function allReq(stateDir) {
  const out = [];
  for (const f of walk(path.join(stateDir, "req"), (p) => p.endsWith(".json"))) for (const r of readItems(f)) out.push({ ...r, __file: f });
  return out;
}

export const byPrefix = (records, prefix) => records.filter((r) => String(r.id).startsWith(`${prefix}-`));
export const findById = (records, id) => records.find((r) => r.id === id) ?? null;
export const inModule = (r, m) => String(r.id).includes(`-${m}-`);
export const live = (records) => records.filter((r) => r.status !== "retired");
export const stripInternal = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "__file"));

// ---- ids -------------------------------------------------------------------

export function mintId(existingIds, prefix, module) {
  const scope = PREFIXES[prefix]?.scope;
  orExit2(scope, `unknown prefix ${prefix}`);
  const re = scope === "project" ? new RegExp(`^${prefix}-([0-9]{3})$`) : new RegExp(`^${prefix}-${module}-([0-9]{3})`);
  let max = 0;
  for (const id of existingIds) {
    const m = re.exec(String(id));
    if (m) max = Math.max(max, Number(m[1]));
  }
  const n = String(max + 1).padStart(3, "0");
  return scope === "project" ? `${prefix}-${n}` : `${prefix}-${module}-${n}`;
}

/** Mint several ids of one prefix without re-reading the disk between them. */
export function minter(existingIds, prefix, module) {
  const ids = [...existingIds];
  return () => {
    const id = mintId(ids, prefix, module);
    ids.push(id);
    return id;
  };
}

// ---- trace -----------------------------------------------------------------

/**
 * One edge per line. core owns the name trace.<plugin>.json, so there is exactly one of these per
 * plugin and it cannot be split — and a design of any size has hundreds of edges.
 */
export function addEdges(stateDir, edges) {
  const file = FILES.trace(stateDir);
  const t = fs.existsSync(file) ? readJson(file) : { schemaVersion: SCHEMA, owner: PLUGIN, edges: [] };
  t.edges ??= [];
  const key = (e) => `${e.from}|${e.rel}|${e.to}`;
  const seen = new Set(t.edges.map(key));
  for (const e of edges) {
    if (seen.has(key(e))) continue;
    t.edges.push({ from: e.from, rel: e.rel, to: e.to });
    seen.add(key(e));
  }
  writeCompactJson(file, t);
}

export const edgesOf = (stateDir) => (fs.existsSync(FILES.trace(stateDir)) ? readJson(FILES.trace(stateDir)).edges ?? [] : []);

// ---- project ---------------------------------------------------------------

export function project(stateDir) {
  return readJson(CORE_FILES.project(stateDir));
}

export function requireModule(stateDir, module) {
  const p = project(stateDir);
  orExit2((p.modules ?? []).includes(module), `module "${module}" is not in project.json modules[] — req declares modules, design does not`);
  return p;
}

export const appsOf = (p) => p.apps ?? [];
export const appNamed = (p, name) => appsOf(p).find((a) => a.name === name) ?? null;
export const appOwning = (p, what) => appsOf(p).find((a) => (a.owns ?? []).includes(what)) ?? null;

// ---- references ------------------------------------------------------------

/** The baseline screens for one app type: what every system of that shape has, asked for or not. */
export function baselineFor(appType) {
  const file = path.join(REFERENCES, "app-baselines", `${appType}.json`);
  if (!fs.existsSync(file)) return { appType, screens: [] };
  return readJson(file);
}

export const nfrScreens = () => readJson(path.join(REFERENCES, "nfr-screens.json")).rules ?? [];

/** A baseline entry applies to an app when every `requires` clause holds. */
export function baselineApplies(entry, app) {
  const r = entry.requires ?? {};
  if (r.authNot && app.auth === r.authNot) return false;
  if (r.auth && app.auth !== r.auth) return false;
  if (r.owns && !(app.owns ?? []).includes(r.owns)) return false;
  return true;
}

// ---- open changes ----------------------------------------------------------

/** Ids frozen by an open CR — phase 3 writes the CRs, design only refuses to touch them. */
export function frozenIds(stateDir) {
  const dir = path.join(stateDir, "change", "open");
  const out = new Set();
  for (const f of walk(dir, (p) => p.endsWith(".json"))) {
    for (const cr of readItems(f)) for (const id of cr.touches ?? []) out.add(id);
  }
  return out;
}

export const now = () => new Date().toISOString();
export { lineageOf };
