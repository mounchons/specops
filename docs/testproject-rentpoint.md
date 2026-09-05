# โปรเจกต์ทดสอบ: RentPoint (ใหม่ทั้งหมด — ใช้ทดสอบทุกเฟสของ specops)

> ร้านให้เช่าอุปกรณ์ก่อสร้างรายวัน สมมติขึ้นเพื่อทดสอบ specops โดยเฉพาะ · เล็กพอที่จะรันครบ 7 เฟส แต่มีทุกสิ่งที่ระบบต้องรับ:
> 2 app · master data · roles · การคำนวณที่มี rounding · state machine · กฎข้าม aggregate · รายงานที่มียอดรวม · การถอนกฎ · CR 3 แบบ · defect 2 แบบ
> สร้าง `.sdlc/` ใน `test/rentpoint/` (นอก repo marketplace) · module เดียว: `rental` · ห้ามใช้ข้อมูลจากโปรเจกต์อื่น

---

## 1. ธุรกิจ (ใช้เป็น input ของ `req:capture` — วางข้อความนี้ให้ตรง ๆ)

ร้าน "RentPoint" ให้เช่าอุปกรณ์ก่อสร้าง (เครื่องตบดิน นั่งร้าน เครื่องเจาะ ปั๊มน้ำ) คิดเป็นรายวัน ลูกค้าจองผ่านเว็บ (login ด้วย LINE) เลือกอุปกรณ์ วันรับ วันคืน ระบบคิดค่าเช่าและมัดจำ ลูกค้าโอนมัดจำแล้วพนักงานยืนยัน วันรับของพนักงานกดปล่อยของ วันคืนพนักงานกดรับคืน ถ้ามีความเสียหายบันทึกค่าเสียหาย แล้วออกบิล คืนมัดจำหักค่าปรับ/ค่าเสียหาย เจ้าของร้านดูรายงานรายได้รายเดือน พนักงานลดราคาได้นิดหน่อย ลดมากต้องให้เจ้าของอนุมัติ ระบบต้องบันทึกว่าใครทำอะไรเมื่อไหร่

**Stakeholders:** STK-001 เจ้าของร้าน (manager) · STK-002 พนักงานหน้าร้าน (staff) · STK-003 ลูกค้าผู้เช่า (customer)
**Apps (`project.json`):** `backoffice` (backoffice-web, auth username, owns master/roles/users) · `customer` (customer-web, auth line)

## 2. Business rules ที่ `req:ask` + `req:rules` ต้องได้ (12 ข้อ — ใช้เทียบ DoD เฟส 1)

| id | กฎ | หมวดคำถามที่นำไปสู่กฎ |
|---|---|---|
| BR-rental-001@v1 | ค่าเช่า = จำนวนวัน × rate/วัน · นับวันตามปฏิทิน วันรับนับเป็นวันที่ 1 · ขั้นต่ำ 1 วัน | calculation / temporal |
| BR-rental-002@v1 | มัดจำ = 30% ของค่าเช่ารวม **ปัดขึ้นเป็นหลักร้อย** | calculation |
| BR-rental-003@v1 | คืนช้า: ค่าปรับ = 1.5 × rate/วัน × จำนวนวันที่เกิน (นับเต็มวัน) | calculation / temporal |
| BR-rental-004@v1 | การจองยืนยันได้ (draft → confirmed) เมื่อรับชำระมัดจำแล้วเท่านั้น | freeze point / approval |
| BR-rental-005@v1 | ลูกค้ายกเลิกได้เฉพาะก่อนสถานะ out · ยกเลิกหลัง confirmed ริบมัดจำ 50% | reversal |
| BR-rental-006@v1 | อุปกรณ์สถานะ maintenance จองไม่ได้ | data scope / eligibility |
| BR-rental-007@v1 | staff ปรับ rate ต่อรายการได้ไม่เกิน −10% · เกินนั้น manager ต้อง approve | permission / approval |
| BR-rental-008@v1 | **เมื่อออกบิลแล้ว การแก้ค่าใช้จ่ายใด ๆ ของการจองต้องออกบิลใหม่** (กฎข้าม aggregate Booking ↔ Bill) | freeze point |
| BR-rental-009@v1 | ลูกค้าเห็นเฉพาะการจองของตัวเอง | data scope |
| BR-rental-010@v1 | ทุกการเปลี่ยนสถานะบันทึก ใคร/เมื่อไร/จากอะไรเป็นอะไร | audit |
| BR-rental-011@v1 | บันทึกค่าเสียหายได้เฉพาะสถานะ returned และก่อนออกบิล | freeze point |
| BR-rental-012@v1 → **retired** · BR-rental-012@v2 | v1: "คืนมัดจำภายใน 3 วันหลังรับคืน" — ถอนใน ask รอบ 2 → v2: "คืนมัดจำทันทีเมื่อออกบิล หักค่าปรับ/ค่าเสียหาย" | reversal — **ทดสอบการถอนกฎ** |

