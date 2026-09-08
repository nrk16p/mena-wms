// lib/price-compare-attachments.ts — โหลดหลักฐานแนบของใบเทียบราคา แล้วประกอบเป็น PDF ฉบับเดียว
//   รูป (webp/jpg/png บน CDN) → sharp → PNG → หน้าแนวตั้ง 1 รูป/หน้า (ผ่าน pdfmake)
//   PDF ที่อัปโหลด → pdf-lib copyPages แทรก "ตามลำดับ" หลังหน้ารูปที่อยู่ก่อนหน้า
import sharp from "sharp"
import { PDFDocument, StandardFonts } from "pdf-lib"
import { renderPdfmake } from "./pdfmake-printer"
import { buildPriceCompareDocDef, type ImagePage } from "./price-compare-pdf"
import type { PriceCompare, PcFile } from "./price-compare"

export type AttachmentPlan = {
  imagePages: ImagePage[]
  pdfInserts: { afterImageIndex: number; bytes: Uint8Array; heading: string }[]   // afterImageIndex = -1 → ก่อนรูปแรก
  failed: string[]
}

const MAX_PX = 1600
const isPdf = (f: PcFile) => /\.pdf$/i.test(f.filename)

/** ลำดับหลักฐาน: ทั่วไป → ใบเสนอราคา Supplier 1..N */
export function attachmentOrder(doc: PriceCompare): { heading: string; file: PcFile }[] {
  const out: { heading: string; file: PcFile }[] = []
  for (const f of doc.evidenceFiles) out.push({ heading: `หลักฐาน: ${f.filename}`, file: f })
  doc.suppliers.forEach((s, i) => {
    for (const f of s.quotationFiles) out.push({ heading: `ใบเสนอราคา Supplier ${i + 1}${s.name ? ` — ${s.name}` : ""}: ${f.filename}`, file: f })
  })
  return out
}

export async function collectAttachments(doc: PriceCompare, fetchImpl: typeof fetch = fetch): Promise<AttachmentPlan> {
  const plan: AttachmentPlan = { imagePages: [], pdfInserts: [], failed: [] }
  for (const { heading, file } of attachmentOrder(doc)) {
    try {
      const res = await fetchImpl(file.webpUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length === 0) throw new Error("empty")
      if (isPdf(file)) {
        await PDFDocument.load(buf, { ignoreEncryption: false })   // ตรวจว่าเปิดได้ก่อน
        plan.pdfInserts.push({ afterImageIndex: plan.imagePages.length - 1, bytes: new Uint8Array(buf), heading })
      } else {
        const png = await sharp(buf).rotate().resize({ width: MAX_PX, height: MAX_PX, fit: "inside", withoutEnlargement: true }).png().toBuffer()
        plan.imagePages.push({ heading, pngBase64: png.toString("base64") })
      }
    } catch {
      plan.failed.push(file.filename)
    }
  }
  return plan
}

/** ประกอบ: pdfmake (หน้า 1 + หน้ารูป) → pdf-lib แทรก PDF แนบตามลำดับ → หน้าแจ้งไฟล์ที่แนบไม่ได้ */
export async function assemblePdf(doc: PriceCompare, plan: AttachmentPlan): Promise<Uint8Array> {
  const main = await renderPdfmake(buildPriceCompareDocDef(doc, plan.imagePages))
  const out = await PDFDocument.load(main)
  const font = await out.embedFont(StandardFonts.Helvetica)

  // แทรกจากท้ายมาหน้า เพื่อไม่ให้ index เลื่อน — หน้ารูป i อยู่ที่ index (1 + i)
  const inserts = [...plan.pdfInserts].sort((a, b) => b.afterImageIndex - a.afterImageIndex)
  for (const ins of inserts) {
    const src = await PDFDocument.load(ins.bytes)
    const pages = await out.copyPages(src, src.getPageIndices())
    let at = 1 + ins.afterImageIndex + 1
    for (const p of pages) out.insertPage(at++, p)
  }

  if (plan.failed.length) {
    const page = out.addPage([595.28, 841.89])
    // Helvetica ไม่มีอักษรไทย — เขียนชื่อไฟล์ (มักเป็นละติน) + ข้อความอังกฤษ; รายละเอียดไทยดูในหน้าเว็บ
    page.drawText("Attachments that could not be included:", { x: 48, y: 780, size: 14, font })
    plan.failed.forEach((name, i) => page.drawText(`- ${name.replace(/[^\x20-\x7E]/g, "?")}`, { x: 60, y: 750 - i * 20, size: 11, font }))
  }
  return out.save()
}
