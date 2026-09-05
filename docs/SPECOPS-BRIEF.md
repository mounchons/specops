# specops — Build Brief (ฉบับส่งมอบให้ Claude Code)

> เอกสารเดียวที่ใช้สร้าง specops ทั้งชุด · เจ้าของ: พี่ปู (Mounchons) · 2026-09-05
> ผู้อ่านคือ Claude Code · ภาษา: อธิบายเป็นไทย · id/โค้ด/ชื่อไฟล์เป็นอังกฤษ
> **ไม่อ้างอิง marketplace ตัวเก่าใด ๆ** — ทุกอย่างที่ต้องรู้อยู่ในไฟล์นี้ + `CLAUDE.md` + `testproject-rentpoint.md` + `PROMPTS.md`
> กติกาการอ่าน: `CLAUDE.md` คือรัฐธรรมนูญและชนะทุกอย่าง · `DESIGN.md` คือเหตุผลและวิธีตัดสินใจ · ไฟล์นี้คือแบบก่อสร้าง · ถ้าสองไฟล์ขัดกัน หยุดแล้วถามเจ้าของ

---

## 0. specops คืออะไร และแก้ปัญหาอะไร

Claude Code plugin marketplace สำหรับงาน consultant คนเดียวที่ทำครบสาย: เก็บ requirement → ออกแบบ → prototype ให้ลูกค้าเซ็น → พัฒนา (หลาย app: api / web / backoffice / mobile / desktop) → ทดสอบ → ส่งมอบ และ**รองรับลูกค้าขอเปลี่ยน**ตลอดทาง

**ปัญหาที่ต้องแก้ (จากประสบการณ์ marketplace รุ่นก่อน):** กฎการทำงานถูกเขียนเป็นร้อยแก้วใน prompt ("dev ต้องอ่าน design ก่อน", "ถ้าเปลี่ยนต้องแก้ design ก่อน") พอ plugin เพิ่ม กฎก็ทบกันจนใช้ไม่ได้ · ไฟล์เดียวโตถึง 7,000 บรรทัด · sitemap ที่ generate ไม่มี login/master/สิทธิ์ · เอกสารกำกับยาวกว่าโค้ด 10 เท่า

**คำตอบของ specops:** กฎอยู่ใน *state ของ artifact + trace graph* ที่ script ตรวจ ไม่ใช่ใน prompt · ไฟล์เล็กแตกตาม module · หน้าจอมาจาก 3 generators · การเปลี่ยนแปลงเป็น artifact (`CR`) ที่ script เดินกราฟหา impact · คนขับ AI ทำ

**Analogy หลัก (ใช้อธิบายทุกส่วน):** กองถ่ายหนัง — REQ = เจตนาของนายทุน · domain/BR = โลกของเรื่องและกฎของโลกนั้น · UC = บทฉาก · UI/mock = storyboard · SCN/TC = shot list · CR = revision pages ของบท · `core:next` = callsheet ประจำวัน

---

## 1. รัฐธรรมนูญ 10 ข้อ (ซ้ำกับ CLAUDE.md เพื่อให้ไฟล์นี้ครบในตัวเอง)

1. กฎที่ script ตรวจไม่ได้ = บรรทัด **LIMIT** ไม่ใช่กฎ · พิมพ์ทุกครั้ง ไม่ผ่านเงียบ ไม่บล็อก
2. plugin ที่ยังไม่สร้าง มีสเปก **1 หน้า**: input / output / DoD · ไม่มีอย่างอื่น
3. gate อยู่ใน `.sdlc/gates.json` เท่านั้น · `CLAUDE.md` ≤ 150 บรรทัด
4. ไฟล์ที่ AI อ่าน ≤ **300 บรรทัด** · `.sdlc/export/` เป็น output ไม่เป็น input
5. **หนึ่งไฟล์หนึ่งเจ้าของ** (W1) · plugin เขียนได้เฉพาะ `.sdlc/<plugin>/**` และ `.sdlc/trace.<plugin>.json`
6. คำสั่งรับ **id** · script ยื่น **slice** (`/core:query`) · ห้ามเปิดไฟล์ artifact เพื่อ "ดูรอบ ๆ"
7. **persist ก่อนตอบ** · การตัดสินใจที่ไม่อยู่บนดิสก์ = ไม่เคยเกิด
8. ทุกเฟสปิดด้วย **Cold Start Test** บนโปรเจกต์ทดสอบ
9. **ไม่เพิ่มคำสั่ง** จนกว่า DoD เฟสก่อนจะเขียว
10. **คนขับ AI ทำ** · ไม่มี orchestrator ไม่มี subagent ไม่มี model routing

