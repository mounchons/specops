#!/usr/bin/env node
/**
 * checks.mjs — design's rules, as functions. Core loads CHECKS (gates.mjs) and NEXT (next.mjs)
 * once project.json names plugins.design.root.
 *
 * Contract: CHECKS = { "design:<check>": (ctx) => [{ subject, message, severity? }] }
 *           NEXT   = [ (ctx) => [{ action, reason, stop? }] ]
 *           ctx    = { stateDir, project, state, registry }   (NEXT gets { gates } instead of state)
 *
 * ctx.state holds every artifact in the state dir, req's included — design reads req here the same
 * way it reads it anywhere: by id, never by opening the folder.
 */
import { prefixOf } from "../../core/scripts/ids.mjs";
import { KINDS } from "./domain.mjs";

const ORIGINS = ["usecase", "master", "baseline", "nfr"];
const of = (state, prefix) => state.artifacts.filter((a) => a.prefix === prefix);
const raw = (a) => a.raw ?? {};
const screensOf = (state) => [...of(state, "UI"), ...of(state, "RPT")];
const moduleOfId = (id) => /^[A-Z]+-([a-z0-9-]+)-[0-9]{3}/.exec(String(id))?.[1] ?? null;
const appOwning = (project, what) => (project.apps ?? []).find((a) => (a.owns ?? []).includes(what)) ?? null;
const edgesTo = (registry, from, rel) => registry.edges.filter((e) => e.from === from && e.rel === rel).map((e) => e.to);