**NFR:** NFR-rental-001 หน้ายืนยันจองตอบภายใน 2 วินาที · NFR-rental-002 audit ต้องอ่านย้อนหลังได้ 2 ปี

## 3. Calculation contracts + golden datasets (ใช้เทียบ `req:calc` / `req:golden`)

| CALC | ผูก BR | สูตร | rounding |
|---|---|---|---|
| CALC-rental-001@v1 | BR-001 | `days = max(1, (return − pickup) + 1)` · `fee = Σ days × rate` | ไม่ปัด (จำนวนเต็มบาท) |
| CALC-rental-002@v1 | BR-002 | `deposit = ceil(fee × 0.30 / 100) × 100` | ปัดขึ้นหลักร้อย **หลัง**คูณ 30% |
| CALC-rental-003@v1 | BR-003 | `late = max(0, actualReturn − dueReturn) × 1.5 × rate` | ไม่ปัด |

Golden (ต้องได้ตรงตัวเมื่อรันสคริปต์ซ้ำ):

| GD | input | expected |
|---|---|---|
| GD-rental-001 | rate 800 · รับ 2026-09-03 · คืน 2026-09-05 | days 3 · fee 2,400 |
| GD-rental-001 | rate 1,250 · รับ = คืน | days 1 · fee 1,250 |
| GD-rental-002 | fee 2,400 | 720 → **800** |
| GD-rental-002 | fee 1,250 | 375 → **400** |
| GD-rental-002 | fee 3,000 | 900 → **900** (ขอบเขตพอดี ไม่ปัดเพิ่ม) |
| GD-rental-003 | rate 800 · กำหนด 09-05 · คืนจริง 09-07 | 2 × 1.5 × 800 = **2,400** |
| GD-rental-003 | คืนตรงวัน | **0** |

## 4. Domain ที่ `design:domain` ควรได้ (ใช้เทียบ `kind` และ G2)

| ENT | kind | หมายเหตุ |
|---|---|---|
| Booking | aggregate | มี RentalLine · STM: draft → confirmed → out → returned → billed → closed · cancelled จาก draft/confirmed |
| RentalLine | entity | equipment, days, rate, discountPct |
| Bill | aggregate | ออกจาก Booking · การแก้หลังออก = บิลใหม่ (BR-008) |
| Payment | entity | deposit / balance / refund |
| DamageCharge | entity | บันทึกได้เฉพาะ returned (BR-011) |
| Customer | **reference** | → G2 master ใน backoffice · ลูกค้าเห็นของตัวเอง (BR-009) |
| Equipment | **reference** | rate/วัน, status available/out/maintenance (BR-006) |
| EquipmentCategory | **lookup** | ถาม: master screen หรือ seed → คาดว่า master |
| Money / DateRange | vo | ไม่มีหน้าจอ |

**ROLE:** manager (STK-001) · staff (STK-002) · customer (STK-003)

## 5. Screen matrix ที่ `design:screens` ต้องผลิตโดยไม่ต้องสั่ง (DoD เฟส 2)

| | backoffice | customer | origin |
|---|---|---|---|
| Login / forgot / profile | ✓ username | ✓ LINE | baseline |
| Users · Roles · Permission matrix · Audit log · Settings · Home | ✓ | – (home ✓) | baseline |
| Master: Customer / Equipment / EquipmentCategory | ✓ CRUD | – | master (G2) |
| จองอุปกรณ์ (UC-001) | ✓ สร้างแทนลูกค้า | ✓ | usecase |
| รายการจอง + ยืนยัน/ปล่อย/รับคืน/ยกเลิก (UC-002..005) | ✓ | ✓ ดูของตัวเอง + ยกเลิก | usecase |
| บันทึกค่าเสียหาย · ออกบิล · คืนมัดจำ (UC-006..008) | ✓ | ✓ ดูบิล | usecase |
| อนุมัติส่วนลด (UC-009, BR-007) | ✓ manager | – | usecase |
| Audit log | ✓ | – | nfr (G4 จาก NFR-002) |

