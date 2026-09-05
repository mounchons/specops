# specops — Prompts สำหรับ Claude Code (ทีละเฟส)

> **ไม่ต้องวาง** — `/phase` อ่านไฟล์นี้เอง: `/phase` (ถามว่าทำข้อไหน) · `/phase 1` (ขั้นถัดไปของเฟส 1) · `/phase 1 spec|approve|build|dod`
> ไฟล์นี้คือเนื้อหาที่ `/phase` รัน · แก้ที่นี่ที่เดียว
> ทุกเฟสมี 3 ขั้นเสมอ: **สเปก 1 หน้า → รออนุมัติ → สร้าง → ทดสอบบน RentPoint → รายงาน DoD พร้อม proof**

---

## P0 — เปิด session (**ไม่ต้องใช้** — `/phase` ทำสิ่งนี้ให้ทุกครั้ง · เก็บไว้เป็น fallback เมื่อ /phase ใช้ไม่ได้)

```
อ่านตามลำดับ: CLAUDE.md → docs/DESIGN.md (ทั้งไฟล์) → docs/SPECOPS-BRIEF.md §0–§4 → docs/phase-plan.md
รัน node plugins/core/scripts/selftest.mjs และ node plugins/core/scripts/next.mjs --state-dir test/rentpoint/.sdlc (ถ้ามี)
บอกผมว่าตอนนี้อยู่เฟสไหน DoD ข้อไหนเขียว/แดง แล้วหยุดรอคำสั่ง
กติกา: เมื่อสเปกไม่ครอบคลุม ใช้ DESIGN.md §4 ตัดสิน · กฎอยู่ใน checks.mjs ไม่ใช่ใน prompt · ไฟล์ที่ AI อ่าน ≤300 บรรทัด · ห้ามสร้างคำสั่งเกินสเปก · เจอสิ่งที่ต้องตัดสินใจ หยุดถาม อย่าเดา
```

## P0.5 — เฟส 0 core (**ไม่ต้องใช้** — core สร้างแล้ว · selftest PASS · docs/dod/phase-0.md ปิดแล้ว · ใช้เฉพาะถ้าตัดสินใจรื้อ core)

```
สร้าง plugins/core ตาม docs/SPECOPS-BRIEF.md §5.0 ให้ครบ: paths ids artifacts registry query gates status next init selftest
+ commands 6 ตัว + fixtures clean/dirty + EXPECTED.md
DoD: selftest PASS · โฟลเดอร์เปล่า → next บอก init → หลัง init บอกใส่ apps → หลังใส่ apps บอก install req
ห้ามเพิ่ม dependency · Node ESM · exit code 0/1/2 ตาม §2
รายงานเป็นตาราง DoD + คำสั่งที่รันพิสูจน์
```

## P1 — เฟส 1 req

```
ขั้น 1 (ยังไม่เขียนโค้ด): เขียน plugins/req/SPEC.md ตาม docs/plugin-spec-template.md โดยยึด SPECOPS-BRIEF §5.1
  ต้องมี: reads / writes / 6 คำสั่ง (capture ask rules calc golden export) / gates ที่จะใส่ใน checks.mjs / cold start question
  ยาวไม่เกิน 1 หน้า แล้วหยุดรออนุมัติ

ขั้น 2 (หลังอนุมัติ): สร้าง plugins/req
  - scripts/checks.mjs export CHECKS + NEXT ตามสัญญาใน CLAUDE.md
  - assets/question-bank.json หมวดตาม §5.1 คำถามละ 2–4 ตัวเลือก มี ⭐ default temperament
  - ask ทำงานเป็นรอบ 3 คำถาม เขียนคำตอบลง req/<module>/ ก่อนแสดงรอบถัดไป
  - rules ใช้ Example Mapping: rule / example / question · EX ≤5 ต่อ BR · BR ที่ถอน = retired ไม่ลบ
  - calc/golden: golden/CALC-…@vN.mjs รันได้จริง GD มี signedBy
  - init เขียน project.json.plugins.req.root และ append gates
  - import ทุกอย่างจาก plugins/core/scripts ห้ามคัดลอก

ขั้น 3: ทดสอบกับ docs/testproject-rentpoint.md
  mkdir test/rentpoint → /core:init --name rentpoint --apps backoffice:backoffice-web,customer:customer-web → modules ["rental"]
  capture ด้วยข้อความ §1 · ask/rules จนได้ BR 12 ข้อตาม §2 (รวม BR-012 v1 retired → v2) · calc 3 ตัว · golden ตรง §3 ทุกแถว · export
  DoD: gates.mjs exit 0 · ไม่มีไฟล์ >300 บรรทัด · Cold Start: "BR-rental-012 เวอร์ชันไหน active และเพราะอะไร" ตอบจาก /core:query
รายงานตาราง DoD + proof · ห้ามรายงานเสร็จโดยไม่มี proof
```

## P2 — เฟส 2 design