export const CHECKS = {
  "design:ent-kind": ({ state }) =>
    of(state, "ENT")
      .filter((a) => !KINDS.includes(raw(a).kind))
      .map((a) => ({ subject: a.file, message: `${a.id} (${a.title}) has kind ${JSON.stringify(raw(a).kind ?? null)} — it must be one of ${KINDS.join("|")}, because that is what decides whether it needs a master screen` })),

  "design:stm-exit": ({ state }) => {
    const out = [];
    for (const stm of of(state, "STM")) {
      const t = raw(stm).transitions ?? [];
      for (const s of raw(stm).states ?? []) {
        if (s.final) continue;
        if (!t.some((x) => x.from === s.name)) out.push({ subject: stm.file, message: `${stm.id}: state "${s.name}" has no transition out and is not marked final — a record that reaches it can never move again` });
      }
    }
    return out;
  },

  "design:uc-satisfies-req": ({ state, registry }) =>
    of(state, "UC")
      .filter((uc) => edgesTo(registry, uc.id, "satisfies").length === 0)
      .map((uc) => ({ subject: uc.file, message: `${uc.id} (${uc.title}) satisfies no REQ — a capability nobody asked for is scope creep, not design` })),

  "design:br-enforced": ({ state }) => {
    const modules = new Set(of(state, "UC").map((uc) => uc.module).filter(Boolean));
    const enforced = new Set(of(state, "UC").flatMap((uc) => raw(uc).enforces ?? []));
    const out = [];
    for (const br of of(state, "BR")) {
      if (br.status === "retired" || !modules.has(moduleOfId(br.id))) continue;
      if (enforced.has(br.id)) continue;
      out.push({ subject: br.file, message: `${br.id} (${br.title}) is enforced by no use-case step — a rule that hangs off nothing never fires at delivery` });
    }
    return out;
  },

  "design:ac-then-verbatim": ({ state }) => {
    const byId = new Map(state.artifacts.map((a) => [a.id, a]));
    const out = [];
    for (const ac of of(state, "AC")) {
      const ex = (raw(ac).derivedFrom ?? []).map((d) => byId.get(d)).find((r) => r && r.prefix === "EX");
      if (!ex) {
        out.push({ subject: ac.file, message: `${ac.id} quotes no EX — an acceptance criterion invented here is not evidence of anything` });
        continue;
      }
      if (String(raw(ex).then ?? "").trim() !== String(raw(ac).then ?? "").trim()) {
        out.push({ subject: ac.file, message: `${ac.id} paraphrases ${ex.id}: EX says ${JSON.stringify(raw(ex).then)}, AC says ${JSON.stringify(raw(ac).then)} — the two have already drifted` });
      }
    }
    return out;
  },

  "design:ui-app-origin": ({ state, project }) => {
    const apps = new Set((project.apps ?? []).map((a) => a.name));
    return screensOf(state)
      .filter((ui) => !apps.has(raw(ui).app) || !ORIGINS.includes(raw(ui).origin))
      .map((ui) => ({ subject: ui.file, message: `${ui.id}: app=${JSON.stringify(raw(ui).app ?? null)} origin=${JSON.stringify(raw(ui).origin ?? null)} — app must be declared in project.json and origin one of ${ORIGINS.join("|")}` }));
  },

  "design:ui-usecase-traces-uc": ({ state, registry }) => {
    const ucs = new Set(of(state, "UC").map((u) => u.id));
    return screensOf(state)
      .filter((ui) => raw(ui).origin === "usecase" && !edgesTo(registry, ui.id, "displays").some((t) => ucs.has(t)))
      .map((ui) => ({ subject: ui.file, message: `${ui.id} (${ui.title}) claims origin usecase but displays no UC — either it belongs to a use case, or somebody drew a screen nobody asked for` }));
  },

  "design:login-per-app": ({ state, project }) => {
    const screens = screensOf(state);
    return (project.apps ?? [])
      .filter((app) => app.auth && app.auth !== "none" && app.type !== "api")
      .filter((app) => !screens.some((ui) => raw(ui).app === app.name && raw(ui).kind === "login"))
      .map((app) => ({ subject: "design screens", message: `app ${app.name} authenticates with ${app.auth} but has no login screen — /design:screens generates it from the app type` }));
  },

  "design:master-owner-ui": ({ state, project }) => {
    const owner = appOwning(project, "master");
    const screens = screensOf(state);
    const out = [];
    for (const ent of of(state, "ENT")) {
      const needsMaster = raw(ent).kind === "reference" || (raw(ent).kind === "lookup" && raw(ent).lookupAs === "master");
      if (!needsMaster) continue;
      if (!owner) {
        out.push({ subject: "project.json", message: `${ent.id} (${ent.title}) is master data but no app declares owns: master` });
        continue;
      }
      if (!screens.some((ui) => raw(ui).origin === "master" && raw(ui).app === owner.name && raw(ui).generatorKey === ent.id)) {
        out.push({ subject: "design screens", message: `${ent.id} (${ent.title}) is master data with no screen in ${owner.name} — someone has to be able to add a row` });
      }
    }
    return out;
  },

  "design:role-management-ui": ({ state, project }) => {
    const owner = appOwning(project, "roles");
    if (!owner) return of(state, "ROLE").length ? [{ subject: "project.json", message: `roles exist but no app declares owns: roles — there is nowhere to manage them` }] : [];
    const keys = new Set(screensOf(state).filter((ui) => raw(ui).app === owner.name).map((ui) => raw(ui).generatorKey));
    return ["users", "roles", "permission-matrix"]
      .filter((k) => !keys.has(k))
      .map((k) => ({ subject: "design screens", message: `app ${owner.name} owns roles but has no ${k} screen — the permission model is unusable without it` }));
  },

  "design:role-traces-stk": ({ state }) => {
    const stk = new Set(of(state, "STK").map((s) => s.id));
    return of(state, "ROLE")
      .filter((r) => !(raw(r).derivedFrom ?? []).some((d) => stk.has(d)))
      .map((r) => ({ subject: r.file, message: `${r.id} (${r.title}) derives from no STK — a role that matches nobody in the client's organisation is a role nobody will use` }));
  },

  "design:ui-has-acl": ({ state }) => {
    const covered = new Set(of(state, "ACL").map((a) => raw(a).ui));
    return screensOf(state)
      .filter((ui) => !covered.has(ui.id))
      .map((ui) => ({ subject: ui.file, message: `${ui.id} (${ui.title}) has no ACL row — under default deny that screen is unreachable, which is almost never what was meant` }));
  },

  "design:write-action-has-api": ({ state, project }) => {
    const clientApps = new Set((project.apps ?? []).filter((a) => a.type !== "api").map((a) => a.name));
    const out = [];
    for (const ui of screensOf(state)) {
      if (!clientApps.has(raw(ui).app)) continue;
      for (const a of raw(ui).actions ?? []) {
        if (a.writes && !a.api) out.push({ subject: ui.file, message: `${ui.id} action "${a.name}" writes but names no API — /design:api generates one` });
      }
    }
    return out;
  },

  "design:flow-has-scn": ({ state }) => {
    const scns = of(state, "SCN").map(raw);
    const out = [];
    for (const uc of of(state, "UC")) {
      for (const f of raw(uc).flows ?? []) {
        if (!scns.some((s) => s.usecase === uc.id && s.flow === f.name)) out.push({ subject: uc.file, message: `${uc.id} flow "${f.name}" has no SCN — the flows that ship broken are the ones nobody wrote a scenario for` });
      }
    }
    const ucModules = new Set(of(state, "UC").map((uc) => uc.module).filter(Boolean));
    for (const nfr of of(state, "NFR")) {
      if (!ucModules.has(moduleOfId(nfr.id))) continue;
      if (!scns.some((s) => (s.derivedFrom ?? []).includes(nfr.id))) out.push({ subject: nfr.file, message: `${nfr.id} (${nfr.title}) has no SCN — a quality requirement nobody can measure is a wish` });
    }
    return out;
  },

  "design:lookup-undecided": ({ state }) => {
    const undecided = of(state, "ENT").filter((e) => raw(e).kind === "lookup" && !raw(e).lookupAs);
    return undecided.length
      ? [{ subject: "design/domain.json", message: `${undecided.length} lookup(s) with no decision: ${undecided.map((e) => `${e.id} (${e.title})`).join(", ")} — master screen or seed data? /design:domain <module> --lookup <ENT>=master|seed`, severity: "warn" }]
      : [];
  },
};

