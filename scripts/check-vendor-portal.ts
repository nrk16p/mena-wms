// scripts/check-vendor-portal.ts — รัน: npx tsx scripts/check-vendor-portal.ts
// กติกาพอร์ทัลเจ้าหนี้: สถานะ 3 แบบ · ช่วงเวลา · whitelist · รายการสินค้า · รหัสผ่าน/session · สิทธิ์ดูใบ
import assert from "node:assert/strict"
import {
  vpStatusOf, vpWindowStart, vpLookbackStart, vpMonths, vpVisible,
  isSaraburiWarehouse, isCashVendor, normVpUsername, vpBillOf, vpNextTransfer, vpItemsOf,
  VP_BILL_KEYS, VP_STATUS_LABEL, vpCanSeeHead, vpAmbiguousNames, vpAccountRows, vpLineMessage,
  vpFilterBills, vpThaiDate, vpMonthLabel, vpDueText, vpBillMonths, vpPortalNames,
  vpBillSheetRows, vpItemSheetRows, vpExportFileName, vpParseCodes, VP_EXPORT_MAX,
} from "../lib/vendor-portal"

// ── สถานะ: จ่ายแล้วชนะทุกอย่าง (ฝั่งภายใน "ไม่ผ่าน" ชนะ — ฝั่งเจ้าหนี้กลับกัน)
assert.equal(vpStatusOf({ review: { status: "ไม่ผ่าน" }, paid: { date: "2026-10-01" } }), "paid")
assert.equal(vpStatusOf({ paid: { paymentNos: ["PV001"] } }), "paid")
assert.equal(vpStatusOf({ review: { status: "ผ่าน" }, pay: { payDate: "2026-10-29" } }), "scheduled")
assert.equal(vpStatusOf({ review: { status: "ไม่ผ่าน" } }), "processing")
assert.equal(vpStatusOf({ review: { status: "" } }), "processing")
assert.equal(vpStatusOf(null), "processing")
assert.equal(vpStatusOf(undefined), "processing")
assert.deepEqual(Object.keys(VP_STATUS_LABEL).sort(), ["paid", "processing", "scheduled"])

// ── ช่วงเวลา: ต้นเดือน (เดือนนี้ − 5) · ย้อนดูใบค้าง = max(go-live, ต้นเดือน (เดือนนี้ − 12))
assert.equal(vpWindowStart("2026-10-27"), "2026-05-01")
assert.equal(vpWindowStart("2027-01-10"), "2026-08-01")
assert.equal(vpLookbackStart("2026-10-27"), "2026-01-01")
assert.equal(vpLookbackStart("2027-06-01"), "2026-06-01")
assert.deepEqual(vpMonths("2026-11-15", "2027-02-01"), ["2026-11", "2026-12", "2027-01", "2027-02"])
assert.deepEqual(vpMonths("2026-10-01", "2026-10-27"), ["2026-10"])
// ใบเก่ากว่าช่วง: โชว์เฉพาะที่ยังไม่โอน
assert.equal(vpVisible("2026-04-30", "paid", "2026-10-27"), false)
assert.equal(vpVisible("2026-04-30", "scheduled", "2026-10-27"), true)
assert.equal(vpVisible("2026-04-30", "processing", "2026-10-27"), false)  // ใบเก่าค้างขั้นภายใน = ข้อมูลยุค Excel ไม่โชว์
assert.equal(vpVisible("2026-05-01", "paid", "2026-10-27"), true)
assert.equal(vpVisible("2025-12-31", "processing", "2026-10-27"), false)   // ก่อน go-live
assert.equal(vpVisible("", "processing", "2026-10-27"), false)             // แปลงวันไม่ได้ = ไม่โชว์

// ── คลังสระบุรีซ่อน (DIST ไม่ซ่อน) · เงินสดไม่ได้บัญชี
assert.equal(isSaraburiWarehouse("คลังสระบุรี"), true)
assert.equal(isSaraburiWarehouse("สระบุรี DIST"), false)
assert.equal(isSaraburiWarehouse("ลาดกระบัง"), false)
assert.equal(isCashVendor("เงินสด (ไม่มีVAT)"), true)
assert.equal(isCashVendor(" เงินสด"), true)
assert.equal(isCashVendor("หจก. สมชัยการช่าง"), false)

