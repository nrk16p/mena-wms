"use client"

// ชิ้นส่วนที่ใช้ร่วมกันของหน้าติดตามซาก: ชนิดข้อมูลฝั่ง browser · ชิปสถานะ · รูปแบบเงิน/วันที่ · สิทธิ์จาก session
import { useCallback, useEffect, useState } from "react"
import { Clock } from "lucide-react"
import { useSession } from "next-auth/react"
import { coreReturnCan, type Access } from "@/lib/access-policy"
import { TIER_PILL, STATUS_PILL, BTN, FIELD, K } from "./tokens"
import { STATUS_LABEL, agingTier, type AgingTier, type CoreStatus } from "@/lib/core-return/core"

export type Row = {
  row_key: string; issuedDate: string; warehouse?: string | null; wdCode?: string | null; mrCode?: string | null; purpose?: string | null
  skuCode?: string | null; skuName?: string | null; productGroup?: string | null; vehicleNo?: string | null; plate?: string | null; driver?: string | null
  qtyIssued?: number | null; amount?: number | null; source?: string | null; legacyRound?: string | null; legacyNote?: string | null
  coreStatus: CoreStatus; coreQtyReturned?: number; attachCount?: number; saleRoundNo?: string | null; mrItemLabel?: string | null; swNo?: string
  requester?: { email: string; name: string } | null
  garageType?: string | null; garage?: string | null; garageSource?: string | null
  ret?: { choice: string; qty: number; shortReason: string | null; note: string; at: string; by: { name: string }; attachmentIds?: string[] } | null
  sale?: { scrapInDate: string | null; soldDate: string | null; price: number | null; buyer: string | null; roundNo?: string | null } | null
  rebuild?: { sentDate: string | null; vendor: string | null; doneDate: string | null; note: string } | null
  noCore?: { reason: string; note: string } | null
  followUp?: { count: number; lastAt: string; lastNote: string; lastBy: { name: string }; nextDate: string | null } | null
}
export type Summary = Record<CoreStatus | "followQueue", { count: number; amount: number }>

export const STATUS_CLS: Record<CoreStatus, string> = STATUS_PILL
/** ป้ายสั้นสำหรับชิปในหน้าใบเบิก */
export const SHORT_LABEL: Record<CoreStatus, string> = {
  pending: "รอคืนซาก", legacy: "รอคืนซาก", sell_waiting: "S1 อยู่คลังซากรอขาย", sold: "S1 ขายแล้ว", rebuild: "A2 ส่งรีบิ้ว", rebuilt: "A2 รีบิ้วเสร็จ", no_core: "S2 ไม่มีมูลค่า",
}

export function CoreChip({ status, short }: { status: CoreStatus; short?: boolean }) {
  return (
    <span data-core-status={status} className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-[3px] text-[12.5px] font-semibold ${STATUS_CLS[status] ?? STATUS_CLS.no_core}`}>
      {short ? SHORT_LABEL[status] : STATUS_LABEL[status] ?? status}
    </span>
  )
}

/** ค้างกี่วัน: เทา <=14 · ส้ม 15–60 · แดง >60 + ไอคอนนาฬิกา (ไม่พึ่งสีอย่างเดียว) */
export function DaysBadge({ days }: { days: number | null }) {
  if (days == null) return null
  const tier = agingTier(days)
  return (
    <span data-testid="days" data-tier={tier} title={`ค้าง ${days} วัน`} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${TIER_PILL[tier]}`}>
      <Clock size={12} strokeWidth={2.4} aria-hidden /><span className="sr-only">ค้าง </span>{days} วัน
    </span>
  )
}
/** ตัวเลขวันค้างแบบข้อความล้วน */
export const TIER_TEXT: Record<AgingTier, string> = { ok: "", warn: `font-semibold ${K["text-c8A4B06"]}`, late: `font-semibold ${K["text-c9F1D12"]}` }

