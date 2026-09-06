#!/usr/bin/env node
/**
 * run.mjs — a run is a new record every time, and a verdict is what a command said.
 *
 *   node run.mjs <module|TC-nnn|UC-nnn> [--state-dir X] [--code-root <path>]
 *
 * Nothing here decides whether a test passed: `expect` on the step does, against the output the
 * step produced. The session's opinion of the output is not recorded anywhere, on purpose (P6).
 * A run is never overwritten — RUN-002 does not edit RUN-001, and the evidence of both stays.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs, resolveStateDir, stateExists, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { prefixOf } from "../../core/scripts/ids.mjs";
import { ensureInit } from "./init.mjs";
import { FILES, allTcs, allRuns, allDefs, mintId, upsert, strip, addEdges, apiComponent, codeRoot as codeRootOf, gitHead, runArgv, runCmd, writeEvidence, checkExpect, defOpen, moduleOf, now } from "./lib.mjs";

/** module name · a TC id · a UC id — the three ways an owner says "run this". */
export function inScope(tcs, scope) {
  const p = prefixOf(scope);
  if (p === "TC") return tcs.filter((t) => t.id === scope);
  if (p === "UC") return tcs.filter((t) => t.usecase === scope);
  return tcs.filter((t) => moduleOf(t.id) === scope);
}

export function run(stateDir, scope, codeRoot) {
  ensureInit(stateDir);
  const all = allTcs(stateDir);
  const scoped = inScope(all, scope).sort((a, b) => a.id.localeCompare(b.id));
  orExit2(scoped.length, `nothing to run for "${scope}" — /qa:cases <module> writes a test case per scenario`);

  const runs = allRuns(stateDir);
  const runId = mintId(runs.map((r) => r.id), "RUN");
  const cmp = apiComponent(stateDir);
  const healthcheckCmd = cmp?.run?.healthcheck ?? null;

  // The system is either up or it is not, and a run against a system that is down records that
  // rather than a page of failures that all mean the same thing.
  let health = { cmd: healthcheckCmd, exitCode: null, evidence: null, up: false };
  if (healthcheckCmd) {
    const r = runCmd(healthcheckCmd, codeRoot);
    const name = `${runId}-healthcheck-${r.exitCode === 0 ? "pass" : "fail"}.log`;
    const dir = FILES.evidenceDir(stateDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), `# ${runId} healthcheck\n# cmd  ${r.cmd}\n# exit ${r.exitCode}\n\n${r.out}\n`, "utf8");
    health = { cmd: healthcheckCmd, exitCode: r.exitCode, evidence: path.posix.join("qa", "evidence", name), up: r.exitCode === 0 };
  }

  const results = [];
  for (const tc of scoped) {
    if (!tc.runnable) {
      results.push({ tc: tc.id, verdict: "blocked", reason: `not runnable: ${(tc.gaps ?? []).join(" · ")}`, steps: [] });
      continue;
    }
    if (!health.up) {
      results.push({ tc: tc.id, verdict: "blocked", reason: healthcheckCmd ? `the system is not up: ${health.cmd} exited ${health.exitCode}` : `no component declares a healthcheck, so nothing says the system is up`, steps: [], evidence: health.evidence });
      continue;
    }
    const steps = [];
    for (const st of tc.steps ?? []) {
      if (!st.argv) {
        steps.push({ n: st.n, via: st.via, result: "skip", exitCode: null, why: st.via === "ui" ? `a step on ${st.testid} needs a browser runner (G-qa-007)` : `no command on this step`, evidence: writeEvidence(stateDir, { tc: tc.id, run: runId, step: st.n, result: "skip", cmd: st.cmd ?? "(none)", out: `skipped: ${st.via} step`, exitCode: "-" }) });
        continue;
      }
      const out = runArgv(st.argv, codeRoot);
      const problems = checkExpect(st.expect, out);
      const result = problems.length ? "fail" : "pass";
      steps.push({ n: st.n, via: st.via, result, exitCode: out.exitCode, ...(problems.length ? { problems } : {}), evidence: writeEvidence(stateDir, { tc: tc.id, run: runId, step: st.n, result, cmd: out.cmd, out: out.out, exitCode: out.exitCode }) });
    }
    const ran = steps.filter((s) => s.result !== "skip");
    const verdict = steps.some((s) => s.result === "fail") ? "fail" : ran.length === 0 ? "blocked" : steps.some((s) => s.result === "skip") ? "partial" : "pass";
    results.push({ tc: tc.id, verdict, steps });
  }

  const record = {
    id: runId,
    title: `run ${scope}`,
    status: "verified",
    scope,
    codeVersion: gitHead(codeRoot),
    env: { os: `${os.type()} ${os.release()}`, node: process.version, healthcheck: health },
    results,
    at: now(),
  };
  upsert(FILES.run(stateDir, runId), record);
  addEdges(stateDir, results.map((r) => ({ from: runId, rel: "ran", to: r.tc })));

  // The test cases and the findings learn what the run said. Nothing else writes these fields.
  const defs = allDefs(stateDir);
  const closed = [];
  for (const r of results) {
    const tc = scoped.find((t) => t.id === r.tc);
    const next = { ...strip(tc), lastRun: runId, lastVerdict: r.verdict, status: r.verdict === "pass" ? "verified" : tc.status === "verified" ? "approved" : tc.status };
    upsert(FILES.tc(stateDir, moduleOf(tc.id), tc.id), next);
    if (r.verdict !== "pass") continue;
    for (const d of defs.filter((d) => d.tc === r.tc && defOpen(d))) {
      upsert(FILES.def(stateDir, moduleOf(d.id), d.id), { ...strip(d), status: "verified", closedBy: runId, closedAt: now() });
      closed.push(d.id);
    }
  }

  return { record, results, closed, health, scoped };
}

