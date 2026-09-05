#!/usr/bin/env node
/**
 * ids.mjs — THE one table of id prefixes for every specops plugin.
 *
 * Earlier attempts kept one id table per plugin plus a prose registry; the two disagreed within a month.
 * specops keeps one table here. A plugin may mint only the prefixes whose `owner` is its name;
 * everything else it may reference by id and must never create, renumber or re-version.
 *
 * Shapes:
 *   module   PFX-<module>-<nnn>          record lives in <plugin>/<module>/…
 *   project  PFX-<nnn>                   record lives in a project-wide file
 *   version  PFX-<module>-<nnn>@vN       identity includes the version (rules, calculations)
 *   named    PFX-<name>                  components: CMP-api, CMP-web
 *
 * Decisions carried over from the 2026-09-05 design record:
 *   FUN- removed  -> use UC (REQ -> UC directly; BR attaches to UC steps via `enforces`)
 *   CHG- removed  -> CR- (change plugin owns every change, req no longer has its own change set)
 *   FE-  removed  -> TSK is already the vertical slice
 *
 * CLI:
 *   node ids.mjs                    print the table
 *   node ids.mjs <id> [...]         validate; exit 1 if any id is malformed or unknown
 *   node ids.mjs --owner <plugin>   print prefixes that plugin may mint
 */
import { parseArgs, isMain } from "./paths.mjs";

const MODULE = "[a-z0-9-]+";
const NNN = "[0-9]{3}";
const shape = {
  module: (p) => new RegExp(`^${p}-${MODULE}-${NNN}$`),
  project: (p) => new RegExp(`^${p}-${NNN}$`),
  version: (p) => new RegExp(`^${p}-${MODULE}-${NNN}@v[0-9]+$`),
  named: (p) => new RegExp(`^${p}-${MODULE}$`),
};

/** prefix -> { owner, scope, meaning, file } — file is a convention, not enforced by core. */
export const PREFIXES = {
  // ---- req -------------------------------------------------------------
  REQ: { owner: "req", scope: "module", meaning: "requirement: actor + goal, what the client asked for", file: "req/<module>/requirements.json" },
  BR: { owner: "req", scope: "version", meaning: "business rule — THE unit of coverage", file: "req/<module>/rules.json" },
  CALC: { owner: "req", scope: "version", meaning: "calculation contract pinned to one rule version", file: "req/<module>/calc.json" },
  GD: { owner: "req", scope: "module", meaning: "golden dataset: answer key produced by running, signed by a human", file: "req/<module>/golden/" },
  EX: { owner: "req", scope: "module", meaning: "example proving one rule version (cap: 5 per BR)", file: "req/<module>/examples/<BR>.json" },
  NFR: { owner: "req", scope: "module", meaning: "non-functional requirement (design expands, never mints)", file: "req/<module>/requirements.json" },
  Q: { owner: "req", scope: "module", meaning: "open question — blocks CP1", file: "req/<module>/questions.json" },
  DQ: { owner: "req", scope: "module", meaning: "deferred question — blocks CP2 only", file: "req/<module>/questions.json" },
  UL: { owner: "req", scope: "module", meaning: "ubiquitous-language term", file: "req/<module>/glossary.json" },
  STK: { owner: "req", scope: "project", meaning: "stakeholder — a real person/party in the client org", file: "req/stakeholders.json" },
  SRC: { owner: "req", scope: "project", meaning: "source document a requirement came from", file: "req/sources.json" },
  // ---- design ----------------------------------------------------------
  UC: { owner: "design", scope: "module", meaning: "use case: capability + flows; steps carry `enforces: [BR@v]`", file: "design/<module>/usecases.json" },
  AC: { owner: "design", scope: "module", meaning: "acceptance criterion: one example restated, `then` verbatim from req", file: "design/<module>/usecases.json" },
  ENT: { owner: "design", scope: "project", meaning: "entity / aggregate with `kind: aggregate|entity|reference|lookup|vo`", file: "design/domain.json" },
  STM: { owner: "design", scope: "project", meaning: "state machine of one entity", file: "design/domain.json" },
  UI: { owner: "design", scope: "module", meaning: "screen; field `app` is mandatory; `origin: usecase|master|baseline|nfr`", file: "design/<module>/screens.json" },
  RPT: { owner: "design", scope: "module", meaning: "report / printable document (columns -> ENT.field, totals -> CALC)", file: "design/<module>/screens.json" },
  API: { owner: "design", scope: "project", meaning: "API endpoint contract", file: "design/api.json" },
  INT: { owner: "design", scope: "project", meaning: "external integration with failure mode", file: "design/api.json" },
  ROLE: { owner: "design", scope: "project", meaning: "role — must trace to a STK", file: "design/rbac.json" },
  ACL: { owner: "design", scope: "project", meaning: "permission row: role x resource x action x data scope", file: "design/rbac.json" },
  SCN: { owner: "design", scope: "module", meaning: "test scenario — one per UC flow (main / alt / exception) and per NFR", file: "design/<module>/scenarios.json" },
  ADR: { owner: "design", scope: "project", meaning: "architecture decision (design's reasoning)", file: "design/adr/" },
  DEC: { owner: "design", scope: "project", meaning: "technical decision the CLIENT signs", file: "design/decisions.json" },
  // ---- change ----------------------------------------------------------
  CR: { owner: "change", scope: "project", meaning: "change request: source, touches[], lane ui|full, status", file: "change/open|closed/CR-nnn.json" },
  // ---- mock ------------------------------------------------------------
  MCK: { owner: "mock", scope: "module", meaning: "L1 wireframe of one UI (structure binds; look is reference)", file: "mock/<app>/" },
  THM: { owner: "mock", scope: "project", meaning: "theme: tokens + component inventory (dev never sets its own values)", file: "mock/theme.json" },
  // ---- dev -------------------------------------------------------------
  CMP: { owner: "dev", scope: "named", meaning: "component with its own stack: CMP-api, CMP-web", file: "dev/components.json" },
  TSK: { owner: "dev", scope: "project", meaning: "unit of work = one vertical slice; needs verify + proof to close", file: "dev/tasks.json" },
  IMP: { owner: "dev", scope: "project", meaning: "implementation unit: file / class / module", file: "dev/impl-map.json" },
  GAP: { owner: "dev", scope: "project", meaning: "question dev sends upstream; closed by an answer, never a guess", file: "dev/gaps.json" },
  // ---- qa --------------------------------------------------------------
  TC: { owner: "qa", scope: "module", meaning: "executable test case derived from one SCN", file: "qa/<module>/testcases.json" },
  RUN: { owner: "qa", scope: "project", meaning: "one test run: scope, code version, env, evidence — never overwritten", file: "qa/runs/" },
  DEF: { owner: "qa", scope: "module", meaning: "finding/defect with routing: dev | design | req", file: "qa/<module>/findings.json" },
};

