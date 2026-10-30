// ตรวจตรรกะหน้า /po (ไม่แตะฐานข้อมูล) — npx tsx scripts/check-po-export.ts
import assert from "node:assert/strict"
import {
  atmsDateISO, poRangeError, poMonthRegex, poStatusKey, poRowOf, filterPoRows,
  poSheetRows, poItemOf, poItemSheetRows, poExportFileName, poParseCodes, PO_MAX_DAYS, PO_ITEMS_CHUNK,
} from "../lib/po-export"

// ── วันที่จาก ATMS ─────────────────────────────────────────────
assert.equal(atmsDateISO("05/10/2026"), "2026-10-05")
assert.equal(atmsDateISO("5/9/2026 14:20"), "2026-09-05")
assert.equal(atmsDateISO(" 31/12/2026 "), "2026-12-31")
assert.equal(atmsDateISO("31/02/2026"), "")          // ไม่มีวันนี้จริง
assert.equal(atmsDateISO(""), "")
assert.equal(atmsDateISO(null), "")
assert.equal(atmsDateISO("2026-10-05"), "")          // ATMS ไม่ใช้รูปนี้

// ── ช่วงวันที่ ─────────────────────────────────────────────────
assert.equal(poRangeError("2026-10-01", "2026-10-30"), null)
assert.equal(poRangeError("2026-10-01", "2026-10-01"), null)
assert.ok(poRangeError("", "2026-10-30"))
assert.ok(poRangeError("2026-10-30", "2026-10-01"))  // กลับด้าน
assert.ok(poRangeError("2026-13-01", "2026-12-01"))  // เดือนไม่มีจริง
assert.equal(poRangeError("2025-10-30", "2026-10-30"), null)   // 366 วันพอดี
assert.ok(poRangeError("2025-10-29", "2026-10-30"))            // เกิน
assert.equal(PO_MAX_DAYS, 366)

// regex เดือน: จับทั้งแบบเติมศูนย์/ไม่เติม และแบบมีเวลา · ไม่จับเดือนนอกช่วง
const rx = new RegExp(poMonthRegex("2026-09-15", "2026-11-02"))
for (const ok of ["01/09/2026", "1/9/2026", "30/10/2026 08:00", "02/11/2026"]) assert.ok(rx.test(ok), ok)
for (const no of ["01/08/2026", "01/12/2026", "01/10/2025", "01/09/20261", "x01/09/2026"]) assert.ok(!rx.test(no), no)
const rxYear = new RegExp(poMonthRegex("2026-12-20", "2027-01-05"))
assert.ok(rxYear.test("25/12/2026") && rxYear.test("03/01/2027") && !rxYear.test("03/01/2026"))

// ── สถานะการรับสินค้า ───────────────────────────────────────────
assert.equal(poStatusKey("รับสินค้าแล้วทั้งหมด"), "all")
assert.equal(poStatusKey("รับสินค้าแล้วบางส่วน"), "partial")
assert.equal(poStatusKey("ยังไม่ได้รับสินค้า"), "none")
assert.equal(poStatusKey("ยกเลิก"), "cancel")
assert.equal(poStatusKey(""), "other")

// ── แถว PO (หัวใบ + PR + DD + เบอร์รถ + ฟิลด์อื่นที่ ATMS มี) ─────
const po = {
  _id: "x", scraped_at: new Date(),
  "รหัส": "LBPO26100012", "วันที่": "03/10/2026", "ใบขอสั่งซื้อ (PR)": "LBPR26100007",
  "ซัพพลายเออร์": "หจก. สมชัย  การช่าง", "ยานพาหนะ": "71-5742", "รวม": 13096.8,
  "กำหนดส่งสินค้า": "10/10/2026", "สถานะการรับสินค้า": "รับสินค้าแล้วบางส่วน", "ap term": "30D",
  "ผู้ใช้งาน": "somsak", "approver": "manager1", "คลังสินค้า": "", "ช่องใหม่": "ค่าใหม่", "ว่าง": null,
}
const pr = { "ใบขอสั่งซื้อ (PR)": "LBPR26100007", "วันที่": "01/10/2026", "ผู้ขอซื้อ": "ช่างเอ",
  "คลังสินค้า": "ลาดกระบัง", "แผนก": "ยานยนต์", "ทะเบียน": "71-5742", "หมายเหตุ": "1.LBMR26100033 เปลี่ยนผ้าเบรก" }
