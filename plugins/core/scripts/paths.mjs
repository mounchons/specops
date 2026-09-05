#!/usr/bin/env node
/**
 * paths.mjs — where the state dir is, and nothing else.
 *
 * Resolution order (first hit wins):
 *   1. --state-dir <path>           explicit
 *   2. $SPECOPS_STATE_DIR           environment
 *   3. <cwd>/.sdlc                  default (constitution: state dir is .sdlc)
 *
 * Every specops plugin imports this file from core. No plugin keeps its own copy (W1 applied to code).
 */
import fs from "node:fs";
import path from "node:path";

export const STATE_DIR_NAME = ".sdlc";

/** Minimal argv parser: --key value | --flag | positional. No dependency. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out.flags[key] = next;
        i++;
      } else {
        out.flags[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

export function resolveStateDir(flags = {}) {
  const explicit = flags["state-dir"];
  if (typeof explicit === "string") return path.resolve(explicit);
  if (process.env.SPECOPS_STATE_DIR) return path.resolve(process.env.SPECOPS_STATE_DIR);
  return path.resolve(process.cwd(), STATE_DIR_NAME);
}

export function stateExists(stateDir) {
  return fs.existsSync(path.join(stateDir, "project.json"));
}

/** Files core owns inside the state dir. Other plugins own <stateDir>/<plugin>/** and trace.<plugin>.json only. */
export const CORE_FILES = {
  project: (s) => path.join(s, "project.json"),
  gates: (s) => path.join(s, "gates.json"),
  registry: (s) => path.join(s, "registry.json"),
};

export function readJson(file, fallback = undefined) {
  if (!fs.existsSync(file)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing file: ${file}`);
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`invalid JSON: ${file} — ${e.message}`);
  }
}

export function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

/** Exit 2 = bad arguments / unusable environment. Reserved marketplace-wide. */
export function orExit2(cond, msg) {
  if (!cond) {
    console.error(`ERROR ${msg}`);
    process.exit(2);
  }
}

/** Walk a directory recursively, returning absolute file paths. Skips nothing except missing dirs. */
export function walk(dir, filter = () => true) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p, filter));
    else if (filter(p)) out.push(p);
  }
  return out;
}

export function rel(stateDir, file) {
  return path.relative(stateDir, file).split(path.sep).join("/");
}
