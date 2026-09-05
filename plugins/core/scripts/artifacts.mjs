#!/usr/bin/env node
/**
 * artifacts.mjs — read the state dir and hand back a flat list of artifacts + edges.
 *
 * What counts as an artifact (convention every plugin follows):
 *   <stateDir>/<plugin>/**.json   one of: { id, ... } | { items: [ {id,...} ] } | [ {id,...} ]
 *   <stateDir>/<plugin>/**.md     with a frontmatter block containing `id:`
 * What is NOT an artifact:
 *   project.json gates.json registry.json (core's), trace.*.json (edges), export/** (outputs only).
 *
 * Every artifact is normalized to:
 *   { id, prefix, owner, plugin, file, line, status, title, app, module, refs[] , raw }
 * where refs[] = every known id that appears anywhere in the record (except itself). Explicit,
 * named edges come from trace.<plugin>.json; refs are the implicit ones and are enough for
 * change-impact walks until a plugin declares something finer.
 */
import fs from "node:fs";
import path from "node:path";
import { walk, rel, readJson } from "./paths.mjs";
import { validate, prefixOf, PREFIXES, PLUGINS } from "./ids.mjs";

const CORE_FILE_NAMES = new Set(["project.json", "gates.json", "registry.json"]);

export function isTraceFile(file) {
  return /^trace\.[a-z]+\.json$/.test(path.basename(file));
}

function pluginOf(stateDir, file) {
  const first = rel(stateDir, file).split("/")[0];
  return PLUGINS.includes(first) ? first : null;
}

function moduleOf(stateDir, file, id) {
  const m = /^[A-Z]+-([a-z0-9-]+)-[0-9]{3}/.exec(id ?? "");
  if (m && PREFIXES[prefixOf(id)]?.scope !== "project") return m[1];
  const parts = rel(stateDir, file).split("/");
  return parts.length >= 3 ? parts[1] : null;
}

function collectRefs(obj, selfId, out = new Set()) {
  if (obj == null) return out;
  if (typeof obj === "string") {
    if (obj !== selfId && validate(obj).ok) out.add(obj);
    return out;
  }
  if (Array.isArray(obj)) {
    for (const v of obj) collectRefs(v, selfId, out);
    return out;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) if (k !== "id") collectRefs(v, selfId, out);
  }
  return out;
}

function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith("[") && v.endsWith("]")) v = v.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
    fm[kv[1]] = v;
  }
  return fm;
}

function normalize(stateDir, file, raw, line) {
  const id = raw.id;
  return {
    id,
    prefix: prefixOf(id),
    owner: PREFIXES[prefixOf(id)]?.owner ?? null,
    plugin: pluginOf(stateDir, file),
    file: rel(stateDir, file),
    line,
    status: raw.status ?? "draft",
    title: raw.title ?? raw.name ?? null,
    app: raw.app ?? null,
    module: moduleOf(stateDir, file, id),
    refs: [...collectRefs(raw, id)],
    raw,
  };
}

/** Returns { artifacts, edges, files, problems } — never throws on a bad file; records it in problems. */
export function loadState(stateDir) {
  const artifacts = [];
  const edges = [];
  const files = [];
  const problems = [];

  const candidates = walk(stateDir, (p) => {
    const r = rel(stateDir, p);
    if (r.startsWith("export/")) return false;
    if (CORE_FILE_NAMES.has(path.basename(p)) && !r.includes("/")) return false;
    return p.endsWith(".json") || p.endsWith(".md");
  });

  for (const file of candidates) {
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/).length;
    files.push({ file: rel(stateDir, file), lines });

    if (isTraceFile(file)) {
      try {
        const t = readJson(file);
        const owner = t.owner ?? path.basename(file).split(".")[1];
        for (const e of t.edges ?? []) edges.push({ from: e.from, rel: e.rel ?? "refs", to: e.to, owner, file: rel(stateDir, file) });
      } catch (e) {
        problems.push({ file: rel(stateDir, file), reason: e.message });
      }
      continue;
    }

    if (file.endsWith(".md")) {
      const fm = parseFrontmatter(text);
      if (fm?.id) artifacts.push(normalize(stateDir, file, fm, 1));
      continue;
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      problems.push({ file: rel(stateDir, file), reason: `invalid JSON — ${e.message}` });
      continue;
    }
    const records = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : data.id ? [data] : [];
    if (records.length === 0 && pluginOf(stateDir, file)) {
      problems.push({ file: rel(stateDir, file), reason: "no artifact records found (expected {id} | {items:[]} | [])", severity: "warn" });
    }
    for (const r of records) {
      if (!r || typeof r !== "object" || !r.id) {
        problems.push({ file: rel(stateDir, file), reason: "record without id" });
        continue;
      }
      artifacts.push(normalize(stateDir, file, r, null));
    }
  }

  for (const a of artifacts) for (const to of a.refs) edges.push({ from: a.id, rel: "refs", to, owner: a.plugin ?? "unknown", file: a.file });

  return { artifacts, edges, files, problems };
}
