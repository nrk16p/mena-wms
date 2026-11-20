// lib/store-withdraw/hub-portal.ts — ยอดฝากขายที่ Sub (อู่) เห็นใน vendor-portal
// จับคู่ code ด้วยรูปมาตรฐานของ portal (VEN-00008 = 8 = Vendor-00008) · ส่งออกแค่ 4 ช่อง ไม่มีราคา/รหัสอื่น
import { vpUsernameFromCode } from "../vendor-portal"
import { hubCols, listHubStock } from "./hub-db"

export type HubPortalRow = { skuCode: string; skuName: string; unit: string; qty: number }

export async function hubStockForVendor(atmsCode: unknown): Promise<{ enabled: boolean; rows: HubPortalRow[] }> {
  const want = vpUsernameFromCode(atmsCode)
  if (!want) return { enabled: false, rows: [] } // ไม่มีรูปมาตรฐาน = ไม่เดา
  const { vendors } = await hubCols()
  const all = await vendors.find({ active: true }, { projection: { code: 1 } }).toArray()
  const codes = all.map((v) => v.code).filter((c) => vpUsernameFromCode(c) === want)
  if (!codes.length) return { enabled: false, rows: [] }
  const rows: HubPortalRow[] = []
  for (const code of codes) {
    for (const r of await listHubStock({ vendorCode: code })) {
      rows.push({ skuCode: r.skuCode, skuName: r.skuName, unit: r.unit, qty: r.qty })
    }
  }
  rows.sort((a, b) => a.skuCode.localeCompare(b.skuCode))
  return { enabled: true, rows }
}
