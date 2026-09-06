#!/usr/bin/env node
/**
 * cases.mjs — one executable test case per scenario, written without asking anyone.
 *
 *   node cases.mjs <module> [--state-dir X]
 *
 * The brief is exact about this: qa asks nobody. So a question it would have had to ask is written
 * down instead — as a `gap` on the case, and, when dev has already called that use case verified,
 * as a `DEF` routed to dev. "The handoff is incomplete" is a finding, not a conversation.
 */
import { parseArgs, resolveStateDir, stateExists, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { loadState } from "../../core/scripts/artifacts.mjs";
import { isFrozen } from "../../change/scripts/checks.mjs";
import { ensureInit } from "./init.mjs";
import { FILES, allTcs, allDefs, of, byId, raw, mintId, upsert, strip, addEdges, apiComponent, originOf, verifiedUseCases, shellText, causeOf, defOpen, moduleOf, now } from "./lib.mjs";

const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const norm = (s) => String(s ?? "").split(",").join("");

/** Every scalar the golden row was fed, looked for in the scenario's own words. */
function goldenFor(gds, given) {
  const hay = norm(given);
  for (const gd of gds) {
    for (const row of gd.rows ?? []) {
      const values = Object.values(row.input ?? {}).filter((v) => v !== null && typeof v !== "object");
      if (values.length && values.every((v) => hay.includes(norm(v)))) return { gd: gd.id, label: row.label ?? "", input: row.input, expected: row.expected };
    }
  }
  return null;
}

/** The answer key as fields to look for in a response: {days:3, fee:2400}, or {value:900} for a bare number. */
function expectFields(match) {
  if (!match) return null;
  const e = match.expected;
  if (e === null || e === undefined) return null;
  if (typeof e !== "object") return null;
  const out = {};
  for (const [k, v] of Object.entries(e)) if (v !== null && typeof v !== "object") out[k] = v;
  return Object.keys(out).length ? out : null;
}

/** Why this endpoint cannot be called, in the words of the record that is missing something. */
function endpointGaps(api, origin, cmp) {
  const gaps = [];
  if (!cmp) gaps.push(`no component: /dev:stack has not been answered, so nothing says where the system runs`);
  else if (!origin) gaps.push(`${cmp.id}.run.healthcheck names no URL, so there is no origin to call`);
  if (!api) return [...gaps, `no API record serves this use case's screens — /design:api <module>`];
  const p = String(api.path ?? "");
  if (!p) gaps.push(`${api.id} has no path`);
  else if (p.includes("//")) gaps.push(`${api.id} path is ${JSON.stringify(p)} — the resource segment is empty, so there is no address to call`);
  else if (/\{[^}]*\}/.test(p)) gaps.push(`${api.id} path is ${JSON.stringify(p)} — it needs an id no record supplies for this scenario`);
  if (WRITE.has(String(api.method).toUpperCase()) && !api.request) gaps.push(`${api.id}.request is null — nothing says what the endpoint takes, so a body cannot be built`);
  else if (WRITE.has(String(api.method).toUpperCase()) && !api.sample) gaps.push(`${api.id} declares its fields but no sample call — "request" says what the endpoint takes, not what a call that works looks like · /design:api <module> --records with "sample"`);
  return gaps;
}

/**
 * The body of a call, from the sample a person declared on the API record. `{{key}}` is a golden-row
 * input field; everything else in the sample is a constant the owner wrote — the id of a seeded row,
 * a customer, a date that is not part of the answer key. qa never invents either half: the golden row
 * is signed, the sample is declared, and where they do not meet the case says so instead of guessing.
 */
export function bodyFor(api, match) {
  const sample = api?.sample ?? null;
  if (sample === null || sample === undefined) return { body: null, gaps: [] };
  const missing = new Set();
  const fill = (v) => {
    if (typeof v === "string") {
      const m = /^\{\{([A-Za-z_][\w-]*)\}\}$/.exec(v);
      if (!m) return v;
      const got = match?.input?.[m[1]];
      if (got === undefined) {
        missing.add(m[1]);
        return v;
      }
      return got;
    }
    if (Array.isArray(v)) return v.map(fill);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]));
    return v;
  };
  const body = fill(sample);
  const gaps = missing.size
    ? [`${api.id}.sample names ${[...missing].map((k) => `{{${k}}}`).join(", ")} and ${match ? `the golden row ${match.gd} (${match.label}) has no such input` : "no golden row matches this scenario's given"}`]
    : [];
  return { body, gaps };
}

