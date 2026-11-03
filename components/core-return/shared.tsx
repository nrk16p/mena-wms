"use client"

// ชิ้นส่วนที่ใช้ร่วมกันของหน้าติดตามซาก: ชนิดข้อมูลฝั่ง browser · ชิปสถานะ · รูปแบบเงิน/วันที่ · สิทธิ์จาก session
import { useCallback, useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { coreReturnCan, type Access } from "@/lib/access-policy"
import { OVERDUE_DAYS, STATUS_LABEL, type CoreStatus } from "@/lib/core-return/core"

export type Row = {
  row_key: string; issuedDate: string; warehouse?: string | null; wdCode?: string | null; mrCode?: string | null; purpose?: string | null
  skuCode?: string | null; skuName?: string | null; productGroup?: string | null; vehicleNo?: string | null; plate?: string | null; driver?: string | null
  qtyIssued?: number | null; amount?: number | null; source?: string | null; legacyRound?: string | null; legacyNote?: string | null
  coreStatus: CoreStatus; coreQtyReturned?: number; saleRoundNo?: string | null; mrItemLabel?: string | null; swNo?: string
  requester?: { email: string; name: string } | null
  garageType?: string | null; garage?: string | null; garageSource?: string | null
  ret?: { choice: string; qty: number; shortReason: string | null; note: string; at: string; by: { name: string } } | null
  sale?: { scrapInDate: string | null; soldDate: string | null; price: number | null; buyer: string | null; roundNo?: string | null } | null
  rebuild?: { sentDate: string | null; vendor: string | null; doneDate: string | null; note: string } | null
  noCore?: { reason: string; note: string } | null
  followUp?: { count: number; lastAt: string; lastNote: string; lastBy: { name: string }; nextDate: string | null } | null
}
export type Summary = Record<CoreStatus | "followQueue", { count: number; amount: number }>

export const STATUS_CLS: Record<CoreStatus, string> = {
  pending: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30",
  legacy: "bg-orange-50 text-orange-800 ring-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-500/30",
  sell_waiting: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/30",
  sold: "bg-green-50 text-green-800 ring-green-200 dark:bg-green-500/10 dark:text-green-300 dark:ring-green-500/30",
  rebuild: "bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/30",
  rebuilt: "bg-teal-50 text-teal-800 ring-teal-200 dark:bg-teal-500/10 dark:text-teal-300 dark:ring-teal-500/30",
  no_core: "bg-gray-100 text-gray-700 ring-gray-200 dark:bg-white/5 dark:text-gray-300 dark:ring-white/10",
}
/** ป้ายสั้นสำหรับชิปในหน้าใบเบิก */
export const SHORT_LABEL: Record<CoreStatus, string> = {
  pending: "รอคืนซาก", legacy: "รอคืนซาก", sell_waiting: "อยู่คลังซากรอขาย", sold: "ขายแล้ว", rebuild: "ส่ง Rebuild", rebuilt: "Rebuild เสร็จ", no_core: "ไม่มีซากคืน",
}

export function CoreChip({ status, short }: { status: CoreStatus; short?: boolean }) {
  return (
    <span data-core-status={status} className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_CLS[status] ?? STATUS_CLS.no_core}`}>
      {short ? SHORT_LABEL[status] : STATUS_LABEL[status] ?? status}
    </span>
  )
}

export function DaysBadge({ days }: { days: number | null }) {
  if (days == null) return null
  const late = days > OVERDUE_DAYS
  return (
    <span data-testid="days" className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${late ? "bg-red-600 text-white" : "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-200"}`}>
      ค้าง {days} วัน
    </span>
  )
}

export const baht = (n: number | null | undefined) => (n == null ? "-" : n.toLocaleString("th-TH", { maximumFractionDigits: 0 }))
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

export const inputCls = "w-full rounded-xl border border-[#E2E8E4] bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#1B8C4B] focus:outline-none focus:ring-1 focus:ring-[#1B8C4B] dark:border-white/10 dark:bg-[#0f1117] dark:text-white"
export const btnPrimary = "inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#1B8C4B] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#157a40] disabled:opacity-60"
export const btnGhost = "inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#E2E8E4] px-3 py-2 text-sm text-gray-700 hover:border-[#1B8C4B] hover:text-[#1B8C4B] dark:border-white/10 dark:text-gray-200"

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
