#!/usr/bin/env node
/**
 * status.mjs — what exists, in what state. Read from disk, never from the conversation.
 *
 *   node status.mjs [--json] [--state-dir X]
 */
import { parseArgs, resolveStateDir, stateExists, CORE_FILES, readJson, orExit2 } from "./paths.mjs";
import { buildRegistry } from "./registry.mjs";
import { runGates } from "./gates.mjs";
import { PLUGINS, STATUSES, prefixOf } from "./ids.mjs";

export async function collectStatus(stateDir) {
  const project = readJson(CORE_FILES.project(stateDir));
  const reg = buildRegistry(stateDir);
  const gates = await runGates(stateDir);

  const byPlugin = {};
  for (const p of PLUGINS) byPlugin[p] = { installed: Boolean(project.plugins?.[p]), total: 0, byStatus: Object.fromEntries(STATUSES.map((s) => [s, 0])) };
  for (const r of Object.values(reg.index)) {
    const p = r.owner ?? "unknown";
    if (!byPlugin[p]) byPlugin[p] = { installed: false, total: 0, byStatus: {} };
    byPlugin[p].total++;
    byPlugin[p].byStatus[r.status] = (byPlugin[p].byStatus[r.status] ?? 0) + 1;
  }
  const openCR = Object.entries(reg.index).filter(([id, r]) => prefixOf(id) === "CR" && r.file.includes("change/open/")).map(([id]) => id);

  return { project: { name: project.name, phase: project.phase?.current ?? 0, apps: project.apps ?? [], modules: project.modules ?? [] }, byPlugin, counts: reg.counts, gates: gates.counts, gateFindings: gates.results, openCR };
}

function print(s) {
  console.log(`# ${s.project.name}  phase=${s.project.phase}`);
  console.log(`apps: ${s.project.apps.map((a) => `${a.name}(${a.type})`).join(", ") || "(none)"}   modules: ${s.project.modules.join(", ") || "(none)"}`);
  console.log(`artifacts=${s.counts.artifacts} edges=${s.counts.edges} files=${s.counts.files}`);
  console.log("plugin   inst  total  " + STATUSES.join("  "));
  for (const [p, v] of Object.entries(s.byPlugin)) {
    const cols = STATUSES.map((st) => String(v.byStatus[st] ?? 0).padStart(st.length)).join("  ");
    console.log(`${p.padEnd(8)} ${(v.installed ? "yes" : "no").padEnd(5)} ${String(v.total).padStart(5)}  ${cols}`);
  }
  console.log(`gates: error=${s.gates.error} warn=${s.gates.warn} limit=${s.gates.limit}`);
  for (const r of s.gateFindings.filter((r) => r.severity === "error").slice(0, 8)) console.log(`  ERROR ${r.gate} ${r.subject}: ${r.message}`);
  console.log(`open CR: ${s.openCR.join(", ") || "none"}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  orExit2(stateExists(stateDir), `no state dir at ${stateDir} — run init.mjs`);
  const s = await collectStatus(stateDir);
  if (flags.json) console.log(JSON.stringify(s, null, 2));
  else print(s);
  process.exit(s.gates.error ? 1 : 0);
}