ข้อควรระวังสำหรับผู้สร้าง: แนวโน้มตามธรรมชาติคืออยากเขียนสเปกให้ครบก่อนสร้าง — นั่นคือสิ่งที่ทำให้รุ่นก่อนพัง ให้สร้าง round 0 ที่รันได้ก่อน แล้วค่อยขยาย

---

## 2. โครง repo และ state dir

```
specops/
  .claude-plugin/marketplace.json
  CLAUDE.md                          รัฐธรรมนูญ (≤150 บรรทัด)
  docs/  SPECOPS-BRIEF.md · phase-plan.md · plugin-spec-template.md · testproject-rentpoint.md · PROMPTS.md
  plugins/<name>/.claude-plugin/plugin.json · commands/*.md (≤6) · scripts/*.mjs · fixtures/{clean,dirty}
```

State dir ของโปรเจกต์ลูกค้า (default `./.sdlc`, override `--state-dir` / `$SPECOPS_STATE_DIR`):

```
.sdlc/
  project.json        core   apps[] · modules[] · plugins{} · phase
  gates.json          core   บ้านเดียวของ gate
  registry.json       core   CACHE — ลบแล้ว rebuild ได้ · AI ไม่อ่านทั้งก้อน
  req/stakeholders.json  req/sources.json  req/<module>/{requirements,rules,calc,glossary,questions}.json  req/<module>/examples/<BR>.json  req/<module>/golden/*.mjs
  design/domain.json  design/api.json  design/rbac.json  design/decisions.json  design/<module>/{usecases,screens,scenarios}.json
  change/open/CR-nnn.json  change/closed/CR-nnn.json
  mock/theme.json  mock/<app>/MCK-*.json  mock/<app>/*.html  mock/baseline/<app>@<date>.json
  dev/components.json  dev/tasks.json  dev/impl-map.json  dev/gaps.json
  qa/<module>/{testcases,findings}.json  qa/runs/RUN-nnn.json  qa/evidence/
  trace.<plugin>.json  edges {from, rel, to} · from ต้องเป็น id ที่ plugin นั้นเป็นเจ้าของ
  export/              เอกสารส่งลูกค้า (md/docx/xlsx) · ห้ามอ่านกลับ
```

**Script ทั้งหมด:** Node ≥ 20, ESM, ไม่มี dependency · exit `0` ok · `1` findings · `2` argument/environment ใช้ไม่ได้ · ทุก plugin import ของร่วมจาก `plugins/core/scripts/` (`paths` `ids` `artifacts` `registry` `query`) ห้ามคัดลอก

---

## 3. ทะเบียน id (บ้านเดียว: `plugins/core/scripts/ids.mjs`)