export const PLUGINS = ["core", "req", "design", "change", "mock", "dev", "qa"];

/** Status state machine shared by every artifact kind. Order matters: later = further along. */
export const STATUSES = ["draft", "reviewed", "approved", "implemented", "verified", "retired"];

export function prefixOf(id) {
  const m = /^([A-Z]+)-/.exec(id ?? "");
  return m ? m[1] : null;
}

export function shapeOf(prefix) {
  const row = PREFIXES[prefix];
  return row ? shape[row.scope](prefix) : null;
}

/** { ok, prefix, owner, scope, reason } */
export function validate(id) {
  const prefix = prefixOf(id);
  if (!prefix) return { ok: false, id, reason: "no prefix" };
  const row = PREFIXES[prefix];
  if (!row) return { ok: false, id, prefix, reason: `unknown prefix ${prefix}` };
  if (!shapeOf(prefix).test(id)) return { ok: false, id, prefix, owner: row.owner, reason: `malformed for scope ${row.scope}` };
  return { ok: true, id, prefix, owner: row.owner, scope: row.scope };
}

export function ownerOf(id) {
  return PREFIXES[prefixOf(id)]?.owner ?? null;
}

export function mintableBy(plugin) {
  return Object.entries(PREFIXES).filter(([, r]) => r.owner === plugin).map(([p]) => p);
}

/** Strip @vN so BR-job-001@v2 and BR-job-001@v1 share a lineage key. */
export function lineageOf(id) {
  return String(id).replace(/@v[0-9]+$/, "");
}

// ---- CLI -------------------------------------------------------------------
if (isMain(import.meta.url)) {
  const { _, flags } = parseArgs();
  if (flags.owner) {
    console.log(mintableBy(flags.owner).join(" "));
    process.exit(0);
  }
  if (_.length === 0) {
    console.log("prefix  owner   scope    file");
    for (const [p, r] of Object.entries(PREFIXES)) console.log(`${p.padEnd(7)} ${r.owner.padEnd(7)} ${r.scope.padEnd(8)} ${r.file}`);
    process.exit(0);
  }
  let bad = 0;
  for (const id of _) {
    const v = validate(id);
    console.log(v.ok ? `OK   ${id}  owner=${v.owner}` : `FAIL ${id}  ${v.reason}`);
    if (!v.ok) bad++;
  }
  process.exit(bad ? 1 : 0);
}
