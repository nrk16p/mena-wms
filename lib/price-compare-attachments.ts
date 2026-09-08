// lib/price-compare-attachments.ts — โหลดหลักฐานแนบของใบเทียบราคา แล้วประกอบเป็น PDF ฉบับเดียว
//   รูป (webp/jpg/png บน CDN) → sharp → PNG → หน้าแนวตั้ง 1 รูป/หน้า (ผ่าน pdfmake)
//   PDF ที่อัปโหลด → pdf-lib copyPages แทรก "ตามลำดับ" หลังหน้ารูปที่อยู่ก่อนหน้า
import fs from "fs"
import path from "path"
import sharp from "sharp"
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib"
import fontkit from "@pdf-lib/fontkit"
import { MEDIA_CDN_BASE, MEDIA_MAX_BYTES } from "./media"
import { renderPdfmake } from "./pdfmake-printer"
import { buildPriceCompareDocDef, type ImagePage } from "./price-compare-pdf"
import type { PriceCompare, PcFile } from "./price-compare"

export type AttachmentPlan = {
  imagePages: ImagePage[]
  pdfInserts: { afterImageIndex: number; bytes: Uint8Array; heading: string }[]   // afterImageIndex = -1 → ก่อนรูปแรก
  failed: string[]
}

const MAX_PX = 1600
const DEFAULT_TIMEOUT_MS = 15000
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

export async function collectAttachments(
  doc: PriceCompare,
  fetchImpl: typeof fetch = fetch,
  opts: { timeoutMs?: number } = {},
): Promise<AttachmentPlan> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const plan: AttachmentPlan = { imagePages: [], pdfInserts: [], failed: [] }
  for (const { heading, file } of attachmentOrder(doc)) {
    // SSRF guard: ยิงได้เฉพาะไฟล์ที่อยู่ใต้ CDN ของเราเท่านั้น — URL อื่น (metadata endpoint, intranet, file://)
    // ตกเป็นไฟล์แนบไม่ได้ทันที โดยไม่ fetch เลย
    if (!file.webpUrl.startsWith(MEDIA_CDN_BASE + "/")) {
      plan.failed.push(file.filename)
      continue
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetchImpl(file.webpUrl, { signal: controller.signal } as RequestInit)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // เพดานขนาด: เชื่อ content-length ถ้ามี (ตัดก่อนโหลด) แล้วตรวจซ้ำกับ buffer จริงเผื่อ header โกหก/ไม่มี
      const declared = Number(res.headers.get("content-length"))
      if (Number.isFinite(declared) && declared > MEDIA_MAX_BYTES) throw new Error("too large (content-length)")
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length === 0) throw new Error("empty")
      if (buf.length > MEDIA_MAX_BYTES) throw new Error("too large")
      if (isPdf(file)) {
        await PDFDocument.load(buf, { ignoreEncryption: false })   // ตรวจว่าเปิดได้ก่อน
        plan.pdfInserts.push({ afterImageIndex: plan.imagePages.length - 1, bytes: new Uint8Array(buf), heading })
      } else {
        const png = await sharp(buf).rotate().resize({ width: MAX_PX, height: MAX_PX, fit: "inside", withoutEnlargement: true }).png().toBuffer()
        plan.imagePages.push({ heading, pngBase64: png.toString("base64") })
      }
    } catch {
      // fetch error / timeout (abort) / corrupt-encrypted PDF / unsupported image ทั้งหมดตกมาที่นี่ — ไม่ทำให้ PDF ทั้งฉบับล้ม
      plan.failed.push(file.filename)
    } finally {
      clearTimeout(timer)
    }
  }
  return plan
}

/** ประกอบ: pdfmake (หน้า 1 + หน้ารูป) → pdf-lib แทรก PDF แนบตามลำดับ → หน้าแจ้งไฟล์ที่แนบไม่ได้ */
export async function assemblePdf(doc: PriceCompare, plan: AttachmentPlan): Promise<Uint8Array> {
  const main = await renderPdfmake(buildPriceCompareDocDef(doc, plan.imagePages))
  const out = await PDFDocument.load(main)
  // ฟอร์มอาจยาวหลายหน้า (รายการเยอะ) — หน้ารูปแนบถูก pdfmake ต่อท้ายเสมอ จึงหักออกเพื่อรู้จำนวนหน้าฟอร์มจริง
  const mainPages = out.getPageCount() - plan.imagePages.length
  const fallbackFont = await out.embedFont(StandardFonts.Helvetica)

  // ฝัง Sarabun ให้ pdf-lib วาดข้อความไทยได้ (ป้ายหัวข้อ PDF แนบ + รายชื่อไฟล์เสีย) — ถ้าฝังไม่สำเร็จให้ถอยไปใช้ Helvetica แทน
  let thaiFont: PDFFont
  try {
    out.registerFontkit(fontkit)
    thaiFont = await out.embedFont(fs.readFileSync(path.join(process.cwd(), "fonts", "Sarabun-Regular.ttf")), { subset: true })
  } catch {
    thaiFont = fallbackFont
  }
  const font = thaiFont

  // แทรกตามลำดับเดิม (ascending) พร้อมนับจำนวนหน้าที่แทรกไปแล้ว เพื่อไม่ให้ index เลื่อนแม้มีหลาย PDF ชี้ afterImageIndex เดียวกัน
  let added = 0
  for (const ins of plan.pdfInserts) {
    const src = await PDFDocument.load(ins.bytes)
    const pages = await out.copyPages(src, src.getPageIndices())
    const at = mainPages + ins.afterImageIndex + 1 + added
    pages.forEach((p, i) => out.insertPage(at + i, p))
    added += pages.length

    // ป้ายหัวข้อบนหน้าแรกของ PDF ที่แทรก — กันเหตุปัญหา font/geometry ไม่ให้ export ทั้งฉบับล้ม
    try {
      const firstPage = out.getPage(at)
      const { width, height } = firstPage.getSize()
      firstPage.drawRectangle({ x: 0, y: height - 16, width, height: 16, color: rgb(1, 1, 1) })
      firstPage.drawText(ins.heading, { x: 12, y: height - 12, size: 8, font })
    } catch { /* ข้ามป้ายหัวข้อถ้าวาดไม่ได้ */ }
  }

  if (plan.failed.length) {
    const page = out.addPage([595.28, 841.89])
    // ชื่อไฟล์มาจากผู้ใช้ — อักขระที่ font ฝังไม่ครอบคลุมทำให้ drawText โยน ห้ามให้ export ทั้งฉบับล้ม
    try {
      page.drawText("Attachments that could not be included:", { x: 48, y: 780, size: 14, font })
    } catch { /* ข้ามหัวข้อถ้าวาดไม่ได้ */ }
    plan.failed.forEach((name, i) => {
      try {
        page.drawText(`- ${name}`, { x: 60, y: 750 - i * 20, size: 11, font })
      } catch { /* ข้ามชื่อไฟล์ที่วาดไม่ได้ */ }
    })
  }
  return out.save()
}