const row = poRowOf(po, { pr, dd: [{ code: "LBDD26100131", date: "08/10/2026" }], fleetNo: "ME042" })
assert.equal(row.code, "LBPO26100012")
assert.equal(row.date, "2026-10-03")
assert.equal(row.due, "2026-10-10")
assert.equal(row.supplier, "หจก. สมชัย การช่าง")      // \xa0 + ช่องว่างซ้อน → ช่องเดียว
assert.equal(row.total, 13096.8)
assert.equal(row.warehouse, "ลาดกระบัง")              // PO ว่าง → ใช้ของ PR
assert.equal(row.dept, "ยานยนต์")
assert.equal(row.prDate, "2026-10-01")
assert.equal(row.requester, "ช่างเอ")
assert.equal(row.prNote, "1.LBMR26100033 เปลี่ยนผ้าเบรก")
assert.equal(row.fleetNo, "ME042")
assert.deepEqual(row.dd, [{ code: "LBDD26100131", date: "2026-10-08" }])
assert.deepEqual(row.extra, { "ช่องใหม่": "ค่าใหม่" })  // ฟิลด์ที่ไม่รู้จักติดไปด้วย · ค่าว่าง/ระบบ ไม่ติด
assert.equal(row.statusKey, "partial")
const bare = poRowOf({ "รหัส": "KKPO1", "วันที่": "bad", "รวม": "abc" }, {})
assert.equal(bare.date, "")
assert.equal(bare.total, null)
assert.equal(bare.vehicle, "")
assert.deepEqual(bare.dd, [])

// ── ค้นหา + กรองสถานะ ──────────────────────────────────────────
const r2 = poRowOf({ "รหัส": "KKPO26100002", "วันที่": "04/10/2026", "ซัพพลายเออร์": "บจก. ยางดี",
  "ยานพาหนะ": "70-1111", "สถานะการรับสินค้า": "ยกเลิก" }, {})
const rows = [row, r2]
assert.deepEqual(filterPoRows(rows, {}).map((r) => r.code), ["LBPO26100012", "KKPO26100002"])
assert.deepEqual(filterPoRows(rows, { q: "me042" }).map((r) => r.code), ["LBPO26100012"])    // เบอร์รถ
assert.deepEqual(filterPoRows(rows, { q: "715742" }).map((r) => r.code), ["LBPO26100012"])  // ทะเบียนไม่มีขีด
assert.deepEqual(filterPoRows(rows, { q: "LBMR26100033" }).map((r) => r.code), ["LBPO26100012"]) // หมายเหตุ PR
assert.deepEqual(filterPoRows(rows, { q: "LBDD26100131" }).map((r) => r.code), ["LBPO26100012"]) // เลข DD
assert.deepEqual(filterPoRows(rows, { q: "ยางดี" }).map((r) => r.code), ["KKPO26100002"])
assert.deepEqual(filterPoRows(rows, { statuses: ["cancel"] }).map((r) => r.code), ["KKPO26100002"])
assert.deepEqual(filterPoRows(rows, { statuses: [] }).length, 2)

