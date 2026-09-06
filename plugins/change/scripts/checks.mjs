#!/usr/bin/env node
/**
 * checks.mjs — change's rules, as functions, plus the one function the rest of the marketplace
 * calls: isFrozen(). Core loads CHECKS (gates.mjs) and NEXT (next.mjs) once project.json names
 * plugins.change.root.
 *
 * Contract: CHECKS = { "change:<check>": (ctx) => [{ subject, message, severity? }] }
 *           NEXT   = [ (ctx) => [{ action, reason, stop? }] ]
 *           ctx    = { stateDir, project, state, registry }   (NEXT gets { gates } instead of state)
 *
 * mock, dev and qa import isFrozen and refuse before they start. They do not read change/ and they
 * do not learn the CR format: they ask one question and get one answer.
 */
import { prefixOf } from "../../core/scripts/ids.mjs";
import { KINDS, SOURCES, LANES, STALE_DAYS, atLeast, openCrs } from "./lib.mjs";

const crs = (state) => state.artifacts.filter((a) => a.prefix === "CR");
const open = (a) => a.file.includes("change/open/");
const raw = (a) => a.raw ?? {};
const days = (iso) => (Date.now() - Date.parse(iso ?? 0)) / 86400000;

/**
 * The freeze, as one question with one answer. An id is frozen while an open CR lists it in
 * `touches` or in the impact it walked — the blast radius is frozen too, or the change lands on
 * artifacts that were re-approved against the old version of the one that moved.
 */
export function isFrozen(id, ctx) {
  for (const cr of openCrs(ctx.stateDir)) {
    const hit = (cr.touches ?? []).includes(id) || (cr.impact?.affected ?? []).some((a) => a.id === id);
    if (hit) return { frozen: true, by: cr.id, lane: cr.lane ?? null };
  }
  return { frozen: false, by: null, lane: null };
}

export const CHECKS = {
  "change:cr-shape": ({ state }) => {
    const out = [];
    for (const cr of crs(state)) {
      const r = raw(cr);
      if (!KINDS.includes(r.kind)) out.push({ subject: cr.file, message: `${cr.id} kind ${JSON.stringify(r.kind ?? null)} — one of ${KINDS.join("|")}; the kind is what decides how the lane is read` });
      if (!SOURCES.includes(r.source)) out.push({ subject: cr.file, message: `${cr.id} source ${JSON.stringify(r.source ?? null)} — one of ${SOURCES.join("|")}; who asked is what makes a change billable` });
      if (!String(r.request ?? "").trim()) out.push({ subject: cr.file, message: `${cr.id} has no request — the client's own words are the only thing that cannot be reconstructed later` });
      if (r.lane != null && !LANES.includes(r.lane)) out.push({ subject: cr.file, message: `${cr.id} lane ${JSON.stringify(r.lane)} — null until impact has run, then ui or full` });
    }
    return out;
  },

  "change:finding-needs-def": ({ state }) => {
    const defs = new Set(state.artifacts.filter((a) => a.prefix === "DEF").map((a) => a.id));
    return crs(state)
      .filter((cr) => raw(cr).source === "finding" && !defs.has(raw(cr).finding))
      .map((cr) => ({ subject: cr.file, message: `${cr.id} came from a finding but names ${JSON.stringify(raw(cr).finding ?? null)} — a defect that routed to spec has a DEF, and without it nobody can tell which test found this` }));
  },

  "change:display-needs-fields": ({ state }) => {
    const ents = new Map(state.artifacts.filter((a) => a.prefix === "ENT").map((a) => [a.id, a]));
    const out = [];
    for (const cr of crs(state)) {
      if (raw(cr).kind !== "display") continue;
      const fields = raw(cr).fields ?? [];
      if (fields.length === 0) {
        out.push({ subject: cr.file, message: `${cr.id} is a display change that names no field — there is nothing to display, so this is a screen change` });
        continue;
      }
      for (const spec of fields) {
        const m = /^(ENT-[0-9]{3})\.([A-Za-z_][\w-]*)$/.exec(String(spec));
        const ent = m && ents.get(m[1]);
        if (!m) out.push({ subject: cr.file, message: `${cr.id} field ${JSON.stringify(spec)} — the shape is ENT-nnn.attribute` });
        else if (!ent) out.push({ subject: cr.file, message: `${cr.id} field ${spec}: ${m[1]} does not exist` });
        else if (!(raw(ent).attributes ?? []).includes(m[2])) out.push({ subject: cr.file, message: `${cr.id} field ${spec}: ${ent.title} has no attribute "${m[2]}" — this change adds data, which is never lane ui` });
      }
    }
    return out;
  },

  "change:stale-open": ({ state }) =>
    crs(state)
      .filter((cr) => open(cr) && !raw(cr).impact && days(raw(cr).openedAt) > STALE_DAYS)
      .map((cr) => ({ subject: cr.file, message: `${cr.id} has been open ${Math.floor(days(raw(cr).openedAt))} days with no impact — until it is walked, nobody knows what it freezes or what it costs`, severity: "warn" })),

  "change:frozen": ({ state, registry }) => {
    const out = [];
    for (const cr of crs(state)) {
      if (!open(cr)) continue;
      const ids = [...new Set([...(raw(cr).touches ?? []), ...(raw(cr).impact?.affected ?? []).map((a) => a.id)])];
      for (const id of ids) {
        const status = registry.index[id]?.status;
        if (!atLeast(status, "approved")) continue;
        out.push({ subject: registry.index[id]?.file ?? id, message: `${id} [${status}] is frozen by ${cr.id} (lane ${raw(cr).lane ?? "not decided"}) — mock, dev and qa refuse it until the change closes`, severity: "warn" });
      }
    }
    return out;
  },

  "change:closed-clean": ({ state, registry }) => {
    const out = [];
    for (const cr of crs(state)) {
      if (open(cr)) continue;
      const c = raw(cr).closed ?? {};
      if (!c.by) out.push({ subject: cr.file, message: `${cr.id} is closed with no signature — a change closes when a person says it is done` });
      if (!c.evidence) out.push({ subject: cr.file, message: `${cr.id} is closed with no evidence — P6: the truth comes from a run, not from a status field` });
      for (const id of raw(cr).touches ?? []) {
        const status = registry.index[id]?.status;
        if (status === "draft") out.push({ subject: cr.file, message: `${cr.id} is closed but ${id} it touched is still draft — the change was closed before its own owner re-approved the record` });
      }
    }
    return out;
  },
};

