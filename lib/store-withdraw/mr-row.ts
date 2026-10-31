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
