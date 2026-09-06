#!/usr/bin/env node
/**
 * revise.mjs — the Class A / Class B line, drawn by a lookup rather than by a judgment.
 *
 *   node revise.mjs <UI-x|UC-x> --field <name> | --action <name> | --route <path> [--request "…"] [--cr CR-nnn]
 *
 * Class A — the design already declares the thing: rearranging what exists is work dev may do, and
 *           it gets a task with origin `changed`.
 * Class B — it does not: a new field, a new affordance, a new route is a promise nobody upstream has
 *           made. dev writes a GAP and the exact /change:open line, and no code.
 *
 * The whole difference is whether a name is in a list on disk. That is on purpose: "it is basically
 * the same thing" is the sentence that turns an estimate into a rewrite.
 */
import { parseArgs, resolveStateDir, stateExists, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { loadState } from "../../core/scripts/artifacts.mjs";
import { ensureRegistry } from "../../core/scripts/query.mjs";
import { ensureInit } from "./init.mjs";
import { FILES, allGaps, allTsks, allImps, byId, of, mintId, taskModule, strip, upsert, git, codeRootOf, isFrozen, now } from "./lib.mjs";

const ASKS = ["field", "action", "route"];

/** Where the name would have to be, and whether it is there. */
export function lookup(state, target, asks, name) {
  const a = byId(state, target);
  if (!a) return null;
  const r = a.raw;
  if (asks === "field") return { where: `${target}.fields[]`, list: r.fields ?? [], found: (r.fields ?? []).includes(name) };
  if (asks === "action") return { where: `${target}.actions[].name`, list: (r.actions ?? []).map((x) => x.name), found: (r.actions ?? []).some((x) => x.name === name) };
  const apis = of(state, "API").map((x) => x.raw).filter((api) => (api.derivedFrom ?? []).includes(target) || api.ui === target);
  const paths = apis.map((api) => api.path ?? api.route ?? api.endpoint ?? api.id);
  return { where: `the API records serving ${target}`, list: paths, found: paths.includes(name) };
}

export function revise(stateDir, target, { asks, name, request = null, cr = null } = {}) {
  ensureInit(stateDir);
  orExit2(ASKS.includes(asks), `one of --field --action --route is required — dev has to know what kind of thing is being asked for`);
  orExit2(name, `--${asks} needs a name`);
  const reg = ensureRegistry(stateDir);
  orExit2(reg.index[target], `${target} does not exist`);

  const frozen = isFrozen(target, { stateDir });
  orExit2(!frozen.frozen || cr === frozen.by, `${target} is frozen by ${frozen.by} (lane ${frozen.lane}) — revise it under that change: --cr ${frozen.by}`);

  const state = loadState(stateDir);
  const found = lookup(state, target, asks, name);
  const klass = found.found ? "A" : "B";

  if (klass === "B") {
    const gaps = allGaps(stateDir);
    const id = mintId(gaps.map((g) => g.id), "GAP");
    const kind = asks === "field" ? "display" : "screen";
    const openWith = `/change:open --kind ${kind} --source internal --title ${JSON.stringify(`เพิ่ม ${asks} "${name}" ที่ ${target}`)} --request ${JSON.stringify(request ?? `dev ขอเพิ่ม ${asks} "${name}" ที่ ${target}`)} --touches ${target}${asks === "field" ? " --fields <ENT-nnn.attribute>" : ""}`;
    const gap = {
      id,
      title: `${asks} "${name}" ที่ ${target} ไม่มีในดีไซน์`,
      status: "draft",
      question: request ?? `ขอเพิ่ม ${asks} "${name}" ที่ ${target}`,
      about: target,
      class: "B",
      asks,
      name,
      lookedIn: found.where,
      openWith,
      cr: null,
      answer: null,
      raisedAt: now(),
    };
    upsert(FILES.gaps(stateDir), gap);
    return { klass, gap, found };
  }

  const tsks = allTsks(stateDir);
  const ucId = target.startsWith("UC-") ? target : (byId(state, target)?.raw?.derivedFrom ?? []).find((d) => String(d).startsWith("UC-"));
  // A screen no use case produced has no ucId to match on, and its task is found by the screen it
  // owns instead. Without this, Class A on a baseline screen reopens nothing and says so to nobody.
  const tsk = (ucId ? tsks.find((t) => t.usecase === ucId) : null) ?? tsks.find((t) => (t.screens ?? []).includes(target)) ?? null;
  const codeRoot = codeRootOf(stateDir);
  const touched = tsk ? allImps(stateDir).filter((i) => (i.implements ?? []).includes(tsk.id)).filter((i) => git.changed(codeRoot, i.path)) : [];
  if (touched.length) return { klass, tsk, touched, found };

  if (tsk) {
    tsk.origin = "changed";
    tsk.status = "approved";
    tsk.cr = cr ?? tsk.cr;
    tsk.revisions = [...(tsk.revisions ?? []), { asks, name, request, at: now() }];
    upsert(FILES.tasks(stateDir, taskModule(tsk), tsk.id), strip(tsk));
  }
  return { klass, tsk, touched: [], found };
}

if (isMain(import.meta.url)) {
  const { _, flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  orExit2(stateExists(stateDir), `no state dir at ${stateDir}`);
  orExit2(_[0], "usage: revise.mjs <UI-x|UC-x> --field <name> | --action <name> | --route <path>");
  const asks = ASKS.find((k) => typeof flags[k] === "string");
  const r = revise(stateDir, _[0], {
    asks: asks ?? null,
    name: asks ? String(flags[asks]) : null,
    request: typeof flags.request === "string" ? flags.request : null,
    cr: typeof flags.cr === "string" ? flags.cr : null,
  });

  if (r.klass === "B") {
    console.log(`CLASS B  ${_[0]}  ${r.gap.asks} "${r.gap.name}"`);
    console.log(`  looked in ${r.found.where}: ${r.found.list.length ? r.found.list.join(", ") : "(empty)"}`);
    console.log(`  it is not there, so this is not a rearrangement — it is a new promise, and dev does not make promises`);
    console.log(`\n  ${r.gap.id} written to dev/gaps.json · no code, no task`);
    console.log(`\nthe owner opens the change:\n  ${r.gap.openWith}`);
    process.exit(0);
  }

  if (r.touched.length) {
    console.log(`CANNOT REVISE ${_[0]} — ${r.touched.length} file(s) differ from the last commit:`);
    for (const t of r.touched) console.log(`  ${t.id.padEnd(9)} ${t.path}`);
    console.log(`\nsomebody edited these by hand. A script does not overwrite a person: commit or discard them first.`);
    process.exit(1);
  }

  console.log(`CLASS A  ${_[0]}  ${r.found.where} already has "${asks ? flags[asks] : ""}"`);
  console.log(`  ${r.found.list.join(", ")}`);
  console.log(r.tsk ? `  ${r.tsk.id} (${r.tsk.title}) reopened as origin "changed" — rearranging what the design already declares` : `  no task implements this yet — /dev:plan <module> first`);
  console.log(`\nnext: /dev:task ${r.tsk?.id ?? "<TSK>"} --verify after the change, then commit and --close`);
  process.exit(0);
}
