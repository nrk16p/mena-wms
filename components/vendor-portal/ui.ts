// ของใช้ร่วมของหน้าเจ้าหนี้ — หน้านี้บังคับธีมสว่างเสมอ (ไม่ใช้ dark:) เพราะคนนอกเปิดจากไลน์บนมือถือ
import type { VpStatus } from "@/lib/vendor-portal"

export const VP_FONT = { fontFamily: "'IBM Plex Sans Thai', sans-serif" }

export const VP_BADGE: Record<VpStatus, { box: string; dot: string }> = {
  processing: { box: "bg-sky-50 text-sky-700",        dot: "bg-sky-500" },
  scheduled:  { box: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  paid:       { box: "bg-teal-50 text-teal-700",       dot: "bg-teal-500" },
}

export const baht = (n: number) =>
  `฿${n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const WEEKDAY = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์", "เสาร์"]
export const weekdayOf = (iso: string) => {
  const t = Date.parse(`${iso}T00:00:00Z`)
  return Number.isNaN(t) ? "" : WEEKDAY[new Date(t).getUTCDay()]
}

/** คัดลอกข้อความ — มี fallback สำหรับเบราว์เซอร์ในแอปที่ไม่มี clipboard API */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement("textarea")
      ta.value = text
      ta.setAttribute("readonly", "")
      ta.style.position = "fixed"
      ta.style.opacity = "0"
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand("copy")
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}