V-check ที่ต้องเขียว: ทุก ROLE มีหน้า Roles/Permission · Customer/Equipment/Category มี owner UI ใน backoffice · ทั้งสอง app มี login · BR ทั้ง 11 ข้อ (ไม่นับ retired) ถูก `enforces` โดย ≥1 step

## 6. Change requests สำหรับเฟส 3 (รันตามลำดับ — ตรวจ lane และ impact)

| CR | คำขอ | lane ที่คาด | impact ที่คาด |
|---|---|---|---|
| CR-001 `kind: display` | แสดงเบอร์โทรลูกค้าบนหน้ารายการจอง (backoffice) | **ui** — phone มีใน Customer, staff มี ACL read, ไม่มีคำนวณ | UI รายการจอง 1 · MCK 1 · TSK revise 1 · TC UI 1 · ไม่แตะ BR/UC |
| CR-002 `kind: screen` | ลูกค้าขอหน้า "ประวัติการเช่าของฉัน" (read-only) | **full** — capability ใหม่ | UC ใหม่ 1 (ดูประวัติ) · UI 1 (customer) · API 1 · ACL 1 (BR-009 data scope) · SCN 1 · ไม่แตะ BR |
| CR-003 `kind: report` | รายงานรายได้รายเดือนแยกหมวดอุปกรณ์ พร้อมยอดรวม | **full** — มียอดรวม | req:ask (temporal: นับตามวันออกบิล / data scope: ทุกสาขา?) → CALC-rental-004 + GD · RPT 1 · UI 1 · SCN 1 · TC 1 |

หลัง `apply CR-001`: UI รายการจองต้องกลับเป็น draft และ `mock:wireframe` / `dev:task` ที่แตะ UI นั้นต้องถูก gate ปฏิเสธจน CR close

## 7. เฟส 5 — slice ที่ต้องขึ้นจริง

**TSK: "ลูกค้าจองอุปกรณ์"** (UC-rental-001) — endpoint สร้าง Booking → ตรวจ BR-006 (maintenance) → คำนวณ CALC-001/002 → บันทึก draft → บันทึก audit (BR-010)
Stack ที่เจ้าของจะตอบเมื่อ `dev:stack` ถาม: CMP-api = C# ASP.NET Core 8 + EF Core + PostgreSQL 16 · CMP-backoffice = ASP.NET Core MVC + Bootstrap 5 + HTMX · CMP-customer = ASP.NET Core MVC + Bootstrap 5 · docker compose: api + postgres
Unit test expected values = GD-rental-001/002 คำต่อคำ · **ทดสอบ Class B:** ขอเพิ่ม "ช่องหมายเหตุ" ในหน้าจอง → ต้องได้ GAP ไม่ใช่โค้ด

## 8. เฟส 6 — defect 2 แบบ

| DEF | อาการ | root cause | routing ที่คาด |
|---|---|---|---|
| DEF-rental-001 | ยืนยันจองได้ทั้งที่ยังไม่ชำระมัดจำ | โค้ดไม่ตรงสเปก (SCN ระบุไว้แล้ว) | **dev** — ไม่เปิด CR |
| DEF-rental-002 | มัดจำของ fee 3,000 แสดง 1,000 | สเปกกำกวม: `ceil` ที่ค่าพอดี — GD บอก 900 แต่ SCN ไม่มีเคสขอบเขต | **design** — เปิด CR source finding อัตโนมัติ · เพิ่ม SCN ขอบเขต |

## 9. Cold Start questions ต่อเฟส (ต้องตอบได้จาก `/core:query` + `/core:next` เท่านั้น)

0 "ต้องทำอะไรตอนนี้" · 1 "BR-rental-012 เวอร์ชันไหน active และเพราะอะไร" · 2 "ทำไม app customer มีหน้า login และ UI รายการจองบังคับ BR อะไร" · 3 "อะไรถูกแช่แข็งเพราะ CR ไหน" · 4 "ลูกค้าเซ็น baseline ของ customer วันไหน มีหน้าไหนแก้หลังจากนั้น" · 5 "class ไหน implement UC-rental-001 และ unit test ใช้ GD ไหน" · 6 "REQ ข้อแรกสร้าง ทดสอบ ผ่านไหม หลักฐานอยู่ไหน"