function httpStep(n, { api, origin, flow, body, fields }) {
  const url = `${origin}${api.path}`;
  const method = String(api.method).toUpperCase();
  const argv = ["curl", "-sS", "-w", "\\nHTTP_STATUS=%{http_code}\\n", "-X", method, url];
  if (body) argv.push("-H", "content-type: application/json", "-d", JSON.stringify(body));
  const expected = flow === "main" ? (method === "POST" ? 201 : 200) : "4xx";
  return {
    n,
    do: `${method} ${api.path} — ${api.title ?? api.action ?? "call the endpoint"}`,
    via: "http",
    api: api.id,
    cmd: shellText(argv),
    argv,
    expect: { http: expected, ...(fields ? { fields } : {}) },
  };
}

export function cases(stateDir, module, { refresh = false } = {}) {
  ensureInit(stateDir);
  const state = loadState(stateDir);
  const scns = of(state, "SCN").filter((a) => a.module === module && a.status !== "retired");
  orExit2(scns.length, `module "${module}" has no scenario — /design:scenario ${module} first`);

  const acs = of(state, "AC").map((a) => a.raw);
  const uis = [...of(state, "UI"), ...of(state, "RPT")].map((a) => a.raw);
  const apis = of(state, "API").map((a) => a.raw);
  const mcks = of(state, "MCK").map((a) => a.raw);
  const gds = of(state, "GD").filter((a) => a.module === module).map((a) => a.raw);
  const cmp = apiComponent(stateDir);
  const origin = originOf(cmp?.run?.healthcheck);
  const built = verifiedUseCases(stateDir);

  const existing = allTcs(stateDir);
  const ids = existing.map((t) => t.id);
  const created = [];
  const refreshed = [];
  const blocked = [];
  const edges = [];

  for (const scn of scns) {
    const have = existing.find((t) => t.scenario === scn.id);
    if (have && !refresh) continue;
    if (!have) {
      const frozen = isFrozen(scn.id, { stateDir });
      if (frozen.frozen) {
        blocked.push({ id: scn.id, title: scn.title, by: frozen.by, lane: frozen.lane });
        continue;
      }
    }
    const s = scn.raw;
    const uc = s.usecase ? raw(byId(state, s.usecase)) : {};
    const myAcs = acs.filter((a) => a.usecase === s.usecase && (a.flow ?? "main") === (s.flow ?? "main")).map((a) => a.id);
    const myUis = uis.filter((u) => (u.derivedFrom ?? []).includes(s.usecase)).map((u) => u.id);
    const myApis = apis.filter((a) => myUis.includes(a.forUi) || (a.derivedFrom ?? []).some((d) => myUis.includes(d)));
    const api = myApis.find((a) => WRITE.has(String(a.method).toUpperCase())) ?? myApis[0] ?? null;
    const match = goldenFor(gds, s.given);
    const fields = expectFields(match);

    const { body, gaps: bodyGaps } = bodyFor(api, match);
    const gaps = s.usecase ? [...endpointGaps(api, origin, cmp), ...bodyGaps] : [`${scn.id} is a scenario of a non-functional requirement — it names no use case, so there is no endpoint to call`];
    if (s.usecase && !built.has(s.usecase)) gaps.push(`${s.usecase} has no verified task — dev has not built it yet, so there is nothing to run against`);

    const steps = [];
    if (gaps.length === 0) steps.push(httpStep(steps.length + 1, { api, origin, flow: s.flow ?? "main", body, fields }));
    for (const m of mcks.filter((m) => myUis.includes(m.ui)))
      for (const c of (m.zones ?? []).flatMap((z) => z.controls ?? []).filter((c) => String(c.from ?? "").startsWith("action:")))
        steps.push({ n: steps.length + 1, do: `on ${m.ui}, use ${c.testid}`, via: "ui", mock: m.id, testid: c.testid, cmd: null, argv: null, expect: {} });

    const runnable = gaps.length === 0 && steps.some((st) => st.argv);
    const id = have?.id ?? mintId(ids, "TC", module);
    if (!have) ids.push(id);
    const tc = {
      id,
      title: s.title ?? scn.title,
      status: have?.status === "verified" ? "verified" : runnable ? "approved" : "draft",
      scenario: scn.id,
      usecase: s.usecase ?? null,
      flow: s.flow ?? "main",
      given: s.given ?? "",
      expected: s.expected ?? "",
      acceptance: myAcs,
      screens: myUis,
      component: cmp?.id ?? null,
      data: match ? [match] : [],
      steps,
      runnable,
      gaps,
      lastRun: have?.lastRun ?? null,
      lastVerdict: have?.lastVerdict ?? null,
      createdAt: have?.createdAt ?? now(),
      ...(have ? { refreshedAt: now() } : {}),
    };
    upsert(FILES.tc(stateDir, module, id), tc);
    edges.push({ from: id, rel: "covers", to: scn.id }, ...myAcs.map((a) => ({ from: id, rel: "covers", to: a })));
    (have ? refreshed : created).push(tc);
  }

  if (edges.length) addEdges(stateDir, edges);

  // A case that cannot run against a use case dev has called verified is a hole in the handoff,
  // and the brief says qa writes that down rather than asking about it.
  const defs = allDefs(stateDir);
  const defIds = defs.map((d) => d.id);
  const kept = existing.filter((t) => scns.some((s) => s.id === t.scenario) && !refreshed.some((r) => r.id === t.id));
  // A handoff defect exists because a case could not run. When the gap upstream is fixed and the
  // case runs, the defect is not "verified" — nothing was tested — it is retired, and the record
  // says which gap went away. `verified` stays a green run's word (G-qa-005).
  const retired = [];
  for (const tc of [...created, ...refreshed, ...kept]) {
    if (!tc.runnable) continue;
    for (const d of defs.filter((d) => d.tc === tc.id && defOpen(d) && causeOf(d) === "handoff")) {
      upsert(FILES.def(stateDir, moduleOf(d.id), d.id), { ...strip(d), status: "retired", retiredAt: now(), retiredReason: `${tc.id} runs now — the gap it was raised for is gone: ${d.reproduce.split(": ").slice(1).join(": ") || d.reproduce}` });
      retired.push(d);
    }
  }

  const raised = [];
  for (const tc of [...created, ...refreshed, ...kept]) {
    if (tc.runnable || !tc.usecase || !built.has(tc.usecase)) continue;
    // one open defect per case per routing, the same rule finding.mjs enforces
    if (defs.some((d) => d.tc === tc.id && d.routing === "dev" && defOpen(d))) continue;
    const id = mintId(defIds, "DEF", module);
    defIds.push(id);
    const def = {
      id,
      title: `${tc.id} ไม่มีทางรันได้ — handoff ไม่ครบ`,
      status: "draft",
      source: "cases",
      tc: tc.id,
      scenario: tc.scenario,
      usecase: tc.usecase,
      run: null,
      evidence: [],
      severity: "s3",
      routing: "dev",
      cause: "handoff",
      reproduce: `/qa:cases ${module} could not build a runnable step for ${tc.id} (${tc.scenario}): ${tc.gaps.join(" · ")}`,
      cr: null,
      raisedAt: now(),
    };
    upsert(FILES.def(stateDir, module, id), def);
    addEdges(stateDir, [{ from: id, rel: "found-in", to: tc.id }]);
    raised.push(def);
  }

  return { module, created, refreshed, kept, blocked, raised, retired, cmp, origin };
}

