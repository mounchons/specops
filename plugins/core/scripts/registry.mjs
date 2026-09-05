#!/usr/bin/env node
/**
 * registry.mjs — registry.json is a CACHE. Truth lives in the artifact files; this file can be
 * deleted and rebuilt at any time. AI never reads it whole; query.mjs reads it and prints slices.
 *
 *   node registry.mjs --build [--state-dir X]     rebuild, print counts
 *   node registry.mjs --check                     exit 0 fresh | 1 stale or missing | 2 no state dir
 *   node registry.mjs --json                      print the registry (for other scripts)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseArgs, resolveStateDir, stateExists, CORE_FILES, readJson, writeJson, walk, rel, orExit2 } from "./paths.mjs";
import { loadState } from "./artifacts.mjs";

export function inputHash(stateDir) {
  const h = crypto.createHash("sha256");
  const files = walk(stateDir, (p) => {
    const r = rel(stateDir, p);
    return !r.startsWith("export/") && path.basename(p) !== "registry.json";
  }).sort();
  for (const f of files) {
    h.update(rel(stateDir, f));
    h.update(fs.readFileSync(f));
  }
  return h.digest("hex").slice(0, 16);
}

export function buildRegistry(stateDir) {
  const { artifacts, edges, files, problems } = loadState(stateDir);
  const index = {};
  const duplicates = [];
  for (const a of artifacts) {
    if (index[a.id]) duplicates.push({ id: a.id, files: [index[a.id].file, a.file] });
    index[a.id] = { prefix: a.prefix, owner: a.owner, plugin: a.plugin, file: a.file, status: a.status, module: a.module, app: a.app, title: a.title };
  }
  const seen = new Set();
  const uniqueEdges = [];
  for (const e of edges) {
    const k = `${e.from}|${e.rel}|${e.to}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniqueEdges.push({ from: e.from, rel: e.rel, to: e.to, owner: e.owner });
  }
  const byPrefix = {};
  for (const a of artifacts) byPrefix[a.prefix] = (byPrefix[a.prefix] ?? 0) + 1;

  return {
    schemaVersion: "1.0",
    note: "CACHE — rebuilt by core/scripts/registry.mjs --build. Do not edit. Do not read whole; use query.mjs.",
    builtAt: new Date().toISOString(),
    inputHash: inputHash(stateDir),
    counts: { artifacts: artifacts.length, edges: uniqueEdges.length, files: files.length, byPrefix },
    index,
    edges: uniqueEdges,
    files,
    duplicates,
    problems,
  };
}

export function loadRegistry(stateDir) {
  return readJson(CORE_FILES.registry(stateDir), null);
}

export function isStale(stateDir) {
  const reg = loadRegistry(stateDir);
  if (!reg) return true;
  return reg.inputHash !== inputHash(stateDir);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  orExit2(stateExists(stateDir), `no state dir at ${stateDir} — run core/scripts/init.mjs first`);

  if (flags.check) {
    const stale = isStale(stateDir);
    console.log(stale ? `STALE registry.json — run --build` : `FRESH registry.json`);
    process.exit(stale ? 1 : 0);
  }
  if (flags.json) {
    const reg = loadRegistry(stateDir) ?? buildRegistry(stateDir);
    console.log(JSON.stringify(reg));
    process.exit(0);
  }
  const reg = buildRegistry(stateDir);
  writeJson(CORE_FILES.registry(stateDir), reg);
  console.log(`BUILT registry.json  artifacts=${reg.counts.artifacts} edges=${reg.counts.edges} files=${reg.counts.files}`);
  for (const [p, n] of Object.entries(reg.counts.byPrefix)) console.log(`  ${p.padEnd(5)} ${n}`);
  if (reg.duplicates.length) console.log(`DUPLICATE ids: ${reg.duplicates.map((d) => d.id).join(", ")}`);
  for (const p of reg.problems) console.log(`${p.severity === "warn" ? "WARN " : "ERROR"} ${p.file}: ${p.reason}`);
  process.exit(0);
}
