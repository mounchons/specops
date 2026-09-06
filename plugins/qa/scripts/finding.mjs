#!/usr/bin/env node
/**
 * finding.mjs — routing is the whole command.
 *
 *   node finding.mjs <TC> --routing dev|design|req --reproduce "..."
 *                    [--severity s1..s4] [--kind display|screen|report|rule|other]
 *                    [--touches ids] [--evidence <file>] [--state-dir X]
 *
 * dev   — the code does not do what the spec already says. A bug. No change request, no money.
 * design/req — the spec is what is wrong or what changed. That is a change request, and the command
 *              opens it here rather than leaving it to be remembered: `source: finding`, naming this
 *              defect. Which of the two it is decides whether the client is billed, so it is never
 *              inferred from the wording of the complaint — the owner says it and the record keeps it.
 *
 * The defect is written to disk before the change request is opened, because change's own gate
 * refuses a CR whose finding does not exist yet. Persist, then answer (rule 7).
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs, resolveStateDir, stateExists, rel, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { openCr } from "../../change/scripts/open.mjs";
import { ensureInit } from "./init.mjs";
import { FILES, ROUTINGS, SEVERITIES, allTcs, allDefs, allRuns, mintId, upsert, strip, addEdges, list, moduleOf, now } from "./lib.mjs";

export function finding(stateDir, tcId, o = {}) {
  ensureInit(stateDir);
  const tc = allTcs(stateDir).find((t) => t.id === tcId);
  orExit2(tc, `no such test case: ${tcId} — /qa:cases <module> writes one per scenario`);
  orExit2(ROUTINGS.includes(o.routing), `--routing must be one of ${ROUTINGS.join("|")} — it decides whether this is a bug or a change, and nobody can read that off the complaint`);
  orExit2(String(o.reproduce ?? "").trim(), `--reproduce is required — a finding nobody can reproduce is an opinion`);
  orExit2(!o.severity || SEVERITIES.includes(o.severity), `--severity must be one of ${SEVERITIES.join("|")}`);

  const module = moduleOf(tc.id);
  const evidence = list(o.evidence).map((f) => {
    orExit2(fs.existsSync(f), `--evidence ${f} does not exist — a signature, a screenshot or a log is evidence; a sentence is not`);
    const abs = path.resolve(f);
    return abs.startsWith(path.resolve(stateDir)) ? rel(stateDir, abs) : path.relative(process.cwd(), abs).split(path.sep).join("/");
  });
  const lastRun = allRuns(stateDir).find((r) => r.id === tc.lastRun) ?? null;
  const failed = lastRun?.results?.find((r) => r.tc === tc.id && r.verdict === "fail") ?? null;
  orExit2(failed || evidence.length, `${tc.id}'s last run did not fail (${tc.lastVerdict ?? "never run"}) — run it first, or bring what was seen instead: --evidence <file>`);

  const defs = allDefs(stateDir);
  const already = defs.find((d) => d.tc === tc.id && d.routing === o.routing && d.status !== "verified");
  if (already) return { def: already, tc, cr: null, reused: true };

  const id = mintId(defs.map((d) => d.id), "DEF", module);
  const def = {
    id,
    title: String(o.title ?? o.reproduce).trim().split("\n")[0].slice(0, 120),
    status: "draft",
    source: "run",
    tc: tc.id,
    scenario: tc.scenario,
    usecase: tc.usecase,
    run: failed ? lastRun.id : null,
    evidence: [...evidence, ...(failed?.steps ?? []).map((s) => s.evidence).filter(Boolean)],
    severity: o.severity ?? "s3",
    routing: o.routing,
    reproduce: String(o.reproduce).trim(),
    cr: null,
    raisedAt: now(),
  };
  upsert(FILES.def(stateDir, module, id), def);
  addEdges(stateDir, [{ from: id, rel: "found-in", to: tc.id }]);
  if (o.routing === "dev") return { def, tc, cr: null, reused: false };

  // The spec is what is wrong. That is a change request, and it is opened now — not written on a
  // list of things to open later. `touches` defaults to the scenario, because a scenario that did
  // not describe the case the system got wrong is the artifact that has to change.
  const touches = list(o.touches).length ? list(o.touches).join(",") : tc.scenario;
  const { cr } = openCr(stateDir, {
    kind: o.kind ?? "rule",
    source: "finding",
    title: `${def.title} (${def.id})`,
    request: def.reproduce,
    touches,
    fields: o.fields ?? null,
    finding: def.id,
    module,
  });
  const withCr = { ...def, cr: cr.id };
  upsert(FILES.def(stateDir, module, id), withCr);
  return { def: withCr, tc, cr, reused: false };
}

if (isMain(import.meta.url)) {
  const { _, flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  orExit2(stateExists(stateDir), `no state dir at ${stateDir}`);
  orExit2(_[0], `usage: finding.mjs <TC> --routing dev|design|req --reproduce "…"`);
  const r = finding(stateDir, _[0], {
    routing: typeof flags.routing === "string" ? flags.routing : null,
    reproduce: typeof flags.reproduce === "string" ? flags.reproduce : null,
    severity: typeof flags.severity === "string" ? flags.severity : null,
    kind: typeof flags.kind === "string" ? flags.kind : null,
    touches: typeof flags.touches === "string" ? flags.touches : null,
    fields: typeof flags.fields === "string" ? flags.fields : null,
    title: typeof flags.title === "string" ? flags.title : null,
    evidence: typeof flags.evidence === "string" ? flags.evidence : null,
  });

  if (r.reused) {
    console.log(`ALREADY ${r.def.id}  ${r.def.tc} is already routed to ${r.def.routing}${r.def.cr ? ` under ${r.def.cr}` : ""} — one defect per case per routing, not one per run`);
    process.exit(0);
  }
  console.log(`FINDING ${r.def.id}  ${r.def.tc}  routing ${r.def.routing}  severity ${r.def.severity}`);
  console.log(`  ${r.def.title}`);
  console.log(`  scenario ${r.def.scenario}${r.def.usecase ? ` · use case ${r.def.usecase}` : ""}${r.def.run ? ` · run ${r.def.run}` : ""}`);
  for (const e of r.def.evidence) console.log(`  evidence: ${e}`);
  if (r.def.routing === "dev") {
    console.log(`\n  routing dev — the code does not do what the spec already says. No change request, and nothing to bill.`);
    console.log(`  dev fixes it and /qa:run ${r.def.tc} closes it. dev cannot close it; a green run does.`);
  } else {
    console.log(`\n  routing ${r.def.routing} — the spec is what is wrong, so this is a change:`);
    console.log(`  ${r.cr.id} opened  ${r.cr.kind} · source finding · touches ${r.cr.touches.join(", ") || "(nothing)"}`);
    console.log(`  next: /change:impact ${r.cr.id} — the lane is decided by the graph, not by the complaint`);
  }
  process.exit(0);
}
