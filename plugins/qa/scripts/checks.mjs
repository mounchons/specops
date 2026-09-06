#!/usr/bin/env node
/**
 * checks.mjs — qa's rules, as functions. Core loads CHECKS (gates.mjs) and NEXT (next.mjs) once
 * project.json names plugins.qa.root.
 *
 * G-qa-007 (`qa:ui-runner`) and G-qa-008 (`qa:no-duplicate-unit`) are deliberately absent from
 * CHECKS: there is no browser runner here, and no script can tell whether an end-to-end step is
 * re-proving a unit test. gates.mjs prints both as LIMITs on every run — constitution rule 1
 * working as intended, not an oversight.
 */
import fs from "node:fs";
import path from "node:path";
import { allTcs, allRuns, allDefs, verifiedUseCases, defOpen, moduleOf } from "./lib.mjs";
import { allCrs } from "../../change/scripts/lib.mjs";

const of = (state, prefix) => state.artifacts.filter((a) => a.prefix === prefix);
const raw = (a) => a.raw ?? {};

/** Evidence is written under the state dir; a file the owner brought by hand keeps the path they gave. */
const evidenceExists = (stateDir, p) => fs.existsSync(path.join(stateDir, p)) || fs.existsSync(p);

const runsOf = (stateDir) => allRuns(stateDir);
const passedIn = (run, tc) => (run.results ?? []).some((r) => r.tc === tc && r.verdict === "pass");

export const CHECKS = {
  "qa:scn-without-tc": ({ state, stateDir }) => {
    const built = verifiedUseCases(stateDir);
    const covered = new Set(allTcs(stateDir).map((t) => t.scenario));
    return of(state, "SCN")
      .filter((s) => raw(s).usecase && built.has(raw(s).usecase) && !covered.has(s.id))
      .map((s) => ({ subject: s.file, message: `${s.id} (${s.title}) belongs to ${raw(s).usecase}, which dev has verified, and no test case covers it — built and never tested · /qa:cases ${s.module}` }));
  },

  "qa:tc-verified-needs-run": ({ stateDir }) => {
    const runs = runsOf(stateDir);
    return allTcs(stateDir)
      .filter((t) => t.status === "verified" && !runs.some((r) => passedIn(r, t.id)))
      .map((t) => ({ subject: `qa/${moduleOf(t.id)}/cases/${t.id}.json`, message: `${t.id} (${t.title}) is verified and no run has it passing — a verdict is what a command said, not a status somebody typed` }));
  },

  "qa:def-routing-needs-cr": ({ stateDir }) =>
    allDefs(stateDir)
      .filter((d) => defOpen(d) && ["design", "req"].includes(d.routing) && !d.cr)
      .map((d) => ({ subject: `qa/${moduleOf(d.id)}/findings/${d.id}.json`, message: `${d.id} is routed to ${d.routing} and names no change request — a defect whose root cause is the spec is a change, and a change that is not a CR is unbilled work nobody agreed to` })),

  "qa:evidence-missing": ({ stateDir }) => {
    const out = [];
    for (const r of runsOf(stateDir)) {
      const named = [r.env?.healthcheck?.evidence, ...(r.results ?? []).flatMap((x) => [x.evidence, ...(x.steps ?? []).map((s) => s.evidence)])].filter(Boolean);
      for (const p of named) if (!evidenceExists(stateDir, p)) out.push({ subject: `qa/runs/${r.id}.json`, message: `${r.id} names evidence ${p}, which is not on disk — a run whose evidence is gone proves nothing` });
    }
    for (const d of allDefs(stateDir))
      for (const p of d.evidence ?? []) if (!evidenceExists(stateDir, p)) out.push({ subject: `qa/${moduleOf(d.id)}/findings/${d.id}.json`, message: `${d.id} names evidence ${p}, which is not on disk` });
    return out;
  },

  "qa:def-closed-needs-green-run": ({ stateDir }) => {
    const runs = runsOf(stateDir);
    return allDefs(stateDir)
      .filter((d) => d.status === "verified")
      .filter((d) => !runs.some((r) => String(r.at) >= String(d.raisedAt) && passedIn(r, d.tc)))
      .map((d) => ({ subject: `qa/${moduleOf(d.id)}/findings/${d.id}.json`, message: `${d.id} is closed and no run since ${d.raisedAt} has ${d.tc} passing — dev does not close a finding, a green run does` }));
  },

  "qa:tc-not-runnable": ({ stateDir }) => {
    const stuck = allTcs(stateDir).filter((t) => !t.runnable);
    return stuck.length
      ? [{ subject: "qa", message: `${stuck.length} test case(s) cannot be executed: ${stuck.slice(0, 4).map((t) => `${t.id} (${(t.gaps ?? [])[0] ?? "?"})`).join(" · ")}${stuck.length > 4 ? ` … +${stuck.length - 4}` : ""} — the handoff is incomplete somewhere upstream`, severity: "warn" }]
      : [];
  },
};

