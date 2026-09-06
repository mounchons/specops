#!/usr/bin/env node
/**
 * lib.mjs — the plumbing every qa command shares. Nothing here is a rule; rules live in checks.mjs.
 *
 * W1: writes only <stateDir>/qa/**, <stateDir>/export/qa-* and <stateDir>/trace.qa.json, plus the
 * one sanctioned line in project.json (plugins.qa.root) that init.mjs writes. The change request a
 * finding opens is written by change's own openCr(), never by a file write from here.
 *
 * One record per file everywhere (qa/<module>/cases/<TC>.json, qa/<module>/findings/<DEF>.json,
 * qa/runs/<RUN>.json): phase 5 shipped one-file-per-module and G-core-005 refused it at nine
 * records. The `file` column in ids.mjs is a convention the loader does not enforce; the folder is.
 */
import { execSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CORE_FILES, readJson, writeJson, walk } from "../../core/scripts/paths.mjs";

export const SCHEMA = "1.0";
export const PLUGIN = "qa";
export const VERDICTS = ["pass", "fail", "partial", "blocked"];
export const ROUTINGS = ["dev", "design", "req"];
export const SEVERITIES = ["s1", "s2", "s3", "s4"];
/**
 * Where the defect's evidence came from, readable without opening the file: `cases` — the command
 * could not build a runnable step · `run` — a run failed and its step logs are the evidence ·
 * `hand` — somebody brought what they saw, a capture or a client's screenshot, with no failing run.
 */
export const DEF_SOURCES = ["cases", "run", "hand"];
export const STEP_TIMEOUT_MS = 120000;
export const EVIDENCE_CHARS = 8000;

export const FILES = {
  tc: (s, m, id) => path.join(s, "qa", m, "cases", `${id}.json`),
  def: (s, m, id) => path.join(s, "qa", m, "findings", `${id}.json`),
  run: (s, id) => path.join(s, "qa", "runs", `${id}.json`),
  evidenceDir: (s) => path.join(s, "qa", "evidence"),
  trace: (s) => path.join(s, "trace.qa.json"),
  reportDoc: (s, m) => path.join(s, "export", `qa-${m}.md`),
};

export const now = () => new Date().toISOString();
export const list = (v) => (typeof v === "string" ? v.split(",").map((x) => x.trim()).filter(Boolean) : Array.isArray(v) ? v : []);

/** The module an id belongs to: the segment between the prefix and the number. One definition. */
export const moduleOf = (id) => /^[A-Z]+-([a-z0-9-]+)-[0-9]{3}/.exec(String(id))?.[1] ?? null;

// ---- records ---------------------------------------------------------------

export function readItems(file) {
  if (!fs.existsSync(file)) return [];
  const d = readJson(file);
  return Array.isArray(d) ? d : Array.isArray(d.items) ? d.items : d.id ? [d] : [];
}

export const writeItems = (file, items) => writeJson(file, { schemaVersion: SCHEMA, items });

export function upsert(file, record) {
  const items = readItems(file);
  const i = items.findIndex((x) => x.id === record.id);
  if (i >= 0) items[i] = record;
  else items.push(record);
  writeItems(file, items);
  return record;
}

const qaFiles = (stateDir, sub) => walk(path.join(stateDir, "qa", sub ?? ""), (p) => p.endsWith(".json"));
const collect = (stateDir, sub, prefix) =>
  qaFiles(stateDir, sub).flatMap((f) => readItems(f).filter((r) => String(r.id).startsWith(`${prefix}-`)).map((r) => ({ ...r, __file: f })));

export const allTcs = (stateDir) => collect(stateDir, null, "TC");
export const allRuns = (stateDir) => collect(stateDir, "runs", "RUN");
export const allDefs = (stateDir) => collect(stateDir, null, "DEF");
export const strip = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith("__")));

