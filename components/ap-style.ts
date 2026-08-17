// โทนของหน้าติดตามเจ้าหนี้ — "สมุดบัญชีที่สะอาด": พื้นเรียบ เส้นคั่นบาง สีเดียวเป็นแกน
// สีเตือน (แดง/เหลือง) สงวนไว้ให้ "เงินที่ต้องรีบ" เท่านั้น ห้ามใช้ตกแต่ง ไม่งั้นจะกลายเป็นสัญญาณลวง
import type { ApUrgency } from "@/lib/ap-tracking"

export const mitr = { fontFamily: "var(--font-mitr), sans-serif" }

// การ์ดพื้นฐาน — ขอบบางกว่าค่า default ของ tailwind เพื่อให้ตัวเลขเป็นพระเอก ไม่ใช่กรอบ
export const CARD = "rounded-2xl border border-gray-200/80 bg-white dark:border-white/10 dark:bg-[#161a23]"

// ตัวเลขเงินทุกที่ต้องเป็น tabular — หลักจะได้ตรงกันทุกแถวเวลาไล่สายตาลงคอลัมน์
export const NUM = "tabular-nums"

export const baht = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ย่อยอดใหญ่ให้อ่านเร็วบนแถบสรุป (฿4.06M) — รายละเอียดเต็มอยู่ใน title ของแต่ละก้อน
export const bahtShort = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `฿${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `฿${Math.round(n / 1_000).toLocaleString("th-TH")}k`
  return `฿${Math.round(n).toLocaleString("th-TH")}`
}

// ความเร่งด่วน → สีเดียวกันทั้งแถบสัดส่วนด้านบนและแถบซ้ายของแต่ละแถว
// (bar = สีทึบบนแถบสรุป · rail = เส้นซ้ายของแถว · text = ตัวอักษรบนป้ายกำหนดชำระ)
export const URGENCY: Record<ApUrgency, { label: string; bar: string; rail: string; text: string }> = {
  overdue: { label: "เกินกำหนด",      bar: "bg-rose-500",   rail: "border-l-rose-500",   text: "text-rose-600 dark:text-rose-400" },
  due7:    { label: "ครบใน 7 วัน",    bar: "bg-amber-400",  rail: "border-l-amber-400",  text: "text-amber-700 dark:text-amber-400" },
  noTerm:  { label: "ไม่รู้กำหนด",     bar: "bg-slate-300",  rail: "border-l-slate-300",  text: "text-slate-500 dark:text-slate-400" },
  ok:      { label: "ยังไม่ครบกำหนด", bar: "bg-emerald-500", rail: "border-l-transparent", text: "text-gray-500 dark:text-gray-400" },
  sent:    { label: "ส่งบัญชีแล้ว",    bar: "bg-emerald-600", rail: "border-l-transparent", text: "text-gray-400" },
}
