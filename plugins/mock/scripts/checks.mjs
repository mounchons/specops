#!/usr/bin/env node
/**
 * checks.mjs — mock's rules, as functions. Core loads CHECKS (gates.mjs) and NEXT (next.mjs) once
 * project.json names plugins.mock.root.
 *
 * Contract: CHECKS = { "mock:<check>": (ctx) => [{ subject, message, severity? }] }
 *           NEXT   = [ (ctx) => [{ action, reason, stop? }] ]
 *           ctx    = { stateDir, project, state, registry }   (NEXT gets { gates } instead of state)
 */
import { prefixOf } from "../../core/scripts/ids.mjs";
import { hashOf, controlsOf } from "./lib.mjs";

const of = (state, prefix) => state.artifacts.filter((a) => a.prefix === prefix);
const raw = (a) => a.raw ?? {};
const isOpenCr = (registry, id) => Boolean(id && registry.index[id]?.file?.includes("change/open/"));

export const CHECKS = {
  "mock:control-matches-ui": ({ state }) => {
    const screens = new Map([...of(state, "UI"), ...of(state, "RPT")].map((a) => [a.id, a]));
    const out = [];
    for (const m of of(state, "MCK")) {
      const ui = screens.get(raw(m).ui);
      if (!ui) {
        out.push({ subject: m.file, message: `${m.id} mocks ${JSON.stringify(raw(m).ui ?? null)}, which is not a screen — a wireframe of nothing cannot be signed for` });
        continue;
      }
      const declared = new Set([...(raw(ui).fields ?? []).map((f) => `field:${f}`), ...(raw(ui).actions ?? []).map((a) => `action:${a.name}`)]);
      const controls = controlsOf(raw(m));
      const drawn = new Map();
      for (const c of controls) {
        if (drawn.has(c.testid)) out.push({ subject: m.file, message: `${m.id} uses data-testid "${c.testid}" twice — qa selects by testid, and two of them is a test that passes on whichever it hits first` });
        drawn.set(c.testid, c.from);
        if (!declared.has(c.from)) out.push({ subject: m.file, message: `${m.id} draws ${c.from} but ${ui.id} (${ui.title}) does not declare it — an affordance the design never promised is scope the client did not buy` });
      }
      const have = new Set(controls.map((c) => c.from));
      for (const d of declared) if (!have.has(d)) out.push({ subject: m.file, message: `${ui.id} declares ${d} and ${m.id} does not draw it — the client signs the drawing, so what is missing there is missing from the quotation` });
    }
    return out;
  },

  "mock:theme-first": ({ state }) => {
    const themes = new Set(of(state, "THM").map((a) => a.id));
    const mcks = of(state, "MCK");
    if (mcks.length && themes.size === 0) return [{ subject: "mock/theme.json", message: `${mcks.length} wireframe(s) exist and no theme does — dev references tokens rather than picking values, so there has to be a set of values to reference · /mock:theme` }];
    return mcks
      .filter((m) => !themes.has(raw(m).theme))
      .map((m) => ({ subject: m.file, message: `${m.id} names theme ${JSON.stringify(raw(m).theme ?? null)}, which does not exist` }));
  },

  "mock:baseline-hash": ({ state, registry }) =>
    of(state, "MCK")
      .filter((m) => raw(m).signed?.hash)
      .filter((m) => hashOf(raw(m)) !== raw(m).signed.hash)
      .filter((m) => !isOpenCr(registry, raw(m).cr))
      .map((m) => ({
        subject: m.file,
        message: `${m.id} (${raw(m).ui} ${m.title}) was signed by ${raw(m).signed.by} on ${String(raw(m).signed.at).slice(0, 10)} with hash ${raw(m).signed.hash}, and now hashes ${hashOf(raw(m))} — the drawing changed after the client signed it and no open CR accounts for it · /change:open --kind display, or put the file back`,
      })),

  "mock:ui-without-fields": ({ state }) => {
    const bare = of(state, "MCK").filter((m) => controlsOf(raw(m)).every((c) => c.kind === "button"));
    return bare.length
      ? [{ subject: "mock", message: `${bare.length} wireframe(s) have buttons and no fields, because their screens declare none: ${bare.map((m) => `${m.id} (${raw(m).ui})`).join(", ")} — that is what the client will sign unless /design:screens is given the fields first`, severity: "warn" }]
      : [];
  },
};

// ---- the callsheet ---------------------------------------------------------

const rec = (ctx, prefix) => Object.entries(ctx.registry.index).filter(([id]) => prefixOf(id) === prefix).map(([id, r]) => ({ id, ...r }));
const appsWithScreens = (ctx) => [...new Set([...rec(ctx, "UI"), ...rec(ctx, "RPT")].map((r) => r.app).filter(Boolean))];

export const NEXT = [
  (ctx) => (appsWithScreens(ctx).length && rec(ctx, "THM").length === 0 ? [{ action: `/mock:theme`, reason: "there are screens but no theme — every wireframe references tokens, and there are none to reference yet" }] : []),
  (ctx) =>
    appsWithScreens(ctx)
      .filter((app) => rec(ctx, "MCK").filter((m) => m.app === app).length < [...rec(ctx, "UI"), ...rec(ctx, "RPT")].filter((u) => u.app === app).length)
      .map((app) => ({ action: `/mock:wireframe ${app}`, reason: `app ${app} has ${[...rec(ctx, "UI"), ...rec(ctx, "RPT")].filter((u) => u.app === app).length} screen(s) and ${rec(ctx, "MCK").filter((m) => m.app === app).length} wireframe(s) — a baseline with holes is not a scope` })),
  (ctx) => {
    const red = ctx.gates.results.filter((r) => r.gate === "G-mock-003");
    return red.length ? [{ action: `/change:open --kind display --source client --touches <UI> --fields <ENT.attr>`, reason: `${red.length} signed wireframe(s) differ from what was signed: ${red[0].message.split(" ")[0]} — either the change gets a CR or the file goes back` }] : [];
  },
  (ctx) =>
    appsWithScreens(ctx)
      .filter((app) => {
        const mcks = rec(ctx, "MCK").filter((m) => m.app === app);
        return mcks.length > 0 && mcks.length === [...rec(ctx, "UI"), ...rec(ctx, "RPT")].filter((u) => u.app === app).length && mcks.every((m) => m.status !== "approved");
      })
      .map((app) => ({ action: `/mock:approve ${app} --sign STK-nnn --evidence <path>`, reason: `every screen of ${app} is drawn and none is signed — the signed list is the scope of the quotation` })),
];
