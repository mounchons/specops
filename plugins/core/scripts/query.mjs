#!/usr/bin/env node
/**
 * query.mjs — the slice. Constitution rule 6: commands take ids, scripts hand slices.
 *
 *   node query.mjs <id> [--depth 2] [--json] [--no-body]
 *
 * Prints: the record itself, what it points at (downstream), what points at it (upstream),
 * open CRs that touch it, and a status summary. Rebuilds registry.json if stale.
 * Accepts a lineage id too (BR-loan-001 matches every @vN).
 */
import { parseArgs, resolveStateDir, stateExists, CORE_FILES, writeJson, orExit2 } from "./paths.mjs";
import { buildRegistry, loadRegistry, isStale } from "./registry.mjs";
import { loadState } from "./artifacts.mjs";
import { lineageOf, prefixOf } from "./ids.mjs";

export function ensureRegistry(stateDir) {
  if (isStale(stateDir)) {
    const reg = buildRegistry(stateDir);
    writeJson(CORE_FILES.registry(stateDir), reg);
    return reg;
  }
  return loadRegistry(stateDir);
}

export function resolveIds(reg, idOrLineage) {
  if (reg.index[idOrLineage]) return [idOrLineage];
  const want = lineageOf(idOrLineage);
  return Object.keys(reg.index).filter((id) => lineageOf(id) === want);
}

export function neighbours(reg, id, dir, depth) {
  const out = [];
  const seen = new Set([id]);
  let frontier = [id];
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next = [];
    for (const e of reg.edges) {
      const hit = dir === "down" ? frontier.includes(e.from) : frontier.includes(e.to);
      if (!hit) continue;
      const other = dir === "down" ? e.to : e.from;
      if (seen.has(other)) continue;
      seen.add(other);
      next.push(other);
      out.push({ depth: d, id: other, rel: e.rel, via: dir === "down" ? e.from : e.to, status: reg.index[other]?.status ?? "(missing)", file: reg.index[other]?.file ?? null });
    }
    frontier = next;
  }
  return out;
}

export function openChangesTouching(reg, ids) {
  return Object.entries(reg.index)
    .filter(([id, r]) => prefixOf(id) === "CR" && r.file.includes("change/open/"))
    .map(([id]) => id)
    .filter((cr) => reg.edges.some((e) => e.from === cr && ids.includes(e.to)));
}

export function slice(stateDir, idOrLineage, { depth = 2, body = true } = {}) {
  const reg = ensureRegistry(stateDir);
  const ids = resolveIds(reg, idOrLineage);
  if (ids.length === 0) return { found: false, query: idOrLineage };
  const state = body ? loadState(stateDir) : null;
  return {
    found: true,
    query: idOrLineage,
    records: ids.map((id) => ({
      id,
      ...reg.index[id],
      body: body ? state.artifacts.find((a) => a.id === id)?.raw ?? null : undefined,
      down: neighbours(reg, id, "down", depth),
      up: neighbours(reg, id, "up", depth),
    })),
    openChanges: openChangesTouching(reg, ids),
  };
}

function print(s) {
  if (!s.found) {
    console.log(`NOT FOUND ${s.query}`);
    return;
  }
  for (const r of s.records) {
    console.log(`## ${r.id}  [${r.status}]  owner=${r.owner}  file=${r.file}`);
    if (r.title) console.log(`   ${r.title}`);
    if (r.body) console.log("   body: " + JSON.stringify(r.body));
    if (r.down.length) {
      console.log("   -> points at:");
      for (const n of r.down) console.log(`      ${"  ".repeat(n.depth - 1)}${n.rel} ${n.id} [${n.status}]`);
    }
    if (r.up.length) {
      console.log("   <- pointed at by:");
      for (const n of r.up) console.log(`      ${"  ".repeat(n.depth - 1)}${n.id} [${n.status}] (${n.rel})`);
    }
  }
  console.log(s.openChanges.length ? `OPEN CR touching: ${s.openChanges.join(", ")}` : "OPEN CR touching: none");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { _, flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  orExit2(stateExists(stateDir), `no state dir at ${stateDir}`);
  orExit2(_[0], "usage: query.mjs <id> [--depth N] [--json] [--no-body]");
  const s = slice(stateDir, _[0], { depth: Number(flags.depth ?? 2), body: !flags["no-body"] });
  if (flags.json) console.log(JSON.stringify(s, null, 2));
  else print(s);
  process.exit(s.found ? 0 : 1);
}
