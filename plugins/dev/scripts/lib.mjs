#!/usr/bin/env node
/**
 * lib.mjs — the plumbing every dev command shares. Nothing here is a rule; rules live in checks.mjs.
 *
 * W1: writes only <stateDir>/dev/**, <stateDir>/export/handoff-* and <stateDir>/trace.dev.json,
 * plus the one sanctioned line in project.json (plugins.dev.root) that init.mjs writes. The client's
 * source code is written by the session under `task`, not by these scripts.
 *
 * dev is the first plugin that runs someone else's command and asks git questions, so both live
 * here and nowhere else:
 *   run()      one command, in the code root, with a timeout, stdout+stderr captured and truncated.
 *              A proof nobody can read is not a proof.
 *   git()      HEAD, cleanliness and the last message. `.sdlc/` is excluded from the cleanliness
 *              check: the record is the record, the commit is the code, and dev writes the record
 *              itself while a task is closing.
 */
import { execSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CORE_FILES, readJson, writeJson, walk, orExit2 } from "../../core/scripts/paths.mjs";
import { isFrozen } from "../../change/scripts/checks.mjs";

export const SCHEMA = "1.0";
export const PLUGIN = "dev";
export const KINDS = ["source", "test", "migration", "config"];
export const MAX_ATTEMPTS = 3;
export const VERIFY_TIMEOUT_MS = 600000;
export const PROOF_CHARS = 2000;

const here = path.dirname(fileURLToPath(import.meta.url));
export const REFERENCES = path.resolve(here, "..", "references");

export const FILES = {
  components: (s) => path.join(s, "dev", "components.json"),
  tasks: (s, m, tsk) => path.join(s, "dev", "tasks", m, `${tsk}.json`),
  impl: (s, tsk, imp) => path.join(s, "dev", "impl", tsk, `${imp}.json`),
  gaps: (s) => path.join(s, "dev", "gaps.json"),
  trace: (s) => path.join(s, "trace.dev.json"),
  handoffDoc: (s, m) => path.join(s, "export", `handoff-${m}.md`),
};

export const now = () => new Date().toISOString();
export const list = (v) => (typeof v === "string" ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);
/** The module an id belongs to: the segment between the prefix and the number. One definition, because it names a directory. */
export const moduleOf = (id) => /^[A-Z]+-([a-z0-9-]+)-[0-9]{3}/.exec(String(id))?.[1] ?? null;
export const questions = () => readJson(path.join(REFERENCES, "stack-questions.json")).questions;
export { isFrozen };

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

const devFiles = (stateDir, sub) => walk(path.join(stateDir, "dev", sub ?? ""), (p) => p.endsWith(".json"));
const collect = (stateDir, sub, prefix) => devFiles(stateDir, sub).flatMap((f) => readItems(f).filter((r) => String(r.id).startsWith(`${prefix}-`)).map((r) => ({ ...r, __file: f })));

export const allCmps = (stateDir) => collect(stateDir, null, "CMP");
export const allTsks = (stateDir) => collect(stateDir, "tasks", "TSK");
export const allImps = (stateDir) => collect(stateDir, "impl", "IMP");
export const allGaps = (stateDir) => collect(stateDir, null, "GAP");
export const findTsk = (stateDir, id) => allTsks(stateDir).find((t) => t.id === id) ?? null;
export const strip = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith("__")));

export function mintId(existing, prefix) {
  let max = 0;
  for (const id of existing) {
    const m = new RegExp(`^${prefix}-([0-9]{3})$`).exec(String(id));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
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

// ---- the code root, and the two questions dev asks it -----------------------

export const project = (stateDir) => readJson(CORE_FILES.project(stateDir));

/** The directory that holds .sdlc/, unless the owner says otherwise. */
export function codeRootOf(stateDir, flag = null) {
  const root = flag ? path.resolve(flag) : path.resolve(stateDir, "..");
  return root;
}

export function run(cmd, cwd, { timeout = VERIFY_TIMEOUT_MS } = {}) {
  const at = now();
  try {
    const out = execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout, windowsHide: true });
    return { cmd, exitCode: 0, result: String(out).slice(-PROOF_CHARS).trim(), at };
  } catch (e) {
    const killed = e.killed || e.signal;
    const body = `${e.stdout ?? ""}${e.stderr ?? ""}`.slice(-PROOF_CHARS).trim();
    return { cmd, exitCode: killed ? 124 : (e.status ?? 1), result: killed ? `timeout after ${timeout}ms\n${body}` : body || String(e.message), at };
  }
}