// ── username = รหัสผู้ขาย ตัดช่องว่าง ตัวใหญ่ · เลขจาก Excel แบบ 6.0 → 6
assert.equal(normVpUsername(" ven-00008 "), "VEN-00008")
assert.equal(normVpUsername(6), "6")
assert.equal(normVpUsername("6.0"), "6")
assert.equal(normVpUsername(null), "")

// ── whitelist: ของภายในหลุดไม่ได้
const bill = vpBillOf({
  depositCode: "LBDD26100131", receivedAt: "2026-10-08", supplierRefNo: "INV-1", vehicle: "71-5742", fleetNo: "ME042",
  amount: 13096.8, status: "scheduled", payDate: "2026-10-29", paidDate: "",
  // ข้างล่างนี้ต้องไม่หลุด
  ...({ note: "ภายใน", review: { status: "ผ่าน", note: "x" }, sentDate: "2026-10-20", supplier: "ร้าน", warehouse: "ลาดกระบัง", paymentNos: ["PV1"] } as object),
} as Parameters<typeof vpBillOf>[0])
for (const k of Object.keys(bill)) assert.ok((VP_BILL_KEYS as readonly string[]).includes(k), `key หลุด: ${k}`)
assert.equal(bill.payDate, "2026-10-29")
assert.equal("paidDate" in bill, false)                   // ค่าว่างไม่แบกคีย์
const bare = vpBillOf({ depositCode: "X", receivedAt: "2026-10-01", amount: 1, status: "processing", payDate: "2026-10-29" })
assert.equal("payDate" in bare, false)                    // กำลังดำเนินการไม่บอกวันโอน
assert.deepEqual(Object.keys(bare).sort(), ["amount", "depositCode", "receivedAt", "status"])

// ── รอบโอนถัดไป: วันที่น้อยสุดที่ ≥ วันนี้ ของใบรอโอน
const bills = [
  vpBillOf({ depositCode: "A", receivedAt: "2026-10-01", amount: 100, status: "scheduled", payDate: "2026-10-29" }),
  vpBillOf({ depositCode: "B", receivedAt: "2026-10-02", amount: 50.5, status: "scheduled", payDate: "2026-10-29" }),
  vpBillOf({ depositCode: "C", receivedAt: "2026-10-03", amount: 70, status: "scheduled", payDate: "2026-11-05" }),
  vpBillOf({ depositCode: "D", receivedAt: "2026-10-04", amount: 999, status: "scheduled", payDate: "2026-10-22" }), // เลยมาแล้ว
  vpBillOf({ depositCode: "E", receivedAt: "2026-10-05", amount: 999, status: "paid", paidDate: "2026-10-29" }),
]
assert.deepEqual(vpNextTransfer(bills, "2026-10-27"), { date: "2026-10-29", count: 2, amount: 150.5 })
assert.equal(vpNextTransfer([bills[4]], "2026-10-27"), null)

// ── รายการสินค้า: "รหัส : ชื่อ" · ตัวเลขมีจุลภาค
assert.deepEqual(
  vpItemsOf([{ item: "S16CSE0021 : ผ้าเบรก : หลัง", qty: "2", unit_price: "3,800.00", total: "7,600.00" }]),
  [{ code: "S16CSE0021", name: "ผ้าเบรก : หลัง", qty: "2", unitPrice: 3800, total: 7600 }],
)
assert.deepEqual(vpItemsOf([{ item: "ค่าขนส่ง", qty: "", unit_price: "", total: "500" }]),
  [{ code: "", name: "ค่าขนส่ง", qty: "", unitPrice: 0, total: 500 }])

// ── ใครดูใบไหนได้ (ด่าน 404 ของรายการสินค้า) ─────────────────────────────────
const mine = ["หจก. สมชัยการช่าง", "สมชัยการช่าง"]
const head = (o: Partial<{ supplier: string; warehouse: string; receivedAt: string }>) =>
  ({ supplier: "สมชัยการช่าง", warehouse: "ลาดกระบัง", receivedAt: "2026-10-08", ...o })
assert.equal(vpCanSeeHead(head({}), mine, "processing", "2026-10-27"), true)
assert.equal(vpCanSeeHead(head({ supplier: "ร้านอื่น" }), mine, "processing", "2026-10-27"), false)
assert.equal(vpCanSeeHead(head({ supplier: "" }), mine, "processing", "2026-10-27"), false)
assert.equal(vpCanSeeHead(head({ warehouse: "คลังสระบุรี" }), mine, "processing", "2026-10-27"), false)
assert.equal(vpCanSeeHead(head({ receivedAt: "2026-03-01" }), mine, "paid", "2026-10-27"), false)
assert.equal(vpCanSeeHead(head({ receivedAt: "2026-03-01" }), mine, "scheduled", "2026-10-27"), true)
assert.equal(vpCanSeeHead(head({}), [], "processing", "2026-10-27"), false)

