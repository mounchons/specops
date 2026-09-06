#!/usr/bin/env node
/**
 * rbac.mjs — who may do what, to whose data.
 *
 *   node rbac.mjs --records <file.json>        declare the roles and what each may do
 *   node rbac.mjs                              show the matrix and what is still denied
 *
 * Default deny, written down: a row is created for every (role, screen in an app that role uses),
 * and a row grants nothing unless the payload says so. An unlisted screen is not "probably fine",
 * it is unreachable — and a screen everyone can reach because nobody wrote a rule is how data
 * belonging to one customer ends up on another customer's page.
 *
 * --records payload:
 *   { "roles": [ { key, title, stk: STK-nnn, apps: ["backoffice"] } ],
 *     "grants": [ { role: "@key"|ROLE-nnn, ui: UI-nnn|"*", allow: ["view","create"], dataScope: "own"|"all", because?: "BR-…" } ] }
 */
import fs from "node:fs";
import { parseArgs, resolveStateDir, readJson, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { prefixOf } from "../../core/scripts/ids.mjs";
import { ensureInit } from "./init.mjs";
import { FILES, allDesign, allReq, byPrefix, findById, minter, readItems, writeItems, upsert, addEdges, project, appsOf, approveCli, now } from "./lib.mjs";

export const SCOPES = ["own", "team", "all"];

export function writeRoles(stateDir, records) {
  const req = allReq(stateDir);
  const appNames = new Set(appsOf(project(stateDir)).map((a) => a.name));
  const next = minter(allDesign(stateDir).map((r) => r.id), "ROLE");
  const byKey = new Map(byPrefix(allDesign(stateDir), "ROLE").map((r) => [`@${r.key}`, r.id]));
  for (const r of records.roles ?? []) {
    orExit2(prefixOf(r.stk) === "STK" && findById(req, r.stk), `role ${JSON.stringify(r.title ?? r.key)}: stk must be an existing stakeholder, got ${JSON.stringify(r.stk ?? null)}`);
    for (const a of r.apps ?? []) orExit2(appNames.has(a), `role ${r.title}: app "${a}" is not declared in project.json`);
    if (byKey.has(`@${r.key}`)) continue;
    const id = next();
    upsert(FILES.rbac(stateDir), { id, title: r.title, status: "draft", key: r.key, apps: r.apps ?? [], derivedFrom: [r.stk] });
    addEdges(stateDir, [{ from: id, rel: "actsAs", to: r.stk }]);
    byKey.set(`@${r.key}`, id);
  }
  return byKey;
}

/** One row per (role, screen the role's apps contain). Grants come from the payload; everything else is denied. */
export function writeAcl(stateDir, records, byKey) {
  const design = allDesign(stateDir);
  const roles = byPrefix(design, "ROLE");
  const screens = [...byPrefix(design, "UI"), ...byPrefix(design, "RPT")];
  const grants = new Map();
  for (const g of records.grants ?? []) {
    const roleId = byKey.get(g.role) ?? g.role;
    orExit2(findById(design, roleId), `grant names role ${JSON.stringify(g.role)}, which does not exist`);
    orExit2(SCOPES.includes(g.dataScope ?? "all"), `grant for ${g.role}: dataScope must be one of ${SCOPES.join("|")}`);
    for (const ui of g.ui === "*" ? screens.map((s) => s.id) : [g.ui]) {
      orExit2(findById(design, ui), `grant names screen ${ui}, which does not exist`);
      const prev = grants.get(`${roleId}|${ui}`) ?? { allow: [], dataScope: "all", because: [] };
      grants.set(`${roleId}|${ui}`, {
        allow: [...new Set([...prev.allow, ...(g.allow ?? [])])],
        dataScope: g.dataScope ?? prev.dataScope,
        because: [...new Set([...prev.because, ...(g.because ? [g.because] : [])])],
      });
    }
  }

  const next = minter(design.map((r) => r.id), "ACL");
  const written = [];
  for (const role of roles) {
    // split the rows by the origin of the screen they cover: one file per role would pass 300 lines
    // on any project with a real number of screens (G-core-005), and origin is known before writing
    const have = new Map(byPrefix(design, "ACL").filter((a) => a.role === role.id).map((a) => [a.ui, a]));
    const groups = new Map();
    for (const ui of screens) {
      if (!(role.apps ?? []).includes(ui.app)) continue;
      const g = grants.get(`${role.id}|${ui.id}`);
      const existing = have.get(ui.id);
      const row = {
        id: existing?.id ?? next(),
        title: `${role.title} → ${ui.title}`,
        status: "draft",
        role: role.id,
        ui: ui.id,
        allow: g?.allow ?? existing?.allow ?? [],
        dataScope: g?.dataScope ?? existing?.dataScope ?? "all",
        derivedFrom: [role.id, ui.id, ...(g?.because ?? [])],
        decidedAt: g ? now() : (existing?.decidedAt ?? null),
      };
      groups.set(ui.origin, [...(groups.get(ui.origin) ?? []), row]);
    }
    let rows = 0;
    let denied = 0;
    for (const [origin, list] of groups) {
      writeItems(FILES.acl(stateDir, role.id, origin), list);
      rows += list.length;
      denied += list.filter((r) => r.allow.length === 0).length;
    }
    written.push({ role: role.id, rows, denied });
  }
  return written;
}

export function view(stateDir) {
  const design = allDesign(stateDir);
  const roles = byPrefix(design, "ROLE");
  const acl = byPrefix(design, "ACL");
  const screens = [...byPrefix(design, "UI"), ...byPrefix(design, "RPT")];
  const uncovered = screens.filter((ui) => !acl.some((a) => a.ui === ui.id));
  return { roles, acl, screens, uncovered };
}

if (isMain(import.meta.url)) {
  const { flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  ensureInit(stateDir);
  if (typeof flags.approve === "string") approveCli(stateDir, flags, ["ACL", "ROLE"]);

  if (typeof flags.records === "string") {
    orExit2(fs.existsSync(flags.records), `no such file: ${flags.records}`);
    const records = readJson(flags.records);
    const byKey = writeRoles(stateDir, records);
    const written = writeAcl(stateDir, records, byKey);
    console.log(`RBAC  ${written.length} role(s)`);
    for (const w of written) console.log(`  ${w.role}  ${w.rows} row(s), ${w.denied} still deny everything`);
  }

  const { roles, acl, screens, uncovered } = view(stateDir);
  console.log(`\n${"screen".padEnd(34)} ${roles.map((r) => r.title.padEnd(14)).join("")}`);
  console.log("-".repeat(34 + roles.length * 14));
  for (const ui of screens) {
    const cells = roles.map((r) => {
      const row = acl.find((a) => a.role === r.id && a.ui === ui.id);
      if (!row) return "–".padEnd(14);
      return `${row.allow.length ? row.allow.join(",") : "deny"}${row.dataScope === "own" ? " (own)" : ""}`.slice(0, 13).padEnd(14);
    });
    console.log(`${`${ui.id} ${ui.title}`.slice(0, 33).padEnd(34)} ${cells.join("")}`);
  }
  if (uncovered.length) console.log(`\n${uncovered.length} screen(s) with no ACL row at all — G-design-012: ${uncovered.map((u) => u.id).join(", ")}`);
  console.log(`\n  next: /design:scenario <module>`);
  process.exit(0);
}