// ---- the callsheet ---------------------------------------------------------

const modulesWithScn = (ctx) => [...new Set(ctx.state.artifacts.filter((a) => a.prefix === "SCN" && a.module).map((a) => a.module))];

export const NEXT = [
  (ctx) => {
    const built = verifiedUseCases(ctx.stateDir);
    const covered = new Set(allTcs(ctx.stateDir).map((t) => t.scenario));
    return modulesWithScn(ctx)
      .filter((m) => ctx.state.artifacts.some((a) => a.prefix === "SCN" && a.module === m && built.has(a.raw?.usecase) && !covered.has(a.id)))
      .map((m) => ({ action: `/qa:cases ${m}`, reason: `${m} has scenarios under a verified task with no test case — one per scenario, and qa asks nobody to write them` }));
  },
  (ctx) => {
    const waiting = allTcs(ctx.stateDir).filter((t) => t.runnable && !t.lastRun);
    return waiting.length ? [{ action: `/qa:run ${moduleOf(waiting[0].id)}`, reason: `${waiting.length} runnable test case(s) have never been run: ${waiting.slice(0, 3).map((t) => t.id).join(", ")}` }] : [];
  },
  (ctx) => {
    const defs = allDefs(ctx.stateDir);
    return allTcs(ctx.stateDir)
      .filter((t) => t.lastVerdict === "fail" && !defs.some((d) => d.tc === t.id && d.status !== "verified"))
      .map((t) => ({ action: `/qa:finding ${t.id} --routing dev|design|req --reproduce "…"`, reason: `${t.id} failed in ${t.lastRun} and nobody has said whether the code or the spec is wrong — that answer is what decides if this is billable` }));
  },
  (ctx) =>
    allDefs(ctx.stateDir)
      .filter((d) => d.status !== "verified" && d.routing === "dev")
      .map((d) => ({ action: `/qa:run ${d.tc}`, reason: `${d.id} is a bug for dev; when it is fixed, only a green run closes it` })),
  // A finding routed to design waits on its change request, and the callsheet has to say which part
  // of that wait it is in. Before this it always said "/change:impact", so DEF-rental-003 kept asking
  // for the impact of CR-004 long after CR-004 was walked, applied and closed.
  //   open, no impact yet  -> impact it; the lane comes from the graph
  //   open and impacted    -> nothing from qa; change's own rules own apply and close
  //   closed               -> a run, like any other finding: a change that answered it on paper is
  //                           still a claim until something green says so (P6)
  (ctx) => {
    const crs = new Map(allCrs(ctx.stateDir).map((c) => [c.id, c]));
    return allDefs(ctx.stateDir)
      .filter((d) => defOpen(d) && d.cr)
      .map((d) => {
        const cr = crs.get(d.cr);
        if (!cr) return { action: `/core:query ${d.cr}`, reason: `${d.id} names ${d.cr}, and no change request by that id is on disk — the finding points at nothing` };
        if (cr.__open) return cr.impact ? null : { action: `/change:impact ${d.cr}`, reason: `${d.id} routed to ${d.routing} and opened ${d.cr} — the lane comes from the graph` };
        return d.tc ? { action: `/qa:run ${d.tc}`, reason: `${d.id} routed to ${d.routing} and ${d.cr} is closed — the change answered it on paper, and only a green run says it answered it` } : null;
      })
      .filter(Boolean);
  },
  (ctx) => {
    const tcs = allTcs(ctx.stateDir).filter((t) => t.runnable);
    return tcs.length && tcs.every((t) => t.lastVerdict === "pass")
      ? [{ action: `/qa:report ${moduleOf(tcs[0].id)}`, reason: `every runnable test case passed in its last run — the report counts it from the records` }]
      : [];
  },
];