// ── ชื่อเดียวหลายรหัสใน ATMS = ไม่ขึ้นให้ใครเห็น
assert.deepEqual([...vpAmbiguousNames([
  { name: "ร้าน ก", code: "VEN-1" }, { name: "ร้าน ก", code: "VEN-2" },
  { name: "ร้าน ข", code: "VEN-3" }, { name: "ร้าน ข", code: "VEN-3" },
  { name: " ร้าน ค ", code: "VEN-4" }, { name: "ร้าน ค", code: "VEN-5" },
])].sort(), ["ร้าน ก", "ร้าน ค"])

// ── รายชื่อสำหรับหน้าจัดการบัญชี: รวมตามรหัสผู้ขาย
const rows = vpAccountRows(
  [
    { name: "หจก. สมชัยการช่าง", atmsCode: "6", lastDdAt: "2026-10-20" },
    { name: "สมชัยการช่าง", atmsCode: 6, lastDdAt: "2026-09-01" },
    { name: "เงินสด (ไม่มีVAT)", atmsCode: "VEN-00001", lastDdAt: "2026-10-26" },
    { name: "ร้านไม่มีรหัส", atmsCode: "", lastDdAt: "2026-10-01" },
    { name: "ร้านซ้ำ", atmsCode: "VEN-00009", lastDdAt: "2026-10-01" },
    { name: "ร้านซ้ำ 2", atmsCode: "VEN-00010", lastDdAt: "2026-10-01" },
    { name: "ร้านซ้ำ 3", atmsCode: "VEN-00010", lastDdAt: "2026-03-01" },
    { name: "ร้านเก่า", atmsCode: "VEN-00020", lastDdAt: "2026-02-01" },
  ],
  new Set(["ร้านซ้ำ", "ร้านซ้ำ 2"]),
  [{ username: "VEN-00020", disabled: true, loginCount: 3, lastLoginAt: "2026-10-01T03:00:00.000Z", passwordSetAt: "2026-09-01T00:00:00.000Z" }],
  "2026-05-01",
)
const by = (u: string) => rows.find((r) => r.username === u)!
assert.deepEqual(by("6").names, ["หจก. สมชัยการช่าง", "สมชัยการช่าง"])
assert.equal(by("6").displayName, "หจก. สมชัยการช่าง")   // ชื่อที่มีใบล่าสุด
assert.equal(by("6").lastDdAt, "2026-10-20")
assert.equal(by("6").eligible, true)
assert.equal(by("6").recent, true)
assert.equal(by("6").account, undefined)
assert.equal(by("VEN-00001").eligible, false)
assert.equal(by("VEN-00001").reason, "เงินสด")
assert.equal(by("VEN-00009").eligible, false)
assert.equal(by("VEN-00009").reason, "ชื่อซ้ำใน ATMS")
assert.deepEqual(by("VEN-00010").names, ["ร้านซ้ำ 3"])          // ชื่อซ้ำถูกตัด เหลือชื่อที่ใช้ได้
assert.deepEqual(by("VEN-00010").hiddenNames, ["ร้านซ้ำ 2"])
assert.equal(by("VEN-00010").eligible, true)
assert.equal(by("VEN-00020").recent, false)
assert.deepEqual(by("VEN-00020").account, { disabled: true, loginCount: 3, lastLoginAt: "2026-10-01T03:00:00.000Z", passwordSetAt: "2026-09-01T00:00:00.000Z" })
const noCode = rows.find((r) => r.allNames.includes("ร้านไม่มีรหัส"))!
assert.equal(noCode.username, "")
assert.equal(noCode.eligible, false)
assert.equal(noCode.reason, "ไม่มีรหัสผู้ขาย")

// ── ข้อความส่งไลน์
assert.equal(
  vpLineMessage({ username: "VEN-00008", password: "Kp7xR2mQa9" }, "https://mena-wms.vercel.app"),
  "ลิงก์ดูสถานะบิลกับวันโอนเงินของร้านครับ\nhttps://mena-wms.vercel.app/vendor-portal\nชื่อผู้ใช้ VEN-00008\nรหัสผ่าน Kp7xR2mQa9",
)

