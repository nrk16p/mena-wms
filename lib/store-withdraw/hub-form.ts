// ตรรกะล้วนของกล่อง "รายการอะไหล่ Hub" ในฟอร์มขอเบิก (ไม่แตะ React/DB) — ให้ทดสอบได้ใน scripts/check-store-withdraw-ui.ts

export type HubTag = { vendorCode: string; vendorName: string }

type KeyLine = { skuId: number; mrItemId?: number | null; hub?: { vendorCode: string } | null }
type HubLine = { qty: string; stockQty: number | null; hub?: HubTag | null }

/** key รวมบรรทัด: SKU + ประเภทการซ่อม + เจ้า Hub · SKU เดียวกันแบบปกติกับ Hub ไม่รวมกัน */
export const formLineKey = (l: KeyLine) => `${l.skuId}|${l.mrItemId ?? "-"}|${l.hub?.vendorCode ?? "-"}`

/** ทิ้งบรรทัด Hub (เปลี่ยนคลัง/เปลี่ยนเป็นอู่นอก) เหลือเฉพาะบรรทัดปกติ */
export const dropHubLines = <T extends { hub?: unknown }>(lines: T[]): T[] => lines.filter((l) => !l.hub)

/** ตัวเลขแถบสรุปล่าง: รายการทั้งหมด (รวม Hub) กับที่เป็น Hub */
export const hubSummary = (lines: { hub?: unknown }[]) => ({ total: lines.length, hub: lines.filter((l) => l.hub).length })

/** บรรทัด Hub ที่ขอเกินคงเหลือ Hub (stockQty = ยอด Hub ตอนเลือก) */
export const overHubStock = (l: HubLine) => !!l.hub && l.stockQty != null && Number(l.qty) > l.stockQty
