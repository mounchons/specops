#!/usr/bin/env node
/**
 * checks.mjs — dev's rules, as functions. Core loads CHECKS (gates.mjs) and NEXT (next.mjs) once
 * project.json names plugins.dev.root.
 *
 * G-dev-008 (`dev:skill-installed`) is deliberately absent from CHECKS: no script can see which
 * skills the running session has loaded, so gates.mjs prints it as a LIMIT on every run. That is
 * constitution rule 1 working as intended, not an oversight.
 */
import fs from "node:fs";
import path from "node:path";
import { prefixOf } from "../../core/scripts/ids.mjs";
import { walk } from "../../core/scripts/paths.mjs";
import { isFrozen, allCmps, allTsks, allImps, allGaps, componentOf, moduleOf } from "./lib.mjs";

const of = (state, prefix) => state.artifacts.filter((a) => a.prefix === prefix);
const raw = (a) => a.raw ?? {};
const STARTED = new Set(["approved", "implemented"]);
const SKIP = new Set(["bin", "obj", "node_modules", ".git", ".sdlc", "dist", "build", "out", "packages", "TestResults"]);

const EXTENSIONS = {
  csharp: [".cs"], "c#": [".cs"], typescript: [".ts", ".tsx"], javascript: [".js", ".mjs", ".jsx"],
  python: [".py"], java: [".java"], go: [".go"], ruby: [".rb"], php: [".php"], rust: [".rs"], kotlin: [".kt"],
};

export const codeRootFor = (stateDir, cmp) => path.resolve(stateDir, cmp.codeRoot ?? "..");

/** Every scalar a golden dataset says the answer is, with the row it came from. */
export function goldenValues(gd) {
  const out = [];
  for (const row of gd.rows ?? []) {
    const walkValue = (v) => {
      if (v == null) return;
      if (Array.isArray(v)) return v.forEach(walkValue);
      if (typeof v === "object") return Object.values(v).forEach(walkValue);
      out.push({ label: row.label ?? "", value: v });
    };
    walkValue(row.expected);
  }
  return out;
}

/**
 * What a test file does not say. A number is matched on its own, so 800 does not find itself inside
 * 2800 — the point of the gate is that the test asserts the signed answer, not a number near it.
 */
export function goldenMisses(imp, gdsById, codeRoot) {
  const file = path.join(codeRoot, imp.path);
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8");
  const out = [];
  for (const gdId of imp.golden ?? []) {
    const gd = gdsById.get ? gdsById.get(gdId) : gdsById[gdId];
    if (!gd) continue;
    for (const { label, value } of goldenValues(gd)) {
      const s = String(value);
      const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const found = typeof value === "number" ? new RegExp(`(?<![\\d.])${escaped}(?![\\d])`).test(text) : text.includes(s);
      if (!found) out.push({ gd: gdId, label, value, path: imp.path });
    }
  }
  return out;
}