| prefix | owner | shape | ความหมาย |
|---|---|---|---|
| REQ | req | `REQ-<module>-nnn` | requirement: actor + goal สิ่งที่ลูกค้าขอ |
| BR | req | `BR-<module>-nnn@vN` | **business rule — หน่วยวัดของทั้งสาย** · เวอร์ชันอยู่ใน id |
| CALC | req | `CALC-<module>-nnn@vN` | สัญญาการคำนวณ: สูตร ชนิดตัวเลข rounding mode + จุดที่ปัด ผูกกับ BR หนึ่งเวอร์ชัน |
| GD | req | `GD-<module>-nnn` | golden dataset: answer key ที่ได้จากการ *รัน* แล้วคนเซ็น |
| EX | req | `EX-<module>-nnn` | ตัวอย่าง Given/When/Then พิสูจน์ BR หนึ่งเวอร์ชัน · **สูงสุด 5 ต่อ BR** |
| NFR | req | `NFR-<module>-nnn` | non-functional (design ขยายความ ไม่ mint) |
| Q / DQ | req | `Q-<module>-nnn` | คำถามเปิด (บล็อก CP1) / คำถามเลื่อน (บล็อก CP2) |
| UL | req | `UL-<module>-nnn` | ศัพท์เฉพาะที่ตกลงความหมายแล้ว |
| STK | req | `STK-nnn` | stakeholder ที่เป็นคนจริงในองค์กรลูกค้า |
| SRC | req | `SRC-nnn` | เอกสารต้นทาง (ไฟล์ ภาพ แชต) |
| UC | design | `UC-<module>-nnn` | use case = capability + flows · **step มี `enforces: [BR@v]`** |
| AC | design | `AC-<module>-nnn` | acceptance criterion: ตัวอย่างหนึ่งข้อ `then` คัดคำต่อคำจาก req |
| ENT | design | `ENT-nnn` | entity · **`kind: aggregate\|entity\|reference\|lookup\|vo`** |
| STM | design | `STM-nnn` | state machine ของ entity หนึ่งตัว |
| UI | design | `UI-<module>-nnn` | หน้าจอ · `app` บังคับ · `origin: usecase\|master\|baseline\|nfr` |
| RPT | design | `RPT-<module>-nnn` | รายงาน: columns → ENT.field · totals → CALC |
| API / INT | design | `API-nnn` / `INT-nnn` | endpoint / integration ภายนอกพร้อม failure mode |
| ROLE / ACL | design | `ROLE-nnn` / `ACL-nnn` | role (ต้อง trace ถึง STK) / แถวสิทธิ์ role × resource × action × data scope |
| SCN | design | `SCN-<module>-nnn` | test scenario — 1 ต่อ flow ของ UC และ 1 ต่อ NFR |
| ADR / DEC | design | `ADR-nnn` / `DEC-nnn` | เหตุผลทางสถาปัตย์ / การตัดสินใจทางเทคนิคที่**ลูกค้าเซ็น** |
| CR | change | `CR-nnn` | change request: `source` `touches[]` `lane: ui\|full` |
| MCK / THM | mock | `MCK-<module>-nnn` / `THM-nnn` | wireframe L1 ของ UI หนึ่งหน้า / theme tokens |
| CMP / TSK / IMP / GAP | dev | `CMP-<name>` / `TSK-nnn` / `IMP-nnn` / `GAP-nnn` | component / unit of work / ไฟล์โค้ด / คำถามส่งขึ้นต้นน้ำ |
| TC / RUN / DEF | qa | `TC-<module>-nnn` / `RUN-nnn` / `DEF-<module>-nnn` | test case / รอบรัน / finding พร้อม routing |

ไม่มี `FUN-` (ใช้ UC) · ไม่มี `CHG-` (ใช้ CR) · ไม่มี `FE-` (ใช้ TSK) · ไม่มี `RULE-` (BR ของ req เท่านั้น)

**status ของทุก artifact:** `draft → reviewed → approved → implemented → verified → retired` · `approved` เขียนได้เฉพาะคำสั่ง `*:approve --sign` ที่แนบหลักฐาน

---

## 4. Convention ของ artifact และ trace (ทุก plugin)

- ไฟล์ JSON = `{ id, … }` หรือ `{ schemaVersion, items: [ {id,…} ] }` หรือ `[ {id,…} ]` · md ที่มี frontmatter `id:` ก็นับ
- ทุก record: `id` `status` และ `derivedFrom: [ids]` เมื่อมีต้นทาง
- **id ใด ๆ ที่ปรากฏใน record** กลายเป็น edge `refs` อัตโนมัติ (core ทำ) · edge ที่มีชื่อ (`satisfies` `enforces` `displays` `verifies` `implements` `covers` `touches`) เขียนใน `trace.<plugin>.json`
- BR/CALC ไม่แก้ในที่: การเปลี่ยน mint `@vN+1` ผ่าน CR เท่านั้น · `retired` คือสถานะของเวอร์ชันเก่า
- ทุกไฟล์ที่ core อ่าน ≤ 300 บรรทัด · แตกตาม module / aggregate / screen / app

