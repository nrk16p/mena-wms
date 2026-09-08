/**
 * Server-side pdfmake printer (pure JS — รันบน Vercel ได้ ไม่ต้อง chromium)
 * โหลดฟอนต์ Sarabun จาก /fonts เข้า virtualfs ของ pdfmake — ยกมาจาก mena-partner-driver/lib/pdfmake-printer.ts
 *
 * หมายเหตุ: ไฟล์นี้ import ได้เฉพาะฝั่ง server (ใช้ fs/path อ่านฟอนต์จาก process.cwd()) —
 * ไม่ import "server-only" เพราะแพ็กเกจนี้ไม่ได้ติดตั้งในโปรเจกต์นี้ และจะทำให้
 * `npx tsx scripts/check-pdfmake-printer.ts` fail (tsx ไม่ใช่ Next server context)
 */
import path from "path"
import fs from "fs"

/* eslint-disable @typescript-eslint/no-explicit-any */
import pdfmake from "pdfmake"
// @ts-expect-error no types for subpath
import PrinterMod from "pdfmake/js/Printer"
// @ts-expect-error no types for subpath
import URLResolverMod from "pdfmake/js/URLResolver"

const Printer = (PrinterMod as any).default || PrinterMod
const URLResolver = (URLResolverMod as any).default || URLResolverMod

const SARABUN_FILES = {
  normal: "Sarabun-Regular.ttf",
  bold: "Sarabun-Bold.ttf",
  italics: "Sarabun-Italic.ttf",
  bolditalics: "Sarabun-BoldItalic.ttf",
}

let printer: any = null
function getPrinter() {
  if (printer) return printer
  const vfs = (pdfmake as any).virtualfs
  const dir = path.join(process.cwd(), "fonts")
  for (const f of Object.values(SARABUN_FILES)) vfs.writeFileSync(f, fs.readFileSync(path.join(dir, f)))
  printer = new Printer({ Sarabun: { ...SARABUN_FILES } }, vfs, new URLResolver(vfs), () => true)
  return printer
}

/** สร้าง PDF buffer จาก docDefinition ของ pdfmake */
export async function renderPdfmake(docDefinition: any): Promise<Buffer> {
  const pdfDoc = await getPrinter().createPdfKitDocument(docDefinition)
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    pdfDoc.on("data", (c: Buffer) => chunks.push(c))
    pdfDoc.on("end", () => resolve(Buffer.concat(chunks)))
    pdfDoc.on("error", reject)
    pdfDoc.end()
  })
}

// แก้ลำดับ สระอำ + วรรณยุกต์ ให้เรนเดอร์ถูก (fontkit ไม่ reorder ให้): ค+้+ำ → ค+ํ+้+า
export function fixThaiMarks(s: string): string {
  return s.replace(/([่-๋])ำ/g, "ํ$1า")
}

// ตัดคำไทยด้วย Intl.Segmenter -> แทรก ZWSP (U+200B) ให้ pdfmake ขึ้นบรรทัดถูก (ห้ามใช้กับเลข/ทะเบียนที่มี "-")
// ก่อน ๆ/ฯ ใส่ NBSP (U+00A0) แทน space ธรรมดา กัน ๆ/ฯ ขึ้นต้นบรรทัดเดี่ยว ๆ — ทุกอักขระที่มองไม่เห็นเขียนเป็น \u escape ตรง ๆ ในซอร์ส
const SEG = new Intl.Segmenter("th", { granularity: "word" })
export function seg(s: string | null | undefined): string {
  if (!s) return ""
  return Array.from(SEG.segment(s), (x) => x.segment)
    .join("\u200B")
    .replace(/\u200B([)\]\u201d\u2019\u0e46\u0e2f,.:;!?%])/g, "$1")
    .replace(/([([\u201c\u2018])\u200B/g, "$1")
    .replace(/\u200B? \u200B?([\u0e46\u0e2f])/g, "\u00A0$1")
    .replace(/\u0e1c\u0e39\u0e49\u200B/g, "\u0e1c\u0e39\u0e49")
    .replace(/([\u0e48-\u0e4b])\u0e33/g, "\u0e4d$1\u0e32")
}