// ── หน้าเจ้าหนี้: กรอง/ค้นหา/เรียง ───────────────────────────────────────────
const L = [
  vpBillOf({ depositCode: "LBDD26100412", receivedAt: "2026-10-21", vehicle: "71-5742", fleetNo: "ME042", amount: 12840, status: "processing" }),
  vpBillOf({ depositCode: "LBDD26100288", receivedAt: "2026-10-15", vehicle: "72-0398", fleetNo: "ME117", amount: 9450, status: "processing" }),
  vpBillOf({ depositCode: "LBDD26100131", receivedAt: "2026-10-08", vehicle: "71-5742", fleetNo: "ME042", amount: 13096.8, status: "scheduled", payDate: "2026-10-29" }),
  vpBillOf({ depositCode: "LBDD26090655", receivedAt: "2026-09-24", supplierRefNo: "INV-6609-212", amount: 7980, status: "paid", paidDate: "2026-10-22" }),
  vpBillOf({ depositCode: "LBDD26090001", receivedAt: "2026-09-01", amount: 100, status: "scheduled", payDate: "2026-11-05" }),
]
const codesOf = (xs: { depositCode: string }[]) => xs.map((x) => x.depositCode)
assert.deepEqual(codesOf(vpFilterBills(L, {})), codesOf(L))                                   // ค่าตั้งต้น = รับของล่าสุดก่อน
assert.deepEqual(codesOf(vpFilterBills(L, { q: "me042" })), ["LBDD26100412", "LBDD26100131"])  // เบอร์รถ ตัวเล็กก็เจอ
assert.deepEqual(codesOf(vpFilterBills(L, { q: "715742" })), ["LBDD26100412", "LBDD26100131"]) // ทะเบียนไม่ใส่ขีดก็เจอ
assert.deepEqual(codesOf(vpFilterBills(L, { q: "71-5742" })), ["LBDD26100412", "LBDD26100131"])
assert.deepEqual(codesOf(vpFilterBills(L, { q: "inv-6609" })), ["LBDD26090655"])              // เลขใบแจ้งหนี้ร้าน
assert.deepEqual(codesOf(vpFilterBills(L, { q: "0288" })), ["LBDD26100288"])
assert.deepEqual(codesOf(vpFilterBills(L, { statuses: ["scheduled", "paid"] })), ["LBDD26100131", "LBDD26090655", "LBDD26090001"])
assert.deepEqual(codesOf(vpFilterBills(L, { months: ["2026-09"] })), ["LBDD26090655", "LBDD26090001"])
assert.deepEqual(codesOf(vpFilterBills(L, { from: "2026-09-24", to: "2026-10-08" })), ["LBDD26100131", "LBDD26090655"])
assert.deepEqual(codesOf(vpFilterBills(L, { sort: "amount" })), ["LBDD26100131", "LBDD26100412", "LBDD26100288", "LBDD26090655", "LBDD26090001"])
// กำหนดโอนใกล้สุด: ใบรอโอนเรียงวันโอน แล้วตามด้วยใบอื่นตามวันรับของล่าสุด
assert.deepEqual(codesOf(vpFilterBills(L, { sort: "payDate" })), ["LBDD26100131", "LBDD26090001", "LBDD26100412", "LBDD26100288", "LBDD26090655"])
assert.deepEqual(vpBillMonths(L), ["2026-09", "2026-10"])

// ── วันที่ไทย
assert.equal(vpThaiDate("2026-10-29"), "29 ต.ค. 69")
assert.equal(vpThaiDate("2027-01-05"), "5 ม.ค. 70")
assert.equal(vpThaiDate(""), "")
assert.equal(vpMonthLabel("2026-10"), "ต.ค. 69")
assert.equal(vpMonthLabel("2026-05", true), "พฤษภาคม 2569")

// ── ข้อความวันที่ใต้สถานะ
assert.equal(vpDueText(L[2], "2026-10-27"), "กำหนดโอน 29 ต.ค. 69")
assert.equal(vpDueText(L[2], "2026-10-30"), "ครบกำหนดโอน 29 ต.ค. 69 · รอยืนยันยอดโอน")
assert.equal(vpDueText(L[3], "2026-10-27"), "โอน 22 ต.ค. 69")
assert.equal(vpDueText(L[0], "2026-10-27"), "")
assert.equal(vpDueText(vpBillOf({ depositCode: "Z", receivedAt: "2026-10-01", amount: 1, status: "scheduled" }), "2026-10-27"), "")

