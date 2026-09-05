#!/usr/bin/env node
/**
 * lib.mjs — the plumbing every req command shares. Nothing here is a rule; rules live in checks.mjs.
 *
 * W1: this module writes only under <stateDir>/req/** and <stateDir>/trace.req.json.
 * The one sanctioned exception is project.json → plugins.req.root / modules[], written by init.mjs,
 * because that is how a plugin plugs in at all (CLAUDE.md "How a plugin plugs in").
 * Everything shared with other plugins is imported from core — never copied.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { CORE_FILES, readJson, writeJson, walk, orExit2 } from "../../core/scripts/paths.mjs";
import { PREFIXES, lineageOf } from "../../core/scripts/ids.mjs";

export const SCHEMA = "1.0";
export const PLUGIN = "req";

const reqDir = (s) => path.join(s, "req");
const modDir = (s, m) => path.join(s, "req", m);

export const FILES = {
  stakeholders: (s) => path.join(reqDir(s), "stakeholders.json"),
  sources: (s) => path.join(reqDir(s), "sources.json"),
  rawSource: (s, id, ext) => path.join(reqDir(s), "sources", `${id}${ext}`),
  requirements: (s, m) => path.join(modDir(s, m), "requirements.json"),
  glossary: (s, m) => path.join(modDir(s, m), "glossary.json"),
  rules: (s, m) => path.join(modDir(s, m), "rules.json"),
  calc: (s, m) => path.join(modDir(s, m), "calc.json"),
  questions: (s, m, category) => path.join(modDir(s, m), "questions", `${category}.json`),
  examples: (s, m, lineage) => path.join(modDir(s, m), "examples", `${lineage}.json`),
  golden: (s, m, gdId) => path.join(modDir(s, m), "golden", `${gdId}.json`),
  goldenScript: (s, m, calcId) => path.join(modDir(s, m), "golden", `${calcId}.mjs`),
  trace: (s) => path.join(s, "trace.req.json"),
  exportDoc: (s, m) => path.join(s, "export", `requirement-${m}.md`),
};

// ---- artifact files --------------------------------------------------------

/** Read one artifact file as a plain list. Missing file = empty list, never an error. */
export function readItems(file) {
  if (!fs.existsSync(file)) return [];
  const d = readJson(file);
  return Array.isArray(d) ? d : Array.isArray(d.items) ? d.items : d.id ? [d] : [];
}

export function writeItems(file, items) {
  writeJson(file, { schemaVersion: SCHEMA, items });
}

/** Insert or replace by id, keeping file order stable. Returns the record written. */
export function upsert(file, record) {
  const items = readItems(file);
  const i = items.findIndex((x) => x.id === record.id);
  if (i >= 0) items[i] = record;
  else items.push(record);
  writeItems(file, items);
  return record;
}

/** Every req record on disk, each tagged with the file it came from. */
export function allReq(stateDir) {
  const out = [];
  for (const f of walk(reqDir(stateDir), (p) => p.endsWith(".json"))) {
    for (const r of readItems(f)) out.push({ ...r, __file: f });
  }
  return out;
}

export const byPrefix = (records, prefix) => records.filter((r) => String(r.id).startsWith(`${prefix}-`));
export const findById = (records, id) => records.find((r) => r.id === id) ?? null;
export const versionNum = (id) => Number(/@v([0-9]+)$/.exec(String(id))?.[1] ?? 0);
/** Every version of one lineage, oldest first. */
export const versionsOf = (records, id) => records.filter((r) => lineageOf(r.id) === lineageOf(id)).sort((a, b) => versionNum(a.id) - versionNum(b.id));

// ---- ids -------------------------------------------------------------------

/** Next free id for a prefix. Version-scoped prefixes get the lineage back; the caller adds @vN. */
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

// ---- trace -----------------------------------------------------------------

/** Append named edges to trace.req.json, skipping duplicates. `from` is always a req id (G-core-007). */
export function addEdges(stateDir, edges) {
  const file = FILES.trace(stateDir);
  const t = fs.existsSync(file) ? readJson(file) : { schemaVersion: SCHEMA, owner: PLUGIN, edges: [] };
  t.edges ??= [];
  const key = (e) => `${e.from}|${e.rel}|${e.to}`;
  const seen = new Set(t.edges.map(key));
  for (const e of edges) {
    if (seen.has(key(e))) continue;
    t.edges.push(e);
    seen.add(key(e));
  }
  writeJson(file, t);
}

// ---- project ---------------------------------------------------------------

export function project(stateDir) {
  return readJson(CORE_FILES.project(stateDir));
}

/** A module must be declared before req writes anything under it. --new-module is the only way in. */
export function requireModule(stateDir, module, { create = false } = {}) {
  orExit2(/^[a-z0-9-]+$/.test(String(module ?? "")), `module must match [a-z0-9-]+, got "${module}"`);
  const p = project(stateDir);
  if ((p.modules ?? []).includes(module)) return p;
  orExit2(create, `module "${module}" is not in project.json modules[] — re-run with --new-module to declare it`);
  p.modules = [...(p.modules ?? []), module];
  writeJson(CORE_FILES.project(stateDir), p);
  return p;
}

// ---- golden ----------------------------------------------------------------

/**
 * Run a golden script over a list of inputs in a child node process and hand back what it computed.
 * Truth comes from running (DESIGN P6) — nothing here ever reads `expected` out of the GD.
 * Returns { ok: true, values } or { ok: false, error }.
 */
export function runGolden(scriptFile, inputs) {
  if (!fs.existsSync(scriptFile)) return { ok: false, error: `no golden script at ${scriptFile}` };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "specops-gd-"));
  try {
    const inputsFile = path.join(tmp, "inputs.json");
    fs.writeFileSync(inputsFile, JSON.stringify(inputs), "utf8");
    const runner = path.join(tmp, "run.mjs");
    fs.writeFileSync(
      runner,
      [
        'import fs from "node:fs";',
        "const mod = await import(process.argv[2]);",
        'if (typeof mod.compute !== "function") throw new Error("golden script must export compute(input)");',
        'const inputs = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));',
        "console.log(JSON.stringify(inputs.map((i) => mod.compute(i))));",
      ].join("\n"),
      "utf8",
    );
    const out = execFileSync(process.execPath, [runner, pathToFileURL(scriptFile).href, inputsFile], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, values: JSON.parse(out.trim().split(/\r?\n/).pop()) };
  } catch (e) {
    const text = `${e.stderr ?? ""}${e.stdout ?? ""}${e.message ?? ""}`.trim();
    return { ok: false, error: text.split(/\r?\n/).filter(Boolean).slice(-2).join(" · ") };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const now = () => new Date().toISOString();
