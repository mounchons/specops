#!/usr/bin/env node
/**
 * task.mjs — one vertical slice, from the slice printed to the commit that closes it.
 *
 *   node task.mjs <TSK> --start
 *                       --impl "<path>=<kind>[,<path>=<kind>]" [--golden GD-x,GD-y]
 *                       --verify
 *                       --close
 *
 * The four conditions on --close are the whole plugin: a proof that exited 0, a HEAD that moved, a
 * commit message naming the task, and a working tree with nothing uncommitted in it. A status field
 * anyone can type is not evidence; a command that ran and a diff a person committed are.
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs, resolveStateDir, stateExists, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { loadState } from "../../core/scripts/artifacts.mjs";
import { ensureInit } from "./init.mjs";
import { FILES, KINDS, MAX_ATTEMPTS, allCmps, allImps, findTsk, upsert, strip, mintId, addEdges, componentOf, codeRootOf, requireRepo, git, run, list, of, isFrozen, moduleOf, now } from "./lib.mjs";
import { sliceOf, printSlice } from "./slice.mjs";
import { goldenMisses } from "./checks.mjs";

const load = (stateDir, id) => {
  ensureInit(stateDir);
  const tsk = findTsk(stateDir, id);
  orExit2(tsk, `no such task: ${id} — /dev:plan <module> creates one per use case`);
  return tsk;
};

const save = (stateDir, tsk) => upsert(FILES.tasks(stateDir, moduleOf(tsk.usecase) ?? "default", tsk.id), strip(tsk));

function frozenFor(stateDir, tsk) {
  return [tsk.usecase, ...(tsk.screens ?? []), ...(tsk.acceptance ?? [])]
    .map((id) => ({ id, f: isFrozen(id, { stateDir }) }))
    .filter((x) => x.f.frozen && x.f.by !== tsk.cr);
}

export function start(stateDir, id, codeRoot) {
  const tsk = load(stateDir, id);
  orExit2(!tsk.blocked, `${id} is blocked since ${tsk.blocked?.at}: ${tsk.blocked?.reason} — a fourth attempt at the same thing is not a plan`);
  requireRepo(codeRoot);
  const frozen = frozenFor(stateDir, tsk);
  if (frozen.length) return { tsk, frozen };
  tsk.status = "approved";
  tsk.startedAt = now();
  tsk.startCommit = git.head(codeRoot);
  save(stateDir, tsk);
  const state = loadState(stateDir);
  return { tsk, frozen: [], slice: sliceOf(state, tsk, allCmps(stateDir)) };
}

export function impl(stateDir, id, spec, golden, codeRoot) {
  const tsk = load(stateDir, id);
  orExit2(tsk.startedAt, `${id} has not started — /dev:task ${id} --start prints the slice first`);
  const cmps = allCmps(stateDir);
  const existing = allImps(stateDir);
  const ids = existing.map((i) => i.id);
  const mine = existing.filter((i) => (i.implements ?? []).includes(id));
  const added = [];
  for (const one of list(spec)) {
    const [p, kind = "source"] = one.split("=");
    const rel = p.replace(/\\/g, "/").replace(/^\.\//, "");
    orExit2(KINDS.includes(kind), `${one}: kind must be one of ${KINDS.join("|")}`);
    orExit2(fs.existsSync(path.join(codeRoot, rel)), `${rel} does not exist under ${codeRoot} — an implementation unit names a file that is there`);
    const cmp = componentOf(cmps, rel);
    orExit2(cmp, `${rel} is outside every component root (${cmps.map((c) => c.root).join(", ")}) — either the file is in the wrong place or /dev:stack has the wrong root`);
    const was = mine.find((i) => i.path === rel);
    const impId = was?.id ?? mintId(ids, "IMP");
    if (!was) ids.push(impId);
    const rec = {
      id: impId,
      title: rel,
      status: "implemented",
      path: rel,
      component: cmp.id,
      kind,
      implements: [...new Set([...(was?.implements ?? []), id])],
      golden: kind === "test" ? [...new Set([...(was?.golden ?? []), ...list(golden), ...(golden ? [] : tsk.golden ?? [])])] : [],
      addedAt: was?.addedAt ?? now(),
    };
    upsert(FILES.impl(stateDir, id), rec);
    addEdges(stateDir, [{ from: impId, rel: "implements", to: id }]);
    added.push(rec);
  }
  orExit2(added.length, `usage: --impl "<path>=source|test|migration|config[,…]"`);
  return { tsk, added };
}

export function verify(stateDir, id, codeRoot) {
  const tsk = load(stateDir, id);
  orExit2(tsk.startedAt, `${id} has not started — /dev:task ${id} --start`);
  orExit2(tsk.verify, `${id} has no verify command — /dev:stack sets run.test`);
  const proof = run(tsk.verify, codeRoot);
  tsk.proof = [...(tsk.proof ?? []), proof];
  tsk.attempts = (tsk.attempts ?? 0) + 1;
  if (proof.exitCode === 0) {
    tsk.status = "implemented";
    tsk.blocked = null;
  } else if (tsk.attempts >= MAX_ATTEMPTS) {
    tsk.blocked = { at: now(), reason: `${tsk.attempts} attempts, last exit ${proof.exitCode} — the slice, the design or the stack is wrong, and a fourth run will not say which` };
  }
  save(stateDir, tsk);
  return { tsk, proof };
}

export function close(stateDir, id, codeRoot) {
  const tsk = load(stateDir, id);
  const last = (tsk.proof ?? []).at(-1);
  orExit2(last, `${id} has no proof — /dev:task ${id} --verify runs ${JSON.stringify(tsk.verify)} and records what it said`);
  orExit2(last.exitCode === 0, `${id}'s last proof exited ${last.exitCode} — fix it and run --verify again; a task does not close on a red run`);
  requireRepo(codeRoot);

  const head = git.head(codeRoot);
  const message = git.message(codeRoot);
  const dirty = git.dirty(codeRoot);
  const state = loadState(stateDir);
  const gds = new Map(of(state, "GD").map((a) => [a.id, a.raw]));
  const misses = allImps(stateDir)
    .filter((i) => (i.implements ?? []).includes(id) && i.kind === "test")
    .flatMap((i) => goldenMisses(i, gds, codeRoot).map((m) => ({ imp: i.id, ...m })));

  const problems = [];
  if (head && head === tsk.startCommit) problems.push(`HEAD is still ${String(head).slice(0, 8)} — nothing was committed since --start; the diff has to be read and committed by a person`);
  if (!String(message).includes(id)) problems.push(`the last commit message does not name ${id} — without it nobody can get from the code back to the use case`);
  if (dirty.length) problems.push(`${dirty.length} uncommitted change(s) outside .sdlc/: ${dirty.slice(0, 5).join(" · ")}`);
  for (const m of misses) problems.push(`${m.imp} (${m.path}) does not contain ${JSON.stringify(m.value)} from ${m.gd} "${m.label}" — a unit test that rounds the answer key is not testing the answer key`);
  if (problems.length) return { tsk, problems };

  tsk.status = "verified";
  tsk.commit = head;
  save(stateDir, tsk);
  return { tsk, problems: [], head, message };
}

if (isMain(import.meta.url)) {
  const { _, flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  orExit2(stateExists(stateDir), `no state dir at ${stateDir}`);
  orExit2(_[0], "usage: task.mjs <TSK> --start | --impl <path>=<kind> | --verify | --close");
  const codeRoot = codeRootOf(stateDir, typeof flags["code-root"] === "string" ? flags["code-root"] : null);
  const id = _[0];

  if (flags.start) {
    const { tsk, frozen, slice } = start(stateDir, id, codeRoot);
    if (frozen.length) {
      console.log(`CANNOT START ${id} — an open change request freezes what it would touch:`);
      for (const f of frozen) console.log(`  ${f.id.padEnd(16)} frozen by ${f.f.by} (lane ${f.f.lane})`);
      console.log(`\nclose the change, or plan this task under it: the CR names the commands on /core:query ${frozen[0].f.by}`);
      process.exit(1);
    }
    printSlice(tsk, slice);
    process.exit(0);
  }

  if (flags.impl) {
    const { added } = impl(stateDir, id, String(flags.impl), typeof flags.golden === "string" ? flags.golden : null, codeRoot);
    console.log(`IMPL ${id}  ${added.length} file(s)`);
    for (const i of added) console.log(`  ${i.id.padEnd(9)} ${i.kind.padEnd(10)} ${i.component.padEnd(16)} ${i.path}${i.golden.length ? `   asserts ${i.golden.join(" ")}` : ""}`);
    console.log(`\nnext: /dev:task ${id} --verify`);
    process.exit(0);
  }

  if (flags.verify) {
    const { tsk, proof } = verify(stateDir, id, codeRoot);
    console.log(`VERIFY ${id}  attempt ${tsk.attempts}  exit ${proof.exitCode}  ${proof.cmd}`);
    console.log(proof.result ? proof.result.split("\n").slice(-12).map((l) => `  ${l}`).join("\n") : "  (no output)");
    if (proof.exitCode === 0) {
      console.log(`\nproof recorded. Commit the diff with ${id} in the message, then: /dev:task ${id} --close`);
      process.exit(0);
    }
    console.log(tsk.blocked ? `\nBLOCKED after ${tsk.attempts} attempts — ${tsk.blocked.reason}` : `\nattempt ${tsk.attempts} of ${MAX_ATTEMPTS}`);
    process.exit(1);
  }

  if (flags.close) {
    const { tsk, problems, head, message } = close(stateDir, id, codeRoot);
    if (problems.length) {
      console.log(`CANNOT CLOSE ${id} — ${problems.length} thing(s) a script can see:`);
      for (const p of problems) console.log(`  ${p}`);
      process.exit(1);
    }
    console.log(`CLOSE ${id}  ${tsk.title}`);
    console.log(`  proof: ${tsk.proof.at(-1).cmd} → exit 0 at ${tsk.proof.at(-1).at}`);
    console.log(`  commit: ${String(head).slice(0, 8)}  ${String(message).split("\n")[0]}`);
    console.log(`  ${tsk.usecase} is now implemented and verified — /core:query ${tsk.usecase} shows it`);
    process.exit(0);
  }

  console.log(`usage: task.mjs <TSK> --start | --impl "<path>=<kind>" | --verify | --close`);
  process.exit(2);
}