// ── ชื่อที่ใช้ดึงใบจริงทุก request: ตัดถังเงินสด + ชื่อซ้ำใน ATMS (รีวิว: รหัสเดียวมีชื่อเงินสดปน = เห็นบิลร้านอื่น)
assert.deepEqual(vpPortalNames(["หจก. สมชัยการช่าง", "เงินสด (ไม่มีVAT)", "ร้านซ้ำ"], new Set(["ร้านซ้ำ"])), ["หจก. สมชัยการช่าง"])
assert.deepEqual(vpPortalNames(["เงินสด"], new Set()), [])

// ── Excel: ชีตบิล + ชีตรายการสินค้า ───────────────────────────────────────────
const sheet1 = vpBillSheetRows([L[2], L[3], L[0]])
assert.deepEqual(Object.keys(sheet1[0]), ["เลข DD", "วันที่รับของ", "เลขใบแจ้งหนี้ร้าน", "เบอร์รถ", "ทะเบียน", "ยอดเงิน", "สถานะ", "กำหนดโอน", "วันที่โอน"])
assert.deepEqual(sheet1[0], { "เลข DD": "LBDD26100131", "วันที่รับของ": "2026-10-08", "เลขใบแจ้งหนี้ร้าน": "", "เบอร์รถ": "ME042", "ทะเบียน": "71-5742", "ยอดเงิน": 13096.8, "สถานะ": "รอโอน", "กำหนดโอน": "2026-10-29", "วันที่โอน": "" })
assert.equal(sheet1[1]["วันที่โอน"], "2026-10-22")
assert.equal(sheet1[1]["เลขใบแจ้งหนี้ร้าน"], "INV-6609-212")
assert.equal(sheet1[2]["สถานะ"], "กำลังดำเนินการ")
assert.equal(sheet1[2]["กำหนดโอน"], "")

const sheet2 = vpItemSheetRows([
  { depositCode: "LBDD26100131", receivedAt: "2026-10-08", items: [
    { code: "BR-1", name: "ผ้าเบรก", qty: "2", unitPrice: 3800, total: 7600 },
    { code: "LB-1", name: "ค่าแรง", qty: "1 งาน", unitPrice: 3500, total: 3500 },
  ] },
  { depositCode: "LBDD26100288", receivedAt: "2026-10-15", items: null },
])
assert.deepEqual(Object.keys(sheet2[0]), ["เลข DD", "วันที่รับของ", "รหัสสินค้า", "ชื่อสินค้า", "จำนวน", "ราคาต่อหน่วย", "ยอดรวม"])
assert.equal(sheet2.length, 3)
assert.equal(sheet2[0]["จำนวน"], 2)                 // ตัวเลขล้วน → number (Excel บวกได้)
assert.equal(sheet2[1]["จำนวน"], "1 งาน")           // มีหน่วยปน → คงเป็นข้อความ
assert.equal(sheet2[2]["เลข DD"], "LBDD26100288")
assert.equal(sheet2[2]["ชื่อสินค้า"], "รายการสินค้ากำลังอัปเดต ลองดาวน์โหลดใหม่ภายหลัง")
assert.equal(sheet2[2]["ยอดรวม"], "")

assert.equal(vpExportFileName("VEN-00008", "2026-10-27"), "บิล-VEN-00008-2026-10-27.xlsx")
assert.equal(vpExportFileName("A/B\\C", "2026-10-27"), "บิล-A-B-C-2026-10-27.xlsx")

// ── รับเลข DD จาก body: ตัวใหญ่ · ตัดซ้ำ/ค่าว่าง/ไม่ใช่ string · เกินเพดาน = null
assert.deepEqual(vpParseCodes({ codes: [" lbdd1 ", "LBDD1", "", 5, null, "LBDD2"] }), ["LBDD1", "LBDD2"])
assert.deepEqual(vpParseCodes({ codes: "LBDD1" }), [])
assert.deepEqual(vpParseCodes({ codes: [{ $gt: "" }] }), [])
assert.deepEqual(vpParseCodes(null), [])
assert.equal(vpParseCodes({ codes: Array.from({ length: VP_EXPORT_MAX + 1 }, (_, i) => `D${i}`) }), null)

console.log("check-vendor-portal: rules ok")