export const CHECKS = {
  "dev:tsk-needs-proof": ({ state }) =>
    of(state, "TSK")
      .filter((t) => ["implemented", "verified"].includes(t.status))
      .filter((t) => !(raw(t).proof ?? []).some((p) => p.exitCode === 0))
      .map((t) => ({ subject: t.file, message: `${t.id} (${t.title}) is ${t.status} with no proof that exited 0 — done is a command that ran, not a status somebody typed` })),

  "dev:imp-in-layout": ({ state, stateDir }) => {
    const cmps = allCmps(stateDir);
    const out = [];
    for (const i of of(state, "IMP")) {
      const r = raw(i);
      const cmp = cmps.find((c) => c.id === r.component);
      if (!cmp) {
        out.push({ subject: i.file, message: `${i.id} names component ${JSON.stringify(r.component ?? null)}, which does not exist` });
        continue;
      }
      if (componentOf([cmp], r.path ?? "")?.id !== cmp.id) out.push({ subject: i.file, message: `${i.id} is ${r.path}, which is outside ${cmp.id}'s root ${cmp.root} — either the file is in the wrong place or the stack has the wrong root` });
      else if (!fs.existsSync(path.join(codeRootFor(stateDir, cmp), r.path))) out.push({ subject: i.file, message: `${i.id} owns ${r.path}, which does not exist — the file was moved or deleted and the record was not` });
    }
    return out;
  },

  "dev:tsk-frozen": ({ state, stateDir }) =>
    of(state, "TSK")
      .filter((t) => STARTED.has(t.status))
      .flatMap((t) =>
        [raw(t).usecase, ...(raw(t).screens ?? []), ...(raw(t).acceptance ?? [])]
          .map((id) => ({ id, f: isFrozen(id, { stateDir }) }))
          .filter((x) => x.f.frozen && x.f.by !== raw(t).cr)
          .slice(0, 1)
          .map((x) => ({ subject: t.file, message: `${t.id} (${t.title}) has started and ${x.id} is frozen by ${x.f.by} (lane ${x.f.lane}) — the code would be written against a spec that is being changed` }))
      ),

  "dev:gd-verbatim": ({ state, stateDir }) => {
    const gds = new Map(of(state, "GD").map((a) => [a.id, a.raw]));
    const cmps = allCmps(stateDir);
    return of(state, "IMP")
      .filter((i) => raw(i).kind === "test" && (raw(i).golden ?? []).length)
      .flatMap((i) => {
        const cmp = cmps.find((c) => c.id === raw(i).component);
        if (!cmp) return [];
        return goldenMisses(raw(i), gds, codeRootFor(stateDir, cmp)).map((m) => ({ subject: i.file, message: `${i.id} (${m.path}) asserts ${m.gd} and does not contain ${JSON.stringify(m.value)} from row "${m.label}" — the answer key is signed, so the test uses it word for word` }));
      });
  },

  "dev:file-without-imp": ({ state, stateDir }) => {
    const cmps = allCmps(stateDir);
    if (cmps.length === 0) return [];
    const owned = new Set(of(state, "IMP").map((i) => raw(i).path));
    const orphans = [];
    const unknown = [];
    for (const cmp of cmps) {
      const exts = EXTENSIONS[String(cmp.language).toLowerCase()];
      if (!exts) {
        unknown.push(`${cmp.id} (${cmp.language})`);
        continue;
      }
      const root = path.join(codeRootFor(stateDir, cmp), cmp.root);
      for (const f of walk(root, (p) => exts.includes(path.extname(p)))) {
        const rel = path.relative(codeRootFor(stateDir, cmp), f).split(path.sep).join("/");
        if (rel.split("/").some((seg) => SKIP.has(seg))) continue;
        if (!owned.has(rel)) orphans.push(rel);
      }
    }
    const out = [];
    if (orphans.length) out.push({ subject: "dev", message: `${orphans.length} file(s) under a component root that no IMP owns: ${orphans.slice(0, 6).join(", ")}${orphans.length > 6 ? ` … +${orphans.length - 6}` : ""} — /dev:task <TSK> --impl claims them, or nobody can say which slice they belong to`, severity: "warn" });
    if (unknown.length) out.push({ subject: "dev", message: `no file-extension list for ${unknown.join(", ")} — the sweep skipped those components rather than guessing which files are source`, severity: "warn" });
    return out;
  },

  "dev:trace-uc-not-br": ({ state }) =>
    state.edges
      .filter((e) => e.owner === "dev" && e.rel !== "refs" && prefixOf(e.to) === "BR")
      .map((e) => ({ subject: e.file, message: `${e.from} ${e.rel} ${e.to} — dev traces the use case, and the use case carries the rule (${e.to} reaches the code through its UC's steps)` })),

  "dev:gap-open": ({ state }) => {
    const open = of(state, "GAP").filter((g) => !raw(g).cr && !raw(g).answer);
    return open.length
      ? [{ subject: "dev/gaps.json", message: `${open.length} gap(s) with no CR and no answer: ${open.map((g) => `${g.id} (${raw(g).about}: ${raw(g).question})`).join(" · ")} — code is waiting on a question nobody has put upstream`, severity: "warn" }]
      : [];
  },
};

// ---- the callsheet ---------------------------------------------------------

const tsks = (ctx) => allTsks(ctx.stateDir);
const ucModules = (ctx) => [...new Set(Object.keys(ctx.registry.index).filter((id) => prefixOf(id) === "UC").map(moduleOf).filter(Boolean))];

export const NEXT = [
  (ctx) => ((ctx.project.apps ?? []).length && allCmps(ctx.stateDir).length === 0 ? [{ action: `/dev:stack`, reason: "there are apps but no component — dev asks the stack once and never guesses it" }] : []),
  (ctx) => (allCmps(ctx.stateDir).length ? ucModules(ctx).filter((m) => !tsks(ctx).some((t) => moduleOf(t.usecase) === m)).map((m) => ({ action: `/dev:plan ${m}`, reason: `module ${m} has use cases and no tasks — one vertical slice each, in an order the state machine decides` })) : []),
  (ctx) => {
    const next = tsks(ctx).filter((t) => !t.blocked && t.status === "draft").sort((a, b) => a.order - b.order)[0];
    return next ? [{ action: `/dev:task ${next.id} --start`, reason: `${next.title} (${next.usecase}) is first in build order and has not started` }] : [];
  },
  (ctx) => tsks(ctx).filter((t) => t.status === "approved" && !t.blocked).map((t) => ({ action: `/dev:task ${t.id} --verify`, reason: `${t.id} started at ${String(t.startedAt).slice(0, 16)} with ${(t.proof ?? []).length} proof(s) — ${t.verify}` })),
  (ctx) => tsks(ctx).filter((t) => t.status === "implemented").map((t) => ({ action: `/dev:task ${t.id} --close`, reason: `${t.id}'s last run exited 0 — commit the diff with ${t.id} in the message, then close` })),
  (ctx) => tsks(ctx).filter((t) => t.blocked).map((t) => ({ action: `/dev:revise ${t.usecase} --request "…"`, reason: `${t.id} is blocked: ${t.blocked.reason}` })),
  (ctx) => allGaps(ctx.stateDir).filter((g) => !g.cr && !g.answer).map((g) => ({ action: g.openWith, reason: `${g.id} asks for a ${g.asks} that ${g.about} does not declare — upstream decides, dev does not` })),
  (ctx) => ucModules(ctx).filter((m) => { const ts = tsks(ctx).filter((t) => moduleOf(t.usecase) === m); return ts.length && ts.every((t) => t.status === "verified"); }).map((m) => ({ action: `/dev:handoff ${m}`, reason: `every task of ${m} is verified — qa needs the manifest to write test cases without asking anyone` })),
];
