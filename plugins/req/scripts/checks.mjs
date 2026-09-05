#!/usr/bin/env node
/**
 * checks.mjs — req's rules, as functions. Core loads CHECKS (for gates.mjs) and NEXT (for
 * next.mjs) from this file automatically once project.json names plugins.req.root.
 *
 * Contract: CHECKS = { "req:<check>": (ctx) => [{ subject, message, severity? }] }
 *           NEXT   = [ (ctx) => [{ action, reason, stop? }] ]
 *           ctx    = { stateDir, project, state, registry }   (NEXT gets { gates } instead of state)
 *
 * Checks are synchronous — gates.mjs calls them directly — so req:golden-match runs its golden
 * scripts in a child process rather than importing them.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lineageOf, prefixOf } from "../../core/scripts/ids.mjs";
import { runGolden, sameValue, versionNum } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const BANK = path.resolve(here, "..", "assets", "question-bank.json");

const of = (state, prefix) => state.artifacts.filter((a) => a.prefix === prefix);
const idsOf = (state, prefix) => new Set(of(state, prefix).map((a) => a.id));
const derived = (a) => (Array.isArray(a.raw?.derivedFrom) ? a.raw.derivedFrom : []);
const isOpen = (a) => a.status === "draft";

/** EX -> the BR@v it proves. An EX names exactly one BR version in derivedFrom. */
const provenBy = (state) => {
  const map = new Map();
  for (const ex of of(state, "EX")) {
    for (const d of derived(ex)) {
      if (prefixOf(d) !== "BR") continue;
      map.set(d, [...(map.get(d) ?? []), ex.id]);
    }
  }
  return map;
};

export const CHECKS = {
  "req:req-actor-goal": ({ state }) =>
    of(state, "REQ")
      .filter((a) => !String(a.raw?.actor ?? "").trim() || !String(a.raw?.goal ?? "").trim())
      .map((a) => ({ subject: a.file, message: `${a.id} needs both actor and goal — got actor=${JSON.stringify(a.raw?.actor ?? null)} goal=${JSON.stringify(a.raw?.goal ?? null)}` })),

  "req:actor-is-stk": ({ state }) => {
    const stk = idsOf(state, "STK");
    return of(state, "REQ")
      .filter((a) => a.raw?.actor && !stk.has(a.raw.actor))
      .map((a) => ({ subject: a.file, message: `${a.id} actor "${a.raw.actor}" is not a stakeholder — every actor is an STK in req/stakeholders.json` }));
  },

  "req:br-has-example": ({ state }) => {
    const proven = provenBy(state);
    return of(state, "BR")
      .filter((a) => a.status !== "retired" && (proven.get(a.id) ?? []).length === 0)
      .map((a) => ({ subject: a.file, message: `${a.id} has no EX — a rule nobody can give an example of is not a rule yet (Example Mapping)` }));
  },

  "req:ex-cap": ({ state }) => {
    const proven = provenBy(state);
    const out = [];
    for (const [br, exs] of proven) {
      if (exs.length > 5) out.push({ subject: `req examples of ${br}`, message: `${exs.length} EX on ${br} — the cap is 5; keep the ones that map a boundary, drop the rest` });
    }
    return out;
  },

  "req:calc-pins-one-br": ({ state }) =>
    of(state, "CALC")
      .map((a) => ({ a, brs: derived(a).filter((d) => prefixOf(d) === "BR") }))
      .filter(({ brs }) => brs.length !== 1)
      .map(({ a, brs }) => ({ subject: a.file, message: `${a.id} pins ${brs.length} BR versions (${brs.join(", ") || "none"}) — a calculation contract belongs to exactly one` })),

  "req:golden-match": ({ stateDir, state }) => {
    const out = [];
    for (const gd of of(state, "GD")) {
      const rows = Array.isArray(gd.raw?.rows) ? gd.raw.rows : [];
      if (rows.length === 0) continue;
      const calc = derived(gd).find((d) => prefixOf(d) === "CALC");
      if (!calc) {
        out.push({ subject: gd.file, message: `${gd.id} has rows but names no CALC in derivedFrom — nothing to re-run it against` });
        continue;
      }
      const script = path.join(stateDir, path.dirname(gd.file), `${calc}.mjs`);
      const res = runGolden(script, rows.map((r) => r.input));
      if (!res.ok) {
        out.push({ subject: gd.file, message: `${gd.id} could not be re-run: ${res.error}` });
        continue;
      }
      rows.forEach((row, i) => {
        if (!("expected" in row)) return;
        if (!sameValue(row.expected, res.values[i])) {
          out.push({ subject: gd.file, message: `${gd.id} row ${i + 1}${row.label ? ` (${row.label})` : ""}: expected ${JSON.stringify(row.expected)} but ${calc}.mjs computed ${JSON.stringify(res.values[i])}` });
        }
      });
    }
    return out;
  },

  "req:golden-signed": ({ state }) =>
    of(state, "GD")
      .filter((a) => a.status === "approved" && (!a.raw?.signedBy || !a.raw?.evidence))
      .map((a) => ({ subject: a.file, message: `${a.id} is approved without signedBy/evidence — an answer key nobody signed is an opinion (golden --sign)` })),

  "req:br-one-active": ({ state }) => {
    const out = [];
    const groups = new Map();
    for (const a of [...of(state, "BR"), ...of(state, "CALC")]) {
      const k = lineageOf(a.id);
      groups.set(k, [...(groups.get(k) ?? []), a]);
    }
    for (const [lineage, versions] of groups) {
      const live = versions.filter((v) => v.status !== "retired");
      if (live.length > 1) out.push({ subject: live[0].file, message: `${lineage} has ${live.length} live versions (${live.map((v) => v.id).join(", ")}) — a new version retires the one before it` });
    }
    return out;
  },

  "req:br-version-needs-cr": ({ state }) => {
    const byId = new Map([...of(state, "BR"), ...of(state, "CALC")].map((a) => [a.id, a]));
    const out = [];
    for (const a of byId.values()) {
      if (versionNum(a.id) < 2) continue;
      const prev = byId.get(`${lineageOf(a.id)}@v${versionNum(a.id) - 1}`);
      if (!prev?.raw?.approval) continue;
      if (derived(a).some((d) => prefixOf(d) === "CR")) continue;
      out.push({ subject: a.file, message: `${a.id} supersedes ${prev.id}, which the client had approved — name the CR that asked for the change in derivedFrom` });
    }
    return out;
  },

  "req:open-question": ({ state }) => {
    const open = [...of(state, "Q"), ...of(state, "DQ")].filter(isOpen);
    return open.length
      ? [{ subject: `req questions`, message: `${open.length} open: ${open.map((a) => a.id).join(", ")} — CP1 does not close while a question has no answer`, severity: "warn" }]
      : [];
  },
};

