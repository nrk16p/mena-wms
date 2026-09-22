// scripts/check-ap-doc-template.ts
// รัน: npx tsx scripts/check-ap-doc-template.ts  (repo ไม่มี test framework — ใช้ assert แทน)
import assert from "node:assert/strict"
import {
  AP_TEMPLATE_DOCS, cleanTemplateDocs, templateRequiredChecks, templateMissing, templateDocsForCheck,
  normVendorCode, templateDocsFromExcelRow, creditTermText, billingInfoGaps, templateDocLabel,
} from "../lib/ap-doc-template"
import { AP_DOC_FIELDS, isDocSetComplete, type ApDocs } from "../lib/ap-tracking"

const on = { checked: true, by: "t", at: "2026-09-22T00:00:00.000Z" }
const off = { checked: false, by: "t", at: "2026-09-22T00:00:00.000Z" }

// --- ทุกชนิดในแม่แบบชี้ไปที่ช่องติ๊กที่มีอยู่จริง ---
const checkKeys = new Set(AP_DOC_FIELDS.map((f) => f.key))
for (const d of AP_TEMPLATE_DOCS) assert.ok(checkKeys.has(d.check), `${d.key} → ${d.check} ต้องเป็นช่องติ๊กจริง`)
// ทุกช่องติ๊กมีชนิดในแม่แบบอย่างน้อย 1 (ไม่งั้นแม่แบบบังคับช่องนั้นไม่ได้เลย)
for (const f of AP_DOC_FIELDS) assert.ok(AP_TEMPLATE_DOCS.some((d) => d.check === f.key), `ช่อง ${f.key} ต้องมีชนิดในแม่แบบ`)

// --- cleanTemplateDocs: ทิ้งคีย์แปลก ตัดซ้ำ เรียงตามแม่แบบ ---
assert.deepEqual(cleanTemplateDocs(["taxInvoice", "billingNote", "taxInvoice", "dd", 5, null]), ["billingNote", "taxInvoice"])
assert.deepEqual(cleanTemplateDocs("billingNote"), [])
assert.deepEqual(cleanTemplateDocs(undefined), [])

// --- templateRequiredChecks: ใบวางบิล + ใบแจ้งหนี้ = ช่องเดียว · เรียงตาม AP_DOC_FIELDS ---
assert.deepEqual(templateRequiredChecks(["billingNote", "receipt", "taxInvoice", "invoice"]), ["invoice", "taxInvoice", "receipt"])
assert.deepEqual(templateRequiredChecks(["cashBill"]), ["bill"])
assert.deepEqual(templateRequiredChecks(["cashBill", "deliveryNote"]), ["bill"])
assert.deepEqual(templateRequiredChecks([]), [])
assert.deepEqual(templateRequiredChecks(undefined), [])

// --- templateMissing: ใช้ป้ายของช่องติ๊ก ---
const pongchom = cleanTemplateDocs(["billingNote", "receipt", "taxInvoice"])     // VEN-00008 ในไฟล์ = 11100011
assert.deepEqual(templateMissing(pongchom, {}), ["ใบแจ้งหนี้/ใบวางบิล", "ต้นฉบับใบกำกับภาษี", "ใบเสร็จรับเงิน"])
assert.deepEqual(templateMissing(pongchom, { invoice: on, taxInvoice: on } as ApDocs), ["ใบเสร็จรับเงิน"])
assert.deepEqual(templateMissing(pongchom, { invoice: on, taxInvoice: on, receipt: off } as ApDocs), ["ใบเสร็จรับเงิน"],
  "ติ๊กแล้วเอาออก (checked=false) ต้องนับว่าขาด")
// ใบเก่าที่ติ๊กไว้ที่คีย์ billingNote (ก่อนรวมช่อง) ต้องนับว่ามีใบแจ้งหนี้/ใบวางบิลแล้ว
assert.deepEqual(templateMissing(pongchom, { billingNote: on, taxInvoice: on, receipt: on } as ApDocs), [])
assert.deepEqual(templateMissing([], {}), [], "ไม่มีแม่แบบ = ไม่ขาดอะไร")

