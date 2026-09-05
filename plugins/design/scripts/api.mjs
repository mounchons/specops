#!/usr/bin/env node
/**
 * api.mjs — one contract per action that leaves the screen.
 *
 *   node api.mjs <module>                        generate the missing endpoints and back-fill UI.action.api
 *   node api.mjs <module> --records <file.json>  refine them, and declare the outside world
 *
 * Generated first, refined second: every write action on a screen needs somewhere to send the write,
 * and that is derivable. What is not derivable is the shape of the payload and — the part that gets
 * forgotten — what happens when an external system is down, so INT carries `failureMode` and there
 * is no default for it.
 *
 * --records payload:
 *   { "apis": [ { for: "UI-rental-003.create", method?, path?, title?, request?, response?, auth? } ],
 *     "integrations": [ { key, title, direction: in|out, failureMode, usedBy: [UI|API] } ] }
 */
import fs from "node:fs";
import { parseArgs, resolveStateDir, readJson, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { ensureInit } from "./init.mjs";
import { FILES, allDesign, byPrefix, findById, inModule, minter, upsert, addEdges, requireModule, appsOf, stripInternal, now } from "./lib.mjs";

const VERB = { create: "POST", edit: "PUT", delete: "DELETE", save: "PUT", submit: "POST", import: "POST", retry: "POST", switch: "POST" };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

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
    const resource = slug(ui.generatorKey?.startsWith("ENT-") ? findById(design, ui.generatorKey)?.title ?? ui.title : ui.title);
    upsert(FILES.api(stateDir, ui.app, ui.origin), {
      id,
      title: `${action.name} — ${ui.title}`,
      status: "draft",
      method: VERB[action.name] ?? "POST",
      path: `/api/${resource}${action.name === "create" ? "" : `/{id}`}`,
      forUi: ui.id,
      action: action.name,
      request: null,
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
  orExit2(module, "usage: api.mjs <module> [--records <file.json>]");
  ensureInit(stateDir);
  requireModule(stateDir, module);

  const created = generate(stateDir, module);
  console.log(`API ${module}  generated ${created.length} endpoint(s)`);
  for (const c of created) console.log(`  ${c.id}  ${c.action} on ${c.ui}`);

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
