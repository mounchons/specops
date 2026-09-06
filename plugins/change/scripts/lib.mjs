#!/usr/bin/env node
/**
 * lib.mjs — the plumbing every change command shares. Nothing here is a rule; rules live in checks.mjs.
 *
 * W1: writes only <stateDir>/change/** and <stateDir>/trace.change.json, plus the one sanctioned
 * line in project.json (plugins.change.root) that init.mjs writes.
 *
 * A CR is one record in one file, so change needs none of the items[]/upsert/pretty-printer
 * plumbing req and design each carry: core's readJson/writeJson already do the job. paths / ids /
 * artifacts / registry / query come from core and are never copied.
 *
 * The one thing change must never do: mint an id it does not own. A CR names what has to be created
 * by kind and by the command that mints it; the concrete next id is computed and PRINTED at impact
 * time and never written, because an id on disk that no plugin has minted is a reference to
 * something that does not exist — and core's dangling-ref gate is right to call that an error.
 */
import fs from "node:fs";
import path from "node:path";
import { CORE_FILES, readJson, writeJson, walk, orExit2 } from "../../core/scripts/paths.mjs";
import { PREFIXES, prefixOf, lineageOf, STATUSES } from "../../core/scripts/ids.mjs";

export const SCHEMA = "1.0";
export const PLUGIN = "change";

export const KINDS = ["display", "screen", "report", "rule", "other"];
export const SOURCES = ["client", "external", "internal", "finding"];
export const LANES = ["ui", "full"];
export const STALE_DAYS = 14;

/** The walk stops here. A scenario, a test case and an implementation unit are the end of the line. */
export const TERMINAL = new Set(["SCN", "TC", "IMP"]);

export const FILES = {
  openDir: (s) => path.join(s, "change", "open"),
  closedDir: (s) => path.join(s, "change", "closed"),
  open: (s, id) => path.join(s, "change", "open", `${id}.json`),
  closed: (s, id) => path.join(s, "change", "closed", `${id}.json`),
  trace: (s) => path.join(s, "trace.change.json"),
};

export const now = () => new Date().toISOString();
export const list = (v) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
export const atLeast = (status, floor) => STATUSES.indexOf(status ?? "draft") >= STATUSES.indexOf(floor);

export function moduleOfId(id) {
  return /^[A-Z]+-([a-z0-9-]+)-[0-9]{3}/.exec(String(id))?.[1] ?? null;
}

/** BR-loan-001@v1 -> BR-loan-001@v2. A versioned kind never changes in place. */
export function versionBump(id) {
  const n = Number(/@v([0-9]+)$/.exec(String(id))?.[1] ?? 0);
  return `${lineageOf(id)}@v${n + 1}`;
}

// ---- the CR files ----------------------------------------------------------

export function allCrs(stateDir) {
  const out = [];
  for (const [dir, open] of [[FILES.openDir(stateDir), true], [FILES.closedDir(stateDir), false]])
    for (const f of walk(dir, (p) => p.endsWith(".json"))) out.push({ ...readJson(f), __file: f, __open: open });
  return out;
}

export const openCrs = (stateDir) => allCrs(stateDir).filter((c) => c.__open);

export function readCr(stateDir, id) {
  return allCrs(stateDir).find((c) => c.id === id) ?? null;
}

export function writeCr(stateDir, cr, { closed = false } = {}) {
  const body = Object.fromEntries(Object.entries(cr).filter(([k]) => !k.startsWith("__")));
  const file = closed ? FILES.closed(stateDir, cr.id) : FILES.open(stateDir, cr.id);
  writeJson(file, body);
  return file;
}

