// lib/store-withdraw/hub-portal.ts — ยอดฝากขายที่ Sub (อู่) เห็นใน vendor-portal
// จับคู่ code แบบตรงตัว (normVpUsername เหมือนฝั่งบิล) · ไม่ตรง/ซ้ำ = ปิดแท็บ · ส่งออกแค่ 4 ช่อง ไม่มีราคา/รหัสอื่น
import { normVpUsername } from "../vendor-portal"
import { hubCols, listHubStock } from "./hub-db"

export type HubPortalRow = { skuCode: string; skuName: string; unit: string; qty: number }

export async function hubStockForVendor(atmsCode: unknown): Promise<{ enabled: boolean; rows: HubPortalRow[] }> {
  const want = normVpUsername(atmsCode)
  if (!want) return { enabled: false, rows: [] }
  const { vendors } = await hubCols()
  const all = await vendors.find({ active: true }, { projection: { code: 1 } }).toArray()
  const codes = all.map((v) => v.code).filter((c) => normVpUsername(c) === want)
  if (codes.length > 1) console.warn("[hub-portal] hub_vendors code ซ้ำหลังจัดรูป:", want)
  if (codes.length !== 1) return { enabled: false, rows: [] } // ไม่เดา — กันเห็นของเจ้าอื่น
  const by = new Map<string, HubPortalRow>()
  for (const r of await listHubStock({ vendorCode: codes[0] })) {
    const cur = by.get(r.skuCode)
    if (cur) cur.qty += r.qty // อะไหล่เดียวกันหลาย Hub รวมยอด
    else by.set(r.skuCode, { skuCode: r.skuCode, skuName: r.skuName, unit: r.unit, qty: r.qty })
  }
  const rows = [...by.values()].sort((a, b) => a.skuCode.localeCompare(b.skuCode))
  return { enabled: true, rows }
}