/**
 * git goes through execFileSync with an argument array, never a shell string: the paths asked about
 * come from IMP records, and a file called `x; rm -rf /` is a valid filename. `run()` above is the
 * one place a shell is used, and what it runs is the owner's own `CMP.run.test` line.
 */
const gitOut = (args, cwd) => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
};

export const git = {
  isRepo: (cwd) => gitOut(["rev-parse", "--is-inside-work-tree"], cwd) === "true",
  head: (cwd) => gitOut(["rev-parse", "HEAD"], cwd),
  message: (cwd) => gitOut(["log", "-1", "--format=%B"], cwd) ?? "",
  /** `.sdlc/` is excluded: dev writes the record while the task is closing, and that is not a dirty diff. */
  dirty: (cwd) => (gitOut(["status", "--porcelain", "--", ".", ":!.sdlc"], cwd) ?? "").split("\n").map((l) => l.trim()).filter(Boolean),
  /** Whether one path differs from the last commit — the "a person edited this" question. */
  changed: (cwd, rel) => Boolean((gitOut(["status", "--porcelain", "--", rel], cwd) ?? "").trim()),
};

export function requireRepo(codeRoot) {
  orExit2(git.isRepo(codeRoot), `${codeRoot} is not a git repository — a task closes on a commit, and a commit is the only "done" a script can verify · git init`);
}

// ---- the graph dev reads ---------------------------------------------------

export const of = (state, prefix) => state.artifacts.filter((a) => a.prefix === prefix);
export const byId = (state, id) => state.artifacts.find((a) => a.id === id) ?? null;
export const inModule = (a, m) => a.module === m;

/** The component a path belongs to: the CMP whose root is the longest matching prefix. */
export function componentOf(cmps, rel) {
  const p = rel.split(path.sep).join("/");
  return cmps.filter((c) => c.root && (p === c.root || p.startsWith(`${c.root.replace(/\/$/, "")}/`))).sort((a, b) => b.root.length - a.root.length)[0] ?? null;
}

/** The states a use case moves between, read from its own steps and precondition. */
export function statesOf(uc, stateNames) {
  const text = [uc.precondition ?? "", ...(uc.flows ?? []).flatMap((f) => (f.steps ?? []).map((s) => s.step ?? ""))].join(" \n ");
  const produces = new Set();
  const consumes = new Set();
  const arrow = /([A-Za-z][A-Za-z0-9_-]*)\s*(?:→|->)\s*([A-Za-z][A-Za-z0-9_-]*)/g;
  let m;
  while ((m = arrow.exec(text))) {
    if (stateNames.has(m[1]) && stateNames.has(m[2])) {
      consumes.add(m[1]);
      produces.add(m[2]);
    }
  }
  if (consumes.size === 0) for (const s of stateNames) if (new RegExp(`(^|[^A-Za-z])${s}([^A-Za-z]|$)`).test(uc.precondition ?? "")) consumes.add(s);
  return { produces: [...produces], consumes: [...consumes] };
}

/**
 * One file per implementation unit. Seventeen IMPs in `dev/impl/TSK-001.json` were 232 lines and a
 * slice of 22 files would have crossed rule 4 — the same lesson the tasks file taught in phase 5.
 * A state dir written by the old layout is split on the next write rather than left to collide.
 */
export function migrateImpl(stateDir, tsk) {
  const legacy = path.join(stateDir, "dev", "impl", `${tsk}.json`);
  if (!fs.existsSync(legacy)) return [];
  const moved = readItems(legacy);
  for (const rec of moved) upsert(FILES.impl(stateDir, tsk, rec.id), rec);
  fs.rmSync(legacy, { force: true });
  return moved.map((r) => r.id);
}