**สัญญาการเสียบ plugin:**
1. `init` ของ plugin เขียน `project.json → plugins.<name>.root` และ append gate ของตัวเองใน `gates.json` (`check: "<name>:<check>"`)
2. `scripts/checks.mjs` export `CHECKS` = `{ "<name>:<check>": (ctx) => [{subject, message, severity?}] }` และ `NEXT` = `[(ctx) => [{action, reason, stop?}]]` · `ctx = { stateDir, project, state, registry }` · core โหลดให้เอง
3. คำสั่ง `.md` ทุกตัว: frontmatter `description` `argument-hint` `allowed-tools: Bash` · เนื้อหา = สั่งรัน script + วิธีแสดงผล · ≤ 40 บรรทัด · ห้ามใส่กฎการทำงานในคำสั่ง (กฎอยู่ใน checks.mjs)

---

## 5. สเปก 1 หน้าต่อ plugin

### 5.0 core (เฟส 0) — มี reference implementation ใน zip นี้แล้ว จะใช้ต่อหรือสร้างใหม่ให้ตรงสเปกนี้ก็ได้

| คำสั่ง | in | out | DoD |
|---|---|---|---|
| `init --name --apps a:type,…` | — | `project.json` `gates.json` โฟลเดอร์ | ปฏิเสธถ้ามีอยู่แล้ว |
| `status` | ดิสก์ | ตาราง plugin × status + gate counts + open CR | อ่านจากดิสก์เท่านั้น |
| `next` | ดิสก์ | รายการ action ≤3 (CR ค้าง → gate แดง → plugin ถัดไป) | ไม่รันอะไรเอง |
| `query <id>` | id/lineage | record + up/down (depth 2) + open CR ที่แตะ | rebuild registry ถ้า stale |
| `check` | gates.json | ERROR/WARN/LIMIT · exit 1 ถ้า error | check ที่ไม่มี script → LIMIT |

Gates: G-core-001…010 (id ถูก · อยู่ใต้เจ้าของ · ไม่ซ้ำ · status ถูก · ≤300 บรรทัด · ไม่มี ref ค้าง · trace owner · parse ได้ · มี apps · registry สด)
`project.json.apps[]`: `{ name, type: backoffice-web|customer-web|mobile|desktop|api, auth: username|line|pin|token|none, owns: [master|roles|users] }`

### 5.1 req (เฟส 1)

**อ่าน:** โน้ต/transcript/ภาพที่ผู้ใช้วางมา · `project.json.modules[]` · question bank ใน `plugins/req/assets/question-bank.json`
**เขียน:** `req/<module>/*.json` · `req/stakeholders.json` · `req/sources.json` · `trace.req.json` · `export/requirement-<module>.md`

| คำสั่ง | in | out | DoD |
|---|---|---|---|
| `capture <module>` | ข้อความ/ไฟล์ที่ผู้ใช้ให้ | REQ · STK · UL · SRC (provenance ถึงหน้า/บรรทัด) · Q สำหรับสิ่งที่ไม่รู้ | ทุก REQ มี actor และ goal · ไม่เดาสิ่งที่ไม่ได้บอก → เปิด Q |
| `ask <module>` | question bank + REQ ที่มี | BR@v1 จากคำตอบ multiple-choice 3 ข้อ/รอบ · ⭐ = default temperament ของเจ้าของ | คำตอบถูกเขียนลงดิสก์ก่อนแสดงรอบถัดไป |
| `rules <module>` | REQ + คำตอบ | BR@vN + EX (≤5/BR) แบบ Example Mapping (rule / example / question) | ทุก BR มี ≥1 EX · BR ที่ถอน = `retired` ไม่ลบ |
| `calc <BR@v>` | BR ที่มีตัวเลข | CALC@v: สูตร ชนิดตัวเลข rounding mode **และจุดปัด** boundary | ผูก BR เวอร์ชันเดียว |
| `golden <CALC@v>` | CALC + สคริปต์คำนวณ | `golden/CALC-…@vN.mjs` + GD ที่ได้จากการรันจริง | GD ต้องมี `signedBy` ก่อน status approved |
| `export <module>` | ทุกอย่างข้างบน | `export/requirement-<module>.md` ภาษาไทยให้ลูกค้า | ไม่มีใครอ่านไฟล์นี้กลับ |