// --- แม่แบบเป็นตัวช่วยบอก: กติกาครบชุดเดิมไม่เปลี่ยน ---
const partial = { taxInvoice: on } as ApDocs
assert.equal(isDocSetComplete(partial), true, "มีเอกสาร ≥1 ยังครบชุดเหมือนเดิม")
assert.ok(templateMissing(pongchom, partial).length > 0, "แต่แม่แบบยังบอกว่าขาด")

// --- templateDocsForCheck: ช่องรวมบอกได้ว่าผู้ขายส่งชนิดไหน ---
assert.deepEqual(templateDocsForCheck(["billingNote", "invoice"], "invoice"), ["ใบวางบิล", "ใบแจ้งหนี้"])
assert.deepEqual(templateDocsForCheck(["cashBill"], "bill"), ["บิลเงินสด"])
assert.deepEqual(templateDocsForCheck(["debtAck"], "debtAck"), ["ใบรับสภาพหนี้"], "ชนิดที่ไม่มีใน Excel ใช้ label")
assert.deepEqual(templateDocsForCheck(["cashBill"], "invoice"), [])

// --- normVendorCode ---
assert.equal(normVendorCode("VEN-00008"), "VEN-00008")
assert.equal(normVendorCode(6), "6")
assert.equal(normVendorCode(6.0), "6")
assert.equal(normVendorCode("27.0"), "27")
assert.equal(normVendorCode("  142 "), "142")
assert.equal(normVendorCode(null), "")

// --- templateDocsFromExcelRow: เฉพาะ ☑ · ข้ามใบรับสินค้า/ใบสั่งซื้อ ---
const hdr = ["ใบวางบิล", "ใบเสร็จรับเงิน", "ใบกำกับภาษี", "ใบแจ้งหนี้", "บิลเงินสด", "ใบส่งของ", "ใบรับสินค้า", "ใบสั่งซื้อ"]
const rowOf = (bits: string) => Object.fromEntries(hdr.map((h, i) => [h, bits[i] === "1" ? "☑" : bits[i] === "?" ? null : "☐"]))
assert.deepEqual(templateDocsFromExcelRow(rowOf("11100011")), ["billingNote", "receipt", "taxInvoice"])
assert.deepEqual(templateDocsFromExcelRow(rowOf("11110111")), ["billingNote", "receipt", "taxInvoice", "invoice", "deliveryNote"])
assert.deepEqual(templateDocsFromExcelRow(rowOf("00001011")), ["cashBill"])
assert.deepEqual(templateDocsFromExcelRow(rowOf("00000011")), [], "ติ๊กแค่ใบรับสินค้า/ใบสั่งซื้อ = ไม่มีแม่แบบ")
assert.deepEqual(templateDocsFromExcelRow(rowOf("01?00011")), ["receipt"], "ช่องว่างในไฟล์ = ไม่ติ๊ก")
assert.deepEqual(templateDocsFromExcelRow(rowOf("????????")), [])

// --- creditTermText ---
assert.equal(creditTermText("30D"), "เครดิต 30 วัน")
assert.equal(creditTermText("7D"), "เครดิต 7 วัน")
assert.equal(creditTermText("Immediate"), "ชำระทันที (ไม่มีเครดิต)")
assert.equal(creditTermText(""), "")
assert.equal(creditTermText("อะไรก็ได้"), "")
assert.equal(creditTermText(undefined), "")

// --- billingInfoGaps ---
assert.deepEqual(billingInfoGaps({ sendTo: "", contact: "" }), ["ที่ส่งเอกสาร", "ผู้ติดต่อ"])
assert.deepEqual(billingInfoGaps({ sendTo: "x", contact: " " }), ["ผู้ติดต่อ"])

assert.equal(templateDocLabel("taxInvoice"), "ใบกำกับภาษี (ต้นฉบับ)")

console.log("check-ap-doc-template: all assertions passed")
