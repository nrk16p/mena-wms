"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Bell, BellOff, KeyRound, Link2, Loader2, MoreVertical, RefreshCw, Search, Warehouse, X } from "lucide-react"
import { swalConfirm, swalError, swalTextInput, swalToast } from "@/lib/swal"
import { AtmsLinkDialog } from "./atms-link-dialog"
import { DetailPanel } from "./detail-panel"
import { PrepareDialog } from "./prepare-dialog"
import { RejectDialog } from "./reject-dialog"
import { isPendingFlow, matchesSearch, normSearch, searchActive, waitMinutes, workTypeFromKind, WORK_TYPE_LABEL, WORK_TYPES } from "@/lib/store-withdraw/core"
import { lateMinutes } from "@/lib/store-withdraw/pending"
import type { SwWorkType } from "@/lib/store-withdraw/types"
import { api, itemKey, type LinkStatus, type QData, type QItem } from "./queue-types"
import { KeyedCard, TicketCard, WAIT_WARN_MIN, hm, waitText, type BusyKind, type CardActions, type ColKey } from "./ticket-card"

type Opt = { id: number; name: string }
type QuickFilter = "all" | "urgent" | "late" | "cutoff" | "return" | "error"

const POLL_MS = 10_000
const LATKRABANG = 4
const SOUND_KEY = "sw-queue-sound"
type Col = { key: ColKey; title: string; dot: string; hint: string }
// งานสโตร์ (ต้องลงมือ) ซ้าย · งานติดตามหลังส่งของ ขวา
const STORE_COLS: Col[] = [
  { key: "NEW", title: "ใหม่", dot: "bg-amber-600", hint: "เก่าสุดก่อน" },
  { key: "PREPARING", title: "กำลังจัด", dot: "bg-blue-600", hint: "เก่าสุดก่อน" },
  { key: "READY", title: "พร้อมส่ง", dot: "bg-green-600", hint: "เก่าสุดก่อน" },
]
const FOLLOW_COLS: Col[] = [
  // Mobile/PM: ของออกไปแล้ว รอช่างสรุป (เลยกำหนดอยู่บนสุด) · สรุปแล้วจะย้ายไปช่องใหม่เป็นงานตัดสต๊อก
  { key: "HANDED_OUT", title: "รอช่างสรุป", dot: "bg-orange-600", hint: "เลยกำหนดก่อน" },
  { key: "DONE_TODAY", title: "ส่งแล้ววันนี้", dot: "bg-gray-500", hint: "ล่าสุดก่อน" },
]
const COLS = [...STORE_COLS, ...FOLLOW_COLS]
const ACTIVE: ColKey[] = ["NEW", "PREPARING", "READY", "HANDED_OUT"]
const QUICK: { id: QuickFilter; label: string }[] = [
  { id: "all", label: "ทั้งหมด" }, { id: "urgent", label: "รถจอดรอ" }, { id: "late", label: `เกิน ${WAIT_WARN_MIN} นาที` },
  { id: "cutoff", label: "ตัดยอด" }, { id: "return", label: "ใบคืน" }, { id: "error", label: "ATMS ผิดพลาด" },
]
const isReturnItem = (i: QItem) => i.itemType === "return" && !!i.return
const isErr = (i: QItem) => (isReturnItem(i) ? i.return!.status === "RETURN_FAILED" : i.status === "ISSUE_FAILED" || i.status === "SETTLE_FAILED")
const isLate = (i: QItem, k: ColKey, now: Date) => (k === "NEW" || k === "PREPARING" || k === "READY") && waitMinutes(new Date(i.createdAt), now) > WAIT_WARN_MIN
const quickMatch = (f: QuickFilter, i: QItem, k: ColKey, now: Date) =>
  f === "all" || (f === "urgent" && i.urgent) || (f === "late" && isLate(i, k, now)) || (f === "cutoff" && !isReturnItem(i) && i.kind === "cutoff")
  || (f === "return" && isReturnItem(i)) || (f === "error" && isErr(i))
const ctl = "h-10 rounded-lg border border-[#D5DCD8] bg-white text-sm text-[#14271C] dark:border-white/10 dark:bg-[#0f1117] dark:text-white"
const iconBtn = `${ctl} inline-flex w-10 items-center justify-center text-[#2B3D32] hover:border-[#17793F] hover:text-[#17793F] dark:text-gray-300`

// ปิด Radix dialog แล้วค่อยเปิด swal: ถ้าเปิดซ้อนในจังหวะเดียวกัน swal จะจำ aria-hidden ของหน้าหลักไว้แล้วคืนค่าทับตอนปิด
// ทำให้ปุ่มทั้งหน้าถูกซ่อนจาก screen reader ค้าง
const settle = () => new Promise<void>((r) => setTimeout(r, 150))
const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

