// lib/store-withdraw/mr-row.ts — แปลงแถว MR item จาก ATMS lookup (ส่งผ่านมาตรง ๆ) เป็นข้อมูลที่หน้าฟอร์มใช้
// แถวจริง: { id: 257041, name: "LBMR26100001 อู่ใน-CM-ระบบไฟ : 257041", driver, mechanic, ... }
// รหัส MR = คำแรกของ name (มีคำนำหน้าสาขา เช่น LB/SB) · ไม่มีคำที่มี "MR" + ตัวเลข = null
export type MrRow = { id: number; label: string; mrCode: string | null }

const s = (v: unknown) => (v == null ? "" : String(v).trim())
const MR_TOKEN = /^[A-Za-z]*MR[A-Za-z0-9-]*\d$/i

export function parseMrRow(r: Record<string, unknown>): MrRow | null {
  const id = Number(r.id ?? r.mr_item_id ?? r.mrItemId)
  const label = s(r.name ?? r.label ?? r.text ?? r.value ?? r.description)
  if (!Number.isFinite(id) || id <= 0 || !label) return null
  const first = label.split(/\s+/)[0]
  return { id, label, mrCode: MR_TOKEN.test(first) ? first : null }
}

/** ข้อความที่พิมพ์ดูเหมือนเลข MR (มี "MR" ตามด้วยตัวเลข) → ค้นรายการแบบเดิม · ไม่ใช่ → ถือเป็นทะเบียน/เบอร์รถ */
export const looksLikeMrCode = (t: string) => /MR\d/i.test(t)

/** หัวใบแจ้งซ่อมจาก lookup/mrv: { id, code, date, plate, vehicle_no, step, driver, mechanic, ... } */
export type MrHead = { id: number; code: string; date: string; step: string; driver: string; mechanic: string; plate: string }

export function parseMrHead(r: Record<string, unknown>): MrHead | null {
  const code = s(r.code)
  if (!code) return null
  const plate = s(r.plate)
  const vno = s(r.vehicle_no)
  return { id: Number(r.id) || 0, code, date: s(r.date), step: s(r.step), driver: s(r.driver), mechanic: s(r.mechanic), plate: plate && vno && plate !== vno ? `${plate} (${vno})` : plate || vno }
}
