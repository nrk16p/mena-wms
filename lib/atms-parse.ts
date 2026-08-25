// lib/atms-parse.ts
// แกะ HTML ของ ATMS — ตรรกะล้วน ไม่มี I/O ไม่แตะ DB (ทดสอบด้วย scripts/check-safety-stock-core.ts)
//
// แยกออกมาจาก lib/atms-sku-log.ts เพราะไฟล์นั้นลากสาย import ไปถึง lib/mongo ซึ่ง throw ทันทีถ้าไม่มี
// MONGO_URI — เทสต์ตรรกะล้วนจึง import ไม่ได้เลย ตัวแกะตารางที่พังเงียบได้ต้องมีเทสต์คุม จึงต้องอยู่ที่นี่

/** แท็ก HTML ออก เหลือข้อความล้วนที่ trim แล้ว */
export function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()
}

/** ยอดรวมจากแถบแบ่งหน้า: "1 - 1000 / 52,505" */
export function parseTotal(html: string): number | null {
  const m = stripTags(html).match(/[\d,]+\s*-\s*[\d,]+\s*\/\s*([\d,]+)/)
  return m ? Number(m[1].replace(/,/g, "")) : null
}

// ── สถานที่จัดเก็บรายรหัส (ตาราง "ประวัติสต๊อก" /inv/stock.history/index) ──────
// ATMS มีค่านี้ที่ตารางนี้ที่เดียว — ตาราง SKU index ที่ fetchSkuIndexPage ใช้ไม่มีให้
// (ตรวจจริง 25/08/2026: sku/index มี 15 คอลัมน์ ไม่มีสถานที่จัดเก็บ)

export type StockLocationRow = { code: string; location: string }

/** วันที่ dd/mm/yyyy ตามเวลาไทย ย้อนหลัง n วัน — ตารางประวัติสต๊อกบังคับให้กรองวัน */
export function ictDdmmyyyy(daysBack = 0): string {
  const d = new Date(Date.now() + 7 * 3_600_000 - daysBack * 86_400_000)
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`
}

export function stockHistoryUrl(inventoryId: string, page: number, dateText: string): string {
  const qs = new URLSearchParams({
    page: String(page), inventory_id: inventoryId, sku_code: "", sku: "",
    from_t_date: dateText, to_t_date: dateText, submit: "ค้นหา",
    // ต้องเรียงด้วย s.code ห้ามใช้ sh.t_date desc ที่หน้าเว็บ ATMS ใช้เป็นค่าเริ่มต้น — เรากรองวันเดียวทุกแถวจึงมี
    // t_date เท่ากันหมด การแบ่งหน้าเลยคืนแถวซ้ำข้ามหน้าและตกหล่นแบบเงียบๆ (วัดจริง 25/08/2026: สระบุรีได้
    // 3,000 จาก 5,000 รหัสแล้วตัน ต่อให้ยิงอีกกี่หน้าก็ไม่ได้เพิ่ม) — รหัสสินค้าไม่ซ้ำในคลัง การแบ่งหน้าจึงนิ่ง
    order_by: "s.code asc",
  })
  return `https://www.mena-atms.com/inv/stock.history/index?${qs}`
}

/** แกะตารางประวัติสต๊อกเป็น "รหัสสินค้า → สถานที่จัดเก็บ"
 *  คอลัมน์: [0] วันที่ [1] คลังสินค้า [2] รหัสสินค้า [3] สินค้า [4] กลุ่มสินค้า [5] ยี่ห้อ
 *          [6] สินค้าคงเหลือ [7] หน่วยสินค้า [8] stock value [9] สถานที่จัดเก็บ
 *  ตำแหน่งคอลัมน์ถูกล็อกไว้ด้วยเทสต์ — ถ้า ATMS สลับ/แทรกคอลัมน์ tds[9] จะกลายเป็นค่าอื่นแบบเงียบๆ
 *  (เช่นหน่วยสินค้า) แล้วถูกเขียนทับสถานที่จริงทั้งคลังในการซิงก์รอบถัดไป */
export function parseStockLocationRows(html: string): StockLocationRow[] {
  const tbody = html.match(/<tbody[\s\S]*?<\/tbody>/)
  if (!tbody) return []
  const rows: StockLocationRow[] = []
  for (const tr of tbody[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]))
    if (tds.length < 10) continue          // แถวหัว/แถวสรุป
    const code = tds[2].trim()
    if (!code) continue
    rows.push({ code, location: tds[9].trim() })
  }
  return rows
}