if (isMain(import.meta.url)) {
  const { _, flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  orExit2(stateExists(stateDir), `no state dir at ${stateDir}`);
  orExit2(_[0], "usage: cases.mjs <module> [--refresh]");
  const r = cases(stateDir, _[0], { refresh: Boolean(flags.refresh) });

  console.log(`CASES ${r.module}  created ${r.created.length}  refreshed ${r.refreshed.length}  already there ${r.kept.length}  blocked ${r.blocked.length}  findings raised ${r.raised.length}  retired ${r.retired.length}`);
  console.log(`  system under test: ${r.cmp?.id ?? "(no component)"} ${r.origin ?? "(no origin)"}`);
  const rows = [...r.created, ...r.refreshed, ...r.kept].sort((a, b) => a.id.localeCompare(b.id));
  if (rows.length) {
    console.log(`\n  test case        scenario          steps  runnable`);
    console.log(`  --------------------------------------------------`);
    for (const t of rows) console.log(`  ${t.id.padEnd(16)} ${t.scenario.padEnd(17)} ${String(t.steps.length).padEnd(6)} ${t.runnable ? "yes" : "no"}`);
  }
  const notRunnable = rows.filter((t) => !t.runnable);
  if (notRunnable.length) {
    console.log(`\nnot runnable, and what stopped each one — this is the list, not a question:`);
    for (const t of notRunnable) for (const g of t.gaps) console.log(`  ${t.id}  ${g}`);
  }
  if (r.retired.length) {
    console.log(`
findings retired — the gap they were raised for is gone:`);
    for (const d of r.retired) console.log(`  ${d.id}  ${d.tc}  ${d.title}`);
  }
  if (r.raised.length) {
    console.log(`\nfindings routed to dev (the use case is verified and its case still cannot run):`);
    for (const d of r.raised) console.log(`  ${d.id}  ${d.tc}  ${d.title}`);
  }
  if (r.blocked.length) {
    console.log(`\nnot written:`);
    for (const b of r.blocked) console.log(`  ${b.id} ${b.title} — frozen by ${b.by} (lane ${b.lane}) · close the change first`);
    process.exit(1);
  }
  console.log(`\nnext: /qa:run ${r.module} — a new run every time, one evidence file per step`);
  process.exit(0);
}