export const baht = (n: number | null | undefined) => (n == null ? "-" : n.toLocaleString("th-TH", { maximumFractionDigits: 0 }))
/** ยอดเงินแบบย่อ: 45.8M · 12.3K */
export const bahtShort = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n)))
export const qtyText = (n: number | null | undefined) => (n == null ? "-" : n.toLocaleString("th-TH", { maximumFractionDigits: 2 }))
export const todayYmd = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
export function daysFrom(ymd: string | null | undefined, today = todayYmd()): number | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null
  return Math.max(0, Math.round((Date.parse(today) - Date.parse(ymd)) / 86_400_000))
}
/** YYYY-MM-DD → dd/mm/yy (พ.ศ.) */
export function thDate(ymd: string | null | undefined): string {
  if (!ymd) return "-"
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd)
  if (!m) return ymd
  return `${m[3]}/${m[2]}/${String(Number(m[1]) + 543).slice(2)}`
}
/** YYYY-MM-DD → dd/mm/yyyy (พ.ศ. เต็มปี) สำหรับข้างช่องวันที่ */
export function thDateFull(ymd: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd ?? "")
  return m ? `${m[3]}/${m[2]}/${Number(m[1]) + 543}` : ""
}
/** ช่องวันที่ native (แสดงปีตามเครื่อง) + ข้อความ "= dd/mm/yyyy พ.ศ." ให้ตรงกับตาราง · ไม่ใช้ calendar ของ repo เพราะ locale th ของมันยังเป็น ค.ศ. */
export function DateInput({ value, onChange, className, ...rest }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & { value: string; onChange: (v: string) => void }) {
  const be = thDateFull(value)
  return (
    <span className="block">
      <input {...rest} type="date" value={value} onChange={(e) => onChange(e.target.value)} className={className ?? inputCls} />
      <span data-testid="be-date" className={`mt-1 block min-h-4 text-xs font-normal ${K["text-muted"]}`}>{be ? `= ${be}` : ""}</span>
    </span>
  )
}
export function thDateTime(iso: string | null | undefined): string {
  if (!iso) return "-"
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleString("th-TH", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })
}
export function followText(f: Row["followUp"]): string | null {
  if (!f || !f.count) return null
  const d = new Date(new Date(f.lastAt).getTime() + 7 * 3600_000)
  return `ตามแล้ว ${f.count} ครั้ง · ล่าสุด ${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

export async function postJson(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง")
  return j
}
export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || "โหลดข้อมูลไม่สำเร็จ")
  return j as T
}
export const rowUrl = (key: string, sub = "") => `/api/core-return/${encodeURIComponent(key)}${sub ? "/" + sub : ""}`

export type Perms = { read: boolean; ret: boolean; store: boolean; follow: boolean; round: boolean; vehicleTeam: boolean; ready: boolean }

/** สิทธิ์ของคนที่ล็อกอิน (ฝั่ง API เช็กซ้ำเสมอ) · vehicleTeam = ยานยนต์ (คืนซากได้ แต่ไม่ใช่สโตร์/จัดซื้อ) */
export function usePerms(): Perms {
  const { data, status } = useSession()
  const a = (data?.user as { access?: Access } | undefined)?.access
  if (!a) return { read: false, ret: false, store: false, follow: false, round: false, vehicleTeam: false, ready: status !== "loading" }
  const store = coreReturnCan(a, "sold")
  const follow = coreReturnCan(a, "follow_up")
  const ret = coreReturnCan(a, "return")
  return { read: coreReturnCan(a, "read"), ret, store, follow, round: coreReturnCan(a, "round"), vehicleTeam: ret && !store && !follow, ready: true }
}

export const inputCls = FIELD.input
export const btnPrimary = `${BTN.base} ${BTN.md} ${BTN.primary}`
export const btnGhost = `${BTN.base} ${BTN.md} ${BTN.secondary}`

/** โหลด JSON ตาม url (null = ไม่โหลด) · ผลผูกกับ url+tick ที่ขอ → เปลี่ยน url แล้วได้ null ทันที ไม่โชว์ของเก่า */
export function useFetch<T>(url: string | null, tick = 0): { data: T | null; error: string } {
  const key = url == null ? null : `${tick}|${url}`
  const [st, setSt] = useState<{ key: string | null; data: T | null; error: string }>({ key: null, data: null, error: "" })
  useEffect(() => {
    if (key == null || url == null) return
    const ctl = new AbortController()
    getJson<T>(url, ctl.signal).then((data) => setSt({ key, data, error: "" })).catch((e) => { if (!ctl.signal.aborted) setSt({ key, data: null, error: e instanceof Error ? e.message : "โหลดไม่สำเร็จ" }) })
    return () => ctl.abort()
  }, [key, url])
  return st.key === key ? { data: st.data, error: st.error } : { data: null, error: "" }
}

/** state ที่รีเซ็ตเองเมื่อ key เปลี่ยน (เช่นเลขหน้าเมื่อเปลี่ยนตัวกรอง) */
export function useKeyed<T>(key: string, initial: T): [T, (v: T | ((cur: T) => T)) => void] {
  const [st, setSt] = useState<{ key: string; v: T }>({ key, v: initial })
  const v = st.key === key ? st.v : initial
  const set = useCallback((x: T | ((cur: T) => T)) => setSt((cur) => {
    const base = cur.key === key ? cur.v : initial
    return { key, v: typeof x === "function" ? (x as (c: T) => T)(base) : x }
  }), [key, initial])
  return [v, set]
}

export const download = (url: string) => { window.location.href = url }

export type Att = { id: string; context: string; filename: string; contentType: string; size: number; by: { name: string; email: string }; confirmedAt: string; url: string }
export const attachApi = (key: string) => rowUrl(key, "attachments")