// ── ชีต 1: ใบสั่งซื้อ ───────────────────────────────────────────
const sheet = poSheetRows(rows, new Map([["LBPO26100012", 3]]))
assert.equal(sheet.length, 2)
const head = Object.keys(sheet[0])
assert.deepEqual(head.slice(0, 6), ["เลขที่ PO", "วันที่ PO", "กำหนดส่งสินค้า", "สถานะการรับสินค้า", "ซัพพลายเออร์", "ยอดรวม"])
for (const k of ["ใบขอซื้อ (PR)", "วันที่ PR", "ผู้ขอซื้อ", "คลังสินค้า", "แผนก", "ทะเบียน", "เบอร์รถ",
  "เครดิต", "ผู้เปิด PO", "ผู้อนุมัติ", "ใบรับของ (DD)", "วันที่รับของ", "หมายเหตุ PR", "จำนวนรายการ", "ช่องใหม่"]) {
  assert.ok(head.includes(k), `missing column ${k}`)
}
assert.equal(head[head.length - 1], "ช่องใหม่")             // ฟิลด์อื่นต่อท้าย
assert.equal(sheet[0]["ยอดรวม"], 13096.8)
assert.equal(sheet[0]["วันที่ PO"], "2026-10-03")           // ตัวสร้าง Excel แปลงเป็นวันที่
assert.equal(sheet[0]["ใบรับของ (DD)"], "LBDD26100131")
assert.equal(sheet[0]["วันที่รับของ"], "08/10/2026")
assert.equal(sheet[0]["จำนวนรายการ"], 3)
assert.equal(sheet[1]["จำนวนรายการ"], 0)
assert.equal(sheet[1]["ยอดรวม"], "")
assert.equal(sheet[1]["ช่องใหม่"], "")                      // ทุกแถวมีคอลัมน์ครบเท่ากัน
assert.deepEqual(Object.keys(sheet[1]), head)

// ── ชีต 2: รายการสินค้า ─────────────────────────────────────────
const it = poItemOf({ po_code: "LBPO26100012", seq: 1, group: "เบรก", sku: "BR-HN500-R", name: "ผ้าเบรกหลัง HINO 500",
  amount: 2, unit_price: 3800, total: 7600, received: 1, outstanding: 1, warehouse: "ลาดกระบัง", note: null, detail_id: "991" })
assert.deepEqual(it, { poCode: "LBPO26100012", seq: 1, group: "เบรก", sku: "BR-HN500-R", name: "ผ้าเบรกหลัง HINO 500",
  qty: 2, unitPrice: 3800, total: 7600, received: 1, outstanding: 1, warehouse: "ลาดกระบัง", note: "" })
const itemRows = poItemSheetRows(rows, new Map([["LBPO26100012", [it]]]))
assert.equal(itemRows.length, 2)                             // PO ไม่มีรายการยังขึ้นหนึ่งแถว ไม่หายเงียบ
assert.deepEqual(Object.keys(itemRows[0]).slice(0, 8),
  ["เลขที่ PO", "วันที่ PO", "สถานะการรับสินค้า", "ซัพพลายเออร์", "ทะเบียน", "เบอร์รถ", "ลำดับ", "กลุ่มสินค้า"])
assert.equal(itemRows[0]["ชื่อสินค้า"], "ผ้าเบรกหลัง HINO 500")
assert.equal(itemRows[0]["ราคาต่อหน่วย"], 3800)
assert.equal(itemRows[0]["ค้างรับ"], 1)
assert.equal(itemRows[1]["เลขที่ PO"], "KKPO26100002")
assert.equal(itemRows[1]["ชื่อสินค้า"], "ยังไม่มีรายการในระบบ")
assert.deepEqual(Object.keys(itemRows[1]), Object.keys(itemRows[0]))

// ── ชื่อไฟล์ + รายการรหัสที่ส่งมา ─────────────────────────────────
assert.equal(poExportFileName("2026-10-01", "2026-10-30", "po"), "PO_วันที่PO_2026-10-01_ถึง_2026-10-30.xlsx")
assert.equal(poExportFileName("2026-10-01", "2026-10-30", "due"), "PO_กำหนดส่ง_2026-10-01_ถึง_2026-10-30.xlsx")
assert.deepEqual(poParseCodes(" LBPO1, LBPO2,,LBPO1 ,"), ["LBPO1", "LBPO2"])
assert.deepEqual(poParseCodes(null), [])
assert.equal(poParseCodes(Array.from({ length: PO_ITEMS_CHUNK + 5 }, (_, i) => `P${i}`).join(",")), null) // เกิน = ปฏิเสธ

console.log("check-po-export: ok")
