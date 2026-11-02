// lib/store-withdraw/pending.ts — ตรรกะล้วนของ Mobile/PM แบบ pending (กำหนดสรุป · สรุปการใช้ · แบ่ง WD ต่อทะเบียน · เลยกำหนด)
// ไม่แตะ DB/env ทดสอบตรง ๆ ด้วย tsx ได้
import type { SwLine, SwRequest, SwSettleGroup, SwUsage } from "./types"

export const DUE_MAX_DAYS = 60
export const MAX_USAGES = 200
export const MAX_NOTE = 500
export const MAX_USAGE_PLATE = 20
export const MAX_MR_CODE = 40
export const MAX_MR_LABEL = 200
const DAY = 86_400_000
const EPS = 1e-9

/** จำนวนที่จ่ายจริงของบรรทัด (ยังไม่แก้ = ตามที่ขอ) */
export const issuedOf = (l: Pick<SwLine, "issuedQty" | "requestedQty">) => l.issuedQty ?? l.requestedQty

/** ตรวจกำหนดสรุปยอด: ต้องเป็นเวลาในอนาคต และไม่เกิน 60 วันจากตอนนี้ */
export function parseDue(raw: unknown, now: Date): { due: Date } | { error: string } {
  if (raw == null || raw === "") return { error: "ใส่กำหนดสรุปยอด (วันและเวลา) ด้วย" }
  if (typeof raw !== "string") return { error: "กำหนดสรุปยอดต้องเป็นวันเวลาแบบ ISO เช่น 2026-11-05T17:00:00+07:00" }
  const d = new Date(raw)
  if (isNaN(d.getTime())) return { error: "กำหนดสรุปยอดอ่านไม่ออก ใช้รูปแบบ ISO เช่น 2026-11-05T17:00:00+07:00" }
  if (d.getTime() <= now.getTime()) return { error: "กำหนดสรุปยอดต้องเป็นเวลาหลังจากตอนนี้" }
  if (d.getTime() > now.getTime() + DUE_MAX_DAYS * DAY) return { error: `กำหนดสรุปยอดได้ไม่เกิน ${DUE_MAX_DAYS} วันจากวันนี้` }
  return { due: d }
}

/** ทะเบียนสำหรับจัดกลุ่ม: ตัดช่องว่างทั้งหมด ตัวพิมพ์ใหญ่ ("70-1234 " กับ "70 -1234" = คันเดียวกัน) */
export const normPlate = (s: string) => s.replace(/\s+/g, "").toUpperCase()

const str = (v: unknown) => (v == null ? "" : String(v).trim())

export type ParsedSummary = { usages: SwUsage[]; returns: { lineIndex: number; qty: number }[]; note: string }

/**
 * ตรวจสรุปการใช้: ทุกแถวต้องมีทะเบียน MR ประเภทการซ่อม และจำนวน > 0 · ใช้รวมต่อบรรทัดต้องไม่เกินที่จ่าย
 * ของเหลือ (จ่าย − ใช้) = คืนสโตร์ คำนวณให้ · ไม่ใช้เลย (คืนหมด) ก็ส่งได้
 */
export function parseSummary(lines: SwLine[], body: Record<string, unknown>): ParsedSummary | { error: string } {
  const raw = body.usages
  if (raw != null && !Array.isArray(raw)) return { error: "usages ต้องเป็นรายการ" }
  const rows = (raw ?? []) as Record<string, unknown>[]
  if (rows.length > MAX_USAGES) return { error: `สรุปได้ไม่เกิน ${MAX_USAGES} แถวต่อใบ` }
  const note = str(body.note)
  if (note.length > MAX_NOTE) return { error: `หมายเหตุยาวเกิน ${MAX_NOTE} ตัวอักษร` }

  const usages: SwUsage[] = []
  const used = new Map<number, number>()
  for (const [k, r] of rows.entries()) {
    const at = `แถวที่ ${k + 1}`
    if (!r || typeof r !== "object") return { error: `${at}: ข้อมูลไม่ถูกต้อง` }
    const lineIndex = Number(r.lineIndex)
    if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) return { error: `${at}: ไม่พบรายการอะไหล่นี้ในใบ` }
    const plate = str(r.plate)
    if (!plate) return { error: `${at}: ใส่ทะเบียนรถ/เบอร์รถที่ใช้ของ` }
    if (plate.length > MAX_USAGE_PLATE) return { error: `${at}: ทะเบียนยาวเกิน ${MAX_USAGE_PLATE} ตัวอักษร` }
    const mrCode = str(r.mrCode)
    if (!mrCode) return { error: `${at}: เลือกใบแจ้งซ่อม (MR) ของรถคันนี้` }
    if (mrCode.length > MAX_MR_CODE) return { error: `${at}: เลข MR ยาวเกินไป` }
    const mrItemId = Number(r.mrItemId)
    const mrItemLabel = str(r.mrItemLabel)
    if (!Number.isInteger(mrItemId) || mrItemId <= 0 || !mrItemLabel) return { error: `${at}: เลือกประเภทการซ่อมของ MR` }
    if (mrItemLabel.length > MAX_MR_LABEL) return { error: `${at}: ชื่อประเภทการซ่อมยาวเกินไป` }
    const qty = typeof r.qty === "number" ? r.qty : Number(r.qty)
    if (!Number.isFinite(qty) || qty <= 0) return { error: `${at}: จำนวนที่ใช้ต้องมากกว่า 0` }
    used.set(lineIndex, (used.get(lineIndex) ?? 0) + qty)
    usages.push({ lineIndex, plate, mrCode, mrItemId, mrItemLabel, qty })
  }

  const returns: { lineIndex: number; qty: number }[] = []
  for (const [i, l] of lines.entries()) {
    const issued = issuedOf(l)
    const u = used.get(i) ?? 0
    if (u > issued + EPS) return { error: `${l.skuName}: ใช้รวม ${fmt(u)} เกินที่เบิกไป ${fmt(issued)}` }
    const left = round(issued - u)
    if (left > EPS) returns.push({ lineIndex: i, qty: left })
  }
  return { usages, returns, note }
}