**Question bank หมวด:** permission · reversal · freeze point · approval · audit · calculation · temporal/versioning · data scope · integration · idempotency · (เพิ่มภายหลัง: notification · import/export · subscription/expiry · deletion · multi-language/currency)
**Default temperament ⭐:** round half-up ทุกจุด · fail-fast เมื่อ API พัง · DB constraint enforce · ข้อมูลเห็นได้เฉพาะผู้สร้าง · เก็บเวอร์ชัน ไม่ลบ — เป็น default ของเจ้าของ ไม่ใช่กฎ domain

**Gates:** ทุก REQ มี actor+goal (error) · ทุก BR มี ≥1 EX (error) · EX ≤5/BR (error) · CALC ที่มี GD ต้อง match เมื่อรันสคริปต์ซ้ำ (error) · Q เปิดค้าง (warn = บล็อก CP1) · ทุก ROLE/actor ใน REQ เป็น STK ที่มีจริง (error)
**Cold Start:** "BR เวอร์ชันไหนของ module X approved แล้ว และพิสูจน์ด้วย EX อะไร"

### 5.2 design (เฟส 2)

**อ่าน:** `req/**` (ผ่าน query) · `project.json.apps[]` · baseline catalogue ใน `plugins/design/references/app-baselines/<type>.json`
**เขียน:** `design/domain.json` `design/api.json` `design/rbac.json` `design/decisions.json` `design/<module>/{usecases,screens,scenarios}.json` · `trace.design.json` · `export/design-<module>.md`

| คำสั่ง | in | out | DoD |
|---|---|---|---|
| `domain <module>` | REQ BR UL | ENT พร้อม **`kind`** + attributes + invariants (อ้าง BR) · STM ต่อ aggregate ที่มี lifecycle | ทุก ENT มี kind · ทุก STM ทุก state มีทางออก |
| `usecase <module>` | REQ BR ENT STM | UC: actor · precondition · main/alternate/exception · **step.enforces[BR@v]** · AC (then คัดคำต่อคำจาก EX) | CRUD = 1 UC · ทุก BR ถูก enforce ≥1 step |
| `screens <module>` | UC ENT ROLE apps baseline | **G1** จาก UC → UI(origin usecase) · **G2** จาก ENT.kind reference/lookup → UI master ใน app ที่ `owns: master` (read-only ที่อื่น) · **G3** baseline ต่อ app type (login, forgot-password, profile, users, roles, permission-matrix, audit-log, settings, home) · **G4** จาก NFR (audit → audit-log, import/export, tenant) · ผลเป็น **matrix entity/UC × app** · RPT ที่ลูกค้าขอ | coverage: ทุก ROLE มีหน้าจัดการ · ทุก reference ENT มี owner UI · ทุก app ที่ auth≠none มี login · ทุก UC มี ≥1 UI ใน app ที่ actor ใช้ |
| `api <module>` | UC UI ENT | API ต่อ action ของ UI ที่ต้องข้าม app / INT ภายนอกพร้อม failure mode | ทุก UI action ที่เขียนข้อมูลมี API |
| `rbac` | STK UC UI ENT | ROLE (trace → STK) · ACL default deny · data scope | ทุก ROLE trace ถึง STK · ทุก UI มี ≥1 ACL |
| `scenario <module>` | UC NFR | SCN 1 ต่อ flow (main/alt/exception) + 1 ต่อ NFR · ผลลัพธ์คาดหวังชัด | ทุก UC flow มี SCN · ทุก NFR มี SCN |

**Gates:** ตาม DoD ข้างบนทั้งหมด (error) + "UI ที่ origin=usecase ไม่ trace ถึง UC" = scope creep (error) + "BR ที่ไม่มี step ใด enforce" (error — นี่คือกฎที่เคยไม่ fire จนส่งมอบ)
**Cold Start:** "UI-X ขึ้นกับหน้าไหน และบังคับ BR อะไร" · "ทำไมมีหน้า login ใน app customer" (ตอบ: origin baseline, app type customer-web, auth line)

### 5.3 change (เฟส 3)

**อ่าน:** ทุก `trace.*.json` + registry · **เขียน:** `change/open|closed/CR-nnn.json` · `trace.change.json` (edge `touches`)

