// lib/ap-dd-month.ts
// เดือนของใบ = 4 หลักหลัง "DD" ในเลขใบ (LBDD26010075 → "2601" = ม.ค. 2026) — ผู้ใช้กำหนด 01/10/2026
// ใช้ร่วมกันในพรีวิวนำเข้า (ตั้งเบิก / จ่ายชำระ) · ใบที่อ่านเลขไม่ได้ = "" (ไม่ทราบเดือน)
const TH_MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]

export const ddMonth = (code: string) => (/^[A-Z]{2}DD(\d{4})/.exec(code)?.[1] ?? "")

export function ddMonthLabel(key: string): string {
  if (!key) return "ไม่ทราบเดือน"
  const yy = Number(key.slice(0, 2)), mm = Number(key.slice(2, 4))
  const be = String((2000 + yy + 543) % 100).padStart(2, "0")
  return mm >= 1 && mm <= 12 ? `${TH_MON[mm - 1]} ${be}` : `เดือน ${key.slice(2, 4)}/${be}`
}

/** เรียงเก่า→ใหม่ "ไม่ทราบเดือน" ไว้ท้ายสุด */
export const sortDdMonths = (keys: Iterable<string>) =>
  [...new Set(keys)].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