// ---- the callsheet ---------------------------------------------------------

const openIn = (ctx) =>
  Object.entries(ctx.registry.index)
    .filter(([id, r]) => prefixOf(id) === "CR" && r.file.includes("change/open/"))
    .map(([id]) => id);

const body = (ctx, id) => openCrs(ctx.stateDir).find((c) => c.id === id) ?? {};
const radius = (cr) => [...new Set([...(cr.touches ?? []), ...(cr.impact?.affected ?? []).map((a) => a.id)])];

export const NEXT = [
  (ctx) => openIn(ctx).map((id) => body(ctx, id)).filter((cr) => !cr.lane).map((cr) => ({ action: `/change:impact ${cr.id}`, reason: `${cr.kind} change with no lane — until the graph is walked nobody knows what it costs or what it freezes`, stop: true })),
  (ctx) => openIn(ctx).map((id) => body(ctx, id)).filter((cr) => cr.lane && !cr.applied).map((cr) => ({ action: `/change:apply ${cr.id}`, reason: `lane ${cr.lane}, walked but not handed over — apply names the commands each plugin has to run` })),
  (ctx) =>
    openIn(ctx)
      .map((id) => body(ctx, id))
      .filter((cr) => cr.applied)
      .map((cr) => {
        const all = radius(cr);
        const pending = all.filter((aid) => !atLeast(ctx.registry.index[aid]?.status, "approved"));
        const cmds = cr.applied.commands ?? [];
        // a CR that touches nothing (a new screen, a new report) has no artifact whose status can say
        // when it is done — the graph cannot tell, so the callsheet points at the work, not at close
        if (all.length === 0) return { action: cmds[0] ?? `/change:close ${cr.id} --sign STK-nnn --evidence <path>`, reason: `${cr.id} (lane ${cr.lane}) creates rather than changes, so no status can say when it is done — the owner closes it after the last command has run${cmds.length > 1 ? ` · then ${cmds.slice(1).join(" · ")}` : ""}` };
        if (pending.length === 0) return { action: `/change:close ${cr.id} --sign STK-nnn --evidence <path>`, reason: `every artifact ${cr.id} touched is back at approved` };
        return { action: cmds[0] ?? `re-run /change:apply ${cr.id}`, reason: `${cr.id} (lane ${cr.lane}) is applied; ${pending.length} artifact(s) still below approved: ${pending.slice(0, 4).join(", ")}${cmds.length > 1 ? ` · then ${cmds.slice(1).join(" · ")}` : ""}` };
      }),
];
