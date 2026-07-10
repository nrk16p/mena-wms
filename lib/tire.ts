// normalize status variants: "in-stock" / "in stock" / "instock" → "In Stock"
export function normStatus(s: unknown): string {
  const t = String(s ?? "").trim()
  if (t.toLowerCase().replace(/[-_\s]+/g, "") === "instock") return "In Stock"
  return t || "In Stock"
}

// "F1ล้อหน้าข้างซ้าย"          → { code: "F1",  name: "ล้อหน้าข้างซ้าย" }
// "RB 6 หางคู่ 2 ซ้ายเส้นใน"   → { code: "RB6", name: "หางคู่ 2 ซ้ายเส้นใน" }
export function splitPosition(pos: string): { code: string; name: string } {
  const m = (pos ?? "").trim().match(/^([A-Z]{1,3})\s*(\d{1,2})\s*(.*)$/i)
  if (!m) return { code: "", name: (pos ?? "").trim() }
  return { code: (m[1] + m[2]).toUpperCase(), name: m[3].trim() }
}

// ตำแหน่งรหัส RB หรือมีคำว่า "หาง" = ยางหางพ่วง ที่เหลือ (F, RA) = ยางหัวรถ
export function isTrailerPosition(pos: string): boolean {
  const { code } = splitPosition(pos)
  return code.startsWith("RB") || pos.includes("หาง")
}

export type TireAge = { text: string; level: "normal" | "warn" | "danger" }

// today - changeIn → adaptive "วัน / สัปดาห์ / เดือน / ปี" + warning level by age
export function tireAge(changeIn: Date | string | null | undefined): TireAge | null {
  if (!changeIn) return null
  const d = new Date(changeIn)
  if (isNaN(d.getTime())) return null
  const days = Math.max(0, (Date.now() - d.getTime()) / 86400000)

  let text: string
  if (days < 7) text = `${Math.floor(days)} วัน`
  else if (days < 30.44) text = `${Math.floor(days / 7)} สัปดาห์`
  else if (days < 365.25) text = `${Math.floor(days / 30.44)} เดือน`
  else {
    const years  = Math.floor(days / 365.25)
    const months = Math.floor((days - years * 365.25) / 30.44)
    text = months > 0 ? `${years} ปี ${months} เดือน` : `${years} ปี`
  }

  const level = days >= 730.5 ? "danger" : days >= 365.25 ? "warn" : "normal"
  return { text, level }
}

// ประสิทธิภาพคงเหลือ % → ระดับสี badge
export function remainingLevel(pct: number): "green" | "amber" | "red" {
  if (pct <= 20) return "red"
  if (pct <= 50) return "amber"
  return "green"
}