/** fullWidth = หน้าลิงก์แยก (/store-withdraw-link/queue) ไม่มี sidebar — ใช้เต็มจอ ไม่จำกัด 1600px */
export function QueueBoard({ fullWidth = false }: { fullWidth?: boolean } = {}) {
  const [invs, setInvs] = useState<Opt[]>([])
  const [inv, setInv] = useState<number | null>(null)
  const [link, setLinkState] = useState<LinkStatus | null>(null)
  const linkRef = useRef<LinkStatus | null>(null) // ให้ action ที่ถูกเรียกซ้ำหลังผูกบัญชี (closure เก่า) เห็นสถานะล่าสุด
  const setLink = useCallback((s: LinkStatus | null) => { linkRef.current = s; setLinkState(s) }, [])
  const [data, setData] = useState<QData | null>(null)
  const [error, setError] = useState("")
  const [now, setNow] = useState(() => new Date())
  const [busy, setBusy] = useState<Map<string, BusyKind>>(new Map())
  const [prep, setPrep] = useState<QItem | null>(null)
  const [rej, setRej] = useState<QItem | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [soundOn, setSoundOn] = useState(false)
  const pendingAfterLink = useRef<(() => void) | null>(null)
  const invTouched = useRef(false)
  const autoAsked = useRef(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const inflight = useRef<AbortController | null>(null)
  const prevNew = useRef<Set<string> | null>(null)
  const audio = useRef<AudioContext | null>(null)
  const soundRef = useRef(false)
  const invRef = useRef<number | null>(null)
  const [q, setQ] = useState("")
  const [quick, setQuick] = useState<QuickFilter>("all")
  const [wtype, setWtype] = useState<SwWorkType | "all">("all")
  const [selKey, setSelKey] = useState<string | null>(null) // ใบที่เปิดในแผงรายละเอียด (itemKey)
  const [mCol, setMCol] = useState<ColKey>("NEW") // จอแคบ: ดูทีละช่อง
  // ค้นย้อนหลัง: เก็บคำที่ส่งไปค้นใน ref ให้ poll รอบถัดไปรีเฟรชผลด้วย (พิมพ์คำใหม่/สลับคลัง = ล้างผลเก่า)
  const [deepQ, setDeepQ] = useState("")
  const [deepItems, setDeepItems] = useState<QItem[]>([])
  const [deepBusy, setDeepBusy] = useState(false)
  const deepRef = useRef<{ inv: number; q: string } | null>(null)

  // ---------- เสียงเตือน (WebAudio · browser บล็อก autoplay จึงต้องกดเปิดก่อน) ----------
  const ensureAudio = useCallback(() => {
    try {
      if (!audio.current) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (AC) audio.current = new AC()
      }
      if (audio.current?.state === "suspended") void audio.current.resume()
    } catch { /* ไม่มีเสียงก็ใช้งานต่อได้ */ }
    return audio.current
  }, [])

  const beep = useCallback(() => {
    const ctx = ensureAudio()
    if (!ctx) return
    try {
      const t0 = ctx.currentTime
      for (const [i, f] of [880, 1175].entries()) {
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.type = "sine"
        o.frequency.value = f
        g.gain.setValueAtTime(0.0001, t0 + i * 0.16)
        g.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.16 + 0.02)
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.16 + 0.14)
        o.connect(g).connect(ctx.destination)
        o.start(t0 + i * 0.16)
        o.stop(t0 + i * 0.16 + 0.15)
      }
    } catch { /* เงียบ */ }
  }, [ensureAudio])

  useEffect(() => () => { void audio.current?.close().catch(() => {}); audio.current = null }, [])
  useEffect(() => {
    // อ่านค่าที่จำไว้หลัง mount (กัน hydration ไม่ตรง) — เลื่อนออกจาก effect body ตามกติกา lint
    const t = setTimeout(() => {
      try { if (localStorage.getItem(SOUND_KEY) === "1") { setSoundOn(true); soundRef.current = true } } catch { /* private mode */ }
    }, 0)
    return () => clearTimeout(t)
  }, [])
  // เปิดเสียงไว้จากรอบก่อน แต่ browser ยังไม่ยอมให้เล่น → ปลดล็อกตอนแตะหน้าจอครั้งแรก
  useEffect(() => {
    if (!soundOn) return
    const unlock = () => { ensureAudio() }
    document.addEventListener("pointerdown", unlock, { once: true })
    return () => document.removeEventListener("pointerdown", unlock)
  }, [soundOn, ensureAudio])

  const toggleSound = () => {
    const next = !soundRef.current
    soundRef.current = next
    setSoundOn(next)
    try { localStorage.setItem(SOUND_KEY, next ? "1" : "0") } catch { /* ข้าม */ }
    if (next) beep()
  }

  // ---------- โหลดตัวเลือก + สถานะผูกบัญชี (ครั้งเดียว) ----------
  useEffect(() => {
    const ctl = new AbortController()
    void (async () => {
      const [o, l] = await Promise.allSettled([
        fetch("/api/store-withdraw/options", { signal: ctl.signal }).then((r) => (r.ok ? r.json() : Promise.reject(new Error("โหลดรายการคลังไม่สำเร็จ")))),
        fetch("/api/store-withdraw/atms-link", { signal: ctl.signal }).then((r) => (r.ok ? r.json() : Promise.reject(new Error("โหลดสถานะบัญชี ATMS ไม่สำเร็จ")))),
      ])
      if (ctl.signal.aborted) return
      const list: Opt[] = o.status === "fulfilled" ? (o.value.inventories ?? []) : []
      const status: LinkStatus | null = l.status === "fulfilled" ? l.value : null
      setInvs(list)
      setLink(status)
      // ค่าเริ่มต้น: คลังที่ตรงกับสาขา ATMS ของบัญชีที่ผูก · ไม่มี = ลาดกระบัง
      const byBranch = status?.branch ? list.find((x) => x.name === status.branch) ?? list.find((x) => x.name.includes(status.branch!) || status.branch!.includes(x.name)) : undefined
      const start = byBranch?.id ?? list.find((x) => x.id === LATKRABANG)?.id ?? list[0]?.id ?? LATKRABANG
      if (!invTouched.current) setInv(start)
      if (o.status === "rejected") setError(errMsg(o.reason, "โหลดรายการคลังไม่สำเร็จ"))
    })()
    return () => ctl.abort()
  }, [setLink])

  useEffect(() => {
    if (link && !link.linked && !autoAsked.current) { autoAsked.current = true; setLinkOpen(true) }
  }, [link])

  // ---------- โหลดคิว ----------
  useEffect(() => { invRef.current = inv }, [inv])

  const load = useCallback(async () => {
    const cur = invRef.current
    if (cur == null) return
    inflight.current?.abort()
    const ctl = new AbortController()
    inflight.current = ctl
    try {
      const r = await fetch(`/api/store-withdraw/queue?inv=${cur}`, { signal: ctl.signal })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || "โหลดคิวไม่สำเร็จ")
      if (ctl.signal.aborted) return
      const d = j as QData
      const keys = new Set(d.columns.NEW.map(itemKey))
      const prev = prevNew.current
      if (prev && soundRef.current && [...keys].some((k) => !prev.has(k))) beep()
      prevNew.current = keys
      setData(d)
      const dp = deepRef.current
      if (dp && dp.inv === cur) {
        const r2 = await fetch(`/api/store-withdraw/search?inv=${cur}&q=${encodeURIComponent(dp.q)}`, { signal: ctl.signal })
        const j2 = await r2.json().catch(() => ({}))
        if (r2.ok && deepRef.current === dp && !ctl.signal.aborted) setDeepItems((j2.items ?? []) as QItem[])
      }
      setNow(new Date())
      setError("")
    } catch (e) {
      if (!ctl.signal.aborted) setError(errMsg(e, "โหลดคิวไม่สำเร็จ"))
    }
  }, [beep])

  // เปลี่ยนคลัง = เริ่มจับ "ใบใหม่" ใหม่ (ไม่ดังเพราะสลับคลัง)
  useEffect(() => {
    if (inv == null) return
    prevNew.current = null
    void load()
  }, [inv, load])

  // poll ทุก 10 วิ เฉพาะตอนแท็บมองเห็น · หยุดเมื่อซ่อน · เก็บกวาดตอน unmount
  useEffect(() => {
    const start = () => { if (!timer.current) timer.current = setInterval(() => { void load() }, POLL_MS) }
    const stop = () => { if (timer.current) { clearInterval(timer.current); timer.current = null } }
    const onVis = () => { if (document.visibilityState === "visible") { void load(); start() } else stop() }
    if (document.visibilityState === "visible") start()
    document.addEventListener("visibilitychange", onVis)
    return () => { stop(); inflight.current?.abort(); document.removeEventListener("visibilitychange", onVis) }
  }, [load])

  // ---------- การกระทำ ----------
  const setBusyKey = (k: string, kind: BusyKind | null) => setBusy((s) => { const n = new Map(s); if (kind) n.set(k, kind); else n.delete(k); return n })

  const askLink = (then: () => void) => { pendingAfterLink.current = then; setLinkOpen(true) }

  const claim = async (i: QItem) => {
    const k = itemKey(i)
    setBusyKey(k, "other")
    try { await api(`/api/store-withdraw/${i.no}/claim`, { method: "POST" }); await load() }
    catch (e) { await swalToast("warning", errMsg(e, "รับงานไม่สำเร็จ")); await load() }
    finally { setBusyKey(k, null) }
  }

  // Mobile/PM: ส่งของ = ไม่แตะ ATMS จึงไม่ต้องผูกบัญชี
  const handOut = async (i: QItem) => {
    const k = itemKey(i)
    setBusyKey(k, "other")
    try {
      await api(`/api/store-withdraw/${i.no}/issue`, { method: "POST" })
      await swalToast("success", "ส่งของแล้ว ใบนี้รอช่างสรุปการใช้")
      await load()
    } catch (e) { await swalToast("warning", errMsg(e, "ส่งของไม่สำเร็จ")); await load() }
    finally { setBusyKey(k, null) }
  }

  const settleStock = async (i: QItem, returnConfirmed: boolean) => {
    if (!linkRef.current?.linked) { askLink(() => { void settleStock(i, returnConfirmed) }); return }
    const k = itemKey(i)
    setBusyKey(k, "issue")
    try {
      const res = await api(`/api/store-withdraw/${i.no}/settle`, { method: "POST", body: { returnConfirmed } })
      const r = res.request as QItem
      const groups = r.settleGroups ?? []
      const err = groups.find((g) => g.status !== "DONE" && g.atms.error)?.atms
      if (r.status === "SETTLED") await swalToast("success", groups.length ? `ตัดสต๊อกแล้ว ${groups.map((g) => g.atms.code).filter(Boolean).join(", ")}` : "ยืนยันแล้ว ไม่มีของต้องตัด (คืนทั้งหมด)")
      else if (r.status === "SETTLING") await swalToast("warning", err?.error || "ยังไม่รู้ผลจาก ATMS รอ 5 นาทีแล้วกดลองใหม่")
      else if (r.status === "SETTLE_FAILED") {
        if (err?.needCreds) { setLink({ linked: false }); askLink(() => { void settleStock(i, returnConfirmed) }) }
        else await swalToast("error", err?.error || "ตัดสต๊อกใน ATMS ไม่สำเร็จ")
      }
      await load()
    } catch (e) {
      await swalToast("warning", errMsg(e, "ตัดสต๊อกไม่สำเร็จ"))
      await load()
    } finally { setBusyKey(k, null) }
  }

  const issue = async (i: QItem) => {
    if (isPendingFlow(i) && i.status === "READY") { void handOut(i); return }
    if (!linkRef.current?.linked) { askLink(() => { void issue(i) }); return }
    if (i.kind === "cutoff" && i.status === "NEW") {
      const c = await swalConfirm(`ตัดยอดใบ ${i.no}?`, "ตัดสต๊อกใน ATMS ทันที ย้อนไม่ได้")
      if (!c.isConfirmed) return
    }
    const k = itemKey(i)
    setBusyKey(k, "issue")
    try {
      const res = await api(`/api/store-withdraw/${i.no}/issue`, { method: "POST" })
      const r = res.request as QItem
      if (r.status === "ISSUED") await swalToast("success", `ตัดใน ATMS แล้ว เลข WD ${r.atms.code ?? "-"}`)
      else if (r.status === "ISSUING") await swalToast("warning", r.atms.error || "ยังไม่รู้ผลจาก ATMS รอ 5 นาทีแล้วกดลองใหม่")
      else if (r.status === "ISSUE_FAILED") {
        if (r.atms.needCreds) { setLink({ linked: false }); askLink(() => { void issue(i) }) }
        else await swalToast("error", r.atms.error || "ส่ง ATMS ไม่สำเร็จ")
      }
      await load()
    } catch (e) {
      await swalToast("warning", errMsg(e, "ส่งของไม่สำเร็จ"))
      await load()
    } finally { setBusyKey(k, null) }
  }

  const reject = async (i: QItem) => { setRej(i) }

  const doReject = async (i: QItem, reason: string, attachmentIds: string[]) => {
    setRej(null)
    const k = itemKey(i)
    setBusyKey(k, "other")
    try { await api(`/api/store-withdraw/${i.no}/reject`, { method: "POST", body: { reason, ...(attachmentIds.length ? { attachmentIds } : {}) } }); await load() }
    catch (e) { await swalToast("warning", errMsg(e, "ปฏิเสธไม่สำเร็จ")); await load() }
    finally { setBusyKey(k, null) }
  }

  const closeManual = async (i: QItem) => {
    const r = await swalTextInput({ title: `ปิดใบ ${i.no}`, label: `ใบนี้มี WD ${i.atms.code ?? `#${i.atms.gmId}`} ใน ATMS แล้ว ใส่หมายเหตุว่าแก้อะไรไปบ้าง`, placeholder: "เช่น ลบ WD ใน ATMS แล้ว / คีย์เองแล้ว", required: true, confirmText: "ปิดใบ", danger: true })
    if (!r.isConfirmed || !r.value?.trim()) return
    const k = itemKey(i)
    setBusyKey(k, "other")
    try { await api(`/api/store-withdraw/${i.no}/close-manual`, { method: "POST", body: { note: r.value.trim() } }); await load() }
    catch (e) { await swalToast("warning", errMsg(e, "ปิดใบไม่สำเร็จ")); await load() }
    finally { setBusyKey(k, null) }
  }

  const acceptReturn = async (i: QItem) => {
    if (!i.return) return
    if (!linkRef.current?.linked) { askLink(() => { void acceptReturn(i) }); return }
    const k = itemKey(i)
    setBusyKey(k, "issue")
    try {
      const res = await api(`/api/store-withdraw/${i.no}/returns/${i.return.rid}/accept`, { method: "POST" })
      const ret = (res.request as QItem).returns.find((x) => x.rid === i.return!.rid)
      if (ret?.status === "RETURNED") await swalToast("success", `รับคืนแล้ว เลข DD ${ret.atms.code ?? "-"}`)
      else if (ret?.atms.needCreds) { setLink({ linked: false }); askLink(() => { void acceptReturn(i) }) }
      else await swalToast("error", ret?.atms.error || "รับคืนใน ATMS ไม่สำเร็จ")
      await load()
    } catch (e) {
      await swalToast("warning", errMsg(e, "รับคืนไม่สำเร็จ"))
      await load()
    } finally { setBusyKey(k, null) }
  }

  const markReady = async (no: string) => {
    await api(`/api/store-withdraw/${no}/ready`, { method: "POST" })
    setPrep(null)
    await settle()
    await swalToast("success", "จัดครบแล้ว ใบนี้ไปอยู่ช่องพร้อมส่ง")
    await load()
  }

  const unlink = async () => {
    setMenuOpen(false)
    const c = await swalConfirm("เลิกผูกบัญชี ATMS?", "ลบรหัสที่เก็บไว้ออก ครั้งหน้าต้องผูกใหม่ก่อนจึงจะตัดสต๊อกได้")
    if (!c.isConfirmed) return
    try { await api("/api/store-withdraw/atms-link", { method: "DELETE" }); setLink({ linked: false }); await swalToast("success", "เลิกผูกบัญชีแล้ว") }
    catch (e) { swalError(errMsg(e, "เลิกผูกไม่สำเร็จ")) }
  }

  // เปิดดูใบ → เทียบกับ ATMS (ห่างกันอย่างน้อย 60 วิต่อใบ · พลาดก็เงียบ ไม่รบกวนงานหลัก)
  const lastCheck = useRef<Map<string, number>>(new Map())
  const open = (i: QItem) => {
    const settled = i.status === "SETTLED" && (i.settleGroups ?? []).some((g) => g.atms.gmId != null)
    if (i.itemType === "return" || (!settled && (i.atms.gmId == null || (i.status !== "ISSUED" && i.status !== "RECEIVED")))) return
    const t = Date.now()
    if (t - (lastCheck.current.get(i.no) ?? 0) < 60_000) return
    lastCheck.current.set(i.no, t)
    void api(`/api/store-withdraw/${encodeURIComponent(i.no)}/check`, { method: "POST" })
      .then((r: { checked?: boolean }) => { if (r.checked) void load() })
      .catch(() => {})
  }

  const clearDeep = () => { deepRef.current = null; setDeepQ(""); setDeepItems([]) }
  const onSearch = (v: string) => {
    setQ(v)
    if (deepRef.current && v.trim() !== deepRef.current.q) clearDeep()
  }
  const searchAll = async () => {
    const cur = invRef.current
    const term = q.trim()
    if (cur == null) return
    setDeepBusy(true)
    try {
      const j = await api(`/api/store-withdraw/search?inv=${cur}&q=${encodeURIComponent(term)}`)
      deepRef.current = { inv: cur, q: term }
      setDeepQ(term)
      setDeepItems((j.items ?? []) as QItem[])
    } catch (e) {
      swalError(errMsg(e, "ค้นย้อนหลังไม่สำเร็จ"))
    } finally { setDeepBusy(false) }
  }

  const actions: CardActions = { claim, prepare: setPrep, issue, reject, closeManual, acceptReturn, settle: settleStock, open }
  const filtering = searchActive(q)
  const narrowed = filtering || quick !== "all" || wtype !== "all"
  const colAll = (k: ColKey) => (data?.columns[k] ?? []) as QItem[]
  const colItems = (k: ColKey) => colAll(k).filter((i) =>
    (!filtering || matchesSearch(i, q))
    && quickMatch(quick, i, k, now)
    && (wtype === "all" || (!isReturnItem(i) && (i.workType ?? workTypeFromKind(i.kind)) === wtype)))
  // WD ที่คีย์ใน ATMS โดยตรง: ค้นได้ด้วยเลข WD / หมายเหตุ · ไม่มีประเภทงาน จึงซ่อนเมื่อกรองด่วน/ประเภทงาน
  const keyedItems = (k: ColKey) => {
    if (k !== "DONE_TODAY" || !data || quick !== "all" || wtype !== "all") return []
    if (!filtering) return data.atmsKeyed
    const words = q.split(/\s+/).map(normSearch).filter(Boolean)
    return data.atmsKeyed.filter((r) => words.every((w) => normSearch(`${r.code} ${r.remark}`).includes(w)))
  }
  const total = data ? COLS.reduce((n, c) => n + colItems(c.key).length, 0) : 0
  const deepOn = filtering && deepQ !== "" && deepQ === q.trim()
  // ผลค้นย้อนหลัง: ใบที่จบแล้ว = อ่านอย่างเดียว (ใช้การ์ดแบบ "ส่งแล้ว" ไม่มีปุ่ม) · ใบที่ยังเปิดอยู่ใช้ปุ่มปกติ
  const deepColumn = (i: QItem): ColKey => {
    switch (i.status) {
      case "NEW": case "SUMMARIZED": case "SETTLING": case "SETTLE_FAILED": return "NEW"
      case "PREPARING": return "PREPARING"
      case "READY": case "ISSUING": case "ISSUE_FAILED": return i.kind === "cutoff" && i.status !== "READY" ? "NEW" : "READY"
      case "HANDED_OUT": return "HANDED_OUT"
      default: return "DONE_TODAY"
    }
  }

  // แผงรายละเอียด: หาใบจากข้อมูลล่าสุดทุกรอบ poll (ใบหลุดคิว = แผงปิดเอง)
  const selected = (() => {
    if (!selKey || !data) return null
    for (const c of COLS) {
      const hit = colAll(c.key).find((i) => itemKey(i) === selKey)
      if (hit) return { item: hit, column: c.key }
    }
    const deep = deepOn ? deepItems.find((i) => itemKey(i) === selKey) : undefined
    return deep ? { item: deep, column: deepColumn(deep) } : null
  })()
  const pick = (i: QItem) => { setSelKey(itemKey(i)); open(i) }
  const closeSel = useCallback(() => setSelKey(null), [])

  // ---------- ตัวเลขสรุปบนหัวบอร์ด (ไม่ขึ้นกับตัวกรอง) ----------
  const count = (k: ColKey) => colAll(k).length + (k === "DONE_TODAY" ? data?.atmsKeyed.length ?? 0 : 0)
  const oldestNew = Math.max(0, ...colAll("NEW").map((i) => waitMinutes(new Date(i.createdAt), now)))
  const latePrep = colAll("PREPARING").filter((i) => isLate(i, "PREPARING", now)).length
  const errReady = [...colAll("NEW"), ...colAll("READY")].filter(isErr).length
  const overdue = colAll("HANDED_OUT").filter((i) => lateMinutes(i, now) > 0).length
  const lastDone = [...colAll("DONE_TODAY").map((i) => i.updatedAt), ...(data?.atmsKeyed ?? []).map((r) => r.created_at)].sort().at(-1)
  const stats: { key: ColKey; dot: string; label: string; sub: string; tone: "warn" | "bad" | "" }[] = [
    { key: "NEW", dot: "bg-amber-600", label: "ใหม่ · รอรับ", sub: colAll("NEW").length ? `เก่าสุด ${waitText(oldestNew)}` : "ไม่มีงานค้าง", tone: oldestNew > WAIT_WARN_MIN ? "warn" : "" },
    { key: "PREPARING", dot: "bg-blue-600", label: "กำลังจัด", sub: latePrep ? `เกิน ${WAIT_WARN_MIN} นาที ${latePrep} ใบ` : "ทันเวลาทั้งหมด", tone: latePrep ? "warn" : "" },
    { key: "READY", dot: "bg-green-600", label: "พร้อมส่ง", sub: errReady ? `ATMS ผิดพลาด ${errReady} ใบ` : "รอช่างมารับ", tone: errReady ? "bad" : "" },
    { key: "HANDED_OUT", dot: "bg-orange-600", label: "รอช่างสรุป", sub: overdue ? `เลยกำหนด ${overdue} ใบ` : "ยังไม่เลยกำหนด", tone: overdue ? "bad" : "" },
    { key: "DONE_TODAY", dot: "bg-gray-500", label: "ส่งแล้ววันนี้", sub: lastDone ? `ล่าสุด ${hm(lastDone)}` : "ยังไม่มี", tone: "" },
  ]
  const quickCount = (f: QuickFilter) => ACTIVE.reduce((n, k) => n + colAll(k).filter((i) => quickMatch(f, i, k, now)).length, 0)

  const renderCol = (c: Col) => {
    const items = colItems(c.key)
    const keyed = keyedItems(c.key)
    return (
      <section key={c.key} data-col={c.key} aria-label={c.title}
        className={`${c.key === mCol ? "" : "hidden"} min-w-0 rounded-xl bg-[#EAEFEC] p-2 pb-2.5 md:block dark:bg-white/[0.04]`}>
        <h2 className="flex items-center gap-2 px-1.5 pb-2.5 pt-1.5">
          <span aria-hidden="true" className={`h-2 w-2 rounded-[2px] ${c.dot}`} />
          <span className="text-sm font-semibold text-[#14271C] dark:text-gray-100">{c.title}</span>
          <span className="inline-flex h-[22px] min-w-6 items-center justify-center rounded-full bg-white px-1.5 text-xs font-semibold tabular-nums text-[#2B3D32] dark:bg-white/10 dark:text-gray-200">{items.length + keyed.length}</span>
          <span className="ml-auto text-xs font-normal text-[#4A5A50] dark:text-gray-400">{c.hint}</span>
        </h2>
        {items.length + keyed.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-[#C9D1CC] px-3 py-6 text-center text-xs text-[#4A5A50] dark:border-white/10 dark:text-gray-400">{narrowed ? "ไม่มีใบที่ตรงกับตัวกรอง" : "ไม่มีงานในช่องนี้"}</p>
        ) : (
          <ul className="space-y-2">
            {items.map((i) => <TicketCard key={itemKey(i)} item={i} now={now} busy={busy.get(itemKey(i)) ?? null} actions={actions} column={c.key} selected={itemKey(i) === selKey} onSelect={pick} />)}
            {keyed.map((k, n) => <KeyedCard key={`${k.id ?? k.code}-${n}`} row={k} />)}
          </ul>
        )}
      </section>
    )
  }
  const groupLabel = "hidden items-center gap-2.5 text-xs font-semibold text-[#4A5A50] after:h-px after:flex-1 after:bg-[#DCE3DF] md:flex dark:text-gray-400 dark:after:bg-white/10"
  const wrap = fullWidth ? "w-full" : "mx-auto max-w-[1600px]"
  const subTone = { warn: "text-amber-800 dark:text-amber-300", bad: "text-red-700 dark:text-red-300", "": "text-[#4A5A50] dark:text-gray-400" }

  return (
    <div className={`${fullWidth ? "min-h-screen bg-[#F4F6F5] dark:bg-[#0b0d12]" : ""} text-[#14271C] transition-[padding] dark:text-gray-100 ${selected ? "xl:pr-[440px]" : ""}`}>
      <header className="border-b border-[#E1E6E3] bg-white dark:border-white/10 dark:bg-[#161922]">
        <div className={`${wrap} flex flex-wrap items-center justify-between gap-x-5 gap-y-3 px-4 py-2.5 sm:px-6`}>
          <div className="flex min-w-0 items-center gap-3">
            <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#E8F3EC] text-[#17793F] dark:bg-emerald-500/10 dark:text-emerald-400"><Warehouse size={20} strokeWidth={1.8} /></span>
            <div>
              <p className="text-xs text-[#4A5A50] dark:text-gray-400">Mena WMS / งานสโตร์</p>
              <h1 className="text-xl font-medium leading-tight" style={{ fontFamily: "'Mitr', sans-serif" }}>คิวงานสโตร์</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-[13px] text-[#4A5A50] dark:text-gray-400">คลัง
              <select aria-label="คลัง" value={inv ?? ""} onChange={(e) => { invTouched.current = true; setData(null); clearDeep(); setSelKey(null); setInv(Number(e.target.value)) }}
                className={`${ctl} min-w-[150px] px-3`}>
                {invs.length === 0 && inv != null && <option value={inv}>คลัง {inv}</option>}
                {invs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
            {link?.linked
              ? <span className={`${ctl} inline-flex items-center gap-2 px-3 text-[13px]`}><span aria-hidden="true" className="h-2 w-2 rounded-full bg-green-600" />ATMS{link.atmsUsername ? ` · ${link.atmsUsername}` : ""}</span>
              : link && <button type="button" onClick={() => setLinkOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 text-[13px] font-medium text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"><Link2 size={15} />ยังไม่ผูก ATMS</button>}
            {data && <span className="px-1 text-xs tabular-nums text-[#4A5A50] dark:text-gray-400">อัปเดต {now.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · ทุก 10 วินาที</span>}
            <button type="button" onClick={() => { void load() }} aria-label="โหลดใหม่" className={iconBtn}><RefreshCw size={16} /></button>
            <button type="button" onClick={toggleSound} aria-pressed={soundOn}
              className={`inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-[13px] ${soundOn ? "border-[#17793F] bg-[#E8F3EC] text-[#14532D] dark:bg-emerald-500/10 dark:text-emerald-300" : "border-[#D5DCD8] bg-white text-[#2B3D32] dark:border-white/10 dark:bg-transparent dark:text-gray-300"}`}>
              {soundOn ? <Bell size={16} /> : <BellOff size={16} />}{soundOn ? "เสียงเตือนเปิด" : "เปิดเสียงเตือน"}
            </button>
            <div className="relative">
              <button type="button" onClick={() => setMenuOpen((o) => !o)} aria-label="เมนู" aria-haspopup="menu" aria-expanded={menuOpen} className={iconBtn}><MoreVertical size={16} /></button>
              {menuOpen && (
                <div role="menu" className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-[#E1E6E3] bg-white p-1 shadow-lg dark:border-white/10 dark:bg-[#161922]">
                  <button role="menuitem" type="button" onClick={() => { setMenuOpen(false); setLinkOpen(true) }} className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm hover:bg-gray-50 dark:hover:bg-white/5"><KeyRound size={14} />{link?.linked ? "ผูกบัญชี ATMS ใหม่" : "ผูกบัญชี ATMS"}</button>
                  {link?.linked && <button role="menuitem" type="button" onClick={unlink} className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10">เลิกผูกบัญชี ATMS</button>}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className={`${wrap} space-y-4 px-4 py-4 sm:px-6`}>
        {data && (
          <section aria-label="สรุปคิว" className="hidden grid-cols-5 gap-px overflow-hidden rounded-xl border border-[#E1E6E3] bg-[#EDF1EE] sm:grid dark:border-white/10 dark:bg-white/10">
            {stats.map((s) => (
              <div key={s.key} data-testid={`stat-${s.key}`} className="flex flex-col gap-0.5 bg-white px-4 py-3 dark:bg-[#161922]">
                <span className="flex items-center gap-2 text-[13px] text-[#4A5A50] dark:text-gray-400"><span aria-hidden="true" className={`h-2 w-2 rounded-[2px] ${s.dot}`} />{s.label}</span>
                <span className="text-2xl font-semibold leading-tight tabular-nums">{count(s.key)}</span>
                <span className={`text-xs ${subTone[s.tone]}`}>{s.sub}</span>
              </div>
            ))}
          </section>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
          <div className="relative min-w-[240px] flex-[1_1_300px] lg:max-w-[440px]">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#5F6E65]" />
            <input type="search" aria-label="ค้นหาใบเบิก" data-testid="search" value={q} onChange={(e) => onSearch(e.target.value)}
              placeholder="ค้นทะเบียน / เบอร์รถ / เลข PR / เลขใบเบิก / MR"
              className={`${ctl} w-full pl-[38px] pr-10 placeholder:text-[#6B7A71] focus:border-[#17793F] focus:outline-none focus:ring-2 focus:ring-[#17793F]/20 [&::-webkit-search-cancel-button]:hidden`} />
            {q !== "" && (
              <button type="button" aria-label="ล้างคำค้น" data-testid="search-clear" onClick={() => onSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[#5F6E65] hover:text-[#14271C]"><X size={16} /></button>
            )}
          </div>
          <div role="group" aria-label="ตัวกรองด่วน" className="flex flex-wrap gap-1.5">
            {QUICK.map((f) => {
              const on = quick === f.id
              const n = data ? quickCount(f.id) : 0
              return (
                <button key={f.id} type="button" aria-pressed={on} data-testid={`quick-${f.id}`} onClick={() => setQuick(on && f.id !== "all" ? "all" : f.id)}
                  className={`inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium ${on ? "border-[#14271C] bg-[#14271C] text-white dark:border-white dark:bg-white dark:text-[#14271C]" : "border-[#D5DCD8] bg-white text-[#2B3D32] hover:border-[#14271C] dark:border-white/10 dark:bg-transparent dark:text-gray-300"}`}>
                  {f.label}{data && <span className="text-xs font-semibold tabular-nums">{n}</span>}
                </button>
              )
            })}
          </div>
          <label className="flex items-center gap-2 text-[13px] text-[#4A5A50] lg:ml-auto dark:text-gray-400">ประเภทงาน
            <select aria-label="ประเภทงาน" value={wtype} onChange={(e) => setWtype(e.target.value as SwWorkType | "all")} className={`${ctl} px-3`}>
              <option value="all">ทั้งหมด</option>
              {WORK_TYPES.map((w) => <option key={w} value={w}>{WORK_TYPE_LABEL[w]}</option>)}
            </select>
          </label>
        </div>
        {filtering && data && (
          <p data-testid="search-count" className="-mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 px-0.5 text-[13px] text-[#4A5A50] dark:text-gray-400">
            <span>เจอในคิวตอนนี้ {total + keyedItems("DONE_TODAY").length} ใบ</span>
            {!deepOn && (
              <button type="button" data-testid="search-deep" disabled={deepBusy} onClick={searchAll} className="font-semibold text-[#157A40] hover:underline disabled:opacity-60 dark:text-emerald-400">
                {deepBusy ? "กำลังค้น..." : "ค้นย้อนหลัง 90 วัน"}
              </button>
            )}
          </p>
        )}

        {link && !link.linked && (
          <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-amber-300 bg-amber-50 py-2.5 pl-4 pr-3 text-[13.5px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            <Link2 size={16} className="shrink-0" />
            <span className="flex-1">ยังไม่ได้ผูกบัญชี ATMS · ผูกก่อนจึงจะส่งของ ตัดยอด หรือรับคืนได้</span>
            <button type="button" onClick={() => setLinkOpen(true)} className="min-h-9 rounded-lg bg-amber-700 px-3.5 text-[13px] font-semibold text-white hover:bg-amber-800">ผูกบัญชี</button>
          </div>
        )}
        {error && <p role="alert" className="rounded-[10px] border border-red-200 bg-red-50 px-4 py-2.5 text-[13.5px] text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">{error}{data ? " · บนจอเป็นข้อมูลรอบก่อน ระบบจะลองใหม่เอง" : ""}</p>}

        {!data ? (
          <div className="grid gap-3 md:grid-cols-5" aria-busy="true">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-56 animate-pulse rounded-xl bg-[#EAEFEC] dark:bg-white/5" />)}</div>
        ) : (
          <>
            <nav aria-label="ช่องงาน" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] md:hidden">
              {COLS.map((c) => (
                <button key={c.key} type="button" aria-pressed={mCol === c.key} onClick={() => setMCol(c.key)}
                  className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium ${mCol === c.key ? "border-[#14271C] bg-[#14271C] text-white dark:border-white dark:bg-white dark:text-[#14271C]" : "border-[#D5DCD8] bg-white text-[#2B3D32] dark:border-white/10 dark:bg-transparent dark:text-gray-300"}`}>
                  <span aria-hidden="true" className={`h-[7px] w-[7px] rounded-[2px] ${c.dot}`} />{c.title}<span className="font-semibold tabular-nums">{colItems(c.key).length + keyedItems(c.key).length}</span>
                </button>
              ))}
            </nav>
            <div className="md:overflow-x-auto md:pb-2" data-testid="board" data-total={total}>
              <div className="md:flex md:min-w-[1240px] md:items-start md:gap-5">
                <div className="min-w-0 md:flex-[3_1_0%] md:space-y-2">
                  <p className={groupLabel}>งานสโตร์ · ต้องดำเนินการ</p>
                  <div className="md:grid md:grid-cols-3 md:items-start md:gap-3">{STORE_COLS.map(renderCol)}</div>
                </div>
                <div className="min-w-0 md:flex-[2_1_0%] md:space-y-2">
                  <p className={groupLabel}>ติดตามหลังส่งของ</p>
                  <div className="md:grid md:grid-cols-2 md:items-start md:gap-3">{FOLLOW_COLS.map(renderCol)}</div>
                </div>
              </div>
            </div>
          </>
        )}

        {deepOn && (
          <section data-testid="deep-results" className="rounded-xl bg-[#EAEFEC] p-2 pb-2.5 dark:bg-white/[0.04]">
            <h2 className="flex flex-wrap items-center gap-2 px-1.5 pb-2.5 pt-1.5">
              <span aria-hidden="true" className="h-2 w-2 rounded-[2px] bg-violet-600" />
              <span className="text-sm font-semibold">ผลค้นย้อนหลัง</span>
              <span className="inline-flex h-[22px] min-w-6 items-center justify-center rounded-full bg-white px-1.5 text-xs font-semibold tabular-nums text-[#2B3D32] dark:bg-white/10 dark:text-gray-200">{deepItems.length}</span>
              <span className="text-xs font-normal text-[#4A5A50] dark:text-gray-400">ในช่วง 90 วัน แสดงสูงสุด 50 ใบล่าสุด</span>
            </h2>
            {deepItems.length === 0 ? (
              <p data-testid="deep-empty" className="rounded-[10px] border border-dashed border-[#C9D1CC] px-3 py-6 text-center text-xs text-[#4A5A50] dark:border-white/10 dark:text-gray-400">ไม่เจอใบที่ตรงกับ &quot;{deepQ}&quot; ใน 90 วันที่ผ่านมา</p>
            ) : (
              <ul className="grid items-start gap-2 md:grid-cols-2 xl:grid-cols-4">
                {deepItems.map((i) => <TicketCard key={`deep-${itemKey(i)}`} item={i} now={now} busy={busy.get(itemKey(i)) ?? null} actions={actions} column={deepColumn(i)} selected={itemKey(i) === selKey} onSelect={pick} />)}
              </ul>
            )}
          </section>
        )}
      </div>

      {selected && (
        <>
          <button type="button" aria-label="ปิดรายละเอียด" tabIndex={-1} onClick={closeSel} className="fixed inset-0 z-30 bg-[#14271C]/20 xl:hidden" />
          <DetailPanel item={selected.item} column={selected.column} now={now} busy={busy.get(itemKey(selected.item)) ?? null} actions={actions} onClose={closeSel} />
        </>
      )}

      {busy.size > 0 && <span className="sr-only" aria-live="polite"><Loader2 className="animate-spin" />กำลังทำรายการ</span>}

      {rej && <RejectDialog no={rej.no} onClose={() => setRej(null)} onSubmit={(reason, ids) => { void doReject(rej, reason, ids) }} />}
      {prep && <PrepareDialog item={prep} onClose={() => setPrep(null)} onReady={markReady} />}
      {linkOpen && (
        <AtmsLinkDialog
          onClose={() => { setLinkOpen(false); pendingAfterLink.current = null }}
          onLinked={(s) => {
            setLink(s); setLinkOpen(false)
            void settle().then(() => swalToast("success", "ผูกบัญชี ATMS แล้ว")).then(() => { const f = pendingAfterLink.current; pendingAfterLink.current = null; f?.() })
          }}
        />
      )}
    </div>
  )
}
