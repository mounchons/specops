#!/usr/bin/env node
/**
 * wireframe.mjs — draw every screen of one app at L1, from the design and nothing else.
 *
 *   node wireframe.mjs <app> [UI-x,UI-y] [--cr CR-nnn] [--state-dir X]
 *
 * It creates what is missing, re-renders the HTML of what is not, and refuses to change a drawing
 * the client has signed or a screen an open CR has frozen unless `--cr` names that change. The
 * refusal is the point: a mock that quietly redraws a signed screen is how a baseline stops being
 * evidence of anything.
 */
import fs from "node:fs";
import { parseArgs, resolveStateDir, stateExists, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { ensureRegistry } from "../../core/scripts/query.mjs";
import { loadState } from "../../core/scripts/artifacts.mjs";
import { ensureInit } from "./init.mjs";
import { FILES, allMcks, writeMck, mintMckId, desiredMck, controlsOf, addEdges, readTheme, requireApp, screensOf, aclsOf, isFrozen, hashOf, list } from "./lib.mjs";
import { renderMck } from "./render.mjs";

const moduleOfId = (id) => /^[A-Z]+-([a-z0-9-]+)-[0-9]{3}/.exec(String(id))?.[1] ?? null;

export function wireframe(stateDir, app, { only = [], cr = null } = {}) {
  ensureInit(stateDir);
  requireApp(stateDir, app);
  const theme = readTheme(stateDir);
  orExit2(theme, `no theme yet — /mock:theme decides the tokens before anything is drawn with them`);

  const reg = ensureRegistry(stateDir);
  if (cr) orExit2(reg.index[cr]?.file?.includes("change/open/"), `--cr ${cr} is not an open change request`);

  const state = loadState(stateDir);
  const screens = screensOf(state, app);
  orExit2(screens.length, `app ${app} has no screens — /design:screens <module> generates them`);
  const targets = only.length ? screens.filter((s) => only.includes(s.id)) : screens;
  orExit2(targets.length, `none of ${only.join(", ")} is a screen of ${app}`);

  const acls = aclsOf(state);
  const existing = allMcks(stateDir);
  const ids = existing.map((m) => m.id);
  const created = [];
  const updated = [];
  const unchanged = [];
  const blocked = [];
  const edges = [];

  for (const ui of targets) {
    const want = desiredMck(ui, acls, theme.id);
    const have = existing.find((m) => m.ui === ui.id);
    // the hash is recomputed from what is on disk, not read out of the record: a file somebody
    // edited by hand still carries the hash it had before the edit, and that is exactly the case
    // this has to catch
    const same = have && hashOf(have) === want.hash;
    const frozen = isFrozen(ui.id, { stateDir });
    const stop = [];
    if (frozen.frozen && cr !== frozen.by) stop.push(`frozen by ${frozen.by} (lane ${frozen.lane ?? "not decided"}) — redraw it with --cr ${frozen.by}`);
    if (have && !same && have.signed && !cr) stop.push(`signed by ${have.signed.by} on ${String(have.signed.at).slice(0, 10)} — a signed drawing changes through a CR, not through a re-run`);

    if (same) {
      fs.writeFileSync(FILES.html(stateDir, app, have.id), renderMck(have, theme), "utf8");
      unchanged.push(have);
      continue;
    }
    if (stop.length) {
      blocked.push({ ui: ui.id, mck: have?.id ?? null, title: ui.title, why: stop });
      continue;
    }

    const id = have?.id ?? mintMckId(ids, ui.__module ?? moduleOfId(ui.id));
    if (!have) ids.push(id);
    const mck = {
      id,
      title: want.title,
      status: have?.status ?? "draft",
      ui: want.ui,
      app: want.app,
      theme: want.theme,
      kind: want.kind,
      zones: want.zones,
      states: want.states,
      roles: want.roles,
      cr: cr ?? have?.cr ?? null,
      signed: have?.signed ?? null,
      hash: want.hash,
      derivedFrom: [ui.id],
    };
    writeMck(stateDir, mck);
    fs.writeFileSync(FILES.html(stateDir, app, id), renderMck(mck, theme), "utf8");
    edges.push({ from: id, rel: "mocks", to: ui.id });
    (have ? updated : created).push(mck);
  }

  if (edges.length) addEdges(stateDir, edges);
  return { app, theme, created, updated, unchanged, blocked, screens: targets };
}

if (isMain(import.meta.url)) {
  const { _, flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  orExit2(stateExists(stateDir), `no state dir at ${stateDir}`);
  orExit2(_[0], "usage: wireframe.mjs <app> [UI-x,UI-y] [--cr CR-nnn]");
  const r = wireframe(stateDir, _[0], { only: list(_[1]), cr: typeof flags.cr === "string" ? flags.cr : null });

  console.log(`WIREFRAME ${r.app}  created ${r.created.length}  updated ${r.updated.length}  already there ${r.unchanged.length}  blocked ${r.blocked.length}  theme ${r.theme.id}`);
  const rows = [...r.created, ...r.updated, ...r.unchanged].sort((a, b) => a.id.localeCompare(b.id));
  if (rows.length) {
    console.log(`\nmock            screen          controls  fields  actions  kind`);
    console.log(`------------------------------------------------------------------`);
    for (const m of rows) {
      const cs = controlsOf(m);
      const f = cs.filter((c) => c.kind !== "button").length;
      console.log(`${m.id.padEnd(15)} ${m.ui.padEnd(15)} ${String(cs.length).padEnd(9)} ${String(f).padEnd(7)} ${String(cs.length - f).padEnd(8)} ${m.kind}`);
    }
  }
  const bare = rows.filter((m) => controlsOf(m).every((c) => c.kind === "button"));
  if (bare.length) console.log(`\nno field declared by the design, so none drawn — this is what the client signs: ${bare.map((m) => `${m.id} (${m.ui})`).join(", ")}`);
  if (r.blocked.length) {
    console.log(`\nnot drawn:`);
    for (const b of r.blocked) for (const why of b.why) console.log(`  ${b.ui} ${b.mck ? `(${b.mck}) ` : ""}${b.title} — ${why}`);
    process.exit(1);
  }
  console.log(`\nnext: /mock:approve ${r.app} --sign STK-nnn --evidence <path> — the signed list is the scope of the quotation`);
  process.exit(0);
}