// ---- the callsheet ---------------------------------------------------------

const rec = (ctx, prefix) =>
  Object.entries(ctx.registry.index)
    .filter(([id, r]) => prefixOf(id) === prefix && r.plugin === "design")
    .map(([id, r]) => ({ id, ...r }));
const reqRec = (ctx, prefix) =>
  Object.entries(ctx.registry.index)
    .filter(([id, r]) => prefixOf(id) === prefix && r.plugin === "req")
    .map(([id, r]) => ({ id, ...r }));
const modulesWithReq = (ctx) => (ctx.project.modules ?? []).filter((m) => reqRec(ctx, "BR").some((r) => r.module === m));
const designErrors = (ctx, gate) => ctx.gates.results.filter((r) => r.gate === gate && r.severity === "error");

export const NEXT = [
  (ctx) => modulesWithReq(ctx).filter((m) => rec(ctx, "ENT").length === 0).map((m) => ({ action: `/design:domain ${m}`, reason: "there are rules but no entities — the rules are about things, and screens needs their kinds" })),
  (ctx) => {
    const undecided = ctx.gates.results.filter((r) => r.gate === "G-design-015");
    return undecided.length ? [{ action: `/design:domain <module> --lookup <ENT>=master|seed`, reason: undecided[0].message }] : [];
  },
  (ctx) => {
    const bare = designErrors(ctx, "G-design-004");
    return bare.length ? [{ action: `/design:usecase <module> --records <file.json>`, reason: `${bare.length} rule(s) enforced by no step: ${bare.slice(0, 3).map((e) => e.message.split(" ")[0]).join(", ")}` }] : [];
  },
  (ctx) => modulesWithReq(ctx).filter((m) => rec(ctx, "UC").some((u) => u.module === m) && !rec(ctx, "UI").some((u) => u.module === m)).map((m) => ({ action: `/design:screens ${m}`, reason: "use cases exist but no screens — four generators, no wish list, and the login and master screens appear on their own" })),
  (ctx) => (designErrors(ctx, "G-design-013").length ? [{ action: `/design:api <module>`, reason: `${designErrors(ctx, "G-design-013").length} write action(s) with nowhere to send the write` }] : []),
  (ctx) => (rec(ctx, "UI").length && rec(ctx, "ROLE").length === 0 ? [{ action: `/design:rbac --records <file.json>`, reason: "screens exist but no roles — under default deny every screen is unreachable until someone says who may open it" }] : []),
  (ctx) => (designErrors(ctx, "G-design-014").length ? [{ action: `/design:scenario <module>`, reason: `${designErrors(ctx, "G-design-014").length} flow(s) or NFR(s) with no scenario — qa cannot invent them later` }] : []),
];