// ---- the callsheet ---------------------------------------------------------

const bankKeys = () => {
  try {
    return JSON.parse(fs.readFileSync(BANK, "utf8")).questions.map((q) => q.key);
  } catch {
    return [];
  }
};

const modulesOf = (ctx) => ctx.project.modules ?? [];
const reqRecords = (ctx, prefix) =>
  Object.entries(ctx.registry.index)
    .filter(([id, r]) => prefixOf(id) === prefix && r.plugin === "req")
    .map(([id, r]) => ({ id, ...r }));

export const NEXT = [
  // a module with no requirement has nothing for any later phase to hang on
  (ctx) => {
    const missing = modulesOf(ctx).filter((m) => !reqRecords(ctx, "REQ").some((r) => r.module === m));
    if (modulesOf(ctx).length === 0) return [{ action: "/req:init --module <name> then /req:capture <name>", reason: "project.json modules[] is empty — req writes per module" }];
    return missing.map((m) => ({ action: `/req:capture ${m}`, reason: `module "${m}" has no REQ yet — paste what the client said and let capture mint SRC/STK/REQ/UL/Q` }));
  },
  // the question bank is the cheapest way to find rules nobody thought to say out loud
  (ctx) => {
    const asked = new Set(reqRecords(ctx, "Q").concat(reqRecords(ctx, "DQ")).map((r) => r.title));
    const left = bankKeys().length - asked.size;
    return modulesOf(ctx)
      .filter(() => left > 0)
      .map((m) => ({ action: `/req:ask ${m}`, reason: `about ${left} question(s) of the bank not put to the owner yet — 3 per round, answers on disk before the next round` }));
  },
  // Example Mapping: a rule with no example is a rule nobody has tested against reality
  (ctx) => {
    const exTargets = new Set(ctx.registry.edges.filter((e) => e.rel === "verifies").map((e) => e.to));
    const bare = reqRecords(ctx, "BR").filter((r) => r.status !== "retired" && !exTargets.has(r.id));
    return bare.length ? [{ action: `/req:rules ${bare[0].module} --ex ${bare[0].id} --given … --when … --then …`, reason: `${bare.length} rule(s) with no EX: ${bare.slice(0, 3).map((r) => r.id).join(", ")}` }] : [];
  },
  // a rule with numbers in it hides a rounding decision until someone writes the contract down
  (ctx) => {
    const pinned = new Set(reqRecords(ctx, "CALC").flatMap((r) => ctx.registry.edges.filter((e) => e.from === r.id).map((e) => e.to)));
    const numeric = reqRecords(ctx, "BR").filter((r) => r.status !== "retired" && /[0-9]/.test(String(r.title ?? "")) && !pinned.has(r.id));
    return numeric.length ? [{ action: `/req:calc ${numeric[0].id}`, reason: `${numeric.length} rule(s) carry numbers but no CALC: ${numeric.slice(0, 3).map((r) => r.id).join(", ")} — rounding mode and where it rounds are decisions, not details` }] : [];
  },
  // a calculation without a signed answer key is a promise; dev's unit tests need the key
  (ctx) => {
    const gds = reqRecords(ctx, "GD");
    const unsigned = reqRecords(ctx, "CALC").filter((c) => {
      const gd = gds.find((g) => ctx.registry.edges.some((e) => e.from === g.id && e.to === c.id));
      return !gd || gd.status !== "approved";
    });
    return unsigned.length ? [{ action: `/req:golden ${unsigned[0].id} --run`, reason: `${unsigned.length} calculation(s) without a signed GD: ${unsigned.slice(0, 3).map((r) => r.id).join(", ")}` }] : [];
  },
  // an open question is the one thing that stops CP1
  (ctx) => {
    const open = reqRecords(ctx, "Q").concat(reqRecords(ctx, "DQ")).filter((r) => r.status === "draft");
    return open.length ? [{ action: `answer ${open.map((r) => r.id).slice(0, 5).join(", ")} — /req:ask <module> --answer <Q>=<option>`, reason: "CP1 does not close with an open question; guessing here is what turns into a CR later", stop: true }] : [];
  },
  // nothing left to find out — hand the client something to read
  (ctx) =>
    modulesOf(ctx)
      .filter((m) => reqRecords(ctx, "REQ").some((r) => r.module === m))
      .map((m) => ({ action: `/req:export ${m}`, reason: "requirements, rules and examples are on disk — render the Thai document for the client to sign" })),
];
