// lib/rfq-import-file.ts — ขั้นตอนร่วมของการอัปโหลดเทมเพลต (ใช้ทั้งฝั่งอู่ /api/q และฝั่งจัดซื้อ /api/rfq)
// ตรวจไฟล์ → อ่าน → แปลงตามเลย์เอาต์ → (ยังไม่ยืนยัน = แค่สรุปให้ดู · ยืนยันแล้ว = บันทึก + ลง log)
import { getCatalog, applyImport } from "@/lib/rfq"
import { jobsForInvite, partsForInvite, type RfqInvite } from "@/lib/rfq-core"
import { parseTemplate, type ImportResult } from "@/lib/rfq-import"
import { sheetsFromBuffer } from "@/lib/rfq-xlsx-read"

export const MAX_UPLOAD = 5 * 1024 * 1024

export type ImportReply =
  | { status: number; error: string }
  | { status: 200; body: { preview: true; counts: ImportResult["counts"]; problems: string[] } }
  | { status: 200; body: { ok: true; saved: { rates: number; items: number; parts: number }; problems: string[] } }

export async function runImport(inv: RfqInvite, form: FormData, by: { name: string; email: string }): Promise<ImportReply> {
  const file = form.get("file")
  if (!(file instanceof File)) return { status: 400, error: "ไม่พบไฟล์ที่อัปโหลด" }
  if (!/\.xlsx$/i.test(file.name)) return { status: 400, error: "รับเฉพาะไฟล์ .xlsx (บันทึกจาก Excel เป็น .xlsx ก่อน)" }
  if (file.size > MAX_UPLOAD) return { status: 400, error: `ไฟล์ใหญ่เกิน ${MAX_UPLOAD / 1024 / 1024} MB` }
  const cat = await getCatalog(inv.catalogVersion)
  let sheets: Record<string, unknown[][]>
  try { sheets = sheetsFromBuffer(Buffer.from(await file.arrayBuffer())) }
  catch { return { status: 400, error: "เปิดไฟล์ไม่สำเร็จ — ไฟล์อาจเสียหายหรือไม่ใช่ .xlsx" } }
  const parsed = parseTemplate(sheets, inv.token, inv.sheets, jobsForInvite(inv, cat.jobs), partsForInvite(inv, cat.parts))
  if (typeof parsed === "string") return { status: 400, error: parsed }
  if (form.get("confirm") !== "1") return { status: 200, body: { preview: true, counts: parsed.counts, problems: parsed.problems } }
  const saved = await applyImport(inv.token, parsed, by)
  return { status: 200, body: { ok: true, saved, problems: parsed.problems } }
}
