// Design tokens ของหน้า "ติดตามซากอะไหล่" — ที่เดียวที่มี hex · คอมโพเนนต์อื่นใช้ค่าชื่อจากไฟล์นี้เท่านั้น
// (Tailwind ต้องเห็น class เต็มสตริงในซอร์ส จึงเก็บเป็นค่าคงที่ class ไม่ประกอบสตริงตอนรัน)
import type { AgingTier } from "@/lib/core-return/core"

/** ค่าดิบ ใช้กับที่ class ใช้ไม่ได้ (เช่น เส้น SVG) */
export const HEX = {
  ink: "#14271C", muted: "#566A5E", line: "#E1E8E4", ground: "#F5F7F6",
  primary: "#1B8C4B", primaryHover: "#146C3A", store: "#0369A1", procure: "#6D28D9", vehicle: "#B45309", danger: "#B42318",
} as const

/** ตัวอักษร */
export const TXT = {
  ink: "text-[#14271C]", body: "text-[#33433A]", muted: "text-[#566A5E]", faint: "text-[#7A8A80]", primary: "text-[#1B8C4B]", danger: "text-[#B42318]",
  store: "text-[#0369A1]", storeDeep: "text-[#0B5A85]", procure: "text-[#6D28D9]", vehicle: "text-[#B45309]", late: "text-[#9F1D12]", warn: "text-[#8A4B06]",
} as const

/** เส้นขอบ · พื้น */
export const BORDER = "border-[#E1E8E4]"
export const DIVIDER = "border-[#EEF2F0]"
export const GROUND = "bg-[#F5F7F6]"
export const CARD = "rounded-2xl border border-[#E1E8E4] bg-white"
export const CARD_SM = "rounded-[14px] border border-[#E1E8E4] bg-white"
export const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B8C4B] focus-visible:ring-offset-2"

/** พื้นเลนตามทีม */
export const LANE_BG = { vehicle: "bg-[#FBF4EC]", store: "bg-[#EDF4F9]", procure: "bg-[#F3EFFB]" } as const
export const LANE_DOT = { vehicle: "bg-[#B45309]", store: "bg-[#0369A1]", procure: "bg-[#6D28D9]" } as const

/** ป้ายอายุค้าง: เทา <=14 · ส้ม 15-60 · แดง >60 */
export const TIER_PILL: Record<AgingTier, string> = {
  ok: "bg-[#EEF1EF] text-[#4A5A50]",
  warn: "bg-[#FDF0DE] text-[#8A4B06]",
  late: "bg-[#FBE4E2] text-[#9F1D12]",
}
export const TIER_TXT: Record<AgingTier, string> = { ok: "text-[#4A5A50]", warn: "text-[#8A4B06]", late: "text-[#9F1D12]" }

/** ป้ายสถานะซาก */
export const STATUS_PILL = {
  pending: "bg-[#FDF0DE] text-[#8A4B06]",
  legacy: "bg-[#FDF0DE] text-[#8A4B06]",
  sell_waiting: "bg-[#E6F1F8] text-[#0B5A85]",
  sold: "bg-[#E4F4EA] text-[#156C3A]",
  rebuild: "bg-[#F0EAFB] text-[#5B21B6]",
  rebuilt: "bg-[#E4F4EA] text-[#156C3A]",
  no_core: "bg-[#EEF1EF] text-[#4A5A50]",
  missing: "bg-[#FBE9E7] text-[#9A2A1C]",
} as const

/** ป้ายเล็ก */
export const TAG = {
  neutral: "bg-[#EEF1EF] text-[#5C6B62]",
  inHouse: "bg-[#E4F4EA] text-[#156C3A]",
  outside: "bg-[#E8EAFB] text-[#3B3F9C]",
  unsure: "bg-[#FFF4C2] text-[#7A5B00]",
  round: "bg-[#E6F1F8] text-[#0B5A85]",
  follow: "bg-[#F0EAFB] text-[#5B21B6]",
  photo: "bg-[#E6F1F8] text-[#0B5A85]",
  legacy: "bg-[#FDF0DE] text-[#8A4B06]",
} as const

