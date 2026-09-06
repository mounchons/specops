#!/usr/bin/env node
/**
 * lib.mjs — the plumbing every mock command shares. Nothing here is a rule; rules live in checks.mjs.
 *
 * W1: writes only <stateDir>/mock/**, <stateDir>/export/mock-* and <stateDir>/trace.mock.json, plus
 * the one sanctioned line in project.json (plugins.mock.root) that init.mjs writes.
 *
 * Two things in here decide everything else:
 *
 *   contentOf()  the drawing, and only the drawing: which screen, which app, which theme, the zones
 *                and their controls, the states, the roles. Not the id, not the status, not who signed
 *                it, not which CR it was drawn under. That is what `hash` covers, which is why signing
 *                a wireframe does not change its hash and re-running wireframe does not either.
 *   zonesFor()   the UI's fields and actions become controls, one each, and nothing else does. A mock
 *                that invents an affordance is a promise the design never made — G-mock-001 is the
 *                same rule as dev's Class B line, one phase earlier.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CORE_FILES, readJson, writeJson, walk, orExit2 } from "../../core/scripts/paths.mjs";
import { isFrozen } from "../../change/scripts/checks.mjs";

export const SCHEMA = "1.0";
export const PLUGIN = "mock";
export const THEME_ID = "THM-001";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REFERENCES = path.resolve(here, "..", "references");

export const FILES = {
  theme: (s) => path.join(s, "mock", "theme.json"),
  appDir: (s, app) => path.join(s, "mock", app),
  mck: (s, app, id) => path.join(s, "mock", app, `${id}.json`),
  html: (s, app, id) => path.join(s, "mock", app, `${id}.html`),
  designDir: (s, app) => path.join(s, "mock", app, "design"),
  trace: (s) => path.join(s, "trace.mock.json"),
  baselineDoc: (s, app, date) => path.join(s, "export", `mock-baseline-${app}@${date}.md`),
};

export const now = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);
export const list = (v) => (typeof v === "string" ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);
export const questions = () => readJson(path.join(REFERENCES, "theme-questions.json"));
export { isFrozen };

// ---- the theme -------------------------------------------------------------

export const readTheme = (stateDir) => (fs.existsSync(FILES.theme(stateDir)) ? readJson(FILES.theme(stateDir)) : null);
export const writeTheme = (stateDir, thm) => writeJson(FILES.theme(stateDir), thm);

// ---- wireframes ------------------------------------------------------------

export function allMcks(stateDir) {
  const out = [];
  for (const f of walk(path.join(stateDir, "mock"), (p) => p.endsWith(".json") && path.basename(p) !== "theme.json")) {
    const r = readJson(f);
    if (r?.id) out.push({ ...r, __file: f });
  }
  return out;
}

export function writeMck(stateDir, mck) {
  const body = Object.fromEntries(Object.entries(mck).filter(([k]) => !k.startsWith("__")));
  const file = FILES.mck(stateDir, mck.app, mck.id);
  writeJson(file, body);
  return file;
}

export function mintMckId(existing, module) {
  let max = 0;
  for (const id of existing) {
    const m = new RegExp(`^MCK-${module}-([0-9]{3})$`).exec(String(id));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `MCK-${module}-${String(max + 1).padStart(3, "0")}`;
}

// ---- the hash --------------------------------------------------------------

/** Keys in a fixed order, so a file that is edited and put back hashes the same. */
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

/** The drawing. Everything the client would see a difference in, and nothing else. */
export const contentOf = (m) => ({ ui: m.ui, app: m.app, theme: m.theme, kind: m.kind, title: m.title, zones: m.zones, states: m.states, roles: m.roles });

export const hashOf = (m) => crypto.createHash("sha256").update(stable(contentOf(m))).digest("hex").slice(0, 16);

// ---- the drawing itself ----------------------------------------------------

const COLUMNAR = new Set(["list", "matrix", "table"]);

/**
 * One control per declared field, one per declared action, nothing else. Fields land in the body
 * zone, actions in the actions zone; a screen that declares neither is drawn as its empty zones,
 * which is what G-mock-004 tells the owner about before the client signs it.
 */
export function zonesFor(ui) {
  const names = (ui.zones ?? []).length ? ui.zones : ["body"];
  const zones = names.map((name) => ({ name, controls: [] }));
  const body = zones.find((z) => z.name === "body") ?? zones.find((z) => !["header", "actions"].includes(z.name)) ?? zones[0];
  const actions = zones.find((z) => z.name === "actions") ?? zones[zones.length - 1];
  const kind = COLUMNAR.has(ui.kind) ? "column" : "input";
  for (const f of ui.fields ?? []) body.controls.push({ testid: `field-${f}`, kind, from: `field:${f}` });
  for (const a of ui.actions ?? []) actions.controls.push({ testid: `action-${a.name}`, kind: "button", from: `action:${a.name}` });
  return zones;
}

/** What the wireframe for this screen must look like right now, given the design and the rbac. */
export function desiredMck(ui, acls, themeId) {
  const roles = acls.filter((a) => a.ui === ui.id && (a.allow ?? []).includes("view")).map((a) => a.role);
  const draft = {
    ui: ui.id,
    app: ui.app,
    theme: themeId,
    kind: ui.kind ?? "form",
    title: ui.title ?? ui.id,
    zones: zonesFor(ui),
    states: ui.states ?? [],
    roles: [...new Set(roles)].sort(),
  };
  return { ...draft, hash: hashOf(draft) };
}

export const controlsOf = (m) => (m.zones ?? []).flatMap((z) => z.controls ?? []);

// ---- trace -----------------------------------------------------------------

/** One edge per line: core owns the name trace.<plugin>.json, so this file cannot be split. */
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

// ---- project ---------------------------------------------------------------

export const project = (stateDir) => readJson(CORE_FILES.project(stateDir));

export function requireApp(stateDir, name) {
  const p = project(stateDir);
  const app = (p.apps ?? []).find((a) => a.name === name);
  orExit2(app, `app "${name}" is not in project.json apps[] — mock draws the apps the project declares, it does not invent them`);
  return app;
}

/** Every screen of one app, from the design records core already loaded. */
export const screensOf = (state, app) =>
  state.artifacts.filter((a) => ["UI", "RPT"].includes(a.prefix) && a.raw.app === app).map((a) => ({ ...a.raw, __module: a.module }));

export const aclsOf = (state) => state.artifacts.filter((a) => a.prefix === "ACL").map((a) => a.raw);