| คำสั่ง | in | out | DoD |
|---|---|---|---|
| `open --kind display\|screen\|report\|rule\|other --source client\|external\|internal\|finding` | คำขอ + id ที่แตะ (ถ้ารู้) | CR draft `touches[]` | CR เขียนก่อนตอบผู้ใช้ |
| `impact <CR>` | CR + กราฟ | รายการ artifact ที่กระทบ (เดินกราฟทั้ง up/down จน SCN/TC/IMP) · **lane** · ประมาณการ (นับ UI/SCN/TC/CALC) | discriminator: "ผู้ใช้จะเห็น/ทำอะไรที่ไม่มี artifact ประกาศไหม" → ไม่ = `ui` · ใช่ = `full` · RPT ที่มี totals = full เสมอ |
| `apply <CR>` | CR ที่ lane แล้ว | reopen status ของ artifact ที่กระทบเป็น `draft` · BR/CALC ที่เปลี่ยน mint @vN+1 (เก่า retired) · ระบุ plugin ที่ต้องรันใหม่ | ไม่แก้เนื้อหา artifact เอง — แค่เปิดสถานะ |
| `close <CR>` | CR ที่ artifact ทั้งหมดกลับเป็น ≥approved | ย้ายไป closed/ · บันทึกวัน + ผู้เซ็น | ปิดไม่ได้ถ้ายังมี artifact draft ที่ CR แตะ |

**Lane `ui`:** design(UI/rbac) → mock → dev:revise (Class A) → qa UI test · **Lane `full`:** กลับ req (BR/CALC) หรือ design:domain แล้วไล่ลงทั้งสาย
**Gates:** artifact ที่ status ≥approved และถูก open CR แตะ → mock/dev/qa ห้ามเริ่ม (error ใน plugin นั้น ๆ) · CR ที่เปิดเกิน N วันโดยไม่มี impact (warn) · CR source=finding ต้องอ้าง DEF (error)
**Cold Start:** "ตอนนี้อะไรถูกแช่แข็งอยู่ เพราะ CR ไหน และเป็น lane อะไร"

### 5.4 mock (เฟส 4)

**อ่าน:** UI (structure: fields, actions, zones, states, roles) · THM · **เขียน:** `mock/theme.json` `mock/<app>/MCK-*.json` `mock/<app>/*.html` `mock/baseline/` · `trace.mock.json` (`mocks` UI)

| คำสั่ง | in | out | DoD |
|---|---|---|---|
| `theme` | ถามผู้ใช้ | THM: tokens (สี ระยะ ฟอนต์) + component inventory | dev ห้ามตั้งค่าเอง อ้าง token เท่านั้น |
| `wireframe <app> [UI…]` | UI + THM | MCK L1 ต่อ UI: zones, control id (`data-testid`), states · HTML ที่เปิดดูได้ (Bootstrap 5 static) | ทุก control มี testid ผูกกับ UI.field/action · ไม่เพิ่ม affordance ที่ UI ไม่ประกาศ |
| `approve <app> --sign --evidence <path>` | MCK ทั้ง app | `mock/baseline/<app>@<date>.json` (รายการ UI/MCK + hash) · status approved | มี evidence และผู้เซ็น · **baseline = ขอบเขตของใบเสนอราคา** |
| `sync-design` *(ทางเลือก)* | MCK | ส่ง prompt ไป Claude Design / ดาวน์โหลดไฟล์กลับ `mock/<app>/design/` | ไม่บังคับ core |

**Gates:** MCK ที่ control ไม่ตรง UI (error) · app ที่ไม่มี THM ห้าม wireframe (error) · baseline ที่ hash ไม่ตรงกับ MCK ปัจจุบัน = มีการแก้หลังเซ็นโดยไม่มี CR (error)
**Cold Start:** "ลูกค้าเซ็นอะไร วันไหน และหน้าไหนถูกแก้หลังจากนั้น"

### 5.5 dev (เฟส 5)

**อ่าน:** UC AC ENT STM API ACL SCN MCK THM CALC GD (ผ่าน query) · **เขียน:** `dev/*.json` · `trace.dev.json` (`implements`) · โค้ดในโปรเจกต์ลูกค้า · docker compose สำหรับทดสอบ