/** ปุ่ม: เป้ากด >= 44px บนมือถือ · 36-40px บนจอคอม */
const BTN_BASE = `inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-colors ${FOCUS} disabled:cursor-not-allowed`
export const BTN = {
  base: BTN_BASE,
  primary: "bg-[#1B8C4B] text-white hover:bg-[#146C3A] disabled:bg-[#C9D3CD] disabled:hover:bg-[#C9D3CD]",
  busy: "bg-[#1B8C4B] text-white opacity-75 cursor-wait",
  store: "bg-[#0369A1] text-white hover:brightness-90 disabled:bg-[#C9D3CD]",
  procure: "bg-[#6D28D9] text-white hover:brightness-90 disabled:bg-[#C9D3CD]",
  secondary: "border border-[#E1E8E4] bg-white text-[#33433A] hover:border-[#1B8C4B] hover:text-[#146C3A] disabled:border-[#E1E8E4] disabled:text-[#9AA9A0] disabled:hover:text-[#9AA9A0]",
  ghost: "bg-transparent text-[#566A5E] hover:bg-[#EEF1EF] disabled:text-[#9AA9A0]",
  danger: "border border-[#F3C2BD] bg-white text-[#B42318] hover:bg-[#FBE4E2] disabled:text-[#9AA9A0]",
  onDark: "bg-white text-[#14271C] hover:bg-[#EEF1EF] disabled:opacity-50",
  onDarkOutline: "border border-white/35 bg-transparent text-white hover:bg-white/10",
  onDarkText: "bg-transparent text-[#C9D6CE] hover:text-white",
  sm: "h-11 rounded-[10px] px-3.5 text-[13px] lg:h-9",
  md: "h-11 rounded-[10px] px-4 text-sm lg:h-10",
  lg: "h-11 rounded-xl px-5 text-sm",
  icon: "h-11 w-11 rounded-[10px] lg:h-9 lg:w-9",
} as const

/** ชิปกรอง (aria-pressed): เลือก = ทึบเข้ม */
export const CHIP = {
  base: `inline-flex items-center gap-2 whitespace-nowrap font-semibold transition-colors ${FOCUS}`,
  on: "bg-[#14271C] text-white",
  off: "border border-[#E1E8E4] bg-white text-[#33433A] hover:border-[#14271C]",
  countOn: "bg-white/15",
  countOff: "bg-[#EEF1EF]",
  status: "h-11 rounded-[10px] px-3.5 text-sm lg:h-10",
  pill: "h-11 rounded-full px-3 text-[13px] lg:h-8",
} as const

/** ปุ่มสลับ (segmented) */
export const SEG = {
  wrap: "flex gap-1 rounded-xl border border-[#E1E8E4] bg-white p-1",
  base: `h-11 rounded-[9px] px-3.5 text-sm font-semibold transition-colors lg:h-[34px] ${FOCUS}`,
  on: "bg-[#1B8C4B] text-white",
  off: "bg-transparent text-[#33433A] hover:bg-[#EEF1EF]",
  onStore: "bg-[#0369A1] text-white",
} as const

/** ช่องกรอก */
export const FIELD = {
  input: "h-11 w-full rounded-xl border border-[#E1E8E4] bg-white px-3 text-sm text-[#14271C] placeholder:text-[#7A8A80] focus:border-[#1B8C4B] focus:outline-none focus:ring-[3px] focus:ring-[#D3EEDC] aria-[invalid=true]:border-[#B42318]",
  area: "w-full rounded-xl border border-[#E1E8E4] bg-white px-3 py-2.5 text-sm text-[#14271C] placeholder:text-[#7A8A80] focus:border-[#1B8C4B] focus:outline-none focus:ring-[3px] focus:ring-[#D3EEDC]",
  label: "text-[13px] font-semibold text-[#14271C]",
  hint: "text-xs font-normal text-[#566A5E]",
  error: "text-xs font-normal text-[#B42318]",
} as const