/** TC-<module>-001 / DEF-<module>-001 / RUN-001 — the shapes ids.mjs declares for qa. */
export function mintId(existing, prefix, module = null) {
  const pattern = module ? `^${prefix}-${module}-([0-9]{3})$` : `^${prefix}-([0-9]{3})$`;
  let max = 0;
  for (const id of existing) {
    const m = new RegExp(pattern).exec(String(id));
    if (m) max = Math.max(max, Number(m[1]));
  }
  const n = String(max + 1).padStart(3, "0");
  return module ? `${prefix}-${module}-${n}` : `${prefix}-${n}`;
}

// ---- trace -----------------------------------------------------------------

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

// ---- the graph qa reads ----------------------------------------------------

export const project = (stateDir) => readJson(CORE_FILES.project(stateDir));
export const of = (state, prefix) => state.artifacts.filter((a) => a.prefix === prefix);
export const byId = (state, id) => state.artifacts.find((a) => a.id === id) ?? null;
export const raw = (a) => a?.raw ?? {};

/** dev's components, read (never written) so a run knows where the system is and how to prove it is up. */
export function components(stateDir) {
  const file = path.join(stateDir, "dev", "components.json");
  return readItems(file);
}

/** The component a run talks to: the one whose healthcheck names a URL, CMP-api first. */
export function apiComponent(stateDir) {
  const cmps = components(stateDir);
  const withUrl = cmps.filter((c) => originOf(c.run?.healthcheck));
  return withUrl.find((c) => c.id === "CMP-api") ?? withUrl[0] ?? cmps[0] ?? null;
}

/** "curl -fsS http://localhost:8080/health" -> "http://localhost:8080" */
export function originOf(healthcheck) {
  const m = /(https?:\/\/[^/\s"']+)/.exec(String(healthcheck ?? ""));
  return m ? m[1] : null;
}

/** dev's tasks, read only: a scenario is worth a finding when the code that should satisfy it exists. */
export function tasks(stateDir) {
  const dir = path.join(stateDir, "dev", "tasks");
  return walk(dir, (p) => p.endsWith(".json")).flatMap((f) => readItems(f).filter((r) => String(r.id).startsWith("TSK-")));
}

export const verifiedUseCases = (stateDir) => new Set(tasks(stateDir).filter((t) => t.status === "verified").map((t) => t.usecase).filter(Boolean));

/** The code root dev recorded on its components — the thing whose git HEAD is the version under test. */
export function codeRoot(stateDir) {
  const cmp = components(stateDir)[0];
  return path.resolve(stateDir, cmp?.codeRoot ?? "..");
}

// ---- running things --------------------------------------------------------

const capture = (fn, cmd, timeout) => {
  const at = now();
  try {
    return { cmd, exitCode: 0, out: String(fn()).slice(-EVIDENCE_CHARS), at };
  } catch (e) {
    const killed = e.killed || e.signal;
    const body = `${e.stdout ?? ""}${e.stderr ?? ""}`.slice(-EVIDENCE_CHARS);
    return { cmd, exitCode: killed ? 124 : (e.status ?? 1), out: killed ? `timeout after ${timeout}ms\n${body}` : body || String(e.message), at };
  }
};

/**
 * A step qa generated: run through execFile with an argument array and no shell, so a path, a
 * header or a JSON body that came out of a record can never become a second command. `cmd` on the
 * step is the same call written the way a person would type it, for reading and for re-running by
 * hand — it is never the thing that is executed.
 */
export function runArgv(argv, cwd, { timeout = STEP_TIMEOUT_MS } = {}) {
  const [bin, ...args] = argv;
  return capture(() => execFileSync(bin, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout, windowsHide: true }), shellText(argv), timeout);
}

/**
 * The owner's own line, run by a shell because that is how they wrote it: `CMP.run.healthcheck`
 * comes from /dev:stack, the same trust level as the `run.test` dev executes. qa never builds this
 * string and never interpolates a record into it.
 */
export function runCmd(cmd, cwd, { timeout = STEP_TIMEOUT_MS } = {}) {
  return capture(() => execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout, windowsHide: true }), cmd, timeout);
}

/** An argv printed the way a person would type it. For reading, never for executing. */
export const shellText = (argv) => argv.map((a) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${String(a).split("'").join(`'\\''`)}'`)).join(" ");

export const gitHead = (cwd) => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
};