/** Numbers are never recycled: a closed CR still owns its number. */
export function mintCrId(stateDir) {
  let max = 0;
  for (const cr of allCrs(stateDir)) {
    const m = /^CR-([0-9]{3})$/.exec(String(cr.id ?? ""));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `CR-${String(max + 1).padStart(3, "0")}`;
}

// ---- trace -----------------------------------------------------------------

/** One edge per line: core owns the name trace.<plugin>.json, so this file cannot be split. */
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
  const lines = t.edges.map((e) => `    ${JSON.stringify(e)}`).join(",\n");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `{\n  "schemaVersion": ${JSON.stringify(t.schemaVersion)},\n  "owner": ${JSON.stringify(t.owner)},\n  "edges": [\n${lines}\n  ]\n}\n`, "utf8");
}

// ---- the graph walk --------------------------------------------------------

/**
 * Transitive DEPENDENTS of the touched ids: the edges that point AT them, not the ones they point
 * at. A screen points down at the use case it displays; changing the screen does not change the use
 * case, so the walk never goes that way — otherwise every display change would drag the whole
 * design back in through its own derivedFrom, and no change would ever be small.
 *
 * Returns Map id -> { depth, rel, via }. Depth 0 is the touched id itself.
 */
export function dependents(registry, startIds) {
  const seen = new Map(startIds.map((id) => [id, { depth: 0, rel: "touches", via: null }]));
  let frontier = new Set(startIds);
  for (let d = 1; d <= 20 && frontier.size; d++) {
    const next = new Set();
    for (const e of registry.edges) {
      if (!frontier.has(e.to) || seen.has(e.from)) continue;
      const p = prefixOf(e.from);
      if (p === "CR") continue;
      seen.set(e.from, { depth: d, rel: e.rel, via: e.to });
      if (!TERMINAL.has(p)) next.add(e.from);
    }
    frontier = next;
  }
  return seen;
}

export function countByPrefix(ids) {
  const out = {};
  for (const id of ids) out[prefixOf(id)] = (out[prefixOf(id)] ?? 0) + 1;
  return out;
}