if (isMain(import.meta.url)) {
  const { _, flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  orExit2(stateExists(stateDir), `no state dir at ${stateDir}`);
  orExit2(_[0], "usage: run.mjs <module|TC-nnn|UC-nnn>");
  const codeRoot = typeof flags["code-root"] === "string" ? path.resolve(String(flags["code-root"])) : codeRootOf(stateDir);
  const { record, results, closed, health } = run(stateDir, _[0], codeRoot);

  const count = (v) => results.filter((r) => r.verdict === v).length;
  console.log(`RUN ${record.id}  scope ${record.scope}  ${results.length} case(s)  pass ${count("pass")}  fail ${count("fail")}  partial ${count("partial")}  blocked ${count("blocked")}`);
  console.log(`  code ${String(record.codeVersion ?? "(not a git repository)").slice(0, 8)} · node ${record.env.node} · healthcheck ${health.cmd ? (health.up ? "up" : `DOWN (exit ${health.exitCode})`) : "(none declared)"}`);
  if (health.evidence) console.log(`  ${health.evidence}`);
  for (const r of results) {
    console.log(`\n  ${r.tc}  ${r.verdict.toUpperCase()}${r.reason ? `  — ${r.reason}` : ""}`);
    for (const s of r.steps) {
      console.log(`    step ${s.n} ${s.via.padEnd(5)} ${s.result.padEnd(5)} ${s.evidence}`);
      for (const p of s.problems ?? []) console.log(`      ${p}`);
    }
  }
  if (closed.length) console.log(`\nfindings closed by a green run: ${closed.join(", ")}`);
  const failed = results.filter((r) => r.verdict === "fail");
  if (failed.length) {
    console.log(`\nnext: /qa:finding ${failed[0].tc} --routing dev|design|req --reproduce "…" — the routing decides whether this is a bug or a change`);
    process.exit(1);
  }
  console.log(`\nwritten: qa/runs/${record.id}.json · next: /qa:report ${moduleOf(results[0].tc)}`);
  process.exit(0);
}
