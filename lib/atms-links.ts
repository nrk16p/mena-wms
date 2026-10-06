// lib/atms-links.ts
// ลิงก์ไปหน้าเอกสารใน ATMS — ตรรกะล้วน ไม่ import อะไร ใช้ได้ทั้งฝั่ง server และ "use client"
// ใช้ view/id ตรงถ้ารู้ detail_id (กัน ?code หลุดตอน ATMS เด้งไปหน้า login แล้วกลับมา)
// ไม่งั้น fallback เป็นหน้า index ค้นด้วยเลขใบ ซึ่งใช้ได้เมื่อเบราว์เซอร์ login ATMS อยู่แล้ว

const BASE = "https://www.mena-atms.com/inv"

export const atmsPrUrl = (code: string, id?: string | null) => id
  ? `${BASE}/purchase.request/view/id/${id}`
  : `${BASE}/purchase.request/index?code=${encodeURIComponent(code)}`

export const atmsPoUrl = (code: string, id?: string | null) => id
  ? `${BASE}/purchase.order/view/id/${id}`
  : `${BASE}/purchase.order/index?code=${encodeURIComponent(code)}`

/** เลขใบที่ ATMS คืนมาตรงกับที่ค้นเป๊ะไหม (เทียบแบบ api-ncac: ตัดช่องว่างหัวท้าย + ไม่สนตัวพิมพ์)
 *  api-ncac ยอมคืนผลจาก prefix / ผลเดียวที่เจอด้วย — ผลแบบนั้นเปลี่ยนได้เมื่อมีใบใหม่ จึงไม่ควรแคช */
export const isExactMrMatch = (found: unknown, query: string) => {
  const q = query.trim().toLowerCase()
  return !!q && typeof found === "string" && found.trim().toLowerCase() === q
}