/** What the owning plugin's next id WOULD be. Printed only — see the header. */
export function nextIdPreview(registry, prefix, module) {
  const scope = PREFIXES[prefix]?.scope;
  if (!scope) return null;
  const re = scope === "project" ? new RegExp(`^${prefix}-([0-9]{3})$`) : new RegExp(`^${prefix}-${module}-([0-9]{3})`);
  let max = 0;
  for (const id of Object.keys(registry.index)) {
    const m = re.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const n = String(max + 1).padStart(3, "0");
  if (scope === "project") return `${prefix}-${n}`;
  return scope === "version" ? `${prefix}-${module}-${n}@v1` : `${prefix}-${module}-${n}`;
}

// ---- project ---------------------------------------------------------------

export const project = (stateDir) => readJson(CORE_FILES.project(stateDir));
export const appNamed = (p, name) => (p.apps ?? []).find((a) => a.name === name) ?? null;

export function resolveModule(p, flag, touches) {
  const mods = p.modules ?? [];
  if (flag) {
    orExit2(mods.includes(flag), `module "${flag}" is not in project.json modules[] — req declares modules, change does not`);
    return flag;
  }
  const fromIds = [...new Set(touches.map(moduleOfId).filter(Boolean))];
  if (fromIds.length === 1) return fromIds[0];
  if (mods.length === 1) return mods[0];
  orExit2(false, `--module is required: the project has ${mods.length} module(s) (${mods.join(", ")}) and the touched ids name ${fromIds.length}`);
}

export function resolveApp(p, flag, kind, touchedRecords) {
  if (flag) {
    orExit2(appNamed(p, flag), `app "${flag}" is not in project.json apps[]`);
    return flag;
  }
  const fromIds = [...new Set(touchedRecords.map((r) => r.app).filter(Boolean))];
  if (fromIds.length === 1) return fromIds[0];
  orExit2(!["screen", "report"].includes(kind), `--app is required for a ${kind} change — a screen belongs to one app, and mock and dev are generated per app`);
  return fromIds[0] ?? null;
}

// ---- what the lane costs ---------------------------------------------------

/** By kind: what has to be created, and which command mints it. Counts, never ids. */
export const TO_CREATE = {
  display: (n) => [
    { kind: "MCK", count: Math.max(1, n.screens), by: "/mock:wireframe" },
    { kind: "TSK", count: 1, by: "/dev:revise" },
    { kind: "TC", count: Math.max(1, n.screens), by: "/qa:cases" },
  ],
  screen: () => [
    { kind: "UC", count: 1, by: "/design:usecase" },
    { kind: "UI", count: 1, by: "/design:screens" },
    { kind: "API", count: 1, by: "/design:api" },
    { kind: "ACL", count: 1, by: "/design:rbac" },
    { kind: "SCN", count: 1, by: "/design:scenario" },
  ],
  report: () => [
    { kind: "CALC", count: 1, by: "/req:calc" },
    { kind: "GD", count: 1, by: "/req:golden" },
    { kind: "RPT", count: 1, by: "/design:screens" },
    { kind: "UI", count: 1, by: "/design:screens" },
    { kind: "SCN", count: 1, by: "/design:scenario" },
    { kind: "TC", count: 1, by: "/qa:cases" },
  ],
  rule: () => [
    { kind: "BR", count: 1, by: "/req:rules" },
    { kind: "EX", count: 1, by: "/req:rules --ex" },
    { kind: "SCN", count: 1, by: "/design:scenario" },
  ],
  other: () => [],
};

const UI_LANE = (m, app, id) => [`/design:screens ${m}`, `/mock:wireframe ${app}`, `/dev:revise --cr ${id}`, `/qa:cases ${m}`];

const FULL_LANE = {
  screen: (m, app, id) => [`/design:usecase ${m} --cr ${id}`, `/design:screens ${m}`, `/design:api ${m}`, `/design:rbac`, `/design:scenario ${m}`, `/mock:wireframe ${app}`, `/dev:task --cr ${id}`, `/qa:cases ${m}`],
  report: (m, app, id) => [`/req:ask ${m} --cr ${id}`, `/req:calc ${m} --cr ${id}`, `/req:golden ${m}`, `/design:screens ${m}`, `/design:scenario ${m}`, `/mock:wireframe ${app}`, `/dev:task --cr ${id}`, `/qa:cases ${m}`],
  rule: (m, app, id) => [`/req:rules ${m} --cr ${id}`, `/design:usecase ${m}`, `/design:screens ${m}`, `/design:scenario ${m}`, `/mock:wireframe ${app}`, `/dev:task --cr ${id}`, `/qa:cases ${m}`],
  display: (m, app, id) => [`/req:ask ${m} --cr ${id}`, `/design:screens ${m}`, `/design:scenario ${m}`, `/mock:wireframe ${app}`, `/dev:task --cr ${id}`, `/qa:cases ${m}`],
  other: (m, app, id) => [`/design:screens ${m}`, `/design:scenario ${m}`, `/mock:wireframe ${app}`, `/dev:task --cr ${id}`, `/qa:cases ${m}`],
};

/**
 * The exact commands, in order, for this CR's lane. A versioned id in `touches` is named with the
 * version its owner will mint next — inside the command line, never as a bare id.
 */
export function commandsFor(cr) {
  const m = cr.module ?? "<module>";
  const app = cr.app ?? "<app>";
  const head = [];
  for (const id of cr.touches ?? []) {
    if (prefixOf(id) === "BR") head.push(`/req:rules ${m} --cr ${cr.id} --retire ${id} --next ${versionBump(id)}`);
    if (prefixOf(id) === "CALC") head.push(`/req:calc ${m} --cr ${cr.id} --retire ${id} --next ${versionBump(id)}`);
  }
  const headStarts = head.map((h) => h.split(" ")[0]);
  const body = cr.lane === "ui" ? UI_LANE(m, app, cr.id) : (FULL_LANE[cr.kind] ?? FULL_LANE.other)(m, app, cr.id);
  return [...head, ...body.filter((c) => !headStarts.includes(c.split(" ")[0]))];
}

export const pluginOfCommand = (cmd) => /^\/([a-z]+):/.exec(String(cmd))?.[1] ?? null;