// ---- evidence --------------------------------------------------------------

/** <TC>-<RUN>-s<n>-<result>.log — the name alone says which test, which run, which step, what happened. */
export function writeEvidence(stateDir, { tc, run, step, result, cmd, out, exitCode }) {
  const dir = FILES.evidenceDir(stateDir);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${tc}-${run}-s${step}-${result}.log`;
  const header = [`# ${tc} · ${run} · step ${step} · ${result}`, `# at   ${now()}`, `# cmd  ${cmd}`, `# exit ${exitCode}`, ""].join("\n");
  fs.writeFileSync(path.join(dir, name), header + String(out ?? "") + "\n", "utf8");
  return path.posix.join("qa", "evidence", name);
}

// ---- expectations ----------------------------------------------------------

/** The first JSON object or array in a step's output, or null. curl prints the body, then our marker. */
export function firstJson(text) {
  const s = String(text ?? "");
  for (const open of ["{", "["]) {
    const i = s.indexOf(open);
    if (i < 0) continue;
    for (let j = s.length; j > i; j--) {
      const slice = s.slice(i, j);
      if (!slice.endsWith(open === "{" ? "}" : "]")) continue;
      try {
        return JSON.parse(slice);
      } catch {
        /* keep shrinking */
      }
    }
  }
  return null;
}

export const httpCodeOf = (text) => {
  const m = /HTTP_STATUS[=:]\s*([0-9]{3})/.exec(String(text ?? ""));
  return m ? Number(m[1]) : null;
};

const flat = (o, prefix = "") =>
  Object.entries(o ?? {}).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]));

const find = (o, key) => flat(o).filter(([k]) => k === key || k.endsWith(`.${key}`)).map(([, v]) => v);

/**
 * What the step said versus what the scenario says it should say. Returns the failures, in words a
 * person can act on. An empty array is a pass.
 */
export function checkExpect(expect, { exitCode, out }) {
  const problems = [];
  const e = expect ?? {};
  if (e.exitCode !== undefined && exitCode !== e.exitCode) problems.push(`exit ${exitCode}, expected ${e.exitCode}`);
  if (e.http !== undefined) {
    const got = httpCodeOf(out);
    if (got === null) problems.push(`no HTTP status in the output, expected ${e.http}`);
    else if (typeof e.http === "string" && /^[0-9]xx$/.test(e.http)) {
      const band = Number(e.http[0]);
      if (Math.floor(got / 100) !== band) problems.push(`HTTP ${got}, expected ${e.http}`);
    } else if (got !== e.http) problems.push(`HTTP ${got}, expected ${e.http}`);
  }
  if (e.fields) {
    const body = firstJson(out);
    if (body === null) problems.push(`no JSON in the output, so ${Object.keys(e.fields).join(", ")} could not be read`);
    else
      for (const [k, want] of Object.entries(e.fields)) {
        const got = find(body, k);
        if (got.length === 0) problems.push(`${k} is not in the response`);
        else if (!got.some((g) => Number(g) === Number(want) || String(g) === String(want))) problems.push(`${k} = ${JSON.stringify(got[0])}, expected ${JSON.stringify(want)}`);
      }
  }
  for (const s of list(e.contains)) if (!String(out).includes(s)) problems.push(`the output does not contain ${JSON.stringify(s)}`);
  return problems;
}

/**
 * Where a defect came from. `cases` raises one for a case it could not make runnable — the handoff
 * is incomplete, and qa writes that down rather than asking (brief §5.6). A person raises one for
 * something they saw the system do. They are not the same claim, so an observed defect is never
 * blocked by, and supersedes, a handoff one on the same case. Records written before the field
 * existed are read from `source`.
 */
export const causeOf = (d) => d.cause ?? (d.source === "cases" ? "handoff" : "observed");

/** A defect is open until a green run verifies it or its gap is retired — nothing else closes one. */
export const defOpen = (d) => !["verified", "retired"].includes(d.status);