| คำสั่ง | in | out | DoD |
|---|---|---|---|
| `stack` | ถามผู้ใช้ต่อ app (ไม่เดา) · DEC ที่ลูกค้าเซ็น | CMP ต่อ app: language framework version orm skills `confirmedBy` · runtime deps + config contract (env, secret) | ถามครั้งเดียว จำตลอดโปรเจกต์ |
| `plan <module>` | UC AC | TSK = **vertical slice** ต่อ UC (CRUD = 1 TSK) · `origin: new\|bound\|changed` · build order acyclic · trace → UC/AC (ห้าม trace BR ตรง) | ทุก TSK มี ≥1 AC + `verify` command |
| `task <TSK>` | TSK + slice | โค้ด · unit test ที่ expected values = GD คำต่อคำ · IMP ต่อไฟล์ · `proof[] {cmd,result,at}` | ปิดได้เมื่อ verify รันจริง + คนอ่าน diff + commit ผูก TSK · retry ≤3 แล้ว blocked |
| `revise <UI\|UC>` | คำขอแก้โค้ดที่มีอยู่ | Class A (จัดเรียงสิ่งที่ design ประกาศแล้ว) → ทำได้ trace ไว้ · Class B (affordance/field/route ใหม่) → เปิด GAP + CR ห้ามเขียนโค้ด | ห้ามทับไฟล์ที่ต่างจาก commit ล่าสุด (คนแก้) — ถาม |
| `handoff <module>` | TSK IMP | manifest ให้ qa: AC ที่ทำ · controls+testid · endpoints จริง · unit tests + GD ที่ใช้ · วิธีขึ้นระบบ | qa เขียน TC ได้โดยไม่ถามใคร |

**Gates:** TSK done โดยไม่มี proof (error) · IMP นอก layout ที่ประกาศ (error) · TSK ที่แตะ artifact ที่มี open CR (error) · unit test expected ที่ไม่ตรง GD (error) · ไฟล์ที่ไม่มี IMP เป็นเจ้าของ (warn) · skill ที่ route ไว้ไม่ได้ติดตั้ง = LIMIT
**Cold Start:** "class ไหน implement REQ-X และ unit test ใช้ GD ไหน"

### 5.6 qa (เฟส 6)

**อ่าน:** SCN AC handoff manifest GD · **เขียน:** `qa/<module>/*.json` `qa/runs/` `qa/evidence/` · `trace.qa.json` (`covers`)

| คำสั่ง | in | out | DoD |
|---|---|---|---|
| `cases <module>` | SCN + handoff | TC ต่อ SCN: steps ที่รันได้ (testid/endpoint) pass criterion command · DATA ที่ต้องมี | ไม่ถามใคร ถ้าต้องถาม = handoff ไม่ครบ → DEF routing dev |
| `run <scope>` | TC | RUN ใหม่ทุกครั้ง (ไม่ทับ): code version, env, ผลต่อ TC, evidence (ภาพ/log) ชื่อไฟล์บอก TC+RUN+step+ผล | ผลมาจากคำสั่งที่รัน ไม่ใช่การประกาศ |
| `finding <TC>` | TC ที่ fail | DEF: reproduce, evidence, severity, **routing dev\|design\|req** ตาม root cause (โค้ดผิดสเปก / สเปกบกพร่อง / requirement เปลี่ยน) | routing design/req → เปิด CR `source: finding` อัตโนมัติ · dev ปิด DEF ไม่ได้ qa รันซ้ำเขียวจึงปิด |
| `report <module>` | RUN DEF | coverage (REQ→SCN→TC→pass) · ของที่ยังพัง · `export/qa-<module>.md` | นับจาก data ไม่ใช่ประมาณ |

unit test = dev · E2E/scenario = qa · ห้ามซ้ำกัน
**Gates:** SCN ที่ไม่มี TC (error) · TC pass โดยไม่มี RUN (error) · DEF routing design/req ที่ไม่มี CR (error) · RUN ที่ evidence หาย (error)
**Cold Start:** "REQ-X สร้างแล้ว ทดสอบแล้ว ผ่านไหม หลักฐานอยู่ไหน"

---

