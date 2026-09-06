#!/usr/bin/env node
/**
 * plan.mjs — one vertical slice per unit of work, in an order the graph decides.
 *
 *   node plan.mjs <module> [--state-dir X]
 *
 * Most units are use cases, and their order comes from the state machine, not from a person's sense
 * of what is foundational: a use case that moves a booking confirmed → out cannot be built before the
 * one that produces confirmed. Where the design's steps name no transition, no dependency is invented
 * — those tasks fall back to use-case order and the command prints which ones, so the gap is visible
 * rather than guessed at.
 *
 * The rest of the screens have no use case at all: the baseline pages every app has, the master
 * maintenance a use case selects from, and the screens an NFR asks for. They are still work, and a
 * plan that skips them ships an application nobody can sign in to. One task per (origin, generatorKey)
 * — one capability, however many apps show it — carrying the ACL rows it has to enforce in place of
 * the acceptance criteria it was never given. Their order is the rank in lib.mjs SCREEN_ORIGINS,
 * because a screen no use case produced names no transition to sort on.
 */
import { parseArgs, resolveStateDir, stateExists, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { loadState } from "../../core/scripts/artifacts.mjs";
import { ensureInit } from "./init.mjs";
import { FILES, SCREEN_ORIGINS, allCmps, allTsks, of, mintId, upsert, addEdges, isFrozen, statesOf, moduleOf, originOf, byBuildOrder, now } from "./lib.mjs";

/** Kahn, with use-case id as the tiebreak so two runs never disagree. */
export function topo(nodes, deps) {
  const left = new Map(nodes.map((n) => [n, new Set((deps.get(n) ?? []).filter((d) => nodes.includes(d)))]));
  const out = [];
  while (left.size) {
    const ready = [...left].filter(([, d]) => d.size === 0).map(([n]) => n).sort();
    if (ready.length === 0) return { order: null, cycle: [...left.keys()].sort() };
    for (const n of ready) {
      out.push(n);
      left.delete(n);
    }
    for (const [, d] of left) for (const n of ready) d.delete(n);
  }
  return { order: out, cycle: null };
}

/**
 * The work that is not a use case, grouped into capabilities. The two login screens are one login
 * even though the apps sign in differently — one task carries both, and its apps[] tell the slice to
 * print both auth schemes. Groups keep the generator's own order (lowest screen id first), which is
 * why login lands ahead of the pages that need somebody to be signed in.
 */
export function screenGroups(screens, module) {
  const mine = screens.filter((s) => moduleOf(s.id) === module && s.origin && s.origin !== "usecase" && s.status !== "retired");
  const out = [];
  for (const origin of SCREEN_ORIGINS.filter((o) => o !== "usecase")) {
    const keys = new Map();
    for (const s of mine.filter((x) => x.origin === origin).sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
      const k = s.generatorKey ?? s.kind ?? s.id;
      keys.set(k, [...(keys.get(k) ?? []), s]);
    }
    [...keys].forEach(([key, list], i) => out.push({ origin, key, screens: list, order: i + 1 }));
  }
  return out;
}

export function plan(stateDir, module) {
  ensureInit(stateDir);
  const cmps = allCmps(stateDir);
  orExit2(cmps.length, `no components yet — /dev:stack decides the stack before anything is planned against it`);

  const state = loadState(stateDir);
  const ucs = of(state, "UC").filter((a) => a.module === module && a.status !== "retired");
  const screens = [...of(state, "UI"), ...of(state, "RPT")].map((a) => a.raw);
  const groups = screenGroups(screens, module);
  orExit2(ucs.length + groups.length, `module "${module}" has no use case and no screen of its own — /design:usecase ${module} first`);

  const stms = of(state, "STM").map((a) => a.raw);
  const stateNames = new Set(stms.flatMap((s) => (s.states ?? []).map((x) => x.name)));
  const acs = of(state, "AC").map((a) => a.raw);
  const scns = of(state, "SCN").map((a) => a.raw);
  const mcks = of(state, "MCK").map((a) => a.raw);
  const calcs = of(state, "CALC").map((a) => a.raw);
  const gds = of(state, "GD").map((a) => a.raw);
  const acls = of(state, "ACL").map((a) => a.raw);
  const verify = cmps.find((c) => c.run?.test)?.run.test ?? null;
  const appsOf = (uis) => [...new Set(screens.filter((s) => uis.includes(s.id)).map((s) => s.app).filter(Boolean))];

  // who produces which state, so who has to exist before whom
  const moves = new Map(ucs.map((uc) => [uc.id, statesOf(uc.raw, stateNames)]));
  const producers = new Map();
  for (const [id, m] of moves) for (const s of m.produces) producers.set(s, [...(producers.get(s) ?? []), id]);
  const deps = new Map();
  const noDep = [];
  for (const uc of ucs) {
    const from = (moves.get(uc.id).consumes ?? []).flatMap((s) => producers.get(s) ?? []).filter((d) => d !== uc.id);
    deps.set(uc.id, [...new Set(from)]);
    if (from.length === 0) noDep.push(uc.id);
  }
  const { order, cycle } = topo(ucs.map((u) => u.id), deps);
  orExit2(order, `the use cases of ${module} depend on each other in a cycle: ${cycle?.join(" -> ")} — a build order cannot exist until /design:usecase breaks it`);

  const existing = allTsks(stateDir);
  const ids = existing.map((t) => t.id);
  const created = [];
  const kept = [];
  const blocked = [];
  const edges = [];
  const fresh = { proof: [], attempts: 0, blocked: null, startedAt: null, startCommit: null, commit: null, cr: null };

  order.forEach((ucId, i) => {
    const uc = ucs.find((u) => u.id === ucId);
    const have = existing.find((t) => t.usecase === ucId);
    if (have) {
      kept.push(have);
      return;
    }
    const frozen = isFrozen(ucId, { stateDir });
    if (frozen.frozen) {
      blocked.push({ id: ucId, title: uc.title, by: frozen.by, lane: frozen.lane });
      return;
    }
    const myAcs = acs.filter((a) => a.usecase === ucId).map((a) => a.id);
    const myUis = screens.filter((s) => (s.derivedFrom ?? []).includes(ucId)).map((s) => s.id);
    const myBrs = (uc.raw.flows ?? []).flatMap((f) => (f.steps ?? []).flatMap((s) => s.enforces ?? []));
    const myCalcs = calcs.filter((c) => (c.derivedFrom ?? []).some((d) => myBrs.includes(d))).map((c) => c.id);
    const id = mintId(ids, "TSK");
    ids.push(id);
    const tsk = {
      id,
      title: uc.title,
      status: "draft",
      usecase: ucId,
      screenOrigin: "usecase",
      group: ucId,
      module,
      origin: "new",
      order: i + 1,
      dependsOn: (deps.get(ucId) ?? []).map((d) => existing.find((t) => t.usecase === d)?.id ?? created.find((t) => t.usecase === d)?.id).filter(Boolean),
      acceptance: myAcs,
      scenarios: scns.filter((s) => s.usecase === ucId).map((s) => s.id),
      screens: myUis,
      mocks: mcks.filter((m) => myUis.includes(m.ui)).map((m) => m.id),
      components: cmps.map((c) => c.id),
      apps: appsOf(myUis),
      acls: acls.filter((a) => myUis.includes(a.ui)).map((a) => a.id),
      calcs: myCalcs,
      golden: gds.filter((g) => (g.derivedFrom ?? []).some((d) => myCalcs.includes(d))).map((g) => g.id),
      verify,
      ...fresh,
      plannedAt: now(),
    };
    orExit2(tsk.acceptance.length, `${ucId} (${uc.title}) has no acceptance criterion — there is nothing for a task to be finished against · /design:usecase ${module}`);
    orExit2(tsk.verify, `no component declares run.test — a task with no command to prove it can never close · /dev:stack`);
    upsert(FILES.tasks(stateDir, module, id), tsk);
    edges.push({ from: id, rel: "implements", to: ucId }, ...tsk.acceptance.map((a) => ({ from: id, rel: "implements", to: a })), ...tsk.golden.map((g) => ({ from: id, rel: "uses", to: g })));
    created.push(tsk);
  });

  groups.forEach((g) => {
    const have = existing.find((t) => originOf(t) === g.origin && t.group === g.key);
    if (have) {
      kept.push(have);
      return;
    }
    const frz = g.screens.map((s) => ({ id: s.id, f: isFrozen(s.id, { stateDir }) })).find((x) => x.f.frozen);
    if (frz) {
      blocked.push({ id: frz.id, title: `${g.origin} ${g.key}`, by: frz.f.by, lane: frz.f.lane });
      return;
    }
    const myUis = g.screens.map((s) => s.id);
    const srcs = [...new Set(g.screens.flatMap((s) => s.derivedFrom ?? []))];
    const id = mintId(ids, "TSK");
    ids.push(id);
    const tsk = {
      id,
      title: g.screens[0].title,
      status: "draft",
      usecase: null,
      screenOrigin: g.origin,
      group: g.key,
      module,
      origin: "new",
      order: g.order,
      dependsOn: [],
      acceptance: [],
      scenarios: scns.filter((s) => !s.usecase && (s.derivedFrom ?? []).some((d) => srcs.includes(d))).map((s) => s.id),
      screens: myUis,
      mocks: mcks.filter((m) => myUis.includes(m.ui)).map((m) => m.id),
      components: cmps.map((c) => c.id),
      apps: appsOf(myUis),
      acls: acls.filter((a) => myUis.includes(a.ui)).map((a) => a.id),
      calcs: [],
      golden: [],
      verify,
      ...fresh,
      plannedAt: now(),
    };
    // Nobody wrote an acceptance criterion for a screen no use case produced. What this task is
    // finished against is the permissions the design says those screens enforce; with neither, there
    // is nothing to be finished against and rbac has to answer before code does.
    orExit2(tsk.acls.length, `${g.origin} ${g.key} (${myUis.join(", ")}) has no acceptance criterion and no ACL row — there is nothing for a task to be finished against · /design:rbac`);
    orExit2(tsk.verify, `no component declares run.test — a task with no command to prove it can never close · /dev:stack`);
    upsert(FILES.tasks(stateDir, module, id), tsk);
    edges.push(...myUis.map((u) => ({ from: id, rel: "implements", to: u })), ...tsk.acls.map((a) => ({ from: id, rel: "enforces", to: a })));
    created.push(tsk);
  });

  if (edges.length) addEdges(stateDir, edges);
  return { module, order, groups, created, kept, blocked, noDep, deps };
}

if (isMain(import.meta.url)) {
  const { _, flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  orExit2(stateExists(stateDir), `no state dir at ${stateDir}`);
  orExit2(_[0], "usage: plan.mjs <module>");
  const r = plan(stateDir, _[0]);

  console.log(`PLAN ${r.module}  created ${r.created.length}  already there ${r.kept.length}  blocked ${r.blocked.length}`);
  const rows = [...r.created, ...r.kept].sort(byBuildOrder);
  if (rows.length) {
    console.log(`\n  #  task     origin    for               AC  SCN  UI  MCK  ACL  CALC  GD  depends on`);
    console.log(`  ------------------------------------------------------------------------------------`);
    rows.forEach((t, i) => {
      const n = (a) => String((a ?? []).length).padEnd(3);
      console.log(`  ${String(i + 1).padStart(2)} ${t.id.padEnd(8)} ${originOf(t).padEnd(9)} ${String(t.usecase ?? t.group ?? "—").padEnd(17)} ${n(t.acceptance)} ${n(t.scenarios)} ${n(t.screens)} ${n(t.mocks)} ${n(t.acls)} ${n(t.calcs).padEnd(2)} ${n(t.golden)} ${(t.dependsOn ?? []).join(", ") || "—"}`);
    });
  }
  if (r.noDep.length) console.log(`\nno state transition in the design's steps, so no dependency inferred — ordered by use case: ${r.noDep.join(", ")}`);
  const off = rows.filter((t) => originOf(t) !== "usecase");
  if (off.length) console.log(`\n${off.length} task(s) build screens no use case produced — finished against ACL rows, not acceptance criteria: ${off.map((t) => `${t.id} ${originOf(t)}/${t.group}`).join(" · ")}`);
  if (rows.length) console.log(`\nverify for every task: ${rows[0].verify}`);
  if (r.blocked.length) {
    console.log(`\nnot planned:`);
    for (const b of r.blocked) console.log(`  ${b.id} ${b.title} — frozen by ${b.by} (lane ${b.lane}) · close the change first`);
    process.exit(1);
  }
  console.log(`\nnext: /dev:task ${rows[0]?.id ?? "TSK-001"} --start — one slice per session`);
  process.exit(0);
}
