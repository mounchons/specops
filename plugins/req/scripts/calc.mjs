#!/usr/bin/env node
/**
 * calc.mjs — write down the arithmetic before anyone implements it.
 *
 *   node calc.mjs <BR@v> --formula "deposit = ceil(fee * 0.30 / 100) * 100"
 *                        --number-type integer|decimal
 *                        --round none|ceil|floor|half-up|half-down|half-even
 *                        [--unit 100] [--at "after multiplying by 30%"]
 *                        [--boundary "fee 3000 -> 900 exactly, no extra rounding; …"]
 *                        [--title "…"]
 *
 * A rounding mode without the point it rounds at is not a contract: 30% of 2,400 rounded up to the
 * hundred is 800, but rounding the rate first and then taking 30% is 720. --at is where that is said.
 * One CALC pins one BR version (G-req-005): if the rule changes, the calculation gets a new version too.
 */
import { parseArgs, resolveStateDir, orExit2, isMain } from "../../core/scripts/paths.mjs";
import { prefixOf } from "../../core/scripts/ids.mjs";
import { ensureInit } from "./init.mjs";
import { FILES, allReq, mintId, upsert, findById, addEdges, now } from "./lib.mjs";

export const ROUNDING = ["none", "ceil", "floor", "half-up", "half-down", "half-even"];
export const NUMBER_TYPES = ["integer", "decimal"];

export function addCalc(stateDir, brId, { formula, numberType, round, unit, at, boundary, title, cr }) {
  const records = allReq(stateDir);
  const br = findById(records, brId);
  orExit2(prefixOf(brId) === "BR", `calc takes a BR@vN, got ${brId}`);
  orExit2(br, `no such rule: ${brId}`);
  orExit2(br.status !== "retired", `${brId} is retired — pin the calculation to the version that replaced it (${br.supersededBy ?? "none yet"})`);
  orExit2(ROUNDING.includes(round), `--round must be one of ${ROUNDING.join("|")}`);
  orExit2(NUMBER_TYPES.includes(numberType), `--number-type must be one of ${NUMBER_TYPES.join("|")}`);
  orExit2(round === "none" || String(at ?? "").trim(), "--at is required whenever you round: say where in the formula the rounding happens");

  const module = /^BR-([a-z0-9-]+)-/.exec(brId)[1];
  const id = `${mintId(records.map((r) => r.id), "CALC", module)}@v1`;
  upsert(FILES.calc(stateDir, module), {
    id,
    title: title ?? `การคำนวณของ ${brId}`,
    status: "draft",
    formula,
    numberType,
    rounding: { mode: round, unit: round === "none" ? null : Number(unit ?? 1), at: at ?? null },
    boundary: String(boundary ?? "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean),
    derivedFrom: [brId, ...(cr ? [cr] : [])],
    pinnedAt: now(),
  });
  addEdges(stateDir, [{ from: id, rel: "calculates", to: brId }]);
  return id;
}

if (isMain(import.meta.url)) {
  const { _, flags } = parseArgs();
  const stateDir = resolveStateDir(flags);
  const brId = _[0];
  orExit2(brId, "usage: calc.mjs <BR@v> --formula \"…\" --number-type integer|decimal --round none|ceil|… [--unit 100] [--at \"…\"]");
  orExit2(typeof flags.formula === "string", "--formula is required");
  ensureInit(stateDir);

  const id = addCalc(stateDir, brId, {
    formula: flags.formula,
    numberType: typeof flags["number-type"] === "string" ? flags["number-type"] : "integer",
    round: typeof flags.round === "string" ? flags.round : "none",
    unit: flags.unit,
    at: typeof flags.at === "string" ? flags.at : null,
    boundary: typeof flags.boundary === "string" ? flags.boundary : null,
    title: typeof flags.title === "string" ? flags.title : null,
    cr: typeof flags.cr === "string" ? flags.cr : null,
  });
  console.log(`CALC ${id}  pins ${brId}`);
  console.log(`  next: /req:golden ${id} --script <file.mjs> then --run  (the answer key comes from running, not from typing)`);
  process.exit(0);
}
