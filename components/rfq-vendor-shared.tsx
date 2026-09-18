"use client"
// ส่วนร่วมของหน้าอู่ (public): โหลดใบ, บันทึกอัตโนมัติ, สไตล์ — มือถือก่อน ไม่มี sidebar
// หน้าตาตามเว็บทางการ (2026-09-18): ฟอนต์ Prompt · เขียวองค์กร · มุมมน 6–8 · ปุ่มหลักทรงแคปซูล — ค่าสีอยู่ที่ lib/vendor-brand
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import Link from "next/link"
import { CalendarClock, ChevronLeft } from "lucide-react"
import { STATUS_META, type RfqInvite, type RfqJob, type RfqPart, type EffectiveStatus } from "@/lib/rfq-core"
import { BRAND } from "@/lib/vendor-brand"

export type PublicInvite = Omit<RfqInvite, "confirm" | "createdBy" | "_id"> & { effective: EffectiveStatus; canWrite: boolean; priceValidTo: string | null }
export type Data = { invite: PublicInvite; jobs: RfqJob[]; parts: RfqPart[]; today: string }

export const mitr = { fontFamily: BRAND.font }
export const V = {
  page:  { ...mitr, color: BRAND.ink, padding: "24px 16px 56px", maxWidth: 880, margin: "0 auto" } as CSSProperties,
  card:  { background: BRAND.white, border: `1px solid ${BRAND.line}`, borderRadius: 8, padding: 18, marginBottom: 14, boxShadow: "0 1px 2px rgba(16,24,40,.04)" } as CSSProperties,
  input: { ...mitr, width: "100%", fontSize: 16, padding: "10px 12px", borderRadius: 6, border: `1px solid ${BRAND.field}`, background: BRAND.white, color: BRAND.ink, minHeight: 44, boxSizing: "border-box" } as CSSProperties,
  btn:   { ...mitr, fontSize: 15, fontWeight: 500, padding: "10px 16px", borderRadius: 6, border: `1px solid ${BRAND.field}`, background: BRAND.white, color: BRAND.ink, cursor: "pointer", minHeight: 44 } as CSSProperties,
  btnPrimary: { ...mitr, fontSize: 16, fontWeight: 500, padding: "12px 22px", borderRadius: 999, border: "none", background: BRAND.green, color: BRAND.white, cursor: "pointer", minHeight: 48, width: "100%" } as CSSProperties,
  label: { fontSize: 13, color: BRAND.body, fontWeight: 500, display: "block", marginBottom: 4 } as CSSProperties,
  muted: { fontSize: 13, color: BRAND.muted } as CSSProperties,
  h2:    { fontSize: 18, fontWeight: 500, color: BRAND.ink, margin: 0 } as CSSProperties,
}

/** ตัวเลื่อนหน้าคือ div#vendor-scroll ใน app/q/[token]/layout.tsx ไม่ใช่ window */
export const scrollToTop = () => document.getElementById("vendor-scroll")?.scrollTo({ top: 0 })

/** วันที่เหลือก่อนปิดรับ ตามปฏิทินไทย (null = เลยกำหนดแล้ว) */
export function daysLeft(deadline: string): number | null {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date())
  const ms = (ymd: string) => { const [y, m, d] = ymd.slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, d) }
  const n = Math.round((ms(deadline) - ms(today)) / 86_400_000)
  return n < 0 ? null : n
}

export function StatusBadge({ status, onDark }: { status: EffectiveStatus; onDark?: boolean }) {
  const m = STATUS_META[status]
  return <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 4, whiteSpace: "nowrap", background: onDark ? "rgba(255,255,255,.16)" : m.bg, color: onDark ? BRAND.white : m.fg, border: onDark ? "1px solid rgba(255,255,255,.35)" : "none" }}>{status}</span>
}

