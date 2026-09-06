#!/usr/bin/env node
/**
 * slice.mjs — everything the session needs to write one vertical slice, printed once, by id.
 *
 * This is the whole reason `query` exists (rule 6): the session never opens design/ or req/ to
 * "see what is there". It gets the flows, the acceptance criteria word for word, the entities and
 * the state machine, the endpoints, the permissions, the testids the wireframe promised, and the
 * golden rows its unit tests must assert — and nothing else.
 */
import { byId, of } from "./lib.mjs";

const raw = (a) => a?.raw ?? {};

/**
 * The entities a slice touches. Two keys, not one: the aggregate whose state machine the use case's
 * steps name — a create enters the initial state and moves nothing, so transitions alone never find
 * it — and every entity whose invariant is one of the rules those steps enforce. Picking by invariant
 * alone left ENT-001 Booking out of UC-rental-001's slice, the record the use case exists to write.
 */
function entitiesFor(state, uc, brs) {
  const ent = of(state, "ENT").map((a) => a.raw);
  const text = [uc.precondition ?? "", ...(uc.flows ?? []).flatMap((f) => (f.steps ?? []).map((s) => s.step ?? ""))].join(" \n ");
  const named = of(state, "STM")
    .map((a) => a.raw)
    .filter((m) => (m.states ?? []).some((x) => new RegExp(`(^|[^A-Za-z])${x.name}([^A-Za-z]|$)`).test(text)))
    .map((m) => m.entity);
  const keep = new Set(named);
  for (const e of ent) if (brs.size === 0 || (e.invariants ?? []).some((i) => brs.has(i))) keep.add(e.id);
  return ent.filter((e) => keep.has(e.id));
}

export function sliceOf(state, tsk, cmps) {
  const uc = byId(state, tsk.usecase);
  const brs = new Set((raw(uc).flows ?? []).flatMap((f) => (f.steps ?? []).flatMap((s) => s.enforces ?? [])));
  return {
    uc: raw(uc),
    acceptance: (tsk.acceptance ?? []).map((id) => raw(byId(state, id))),
    scenarios: (tsk.scenarios ?? []).map((id) => raw(byId(state, id))),
    screens: (tsk.screens ?? []).map((id) => raw(byId(state, id))),
    mocks: (tsk.mocks ?? []).map((id) => raw(byId(state, id))),
    rules: [...brs].map((id) => raw(byId(state, id))).filter((r) => r.id),
    entities: entitiesFor(state, raw(uc), brs),
    states: of(state, "STM").map((a) => a.raw),
    apis: of(state, "API").map((a) => a.raw).filter((api) => (tsk.screens ?? []).some((ui) => (api.derivedFrom ?? []).includes(ui) || api.ui === ui)),
    acls: of(state, "ACL").map((a) => a.raw).filter((acl) => (tsk.screens ?? []).includes(acl.ui)),
    calcs: (tsk.calcs ?? []).map((id) => raw(byId(state, id))),
    golden: (tsk.golden ?? []).map((id) => raw(byId(state, id))),
    theme: raw(of(state, "THM")[0]),
    components: cmps,
  };
}

export function printSlice(tsk, s) {
  console.log(`SLICE ${tsk.id}  ${tsk.title}  ·  ${tsk.usecase}  ·  order ${tsk.order}`);
  console.log(`\n— use case —`);
  if (s.uc.precondition) console.log(`  precondition: ${s.uc.precondition}`);
  for (const f of s.uc.flows ?? []) {
    console.log(`  flow ${f.name}:`);
    (f.steps ?? []).forEach((st, i) => console.log(`    ${i + 1}. ${st.step}${(st.enforces ?? []).length ? `   [${st.enforces.join(" ")}]` : ""}`));
  }

  console.log(`\n— rules these steps enforce (quoted, not summarised) —`);
  for (const r of s.rules) console.log(`  ${r.id}  ${r.title ?? r.rule ?? ""}`);

  console.log(`\n— acceptance criteria: the words the code has to make true —`);
  for (const a of s.acceptance) console.log(`  ${a.id}  given ${a.given} · when ${a.when} · then ${a.then}`);

  console.log(`\n— entities and states —`);
  for (const e of s.entities) console.log(`  ${e.id} ${e.title} (${e.kind})  ${(e.attributes ?? []).join(", ")}`);
  for (const st of s.states) {
    console.log(`  ${st.id} ${st.title}: ${(st.states ?? []).map((x) => x.name + (x.final ? "*" : "")).join(" → ")}`);
    for (const t of st.transitions ?? []) console.log(`    ${t.from} -> ${t.to}  by ${t.by}${(t.enforces ?? []).length ? `  [${t.enforces.join(" ")}]` : ""}`);
  }

  console.log(`\n— endpoints and permissions —`);
  for (const a of s.apis) console.log(`  ${a.id}  ${a.method ?? ""} ${a.path ?? a.route ?? ""}  ${a.title ?? ""}`);
  for (const a of s.acls) console.log(`  ${a.id}  ${a.role} on ${a.ui}: ${(a.allow ?? []).join("/")} · scope ${a.dataScope}`);

  console.log(`\n— screens and the testids the wireframe promised —`);
  for (const m of s.mocks) {
    const controls = (m.zones ?? []).flatMap((z) => z.controls ?? []);
    console.log(`  ${m.id} → ${m.ui}  ${m.title}`);
    for (const c of controls) console.log(`      data-testid="${c.testid}"  (${c.from})`);
  }
  for (const ui of s.screens) if (!s.mocks.some((m) => m.ui === ui.id)) console.log(`  ${ui.id} ${ui.title} — no wireframe yet · /mock:wireframe ${ui.app}`);
  if (s.theme?.id) console.log(`  tokens come from ${s.theme.id}: ${Object.entries(s.theme.tokens ?? {}).map(([k, v]) => `${k}=${v}`).join(" · ")}`);

  console.log(`\n— the numbers, and the answer key the unit tests must assert word for word —`);
  for (const c of s.calcs) console.log(`  ${c.id}  ${c.formula}  · rounding ${c.rounding?.mode ?? "?"}${c.rounding?.unit ? ` to ${c.rounding.unit}` : ""}${(c.boundary ?? []).length ? ` · boundary: ${c.boundary.join(" · ")}` : ""}`);
  for (const g of s.golden) {
    console.log(`  ${g.id} (${g.derivedFrom?.join(", ")}) signed by ${g.signedBy ?? "—"}`);
    for (const row of g.rows ?? []) console.log(`      ${String(row.label).padEnd(14)} in ${JSON.stringify(row.input)}  →  out ${JSON.stringify(row.expected)}`);
  }

  console.log(`\n— stack —`);
  for (const c of s.components) {
    console.log(`  ${c.id.padEnd(16)} ${c.language} ${c.framework} ${c.version} · ${c.orm} · ${c.db} · ${c.testRunner} · root ${c.root}`);
    if ((c.skills ?? []).length) console.log(`  ${" ".repeat(16)} load skills: ${c.skills.join(" ")}`);
  }
  console.log(`\n— verify —\n  ${tsk.verify}`);
  console.log(`\nwrite the code, then: /dev:task ${tsk.id} --impl <path>=source|test|migration|config · --verify · commit naming ${tsk.id} · --close`);
  console.log(`a field, action or route that is not above is Class B: /dev:revise <UI|UC> --field <name> opens a GAP instead of code`);
}
