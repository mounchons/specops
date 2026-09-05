#!/usr/bin/env node
/**
 * screens.mjs — screens come from four places, and only one of them is the client's wish list.
 *
 *   node screens.mjs <module> [--app <name>] [--json]
 *
 *   G1 use case   one screen per (use case, app it is used from)          origin: usecase
 *   G2 master     one per reference entity, in the app that owns master   origin: master
 *   G3 baseline   what every app of that type has: login, profile, …      origin: baseline
 *   G4 cross-cut  what a non-functional requirement forces: audit log, …  origin: nfr
 *
 * No payload: everything here is derived. A generator that read a wish list would miss exactly the
 * screens nobody writes down — login, master data, the permission matrix — which is how a sitemap
 * ends up with nine screens and no way to sign in. Re-running changes nothing that already exists,
 * and it refuses to change a screen an open CR has frozen.
 */
import { parseArgs, resolveStateDir, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { ensureInit } from "./init.mjs";
import { FILES, allDesign, allReq, byPrefix, findById, inModule, live, minter, readItems, upsert, addEdges, requireModule, appsOf, appOwning, baselineFor, baselineApplies, nfrScreens, frozenIds, now } from "./lib.mjs";

const CRUD_ACTIONS = [
  { name: "view", writes: false },
  { name: "create", writes: true },
  { name: "edit", writes: true },
  { name: "delete", writes: true },
];

/** Everything the four generators want to exist, before anything is compared with disk. */
export function plan(stateDir, module) {
  const project = requireModule(stateDir, module);
  const design = allDesign(stateDir);
  const req = allReq(stateDir);
  const apps = appsOf(project);
  const wanted = [];
  const skipped = [];

  // G1 — one screen per use case per app it is used from
  for (const uc of byPrefix(design, "UC").filter((u) => inModule(u, module))) {
    const ent = uc.crud ? findById(design, uc.crud) : null;
    for (const appName of uc.apps ?? []) {
      const app = apps.find((a) => a.name === appName);
      if (!app) {
        skipped.push({ origin: "usecase", key: uc.id, app: appName, why: `app "${appName}" is not declared in project.json` });
        continue;
      }
      wanted.push({
        prefix: uc.report ? "RPT" : "UI",
        origin: "usecase",
        key: uc.id,
        app: appName,
        title: uc.title,
        kind: uc.report ? "report" : uc.crud ? "list" : uc.readOnly ? "list" : "form",
        fields: ent?.attributes ?? [],
        actions: uc.crud ? CRUD_ACTIONS : uc.readOnly ? [{ name: "view", writes: false }] : [{ name: "submit", writes: true }],
        derivedFrom: [uc.id],
        displays: uc.id,
      });
    }
  }

  // G2 — a reference entity is master data, and master data needs a screen in the app that owns it
  const owner = appOwning(project, "master");
  for (const ent of byPrefix(design, "ENT")) {
    const isMaster = ent.kind === "reference" || (ent.kind === "lookup" && ent.lookupAs === "master");
    if (!isMaster) {
      if (ent.kind === "lookup" && !ent.lookupAs) skipped.push({ origin: "master", key: ent.id, app: owner?.name ?? "—", why: `lookup ${ent.title} has no decision yet: /design:domain ${module} --lookup ${ent.id}=master|seed` });
      continue;
    }
    if (!owner) {
      skipped.push({ origin: "master", key: ent.id, app: "—", why: "no app declares owns: master in project.json" });
      continue;
    }
    wanted.push({
      prefix: "UI",
      origin: "master",
      key: ent.id,
      app: owner.name,
      title: `ข้อมูลหลัก: ${ent.title}`,
      kind: "list",
      fields: ent.attributes ?? [],
      actions: CRUD_ACTIONS,
      derivedFrom: [ent.id],
      displays: ent.id,
      readOnlyElsewhere: true,
    });
  }

  // G3 — the shell of the app type: nobody asks for it, nobody accepts a system without it
  for (const app of apps) {
    const baseline = baselineFor(app.type);
    for (const entry of baseline.screens ?? []) {
      if (!baselineApplies(entry, app)) {
        skipped.push({ origin: "baseline", key: entry.key, app: app.name, why: `app ${app.name} is auth=${app.auth} owns=[${(app.owns ?? []).join(",")}] — ${JSON.stringify(entry.requires)} does not hold` });
        continue;
      }
      wanted.push({
        prefix: "UI",
        origin: "baseline",
        key: entry.key,
        app: app.name,
        title: entry.title,
        kind: entry.kind,
        fields: entry.fields ?? [],
        actions: entry.actions ?? [],
        derivedFrom: [],
        baseline: `${app.type}/${entry.key}`,
      });
    }
  }

  // G4 — a screen that exists because of a quality requirement, not a feature request
  for (const nfr of byPrefix(req, "NFR").filter((n) => inModule(n, module))) {
    const text = `${nfr.title ?? ""} ${nfr.goal ?? ""}`;
    for (const rule of nfrScreens()) {
      if (!new RegExp(rule.match, "i").test(text)) continue;
      const targets = rule.app === "any" ? apps : [appOwning(project, rule.app.replace("owner:", ""))].filter(Boolean);
      if (targets.length === 0) {
        skipped.push({ origin: "nfr", key: rule.key, app: "—", why: `${nfr.id} wants ${rule.key} but no app declares owns: ${rule.app.replace("owner:", "")}` });
        continue;
      }
      for (const app of targets) {
        wanted.push({
          prefix: "UI",
          origin: "nfr",
          key: rule.key,
          app: app.name,
          title: rule.title,
          kind: rule.kind,
          fields: rule.fields ?? [],
          actions: rule.actions ?? [],
          derivedFrom: [nfr.id],
        });
      }
    }
  }

  return { project, wanted, skipped };
}

const identity = (w) => `${w.app}::${w.origin}::${w.key}`;
const identityOf = (ui) => `${ui.app}::${ui.origin}::${ui.generatorKey}`;

export function generate(stateDir, module) {
  const { project, wanted, skipped } = plan(stateDir, module);
  const design = allDesign(stateDir);
  const existing = new Map([...byPrefix(design, "UI"), ...byPrefix(design, "RPT")].map((ui) => [identityOf(ui), ui]));
  const frozen = frozenIds(stateDir);
  const nextUi = minter(design.map((r) => r.id), "UI", module);
  const nextRpt = minter(design.map((r) => r.id), "RPT", module);

  const created = [];
  const kept = [];
  const blocked = [];
  for (const w of wanted) {
    const have = existing.get(identity(w));
    if (have) {
      kept.push(have);
      if (frozen.has(have.id)) blocked.push(have.id);
      continue;
    }
    const id = w.prefix === "RPT" ? nextRpt() : nextUi();
    const record = {
      id,
      title: w.title,
      status: "draft",
      app: w.app,
      origin: w.origin,
      kind: w.kind,
      generatorKey: w.key,
      fields: w.fields,
      actions: w.actions.map((a) => ({ name: a.name, writes: Boolean(a.writes), api: null })),
      zones: ["header", "body", "actions"],
      states: ["empty", "loaded", "error"],
      roles: [],
      ...(w.baseline ? { baseline: w.baseline } : {}),
      ...(w.readOnlyElsewhere ? { readOnlyElsewhere: true } : {}),
      derivedFrom: w.derivedFrom,
      generatedAt: now(),
    };
    upsert(FILES.screens(stateDir, module, w.app, w.origin), record);
    if (w.displays) addEdges(stateDir, [{ from: id, rel: "displays", to: w.displays }]);
    created.push(record);
    existing.set(identity(w), record);
  }
  return { project, created, kept, skipped, blocked };
}

/** entity/use case x app — the table the owner reads to see what was quoted. */
export function matrix(stateDir, module) {
  const project = requireModule(stateDir, module);
  const apps = appsOf(project).map((a) => a.name);
  const screens = [...byPrefix(allDesign(stateDir), "UI"), ...byPrefix(allDesign(stateDir), "RPT")];
  const rows = new Map();
  for (const ui of screens) {
    const row = `${ui.origin}|${ui.generatorKey}|${ui.title}`;
    rows.set(row, { ...(rows.get(row) ?? {}), [ui.app]: ui.id });
  }
  const order = { usecase: 0, master: 1, baseline: 2, nfr: 3 };
  return {
    apps,
    rows: [...rows.entries()]
      .map(([k, cells]) => {
        const [origin, key, title] = k.split("|");
        return { origin, key, title, cells };
      })
      .sort((a, b) => order[a.origin] - order[b.origin] || a.key.localeCompare(b.key)),
  };
}

if (isMain(import.meta.url)) {
  const { _, flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  const module = _[0];
  orExit2(module, "usage: screens.mjs <module> [--app <name>] [--json]");
  ensureInit(stateDir);

  const { created, kept, skipped, blocked } = generate(stateDir, module);
  const m = matrix(stateDir, module);
  const apps = typeof flags.app === "string" ? [flags.app] : m.apps;

  if (flags.json) {
    console.log(JSON.stringify({ created: created.map((c) => c.id), kept: kept.length, skipped, matrix: m }, null, 2));
    process.exit(blocked.length ? 1 : 0);
  }

  console.log(`SCREENS ${module}  created ${created.length}  already there ${kept.length}  skipped ${skipped.length}`);
  const w = Math.max(28, ...m.rows.map((r) => r.title.length + 2));
  console.log(`\n${"screen".padEnd(w)} ${apps.map((a) => a.padEnd(16)).join("")} origin`);
  console.log("-".repeat(w + apps.length * 16 + 8));
  for (const row of m.rows) {
    if (!apps.some((a) => row.cells[a])) continue;
    console.log(`${row.title.padEnd(w)} ${apps.map((a) => (row.cells[a] ?? "–").padEnd(16)).join("")} ${row.origin}`);
  }
  if (skipped.length) {
    console.log(`\nnot generated, and why:`);
    for (const s of skipped) console.log(`  ${s.origin.padEnd(8)} ${String(s.key).padEnd(12)} ${s.app.padEnd(12)} ${s.why}`);
  }
  if (blocked.length) {
    console.log(`\nfrozen by an open CR — regenerate after the change closes: ${blocked.join(", ")}`);
    process.exit(1);
  }
  console.log(`\n  next: /design:api ${module}`);
  process.exit(0);
}
