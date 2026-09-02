// lib/vendor-log.ts
// ประวัติการแก้ตารางความสามารถอู่ — ใครติ๊กช่องไหน เอาออกเมื่อไหร่ ใครเปลี่ยนสถานะอนุมัติ
//
// ทำไมต้องมี: เอกสาร `vendor_approval` เก็บได้แค่ "คนล่าสุดที่แตะอู่รายนี้" (ฟิลด์ by/at
// ถูกทับทุกครั้ง) พอเปิดให้ทุกคนติ๊กได้ จะสืบไม่ได้เลยว่าช่องนี้ใครติ๊ก — จึงต้องมีสมุด
// บันทึกแยกที่ append อย่างเดียว ไม่มีใครเขียนทับใคร (แพตเทิร์นเดียวกับ repair_external_log)
//
// ตรรกะล้วน — import ได้แค่ทะเบียนประเภทการซ่อม (ซึ่งก็ไม่ import อะไรเลย)
// เพื่อให้ฝั่งจอกับฝั่งเซิร์ฟเวอร์ใช้ตัวแปลข้อความตัวเดียวกัน
import { byCode } from "@/lib/repair-type-master"

export const VENDOR_LOG_COLL = "vendor_capability_log"

export type VendorLogAction =
  | "tick"     // ติ๊กว่าอู่นี้ทำงานประเภทนี้ได้
  | "untick"   // เอาติ๊กออก
  | "status"   // เปลี่ยนสถานะอนุมัติของอู่
  | "note"     // แก้หมายเหตุ
  | "codes"    // ตั้งรายการติ๊กใหม่ทั้งชุด (มาจาก API อนุมัติที่ส่ง codes มาทีเดียว)

/** 1 บรรทัดในสมุดบันทึก — เขียนแล้วห้ามแก้ (ตามชื่อว่าประวัติ) */
export type VendorLogEntry = {
  vendor: string
  action: VendorLogAction
  /** รหัสประเภทการซ่อมของช่องที่ติ๊ก — มีเฉพาะ tick/untick */
  code?: string
  /** ค่าก่อน/หลัง สำหรับ status · note · codes (codes เก็บเป็นรหัสคั่นด้วยช่องว่าง) */
  from?: string
  to?: string
  by: string
  byEmail: string
  at: Date
}

/** รูปเดียวกันหลังผ่าน JSON (at กลายเป็น ISO string) — ฝั่งจอใช้ตัวนี้ */
export type VendorLogRow = Omit<VendorLogEntry, "at"> & { at: string }

export const AP_STATUS_TH: Record<string, string> = {
  approved: "อนุมัติ",
  rejected: "ไม่อนุมัติ",
  pending:  "รอพิจารณา",
}

const statusTh = (s: string | undefined) => (s ? AP_STATUS_TH[s] ?? s : "—")

/** รหัส → ชื่อเต็มให้คนอ่านรู้เรื่อง เช่น "S44 · อู่นอก - CM - ระบบเบรกและคลัตช์"
 *  รหัสที่ถูกถอดออกจากทะเบียนภายหลังยังต้องอ่านออก จึงคืนรหัสเปล่าแทนที่จะเป็นช่องว่าง */
export function codeLabel(code: string | undefined): string {
  if (!code) return "—"
  const row = byCode(code)
  return row ? `${row.code} · ${row.label}` : code
}

/** ข้อความบรรยาย 1 บรรทัดของประวัติ — ใช้ทั้งใน drawer และ tooltip */
export function describeVendorLog(e: Pick<VendorLogRow, "action" | "code" | "from" | "to">): string {
  switch (e.action) {
    case "tick":   return `ติ๊ก ${codeLabel(e.code)}`
    case "untick": return `เอาติ๊กออก ${codeLabel(e.code)}`
    case "status": return `เปลี่ยนสถานะอนุมัติ: ${statusTh(e.from)} → ${statusTh(e.to)}`
    case "note":   return e.to ? `แก้หมายเหตุ: ${e.to}` : "ลบหมายเหตุ"
    case "codes": {
      const n = (e.to ?? "").split(" ").filter(Boolean).length
      return `ตั้งรายการติ๊กใหม่ทั้งชุด (${n} ประเภท)`
    }
    default: return e.action
  }
}

/** "2026-09-02T07:32:10.000Z" → "2 ก.ย. 69 14:32" (เวลาไทยเสมอ — Vercel รัน TZ=UTC) */
export function fmtLogAt(at: string | Date | undefined): string {
  if (!at) return "—"
  const d = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric", month: "short", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  })
}

/** ประวัติล่าสุดของแต่ละช่อง (อู่ × รหัส) — ใช้เติม tooltip ว่าช่องนี้ใครติ๊กไว้
 *  รับมาเรียงใหม่→เก่า จึงเก็บตัวแรกที่เจอของแต่ละรหัสแล้วข้ามที่เหลือ */
export function latestByCode(rows: VendorLogRow[]): Map<string, VendorLogRow> {
  const out = new Map<string, VendorLogRow>()
  for (const r of rows) {
    if (r.action !== "tick" && r.action !== "untick") continue
    if (!r.code || out.has(r.code)) continue
    out.set(r.code, r)
  }
  return out
}
