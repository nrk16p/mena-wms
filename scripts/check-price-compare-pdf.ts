// scripts/check-price-compare-pdf.ts — รัน: npx tsx scripts/check-price-compare-pdf.ts
import assert from "node:assert/strict"
import fs from "node:fs"
import { PDFDocument } from "pdf-lib"
import { newDoc, emptySupplier, supplierTotals, fmtMoney, type PriceCompare, type PcSupplier, type PcFile } from "../lib/price-compare"
import { buildPriceCompareDocDef, pdfFilename } from "../lib/price-compare-pdf"
import { renderPdfmake, seg } from "../lib/pdfmake-printer"
import { attachmentOrder, collectAttachments, assemblePdf } from "../lib/price-compare-attachments"

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
  // fixture ตั้งต้นไม่มีเหตุผลทั้งสองข้อ → บรรทัดเหตุผลต้องไม่ถูกพิมพ์
  assert.ok(!flat.includes("เหตุผลที่เลือก"), "ไม่มี selectionReason ต้องไม่มีบรรทัดเหตุผลที่เลือก")
  assert.ok(!flat.includes("เหตุผลที่มีใบเสนอราคาน้อยกว่า 3 ราย"), "ไม่มี fewerQuotesReason ต้องไม่มีบรรทัดนั้น")

  // supplier ที่เสนอราคาแบบไม่มี VAT: ช่องภาษีขึ้น "ไม่มี VAT" และสุทธิ = ยอดหลังส่วนลด
  const dNone = uh03()
  dNone.suppliers[2].vatMode = "none"
  const tNone = supplierTotals(dNone, 2)
  assert.equal(tNone.vat, 0)
  assert.equal(tNone.net, tNone.afterDiscount, "vatMode none: สุทธิ = ยอดหลังส่วนลด")
  const flatNone = JSON.stringify(buildPriceCompareDocDef(dNone))
  // ข้อความไทยทั่วไปผ่าน seg() (มี ZWSP คั่นคำ) จึงต้องเทียบกับรูปที่ seg() แล้ว
  assert.ok(flatNone.includes(seg("ไม่มี VAT")), "ช่องภาษีของ supplier 3 ต้องขึ้น ไม่มี VAT")
  assert.ok(flatNone.includes(fmtMoney(tNone.net)), `สุทธิ supplier 3 (none) = ${fmtMoney(tNone.net)}`)

  // เหตุผลที่มีใบเสนอราคาน้อยกว่า 3 ราย — ป้ายหัวข้อเป็นข้อความตรงตัว ส่วนเนื้อความผ่าน seg()
  const flatFewer = JSON.stringify(buildPriceCompareDocDef({ ...uh03(), fewerQuotesReason: "มีผู้ขายรายเดียว" }))
  assert.ok(flatFewer.includes("เหตุผลที่มีใบเสนอราคาน้อยกว่า 3 ราย"))
  assert.ok(flatFewer.includes(seg("มีผู้ขายรายเดียว")))

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

  // --- ลำดับหลักฐาน: ทั่วไป → Supplier 1..N ---
  {
    const d = uh03()
    const f = (n: string): PcFile => ({ mediaId: 1, batchId: "b", filename: n, webpUrl: `https://cdn.test/${n}`, thumbnailUrl: "" })
    d.evidenceFiles = [f("line-chat.jpg")]
    d.suppliers[0].quotationFiles = [f("q1.jpg")]
    d.suppliers[1].quotationFiles = [f("quote2.pdf"), f("q2b.jpg")]
    const order = attachmentOrder(d)
    assert.deepEqual(order.map((o) => o.file.filename), ["line-chat.jpg", "q1.jpg", "quote2.pdf", "q2b.jpg"])
    assert.equal(order[0].heading, "หลักฐาน: line-chat.jpg")
    assert.equal(order[2].heading, "ใบเสนอราคา Supplier 2 — คุณณัฐ: quote2.pdf")

    // --- collectAttachments ด้วย fetch ปลอม: รูป = PNG 1×1 (sharp แปลงได้), pdf = เอกสาร 2 หน้า, ไฟล์เสีย = 404 ---
    const twoPage = await PDFDocument.create(); twoPage.addPage(); twoPage.addPage()
    const pdfBytes = await twoPage.save()
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64")
    d.suppliers[2].quotationFiles = [f("broken.jpg")]
    const fakeFetch = (async (url: string) => {
      if (url.endsWith("broken.jpg")) return new Response(null, { status: 404 })
      if (url.endsWith(".pdf")) return new Response(pdfBytes, { status: 200, headers: { "content-type": "application/pdf" } })
      return new Response(png, { status: 200, headers: { "content-type": "image/png" } })
    }) as unknown as typeof fetch
    const plan = await collectAttachments(d, fakeFetch)
    assert.equal(plan.imagePages.length, 3, "รูป 3 ไฟล์")
    assert.equal(plan.pdfInserts.length, 1)
    assert.equal(plan.pdfInserts[0].afterImageIndex, 1, "PDF ของ supplier 2 อยู่หลังรูปที่ 2 (index 1)")
    assert.deepEqual(plan.failed, ["broken.jpg"])

    const out = await assemblePdf(d, plan)
    const merged = await PDFDocument.load(out)
    // หน้า 1 ฟอร์ม + รูป line-chat + รูป q1 + PDF 2 หน้า + รูป q2b + หน้าแจ้งไฟล์เสีย = 7
    assert.equal(merged.getPageCount(), 7)
    fs.writeFileSync("tmp/price-compare-merged.pdf", out)
    console.log("attachments: OK → tmp/price-compare-merged.pdf")
  }

  // --- ลำดับการแทรกต้องคงที่เมื่อ PDF สองไฟล์ afterImageIndex ตรงกัน (supplier เดียวอัปโหลด PDF สองไฟล์ ไม่มีรูปคั่น) ---
  {
    const d = uh03()
    d.evidenceFiles = []
    const f = (n: string): PcFile => ({ mediaId: 1, batchId: "b", filename: n, webpUrl: `https://cdn.test/${n}`, thumbnailUrl: "" })
    d.suppliers[0].quotationFiles = [f("photo.jpg"), f("a.pdf"), f("b.pdf")]
    d.suppliers[1].quotationFiles = []
    d.suppliers[2].quotationFiles = []

    const a4 = await PDFDocument.create(); a4.addPage([595.28, 841.89])
    const letter = await PDFDocument.create(); letter.addPage([612, 792])
    const png1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64")
    const aBytes = await a4.save(), bBytes = await letter.save()
    const fakeFetch = (async (url: string) => {
      if (url.endsWith("a.pdf")) return new Response(aBytes, { status: 200, headers: { "content-type": "application/pdf" } })
      if (url.endsWith("b.pdf")) return new Response(bBytes, { status: 200, headers: { "content-type": "application/pdf" } })
      return new Response(png1x1, { status: 200, headers: { "content-type": "image/png" } })
    }) as unknown as typeof fetch

    const plan = await collectAttachments(d, fakeFetch)
    assert.equal(plan.pdfInserts.length, 2)
    assert.ok(plan.pdfInserts.every((p) => p.afterImageIndex === 0), "ทั้งสอง PDF ชี้ afterImageIndex เดียวกัน (หลังรูปเดียวที่มี)")

    const out = await assemblePdf(d, plan)
    const merged = await PDFDocument.load(out)
    assert.equal(merged.getPageCount(), 4, "1 ฟอร์ม + 1 รูป + 2 หน้า PDF (a.pdf, b.pdf)")
    assert.ok(Math.abs(merged.getPage(2).getSize().width - 595.28) < 0.1, "หน้า index 2 = a.pdf (A4)")
    assert.ok(Math.abs(merged.getPage(3).getSize().width - 612) < 0.1, "หน้า index 3 = b.pdf (Letter) — ต้องไม่สลับลำดับ")
    console.log("attachments (stable order, same afterImageIndex): OK")
  }

  // --- fetch timeout: ไฟล์ที่ไม่มีวันตอบ ต้องตกไปที่ failed[] แทนที่จะค้างตลอดกาล ---
  {
    const d = uh03()
    d.evidenceFiles = []
    const f = (n: string): PcFile => ({ mediaId: 1, batchId: "b", filename: n, webpUrl: `https://cdn.test/${n}`, thumbnailUrl: "" })
    d.suppliers[0].quotationFiles = [f("slow.jpg")]
    d.suppliers[1].quotationFiles = []
    d.suppliers[2].quotationFiles = []
    const hangingFetch = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))
      })) as unknown as typeof fetch

    const plan = await collectAttachments(d, hangingFetch, { timeoutMs: 100 })
    assert.deepEqual(plan.failed, ["slow.jpg"], "fetch ที่ไม่ตอบเกิน timeoutMs ต้องถูก abort แล้วตกไป failed")
    assert.equal(plan.imagePages.length, 0)
    console.log("attachments (fetch timeout): OK")
  }
}

main()