const round = (n: number) => Math.round(n * 1e6) / 1e6
const fmt = (n: number) => String(round(n))

/** ของเหลือรวมทั้งใบ (> 0 = สโตร์ต้องยืนยันว่ารับคืนแล้ว) */
export const leftoverTotal = (s: { returns: { qty: number }[] } | null | undefined) => (s?.returns ?? []).reduce((a, r) => a + r.qty, 0)

/**
 * แบ่งแถวที่ใช้เป็นกลุ่มต่อทะเบียน (1 กลุ่ม = 1 WD) · เรียงตามทะเบียน เลขกลุ่มเริ่ม 1 · token = `${no}-${n}`
 * บรรทัดซ้ำ (บรรทัดเดียวกัน + ประเภทการซ่อมเดียวกัน) ในคันเดียวกันรวมจำนวนให้ · ใช้ 0 ทั้งใบ = ไม่มีกลุ่ม
 */
export function buildSettleGroups(no: string, usages: SwUsage[], emptyAtms: () => SwSettleGroup["atms"]): SwSettleGroup[] {
  const by = new Map<string, { plate: string; mr: string[]; lines: SwSettleGroup["lines"] }>()
  for (const u of usages) {
    if (!(u.qty > 0)) continue
    const key = normPlate(u.plate)
    const g = by.get(key) ?? { plate: u.plate.trim(), mr: [], lines: [] }
    if (!g.mr.includes(u.mrCode)) g.mr.push(u.mrCode)
    const same = g.lines.find((x) => x.lineIndex === u.lineIndex && x.mrItemId === u.mrItemId)
    if (same) same.qty = round(same.qty + u.qty)
    else g.lines.push({ lineIndex: u.lineIndex, mrItemId: u.mrItemId, qty: u.qty })
    by.set(key, g)
  }
  return [...by.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, g], i) => ({ n: i + 1, plate: g.plate, token: `${no}-${i + 1}`, mrCodes: g.mr, lines: g.lines, status: "PENDING" as const, atms: emptyAtms() }))
}

/** หมายเหตุหัวใบ WD ของกลุ่ม (แบบเดียวกับ headerRemark: MR · อ้างอิง · ทะเบียน · หมายเหตุ) — เลขใบ SW มากับ remark_token ที่ api-ncac ใส่หน้าหมายเหตุให้เอง */
export function settleRemark(r: Pick<SwRequest, "ref" | "remark">, g: Pick<SwSettleGroup, "mrCodes" | "plate">): string {
  return [...g.mrCodes, r.ref?.code, g.plate, r.remark].map((s) => (s ?? "").trim()).filter(Boolean).join(" ")
}

/** เลยกำหนดสรุปกี่นาที (0 = ยังไม่เลย / ไม่ได้รอสรุป) · ไม่มีอะไรเกิดขึ้นเองเมื่อเลย แค่แสดงสีแดง */
export function lateMinutes(r: { status: string; summaryDueAt?: Date | string | null }, now: Date): number {
  if (r.status !== "HANDED_OUT" || r.summaryDueAt == null) return 0
  const due = new Date(r.summaryDueAt).getTime()
  if (isNaN(due) || due >= now.getTime()) return 0
  return Math.max(1, Math.floor((now.getTime() - due) / 60_000))
}

/** "เลยมา 2 วัน 3 ชม." / "เลยมา 45 นาที" */
export function lateText(min: number): string {
  if (min < 60) return `${min} นาที`
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  if (d > 0) return h > 0 ? `${d} วัน ${h} ชม.` : `${d} วัน`
  const m = min % 60
  return m > 0 ? `${h} ชม. ${m} นาที` : `${h} ชม.`
}

/** คิว "รอช่างสรุป": ใกล้/เลยกำหนดก่อน (เลยกำหนดอยู่บนสุดเสมอ) แล้วเก่าก่อน */
export function handedOutSort<T extends { summaryDueAt?: Date | string | null; createdAt: Date | string }>(a: T[]): T[] {
  const t = (v: Date | string | null | undefined) => (v == null ? Infinity : new Date(v).getTime())
  return [...a].sort((x, y) => t(x.summaryDueAt) - t(y.summaryDueAt) || t(x.createdAt) - t(y.createdAt))
}
