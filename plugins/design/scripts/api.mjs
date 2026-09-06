#!/usr/bin/env node
/**
 * api.mjs — one contract per action that leaves the screen.
 *
 *   node api.mjs <module>                        generate the missing endpoints and back-fill UI.action.api
 *   node api.mjs <module> --repath               recompute the path of every endpoint no one has refined
 *   node api.mjs <module> --records <file.json>  refine them, and declare the outside world
 *
 * Generated first, refined second: every write action on a screen needs somewhere to send the write,
 * and that is derivable. What is not derivable is the shape of the payload and — the part that gets
 * forgotten — what happens when an external system is down, so INT carries `failureMode` and there
 * is no default for it.
 *
 * --records payload:
 *   { "apis": [ { for: "UI-rental-003.create", method?, path?, title?, request?, sample?, response?, auth? } ],
 *     "integrations": [ { key, title, direction: in|out, failureMode, usedBy: [UI|API] } ] }
 */
import fs from "node:fs";
import { parseArgs, resolveStateDir, readJson, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { ensureInit } from "./init.mjs";
import { FILES, allDesign, byPrefix, findById, inModule, minter, upsert, addEdges, requireModule, appsOf, stripInternal, approveCli, now } from "./lib.mjs";

const VERB = { create: "POST", edit: "PUT", delete: "DELETE", save: "PUT", submit: "POST", import: "POST", retry: "POST", switch: "POST" };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const plural = (s) => (/(s|x|ch|sh)$/.test(s) ? `${s}es` : /[^aeiou]y$/.test(s) ? `${s.slice(0, -1)}ies` : `${s}s`);

/**
 * The aggregate a use case writes. Read from the design's own graph, in the order a person would:
 * the state machine whose state names the use case's steps mention (a create names its initial
 * state and moves nothing, so the transitions alone never find it), then the one whose transitions
 * enforce the rules the use case enforces. Ambiguous — none or several — is null, not a guess.
 */
export function aggregateOf(design, ucId) {
  const uc = findById(design, ucId);
  if (!uc) return null;
  const stms = byPrefix(design, "STM");
  const text = [uc.precondition ?? "", ...(uc.flows ?? []).flatMap((f) => (f.steps ?? []).map((s) => s.step ?? ""))].join(" \n ");
  const named = stms.filter((s) => (s.states ?? []).some((x) => new RegExp(`(^|[^A-Za-z])${x.name}([^A-Za-z]|$)`).test(text)));
  const enforced = stms.filter((s) => (s.transitions ?? []).some((t) => (t.enforces ?? []).some((b) => (uc.enforces ?? []).includes(b))));
  const hits = [...new Set((named.length ? named : enforced).map((s) => s.entity))].map((e) => findById(design, e)).filter((e) => e?.kind === "aggregate");
  return hits.length === 1 ? hits[0] : null;
}

/**
 * A URL segment is a name, and project.json says names are `en` while content is `th`: slugging a
 * Thai screen title returns "" and writes `/api//{id}`, which is exactly what the phase-5 handoff
 * shipped and what left every RentPoint test case unrunnable. So the resource comes from an id-language
 * name only — the entity behind a master screen, the aggregate behind a use case, or the generator
 * key itself (baseline and nfr keys are already slugs). Nothing derivable returns null.
 */
export function resourceOf(design, ui) {
  const key = ui.generatorKey ?? "";
  const named = key.startsWith("ENT-") ? findById(design, key) : key.startsWith("UC-") ? aggregateOf(design, key) : null;
  const raw = named ? plural(slug(named.title ?? named.name ?? "")) : slug(key);
  return raw || null;
}

/** No resource, no path: an empty segment is not an address, and pretending otherwise is the bug. */
export const pathFor = (resource, action) => (resource ? `/api/${resource}${action === "create" ? "" : "/{id}"}` : null);


/** Every (screen, write action) that has no endpoint yet. A screen in an `api` app is the endpoint. */
export function pending(stateDir, module) {
  const project = requireModule(stateDir, module);
  const clientApps = new Set(appsOf(project).filter((a) => a.type !== "api").map((a) => a.name));
  const out = [];
  for (const ui of [...byPrefix(allDesign(stateDir), "UI"), ...byPrefix(allDesign(stateDir), "RPT")]) {
    if (!clientApps.has(ui.app)) continue;
    for (const a of ui.actions ?? []) if (a.writes && !a.api) out.push({ ui, action: a });
  }
  return out;
}

export function generate(stateDir, module) {
  const design = allDesign(stateDir);
  const nextApi = minter(design.map((r) => r.id), "API");
  const created = [];
  for (const { ui, action } of pending(stateDir, module)) {
    const id = nextApi();
    const resource = resourceOf(design, ui);
    upsert(FILES.api(stateDir, ui.app, ui.origin), {
      id,
      title: `${action.name} — ${ui.title}`,
      status: "draft",
      method: VERB[action.name] ?? "POST",
      path: pathFor(resource, action.name),
      forUi: ui.id,
      action: action.name,
      request: null,
      // What a call that works looks like — the fields a person fills in, not the shape. qa builds
      // its request body from this and nothing else; "{{key}}" is a golden-row input field.
      sample: null,
      response: null,
      auth: "required",
      derivedFrom: [ui.id],
      generatedAt: now(),
    });
    const fresh = findById(allDesign(stateDir), ui.id);
    upsert(fresh.__file, { ...stripInternal(fresh), actions: fresh.actions.map((a) => (a.name === action.name ? { ...a, api: id } : a)) });
    addEdges(stateDir, [{ from: id, rel: "serves", to: ui.id }]);
    created.push({ id, ui: ui.id, action: action.name });
  }
  return created;
}

/**
 * Recompute the path of every endpoint no person has touched (`status: draft`). Generated-first
 * means the generator owns those; a record at `reviewed` was refined by hand through --records and
 * is left exactly as the person left it, even when this would compute something different.
 */
export function repath(stateDir, module) {
  const design = allDesign(stateDir);
  const uis = new Map([...byPrefix(design, "UI"), ...byPrefix(design, "RPT")].map((u) => [u.id, u]));
  const changed = [];
  for (const api of byPrefix(design, "API")) {
    if (api.status !== "draft") continue;
    const ui = uis.get(api.forUi);
    if (!ui) continue;
    const want = pathFor(resourceOf(design, ui), api.action);
    if (want === api.path) continue;
    upsert(api.__file, { ...stripInternal(api), path: want });
    changed.push({ id: api.id, from: api.path, to: want, ui: ui.id });
  }
  return changed;
}

export function refine(stateDir, records) {
  const touched = [];
  for (const spec of records.apis ?? []) {
    const [uiId, actionName] = String(spec.for ?? "").split(".");
    const design = allDesign(stateDir);
    const api = byPrefix(design, "API").find((a) => a.forUi === uiId && a.action === actionName);
    orExit2(api, `no generated endpoint for ${JSON.stringify(spec.for)} — run without --records first, then refine`);
    upsert(api.__file, {
      ...stripInternal(api),
      ...(spec.method ? { method: spec.method } : {}),
      ...(spec.path ? { path: spec.path } : {}),
      ...(spec.title ? { title: spec.title } : {}),
      ...(spec.request !== undefined ? { request: spec.request } : {}),
      ...(spec.sample !== undefined ? { sample: spec.sample } : {}),
      ...(spec.response !== undefined ? { response: spec.response } : {}),
      ...(spec.auth ? { auth: spec.auth } : {}),
      status: "reviewed",
    });
    touched.push(api.id);
  }
  const nextInt = minter(allDesign(stateDir).map((r) => r.id), "INT");
  for (const i of records.integrations ?? []) {
    orExit2(String(i.failureMode ?? "").trim(), `integration ${JSON.stringify(i.key ?? i.title)} needs failureMode — "what happens when it is down" is the whole reason to write it down`);
    const id = nextInt();
    upsert(FILES.integrations(stateDir), {
      id,
      title: i.title ?? i.key,
      status: "draft",
      direction: i.direction ?? "out",
      failureMode: i.failureMode,
      usedBy: i.usedBy ?? [],
      derivedFrom: i.usedBy ?? [],
    });
    touched.push(id);
  }
  return touched;
}

if (isMain(import.meta.url)) {
  const { _, flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  const module = _[0];
  orExit2(module, "usage: api.mjs <module> [--repath] [--records <file.json>] [--approve <ids> --sign STK-nnn]");
  ensureInit(stateDir);
  if (typeof flags.approve === "string") approveCli(stateDir, flags, ["API", "INT"]);
  requireModule(stateDir, module);

  const created = generate(stateDir, module);
  console.log(`API ${module}  generated ${created.length} endpoint(s)`);
  for (const c of created) console.log(`  ${c.id}  ${c.action} on ${c.ui}`);

  if (flags.repath) {
    const changed = repath(stateDir, module);
    console.log(`  repath: ${changed.length} draft endpoint(s) rewritten`);
    for (const c of changed) console.log(`    ${c.id}  ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}  (${c.ui})`);
  }
  const unresolved = byPrefix(allDesign(stateDir), "API").filter((a) => !a.path);
  if (unresolved.length) console.log(`  ${unresolved.length} endpoint(s) have no path — the screen has no id-language name to build one from: ${unresolved.map((a) => `${a.id} (${a.forUi})`).join(" · ")} · give one with --records`);

  if (typeof flags.records === "string") {
    orExit2(fs.existsSync(flags.records), `no such file: ${flags.records}`);
    const touched = refine(stateDir, readJson(flags.records));
    console.log(`  refined/declared ${touched.length}: ${touched.join(" ")}`);
  }
  const left = pending(stateDir, module);
  console.log(left.length ? `  ${left.length} write action(s) still without an endpoint` : `  every write action on a screen has an endpoint`);
  console.log(`  next: /design:rbac`);
  process.exit(0);
}
