// scripts/check-price-compare-pdf.ts — รัน: npx tsx scripts/check-price-compare-pdf.ts
import assert from "node:assert/strict"
import fs from "node:fs"
import { newDoc, emptySupplier, type PriceCompare, type PcSupplier } from "../lib/price-compare"
import { buildPriceCompareDocDef, pdfFilename } from "../lib/price-compare-pdf"
import { renderPdfmake } from "../lib/pdfmake-printer"

function uh03(): PriceCompare {
  const d = newDoc({ name: "นพรัตน์ อายยืน", email: "n@mena.co.th" }) as PriceCompare
  d.docNo = "PC-2609-002"; d.createdAt = "2026-09-07T09:00:00.000+07:00"; d.updatedAt = "2026-09-07T15:30:00.000+07:00"
  d.title = "Pump + Motor UH03"; d.requestDept = "ยานยนต์"; d.revision = 0; d.selectedSupplier = 1
  d.items = [
    { name: "Pump Rexroth", qty: 1, unit: "ตัว" }, { name: "Motor Rexroth", qty: 1, unit: "ตัว" },
    { name: "น้ำมัน HYD.", qty: 18, unit: "ลิตร" }, { name: "น้ำมันเกียร์", qty: 10, unit: "ลิตร" },
    { name: "ค่าแรงซ่อม+ประกอบทดสอบ", qty: 1, unit: "งาน" },
  ]
  const s = (name: string, note: string, prices: number[]): PcSupplier => ({ ...emptySupplier(5), name, note, prices })
  d.suppliers = [
    s("ช่างหมู", "ราคานี้เป็นราคาซ่อม Pump + Motor ของเดิมติดรถ", [21000, 18900, 110.56, 180, 7000]),
    s("คุณณัฐ", "ราคานี้เป็นราคาเปลี่ยน Pump + Motor ใหม่ มือ 1", [30000, 18000, 100, 100, 5500]),
    s("ศศ&ณ", "ราคานี้เป็นราคาเปลี่ยน Pump + Motor ใหม่ มือ 2", [30000, 25000, 107.14, 107.14, 5000]),
  ]
  d.suppliers[0].conditions.statusA = "2"
  d.suppliers[1].vatMode = "incl"; d.suppliers[1].quoteDate = "2026-09-03"; d.suppliers[1].validUntil = "2026-10-03"
  d.selectionReason = ""; d.fewerQuotesReason = ""
  d.committee = d.committee.map((m, i) => ({ ...m, name: ["คุณเสถียรพงษ์ ชะเอมจันทร์", "บุญภัก พรหมมา", "", "คุณนัชภัค ขจรวุฒิเดช"][i], pickedSupplier: i === 2 ? null : 1, reason: i === 2 ? "" : "ราคาถูกสุด", signedDate: i === 2 ? "" : "2026-09-07" }))
  return d
}

// wrapped in an async IIFE: this repo's tsx runs scripts as CJS, which rejects top-level await
async function main() {
  assert.equal(pdfFilename(uh03()), "PC-2609-002 Pump + Motor UH03.pdf")
  assert.equal(pdfFilename({ ...uh03(), title: "a/b:c*d?" }), "PC-2609-002 a-b-c-d-.pdf", "อักขระต้องห้ามในชื่อไฟล์ถูกแทนด้วย -")

  const dd = buildPriceCompareDocDef(uh03())
  assert.equal(dd.pageOrientation, "landscape")
  assert.equal(dd.defaultStyle.font, "Sarabun")
  const flat = JSON.stringify(dd)
  assert.ok(flat.includes("PC-2609-002"))
  assert.ok(flat.includes("54,238.39"), "สุทธิ supplier 1")
  assert.ok(flat.includes("(รวมในราคา)"), "supplier 2 เป็นราคารวม VAT")
  assert.ok(flat.includes("56,300.00"), "สุทธิ supplier 2 (incl) = หลังส่วนลด")
  assert.ok(flat.includes("3/9/2569"), "วันที่ใบเสนอราคา")
  { const r = buildPriceCompareDocDef({ ...uh03(), selectionReason: "ของใหม่ มือ 1" }); assert.ok(JSON.stringify(r).includes("เหตุผลที่เลือก")) }
  assert.ok(flat.includes("Supplier 4"), "ต้องพิมพ์ 4 คอลัมน์เสมอแม้มี 3 ราย")
  assert.ok(flat.includes("ผู้ได้รับเลือก"))

  // หน้ารูปแนบ
  const png1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
  const dd2 = buildPriceCompareDocDef(uh03(), [{ heading: "หลักฐาน: ใบเสนอราคา Supplier 1 — ช่างหมู", pngBase64: png1x1 }])
  assert.ok(JSON.stringify(dd2).includes("data:image/png;base64,"))
  assert.ok(JSON.stringify(dd2).includes('"pageBreak":"before"'))

  const pdf = await renderPdfmake(dd2)
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-")
  fs.mkdirSync("tmp", { recursive: true })
  fs.writeFileSync("tmp/price-compare-uh03.pdf", pdf)
  console.log("check-price-compare-pdf: OK → tmp/price-compare-uh03.pdf (เปิดเทียบกับต้นแบบหน้า 1)")
}

main()