/** แถวตาราง */
export const ROW = {
  hover: "hover:bg-[#F7F9F8]",
  selected: "bg-[#F2FAF5]",
  focus: "focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_#1B8C4B]",
} as const

/** แจ้งผล */
export const TOAST = { success: "bg-[#14271C] text-white", error: "bg-[#FBE4E2] text-[#9F1D12] font-semibold" } as const
export const SKELETON = "bg-[#EEF2F0]"
export const OVERLAY_SHADOW = "shadow-[0_20px_50px_rgba(20,39,28,0.18)]"

/** คลาสสีที่เหลือ (สร้างจากพาเลตต์ด้านบน) — คอมโพเนนต์อ้างด้วยชื่อ ไม่ใส่ hex เอง */
export const K = {
  "accent-primary": "accent-[#1B8C4B]",
  "bg-c156C3A": "bg-[#156C3A]",
  "bg-cDCE5DF": "bg-[#DCE5DF]",
  "bg-cE4F4EA": "bg-[#E4F4EA]",
  "bg-cEEF2F0": "bg-[#EEF2F0]",
  "bg-cF2FAF5": "bg-[#F2FAF5]",
  "bg-cF6F8F7": "bg-[#F6F8F7]",
  "bg-cFBE4E2": "bg-[#FBE4E2]",
  "bg-cFDF0DE": "bg-[#FDF0DE]",
  "bg-danger": "bg-[#B42318]",
  "bg-ground": "bg-[#F5F7F6]",
  "bg-ink": "bg-[#14271C]",
  "bg-ink/40": "bg-[#14271C]/40",
  "bg-muted": "bg-[#566A5E]",
  "bg-primary": "bg-[#1B8C4B]",
  "bg-primary/10": "bg-[#1B8C4B]/10",
  "bg-procure": "bg-[#6D28D9]",
  "bg-store": "bg-[#0369A1]",
  "bg-vehicle": "bg-[#B45309]",
  "border-cC9D3CD": "border-[#C9D3CD]",
  "border-cE2E8E4": "border-[#E2E8E4]",
  "border-cEEF2F0": "border-[#EEF2F0]",
  "border-ink": "border-[#14271C]",
  "border-line": "border-[#E1E8E4]",
  "border-primary": "border-[#1B8C4B]",
  "dark:bg-c161922": "dark:bg-[#161922]",
  "divide-cEEF2F0": "divide-[#EEF2F0]",
  "focus-visible:ring-primary": "focus-visible:ring-[#1B8C4B]",
  "focus-within:border-primary": "focus-within:border-[#1B8C4B]",
  "focus-within:ring-cD3EEDC": "focus-within:ring-[#D3EEDC]",
  "focus-within:ring-primary": "focus-within:ring-[#1B8C4B]",
  "hover:bg-c157A40": "hover:bg-[#157a40]",
  "hover:bg-cEEF1EF": "hover:bg-[#EEF1EF]",
  "hover:border-primary": "hover:border-[#1B8C4B]",
  "hover:text-ink": "hover:text-[#14271C]",
  "hover:text-primaryHover": "hover:text-[#146C3A]",
  "placeholder:text-c7A8A80": "placeholder:text-[#7A8A80]",
  "text-c156C3A": "text-[#156C3A]",
  "text-c33433A": "text-[#33433A]",
  "text-c5B21B6": "text-[#5B21B6]",
  "text-c7A5B00": "text-[#7A5B00]",
  "text-c7A8A80": "text-[#7A8A80]",
  "text-c8A4B06": "text-[#8A4B06]",
  "text-c9F1D12": "text-[#9F1D12]",
  "text-danger": "text-[#B42318]",
  "text-ink": "text-[#14271C]",
  "text-muted": "text-[#566A5E]",
  "text-primary": "text-[#1B8C4B]",
} as const
