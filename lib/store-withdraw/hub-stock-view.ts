// ตรรกะล้วนของแท็บคงเหลือ Hub: กรอง Sub · ค้น · เรียง · สรุปยอด · ระดับของใกล้หมด
export type StockViewRow = { vendorCode: string; skuCode: string; skuName: string; qty: number; active?: boolean }
export type StockLevel = "out" | "one" | "ok"
export type StockSort = "code" | "qtyAsc"

export const stockLevel = (qty: number): StockLevel => (qty <= 0 ? "out" : qty === 1 ? "one" : "ok")

export function filterStockRows<T extends StockViewRow>(rows: T[], opts: { q: string; vendor: string; names: Record<string, string>; sort: StockSort }): T[] {
  const k = opts.q.trim().toLowerCase()
  let out = rows
  if (opts.vendor) out = out.filter((r) => r.vendorCode === opts.vendor)
  if (k) out = out.filter((r) => `${r.skuCode} ${r.skuName} ${r.vendorCode} ${opts.names[r.vendorCode] ?? ""}`.toLowerCase().includes(k))
  const byCode = (a: T, b: T) => a.skuCode.localeCompare(b.skuCode, "th", { numeric: true }) || a.vendorCode.localeCompare(b.vendorCode)
  return [...out].sort(opts.sort === "qtyAsc" ? (a, b) => a.qty - b.qty || byCode(a, b) : byCode)
}

/** สรุปบนตาราง: จำนวนรายการ · รวมหน่วย (ไม่นับยอดติดลบ) · ใกล้หมด (≤ 1 ไม่นับแถวที่ปิดใช้) */
export function summarizeStock(rows: StockViewRow[]) {
  let qty = 0
  let low = 0
  for (const r of rows) {
    qty += Math.max(0, r.qty)
    if (r.qty <= 1 && r.active !== false) low++
  }
  return { count: rows.length, qty, low }
}

export const distinctVendors = (rows: StockViewRow[]) => [...new Set(rows.map((r) => r.vendorCode))].sort()

/** โชว์คอลัมน์ Sub เมื่อดู "ทั้งหมด" และมี Sub ตั้งแต่ 2 เจ้า */
export const showSubColumn = (vendorCount: number, selected: string) => !selected && vendorCount >= 2