export function useInvite(token: string) {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const fetchData = useCallback(async (): Promise<Data> => {
    const r = await fetch(`/api/q/${token}`, { cache: "no-store" })
    if (r.status === 404) throw new Error("ไม่พบลิงก์นี้ กรุณาตรวจสอบลิงก์ที่ได้รับ")
    if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? "โหลดไม่สำเร็จ")
    return r.json()
  }, [token])
  // โหลดครั้งแรก — setState เกิดใน callback หลัง await เท่านั้น (กัน cascading render)
  // และเช็ค cancelled กันเซ็ต state หลังผู้ใช้ออกจากหน้าไปแล้ว
  useEffect(() => {
    let cancelled = false
    fetchData()
      .then((d) => { if (!cancelled) { setData(d); setError("") } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fetchData])
  const reload = useCallback(async () => {
    setLoading(true); setError("")
    try { setData(await fetchData()) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [fetchData])
  const setLocal = useCallback((fn: (d: Data) => Data) => setData((d) => (d ? fn(d) : d)), [])
  return { data, loading, error, reload, setLocal }
}

export function useAutosave(token: string) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [savedAt, setSavedAt] = useState("")
  const [errorMsg, setErrorMsg] = useState("")
  type Queue = { items: Record<string, unknown>; parts: Record<string, unknown>; rates: Record<string, unknown> }
  const queue = useRef<Queue>({ items: {}, parts: {}, rates: {} })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flush = useCallback(async () => {
    const q = queue.current; queue.current = { items: {}, parts: {}, rates: {} }
    if (!Object.keys(q.items).length && !Object.keys(q.parts).length && !Object.keys(q.rates).length) return
    setState("saving")
    try {
      const r = await fetch(`/api/q/${token}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(q), keepalive: true })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error ?? "บันทึกไม่สำเร็จ")
      setState("saved"); setSavedAt(new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }))
    } catch (e) {
      // เก็บกลับเข้าคิว ให้ปุ่ม "ลองใหม่" ส่งซ้ำได้
      queue.current = { items: { ...q.items, ...queue.current.items }, parts: { ...q.parts, ...queue.current.parts }, rates: { ...q.rates, ...queue.current.rates } }
      setState("error"); setErrorMsg(e instanceof Error ? e.message : String(e))
    }
  }, [token])
  // รวมการแก้หลายช่องติดกันเป็นคำขอเดียว (หน่วง 600ms) — แต่ไม่เกิน 20 รายการต่อครั้งตาม API
  const save = useCallback(async (patch: { items?: Record<string, unknown>; parts?: Record<string, unknown>; rates?: Record<string, unknown> }) => {
    Object.assign(queue.current.items, patch.items ?? {})
    Object.assign(queue.current.parts, patch.parts ?? {})
    Object.assign(queue.current.rates, patch.rates ?? {})
    if (timer.current) clearTimeout(timer.current)
    const n = Object.keys(queue.current.items).length + Object.keys(queue.current.parts).length + Object.keys(queue.current.rates).length
    if (n >= 20) { await flush(); return }
    timer.current = setTimeout(() => void flush(), 600)
  }, [flush])
  // ออกจากหน้า/ปิดแอปก่อนครบ 600ms ต้องส่งของค้างออกไปก่อน ไม่งั้นช่องสุดท้ายหายเงียบ ๆ
  // (fetch ใน flush ใช้ keepalive ให้รอดตอน unload) · ใช้ ref เพื่อให้ cleanup เรียก flush ตัวล่าสุด
  const flushRef = useRef(flush)
  useEffect(() => { flushRef.current = flush }, [flush])
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") void flushRef.current() }
    window.addEventListener("pagehide", onHide)
    document.addEventListener("visibilitychange", onHide)
    return () => {
      window.removeEventListener("pagehide", onHide)
      document.removeEventListener("visibilitychange", onHide)
      if (timer.current) clearTimeout(timer.current)
      void flushRef.current()
    }
  }, [])
  return { save, flush, state, savedAt, errorMsg }
}

/** หัวเอกสารของหน้าย่อย (ค่าแรง/อะไหล่/ข้อมูลอู่) — หน้าหลักใช้แถบภาพแทน (HubHero)
 *  subtitle "ชื่อ — คำอธิบาย" → ชื่อเป็นหัวข้อใหญ่ คำอธิบายเป็นบรรทัดรอง */
export function VendorHeader({ invite, subtitle, backHref }: { invite: PublicInvite; subtitle?: string; backHref?: string }) {
  const left = daysLeft(invite.deadline)
  const [title, ...rest] = (subtitle ?? invite.vendor).split(" — ")
  return (
    <div style={{ marginBottom: 16 }}>
      {backHref && <Link href={backHref} style={{ ...V.muted, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 2 }}><ChevronLeft size={15} /> กลับหน้าหลัก</Link>}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginTop: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: .8, color: BRAND.green }}>{subtitle ? invite.vendor : `ใบขอราคา · ${invite.title}`}</div>
          <h1 style={{ fontSize: 24, fontWeight: 500, margin: "2px 0 0", lineHeight: 1.3 }}>{title}</h1>
          {rest.length > 0 && <div style={{ fontSize: 14, color: BRAND.body }}>{rest.join(" — ")}</div>}
          <div style={{ ...V.muted, marginTop: 4, display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
            <CalendarClock size={14} /> ปิดรับ {thDate(invite.deadline)}{left !== null && invite.canWrite && <span style={{ color: left <= 3 ? "#B45309" : BRAND.green, fontWeight: 500 }}>· เหลือ {left} วัน</span>}
          </div>
        </div>
        <StatusBadge status={invite.effective} />
      </div>
    </div>
  )
}

export function SaveBadge({ state, savedAt, errorMsg, onRetry }: { state: "idle" | "saving" | "saved" | "error"; savedAt: string; errorMsg: string; onRetry: () => void }) {
  if (state === "idle") return null
  const c = state === "error" ? "#B91C1C" : state === "saving" ? "#92400E" : "#047857"
  return (
    <div style={{ position: "fixed", left: 16, right: 16, bottom: 12, zIndex: 20, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
      <span style={{ ...mitr, pointerEvents: "auto", fontSize: 12.5, fontWeight: 500, color: c, background: BRAND.white, border: `1px solid ${c}33`, borderRadius: 999, padding: "6px 14px", boxShadow: "0 4px 14px rgba(16,24,40,.12)" }}>
        {state === "saving" ? "กำลังบันทึก…" : state === "saved" ? `บันทึกแล้ว ${savedAt}` : <>บันทึกไม่สำเร็จ: {errorMsg} <button onClick={onRetry} style={{ ...V.btn, minHeight: 28, padding: "2px 10px", fontSize: 12, marginLeft: 6 }}>ลองใหม่</button></>}
      </span>
    </div>
  )
}

export function StatusNotice({ invite }: { invite: PublicInvite }) {
  const box = (bg: string, fg: string, text: string) => <div style={{ ...V.card, background: bg, color: fg, borderColor: fg + "33", borderLeft: `4px solid ${fg}`, fontSize: 14 }}>{text}</div>
  switch (invite.effective) {
    case "หมดอายุ":   return box("#F4F4F5", "#52525B", "ลิงก์นี้ปิดรับแล้ว หากต้องการเสนอราคา กรุณาติดต่อฝ่ายจัดซื้อ Mena Transport")
    case "ยกเลิก":    return box("#FEF2F2", "#B91C1C", "ลิงก์นี้ถูกยกเลิกแล้ว")
    case "ส่งแล้ว":   return box("#FFFBEB", "#92400E", `ส่งใบเสนอราคาแล้วเมื่อ ${thDateTime(invite.submittedAt)} · ฝ่ายจัดซื้อกำลังตรวจสอบ แก้ไขไม่ได้จนกว่าจะได้รับแจ้ง`)
    case "ยืนยันแล้ว": return box("#ECFDF5", "#047857", `ฝ่ายจัดซื้อยืนยันใบเสนอราคาแล้ว · ราคามีผลถึง ${thDate(invite.priceValidTo)}`)
    case "ส่งกลับแก้": return box("#FFF7ED", "#C2410C", `ฝ่ายจัดซื้อขอให้แก้ไข: ${invite.returnNote || "—"} · แก้แล้วกดส่งอีกครั้ง`)
    default: return null
  }
}

/** เข้าหน้าค่าแรง/อะไหล่ก่อนกรอกผู้ติดต่อ — พาไปหน้าหลักซึ่งจะโชว์ขั้นยืนยันตัวตนเอง */
export function NeedContact({ token }: { token: string }) {
  return (
    <div style={V.page}>
      <div style={{ ...V.card, textAlign: "center" }}>
        <div style={{ ...V.h2, marginBottom: 12 }}>กรุณากรอกข้อมูลผู้ติดต่อก่อนเริ่มกรอกราคา</div>
        <Link href={`/q/${token}`} style={{ ...V.btnPrimary, display: "inline-block", textDecoration: "none", width: "auto", padding: "12px 28px" }}>ไปกรอกข้อมูลผู้ติดต่อ</Link>
      </div>
    </div>
  )
}

export const thDate = (ymd: string | null | undefined) => {
  if (!ymd) return "—"
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number)
  const MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
  return `${d} ${MON[m - 1]} ${String(y + 543).slice(-2)}`
}
export const thDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"

/** ตัวเลขจากช่อง input → number|undefined (ว่าง = ไม่กรอก) */
export const toNum = (s: string): number | undefined => { const t = s.replace(/,/g, "").trim(); if (!t) return undefined; const n = Number(t); return Number.isFinite(n) ? n : undefined }
