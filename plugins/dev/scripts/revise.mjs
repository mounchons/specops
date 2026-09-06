#!/usr/bin/env node
/**
 * revise.mjs — the Class A / Class B line, drawn by a lookup rather than by a judgment.
 *
 *   node revise.mjs <UI-x|UC-x> --field <name> | --action <name> | --route <path> [--request "…"] [--cr CR-nnn]
 *   node revise.mjs --gap <GAP-nnn> --answer "<what declares it now>" [--cr CR-nnn]
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
import { openCrs } from "../../change/scripts/lib.mjs";

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

/**
 * The other half of a GAP. dev asks the question and writes the `/change:open` line; the owner runs
 * it; design declares the thing — and until now nothing closed the loop, so the GAP sat at `draft`
 * forever and the CR it produced could never close (every artifact a CR touched has to be back at
 * `approved`, and a GAP had no command that could take it there).
 *
 * The answer has to name what now declares it. Any id in the answer must exist, which is the whole
 * check: you cannot answer "it is API-033" before API-033 is a record, so the question is settled by
 * the design, not by a sentence.
 */
export function answerGap(stateDir, gapId, answer, cr) {
  ensureInit(stateDir);
  const gaps = allGaps(stateDir);
  const gap = gaps.find((g) => g.id === gapId);
  orExit2(gap, `no such gap: ${gapId} — /dev:revise <UI|UC> --field|--action|--route opens one`);
  orExit2(!gap.answer, `${gapId} was already answered at ${gap.answeredAt}: ${JSON.stringify(gap.answer)}`);
  orExit2(answer, `--answer needs the record that declares it now, or the words that settle it`);
  const reg = ensureRegistry(stateDir);
  const named = [...String(answer).matchAll(/\b[A-Z]{2,4}-(?:[a-z0-9-]+-)?[0-9]{3}\b/g)].map((m) => m[0]);
  const missing = named.filter((id) => !reg.index[id]);
  orExit2(missing.length === 0, `${missing.join(", ")} does not exist — an answer names the record that declares the thing, and that record has to be there first`);
  const touching = openCrs(stateDir).filter((c) => (c.touches ?? []).includes(gap.about) || (c.impact?.affected ?? []).some((a) => a.id === gapId));
  const bound = cr ?? (touching.length === 1 ? touching[0].id : null);
  orExit2(!cr || touching.some((c) => c.id === cr) || !touching.length, `${cr} does not touch ${gap.about} and does not list ${gapId} — the CR that answers a gap is the one the gap opened`);
  orExit2(bound || touching.length === 0, `${touching.length} open changes touch ${gap.about} (${touching.map((c) => c.id).join(", ")}) — say which with --cr`);
  gap.answer = String(answer);
  gap.answeredAt = now();
  gap.cr = bound;
  gap.status = "approved";
  upsert(FILES.gaps(stateDir), gap);
  return { gap, named };
}

if (isMain(import.meta.url)) {
  const { _, flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  orExit2(stateExists(stateDir), `no state dir at ${stateDir}`);

  if (typeof flags.gap === "string") {
    const { gap, named } = answerGap(stateDir, String(flags.gap), typeof flags.answer === "string" ? flags.answer : null, typeof flags.cr === "string" ? flags.cr : null);
    console.log(`ANSWERED ${gap.id}  ${gap.title}`);
    console.log(`  asked: ${gap.question}`);
    console.log(`  answer: ${gap.answer}${named.length ? `  · names ${named.join(", ")}, and every one of them exists` : "  · no record named — the words are the answer"}`);
    console.log(`  draft → approved${gap.cr ? ` · under ${gap.cr}, which can close once everything else it touched is approved too` : " · no open change touches it"}`);
    process.exit(0);
  }

  orExit2(_[0], "usage: revise.mjs <UI-x|UC-x> --field <name> | --action <name> | --route <path>   ·   revise.mjs --gap <GAP-nnn> --answer <…> [--cr CR-nnn]");
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