```
ขั้น 1: plugins/design/SPEC.md 1 หน้า ตาม §5.2 · รออนุมัติ
ขั้น 2: สร้าง plugins/design
  - references/app-baselines/{backoffice-web,customer-web,mobile,desktop,api}.json = หน้า baseline ต่อ app type
  - domain: ENT ต้องมี kind · STM ทุก state มีทางออก
  - usecase: step.enforces[BR@v] · AC then คัดคำต่อคำจาก EX · CRUD = 1 UC
  - screens: G1 (UC) + G2 (ENT.kind reference/lookup → master ใน app ที่ owns) + G3 (baseline ต่อ app type) + G4 (NFR)
    ผลเป็น matrix · UI มี app และ origin · lookup ให้ถามผู้ใช้ว่า master หรือ seed
  - checks.mjs: ทุก BR ถูก enforce · ทุก ROLE มีหน้าจัดการ · ทุก reference ENT มี owner UI · ทุก app auth≠none มี login · UI origin=usecase ต้อง trace UC · ทุก UC flow มี SCN
ขั้น 3: รันบน test/rentpoint จนได้ matrix ตาม testproject §5 โดยไม่ต้องสั่งเพิ่มหน้าใด ๆ
  DoD ตาม phase-plan เฟส 2 · Cold Start คำถามเฟส 2
```

## P3 — เฟส 3 change

```
ขั้น 1: plugins/change/SPEC.md 1 หน้า ตาม §5.3 · รออนุมัติ
ขั้น 2: สร้าง plugins/change
  - impact เดินกราฟจาก registry (edges ทุก owner) ทั้ง up/down จนถึง SCN/TC/IMP · พิมพ์รายการ + lane + จำนวนต่อ prefix
  - discriminator lane: ผู้ใช้จะเห็น/ทำอะไรที่ไม่มี artifact ประกาศไหม → ui/full · RPT มี totals = full เสมอ
  - apply: reopen เป็น draft · BR/CALC mint @vN+1 · ไม่แก้เนื้อหา artifact เอง
  - checks.mjs: export ฟังก์ชัน isFrozen(id, ctx) ให้ mock/dev/qa ใช้ + gate CR source=finding ต้องอ้าง DEF
ขั้น 3: รัน CR-001/002/003 ตาม testproject §6 · lane และ impact ต้องตรงตาราง · apply CR-001 แล้ว design:screens ต้องปฏิเสธ UI ที่ถูกแตะ
```

## P4 — เฟส 4 mock

```
ขั้น 1: plugins/mock/SPEC.md 1 หน้า ตาม §5.4 · รออนุมัติ
ขั้น 2: สร้าง plugins/mock — theme (ถามผู้ใช้) · wireframe L1 เป็น JSON + HTML static Bootstrap 5 · control ทุกตัวมี data-testid ผูก UI.field/action · approve --sign --evidence เขียน baseline พร้อม hash
  sync-design เป็นทางเลือก: ทำเป็นคำสั่งแยก ห้ามให้ core หรือ approve ขึ้นกับมัน
ขั้น 3: app customer ทุก UI มี MCK · approve พร้อม evidence · แก้ MCK 1 ไฟล์หลังเซ็น → gate แดง
```

## P5 — เฟส 5 dev

```
ขั้น 1: plugins/dev/SPEC.md 1 หน้า ตาม §5.5 · รออนุมัติ
ขั้น 2: สร้าง plugins/dev — stack ถามต่อ app ไม่เดา · plan = vertical slice ต่อ UC · task ปิดได้เมื่อ verify รันจริง + proof + commit · revise Class A/B · handoff manifest
  ห้ามทับไฟล์ที่ต่างจาก commit ล่าสุด · TSK ที่แตะ artifact ที่ isFrozen → gate แดง
ขั้น 3: slice ตาม testproject §7 ขึ้น docker compose · unit test expected = GD คำต่อคำ · ขอ "ช่องหมายเหตุ" → ต้องได้ GAP ไม่ใช่โค้ด
```

## P6 — เฟส 6 qa

```
ขั้น 1: plugins/qa/SPEC.md 1 หน้า ตาม §5.6 · รออนุมัติ
ขั้น 2: สร้าง plugins/qa — cases จาก SCN + handoff ไม่ถามใคร · run สร้าง RUN ใหม่ทุกครั้ง evidence ชื่อไฟล์บอก TC+RUN+step+ผล · finding routing dev/design/req · routing design/req → เปิด CR source finding เอง
ขั้น 3: DEF ตาม testproject §8 — DEF-001 routing dev ไม่มี CR · DEF-002 routing design เปิด CR อัตโนมัติ · report นับจาก data
```

## เมื่อ Claude Code อยากทำเกินสเปก

ตอบว่า: "รัฐธรรมนูญข้อ 9 — บันทึกเป็น docs/backlog.md แล้วทำต่อตาม DoD" · backlog ถูกหยิบมาพิจารณาหลังเฟส 6 เท่านั้น