## 6. เคสที่ระบบต้องรับได้ (ใช้เป็นชุดทดสอบเชิงพฤติกรรม)

| เคส | ทางเดิน |
|---|---|
| ลูกค้าขอเพิ่มฟิลด์แสดงผลบนหน้าเดิม (ฟิลด์มีใน ENT, role อ่านได้) | CR display → lane ui → UI → MCK → dev:revise A → qa |
| ขอหน้าดูข้อมูลใหม่ (read-only) | CR screen → UC ใหม่ (capability "ดู…") → UI API ACL SCN → full |
| ขอรายงานที่มียอดรวม | CR report → req:ask (calculation/data scope/temporal) → CALC+GD → RPT → full |
| bug ที่ root cause คือสเปก | qa:finding routing design → CR source finding อัตโนมัติ |
| ประกัน: bug หรือ change | finding routing ตัดสิน: code/spec = defect · requirement เปลี่ยน = CR คิดเงิน |
| ลูกค้าตอบใน LINE | ทุก approve ต้องแนบ evidence · ไม่รับคำบอกเล่า |
| หยุด 3 เดือนแล้วกลับมา | Cold Start Test ของทุกเฟส |
| mobile + backoffice ใช้ UC เดียว | screen matrix: UC ร่วม UI ต่อ app |
| hotfix ตีสอง / UAT sign-off / migration ข้อมูลเก่า / brownfield / product หลาย tenant | **จองไว้เฟส 7** — ห้ามใส่ก่อน |

---

## 7. ลำดับสร้างและ DoD

| เฟส | plugin | DoD ต้องเขียวก่อนเปิดเฟสถัดไป |
|---|---|---|
| 0 | core | `selftest.mjs` PASS · โฟลเดอร์เปล่า → `next` = init → หลัง init = ใส่ apps → หลัง apps = install req |
| 1 | req | rentpoint module `rental` capture+ask+rules ครบ 12 BR ตาม testproject · ไม่มีไฟล์ >300 บรรทัด · CALC 3 ตัวมี GD ที่รันซ้ำตรง · export ออก md |
| 2 | design | apps `backoffice` + `customer` → screens มี login/master/roles/permission ทั้งสอง app โดยไม่ต้องสั่ง · ทุก BR ถูก enforce · ทุก UC flow มี SCN |
| 3 | change | รัน 3 CR ตาม testproject §5 → lane ถูกทั้ง 3 · impact list ตรงกับที่คาด · design ปฏิเสธ regenerate UI ที่ CR แตะ |
| 4 | mock | app customer มี THM + MCK ทุก UI + baseline เซ็นพร้อม evidence · แก้ MCK หลังเซ็น → gate แดง |
| 5 | dev | slice "จองอุปกรณ์" ขึ้น docker compose · TSK มี proof · unit test ใช้ GD · Class B → GAP ไม่มีโค้ด |
| 6 | qa | TC จาก SCN ไม่ถาม · 1 RUN มี evidence · DEF ที่ routing design เปิด CR เอง |

**โปรเจกต์ทดสอบ:** `testproject-rentpoint.md` — ใหม่ทั้งหมด ไม่ใช้ข้อมูลจากที่ใด · สร้าง `.sdlc/` ใน `test/rentpoint/` แยกจาก repo marketplace

---

## 8. เชิงพาณิชย์ที่ต้องฝังไว้ (เจ้าของมักลืม)

- `mock:approve --sign` = baseline = **ขอบเขตของใบเสนอราคา** · `change:impact` = หลักฐานคิดเงิน CR
- ใบเสนอราคาต้องระบุ: ปรับแสดงผลหน้าเดิม (lane ui) รวมในงาน จำกัดรอบ · หน้าใหม่/รายงานใหม่คิดเพิ่ม · รายงานมียอดรวมราคาต่างจากรายงานรายการ · Discovery (CP1) มี timebox และคิดเงินแยก
- หน้า `origin: baseline` เป็นชุดเดียวกันทุกโปรเจกต์ → เป็น starter kit ที่ list ครบในใบเสนอราคาแต่คิดเป็นแพ็กเกจ
- `export/*.md` เป็นภาษาไทย สุภาพ ตรง ไม่ขายเกิน
