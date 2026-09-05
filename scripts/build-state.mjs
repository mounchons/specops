#!/usr/bin/env node
/**
 * build-state.mjs — where the MARKETPLACE build is, computed from disk (not from memory).
 * This is about building specops itself, not about a customer's .sdlc.
 *
 *   node scripts/build-state.mjs [--json]
 *
 * Per phase, three steps, each proven by a file:
 *   step 1 spec      plugins/<p>/SPEC.md exists · approved when it contains a line "approved: <date>"
 *   step 2 build     plugins/<p>/scripts/checks.mjs + ≥1 command exist (core: selftest passes)
 *   step 3 dod       docs/dod/phase-<n>.md exists and every row is PASS
 *
 * Who runs each step (MODEL): the OWNER switches with `/model`; the AI never routes.
 * No script can see which model is running, so this is a LIMIT line: the running model self-checks.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PHASES = ["core", "req", "design", "change", "mock", "dev", "qa"];
const MODEL = { spec: "fable", approve: "human", build: "opus", dod: "fable" };
const exists = (p) => fs.existsSync(path.join(root, p));
const read = (p) => (exists(p) ? fs.readFileSync(path.join(root, p), "utf8") : "");

function phaseState(n, plugin) {
  const spec = `plugins/${plugin}/SPEC.md`;
  const s1 = exists(spec) ? (/^approved:\s*\S+/m.test(read(spec)) ? "approved" : "waiting-approval") : "todo";
  let s2 = "todo";
  if (plugin === "core") {
    try { execFileSync("node", [path.join(root, "plugins/core/scripts/selftest.mjs")], { stdio: "ignore" }); s2 = "done"; } catch { s2 = exists("plugins/core/scripts/gates.mjs") ? "failing" : "todo"; }
  } else if (exists(`plugins/${plugin}/scripts/checks.mjs`)) {
    const cmds = exists(`plugins/${plugin}/commands`) ? fs.readdirSync(path.join(root, `plugins/${plugin}/commands`)).filter((f) => f.endsWith(".md")).length : 0;
    s2 = cmds > 0 ? "done" : "partial";
  }
  const dod = read(`docs/dod/phase-${n}.md`);
  const s3 = !dod ? "todo" : /\bFAIL\b/.test(dod) ? "failing" : /\bPASS\b/.test(dod) ? "done" : "partial";
  return { phase: n, plugin, steps: { spec: s1, build: s2, dod: s3 } };
}

const phases = PHASES.map((p, i) => phaseState(i, p));
const current = phases.find((p) => !(p.steps.dod === "done")) ?? phases[phases.length - 1];
const nextStep =
  current.phase === 0 && current.steps.build === "done" && current.steps.dod !== "done" ? "dod" :
  current.steps.spec === "todo" ? "spec" :
  current.steps.spec === "waiting-approval" ? "approve" :
  current.steps.build !== "done" ? "build" : "dod";

const out = { current: current.phase, plugin: current.plugin, nextStep, model: MODEL[nextStep], models: MODEL, phases };
if (process.argv.includes("--json")) console.log(JSON.stringify(out, null, 2));
else {
  console.log("phase plugin  spec              build    dod");
  for (const p of phases) console.log(`${String(p.phase).padEnd(5)} ${p.plugin.padEnd(7)} ${p.steps.spec.padEnd(17)} ${p.steps.build.padEnd(8)} ${p.steps.dod}`);
  console.log(`\nCURRENT phase ${current.phase} (${current.plugin}) → next step: ${nextStep} · model: ${MODEL[nextStep]}`);
  console.log(`LIMIT  model per step: ${Object.entries(MODEL).map(([k, v]) => `${k}→${v}`).join(" · ")}  (owner switches with /model; the running model self-checks)`);
}