// ── รหัสผ่าน + session ───────────────────────────────────────────────────────
async function checkAuth() {
  const auth = await import("../lib/vendor-portal-auth")
  const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
  const pws = Array.from({ length: 50 }, () => auth.genVpPassword())
  for (const pw of pws) {
    assert.equal(pw.length, 10)
    for (const ch of pw) assert.ok(ALPHA.includes(ch), `ตัวอักษรสับสน: ${ch}`)
  }
  assert.ok(new Set(pws).size > 45, "รหัสสุ่มซ้ำกันเยอะผิดปกติ")

  const stored = await auth.hashVpPassword("Kp7xR2mQa9")
  assert.match(stored, /^scrypt\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
  assert.ok(!stored.includes("Kp7xR2mQa9"))
  assert.equal(await auth.verifyVpPassword("Kp7xR2mQa9", stored), true)
  assert.equal(await auth.verifyVpPassword("Kp7xR2mQa8", stored), false)
  assert.equal(await auth.verifyVpPassword("Kp7xR2mQa9", "plain"), false)
  assert.equal(await auth.verifyVpPassword("Kp7xR2mQa9", ""), false)
  assert.notEqual(await auth.hashVpPassword("Kp7xR2mQa9"), stored)   // salt ต่างทุกครั้ง

  process.env.NEXTAUTH_SECRET = "test-secret-a"
  const tok = await auth.signVpSession({ sub: "VEN-00008", tv: 3 })
  assert.deepEqual(await auth.readVpSession(tok), { sub: "VEN-00008", tv: 3 })
  assert.equal(await auth.readVpSession(undefined), null)
  assert.equal(await auth.readVpSession("abc.def.ghi"), null)
  const [h, p, sig] = tok.split(".")
  const forged = Buffer.from(JSON.stringify({ sub: "VEN-00009", tv: 3, exp: 9999999999 })).toString("base64url")
  assert.equal(await auth.readVpSession(`${h}.${forged}.${sig}`), null)     // แก้ payload แล้วลายเซ็นไม่ตรง
  assert.equal(await auth.readVpSession(`${h}.${p}.`), null)
  process.env.NEXTAUTH_SECRET = "test-secret-b"
  assert.equal(await auth.readVpSession(tok), null)                         // คนละกุญแจ
  process.env.NEXTAUTH_SECRET = "test-secret-a"

  assert.equal(auth.vpSessionValid({ tokenVersion: 3 }, { tv: 3 }), true)
  assert.equal(auth.vpSessionValid({ tokenVersion: 4 }, { tv: 3 }), false)   // รีเซ็ตรหัสแล้ว session เก่าหลุด
  assert.equal(auth.vpSessionValid({ tokenVersion: 3, disabled: true }, { tv: 3 }), false)
  assert.equal(auth.vpSessionValid(null, { tv: 3 }), false)
  assert.equal(auth.vpSessionValid({ tokenVersion: 3 }, null), false)
  assert.equal(auth.VP_COOKIE, "vp_session")
  assert.equal(auth.VP_MAX_FAILS, 5)
  assert.equal(auth.VP_LOCK_MINUTES, 15)

  // ── ผิด 5 ครั้งล็อก 15 นาที · พ้นเวลาล็อกแล้วนับใหม่
  const now = "2026-10-27T10:00:00.000Z"
  assert.equal(auth.vpIsLocked({ lockedUntil: "2026-10-27T10:05:00.000Z" }, now), true)
  assert.equal(auth.vpIsLocked({ lockedUntil: "2026-10-27T09:59:59.000Z" }, now), false)
  assert.equal(auth.vpIsLocked({}, now), false)
  assert.deepEqual(auth.vpFailUpdate({ failedCount: 1 }, now), { failedCount: 2, lockedUntil: null })
  assert.deepEqual(auth.vpFailUpdate({ failedCount: 4 }, now), { failedCount: 5, lockedUntil: "2026-10-27T10:15:00.000Z" })
  assert.deepEqual(auth.vpFailUpdate({ failedCount: 5, lockedUntil: "2026-10-27T09:00:00.000Z" }, now), { failedCount: 1, lockedUntil: null })
  assert.deepEqual(auth.vpFailUpdate({}, now), { failedCount: 1, lockedUntil: null })

  console.log("check-vendor-portal: auth ok")
}

checkAuth().catch((e) => { console.error(e); process.exit(1) })
