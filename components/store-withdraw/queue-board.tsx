"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Bell, BellOff, KeyRound, Loader2, MoreVertical, RefreshCw, Store } from "lucide-react"
import { swalConfirm, swalError, swalTextInput, swalToast } from "@/lib/swal"
import { AtmsLinkDialog } from "./atms-link-dialog"
import { PrepareDialog } from "./prepare-dialog"
import { api, itemKey, type LinkStatus, type QData, type QItem } from "./queue-types"
import { KeyedCard, TicketCard, type CardActions } from "./ticket-card"

type Opt = { id: number; name: string }
type ColKey = "NEW" | "PREPARING" | "READY" | "DONE_TODAY"

const POLL_MS = 10_000
const LATKRABANG = 4
const SOUND_KEY = "sw-queue-sound"
const COLS: { key: ColKey; title: string; dot: string }[] = [
  { key: "NEW", title: "ใหม่", dot: "bg-amber-500" },
  { key: "PREPARING", title: "กำลังจัด", dot: "bg-blue-500" },
  { key: "READY", title: "พร้อมส่ง", dot: "bg-emerald-500" },
  { key: "DONE_TODAY", title: "ส่งแล้ววันนี้", dot: "bg-gray-400" },
]

// ปิด Radix dialog แล้วค่อยเปิด swal: ถ้าเปิดซ้อนในจังหวะเดียวกัน swal จะจำ aria-hidden ของหน้าหลักไว้แล้วคืนค่าทับตอนปิด
// ทำให้ปุ่มทั้งหน้าถูกซ่อนจาก screen reader ค้าง
const settle = () => new Promise<void>((r) => setTimeout(r, 150))
const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

export function QueueBoard() {
  const [invs, setInvs] = useState<Opt[]>([])
  const [inv, setInv] = useState<number | null>(null)
  const [link, setLinkState] = useState<LinkStatus | null>(null)
  const linkRef = useRef<LinkStatus | null>(null) // ให้ action ที่ถูกเรียกซ้ำหลังผูกบัญชี (closure เก่า) เห็นสถานะล่าสุด
  const setLink = useCallback((s: LinkStatus | null) => { linkRef.current = s; setLinkState(s) }, [])
  const [data, setData] = useState<QData | null>(null)
  const [error, setError] = useState("")
  const [now, setNow] = useState(() => new Date())
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [prep, setPrep] = useState<QItem | null>(null)
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
  const setBusyKey = (k: string, on: boolean) => setBusy((s) => { const n = new Set(s); if (on) n.add(k); else n.delete(k); return n })

  const askLink = (then: () => void) => { pendingAfterLink.current = then; setLinkOpen(true) }

  const claim = async (i: QItem) => {
    const k = itemKey(i)
    setBusyKey(k, true)
    try { await api(`/api/store-withdraw/${i.no}/claim`, { method: "POST" }); await load() }
    catch (e) { await swalToast("warning", errMsg(e, "รับงานไม่สำเร็จ")); await load() }
    finally { setBusyKey(k, false) }
  }

  const issue = async (i: QItem) => {
    if (!linkRef.current?.linked) { askLink(() => { void issue(i) }); return }
    if (i.kind === "cutoff" && i.status === "NEW") {
      const c = await swalConfirm(`ตัดยอดใบ ${i.no}?`, "ตัดสต๊อกใน ATMS ทันที ย้อนไม่ได้")
      if (!c.isConfirmed) return
    }
    const k = itemKey(i)
    setBusyKey(k, true)
    try {
      const res = await api(`/api/store-withdraw/${i.no}/issue`, { method: "POST" })
      const r = res.request as QItem
      if (r.status === "ISSUED") await swalToast("success", `ตัดใน ATMS แล้ว เลข WD ${r.atms.code ?? "-"}`)
      else if (r.status === "ISSUE_FAILED") {
        if (r.atms.needCreds) { setLink({ linked: false }); askLink(() => { void issue(i) }) }
        else await swalToast("error", r.atms.error || "ส่ง ATMS ไม่สำเร็จ")
      }
      await load()
    } catch (e) {
      await swalToast("warning", errMsg(e, "ส่งของไม่สำเร็จ"))
      await load()
    } finally { setBusyKey(k, false) }
  }

  const reject = async (i: QItem) => {
    const r = await swalTextInput({ title: `ปฏิเสธใบ ${i.no}`, label: "เหตุผล (ผู้ขอจะเห็นข้อความนี้)", placeholder: "เช่น ของหมด รออะไหล่เข้า", required: true, confirmText: "ปฏิเสธ", danger: true })
    if (!r.isConfirmed || !r.value?.trim()) return
    const k = itemKey(i)
    setBusyKey(k, true)
    try { await api(`/api/store-withdraw/${i.no}/reject`, { method: "POST", body: { reason: r.value.trim() } }); await load() }
    catch (e) { await swalToast("warning", errMsg(e, "ปฏิเสธไม่สำเร็จ")); await load() }
    finally { setBusyKey(k, false) }
  }

  const acceptReturn = async (i: QItem) => {
    if (!i.return) return
    if (!linkRef.current?.linked) { askLink(() => { void acceptReturn(i) }); return }
    const k = itemKey(i)
    setBusyKey(k, true)
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
    } finally { setBusyKey(k, false) }
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

  const actions: CardActions = { claim, prepare: setPrep, issue, reject, acceptReturn }
  const total = data ? COLS.reduce((n, c) => n + data.columns[c.key].length, 0) : 0

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1B8C4B]/10 text-[#1B8C4B]"><Store size={20} /></div>
          <div>
            <h1 className="text-lg font-bold text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>คิวงานสโตร์</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">อัปเดตเองทุก 10 วินาที{link?.linked && link.atmsUsername ? ` · ATMS: ${link.atmsUsername}` : ""}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="คลัง" value={inv ?? ""} onChange={(e) => { invTouched.current = true; setData(null); setInv(Number(e.target.value)) }}
            className="rounded-xl border border-[#E2E8E4] bg-white px-3 py-2.5 text-sm dark:border-white/10 dark:bg-[#0f1117]">
            {invs.length === 0 && inv != null && <option value={inv}>คลัง {inv}</option>}
            {invs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button type="button" onClick={toggleSound} aria-pressed={soundOn}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm ${soundOn ? "border-[#1B8C4B] bg-[#1B8C4B]/10 text-[#1B8C4B]" : "border-[#E2E8E4] text-gray-600 dark:border-white/10 dark:text-gray-300"}`}>
            {soundOn ? <Bell size={16} /> : <BellOff size={16} />}{soundOn ? "เสียงเตือนเปิดอยู่" : "เปิดเสียงเตือน"}
          </button>
          <button type="button" onClick={() => { void load() }} aria-label="โหลดใหม่" className="rounded-xl border border-[#E2E8E4] p-2.5 text-gray-600 hover:text-[#1B8C4B] dark:border-white/10"><RefreshCw size={16} /></button>
          <div className="relative">
            <button type="button" onClick={() => setMenuOpen((o) => !o)} aria-label="เมนู" aria-haspopup="menu" aria-expanded={menuOpen} className="rounded-xl border border-[#E2E8E4] p-2.5 text-gray-600 dark:border-white/10"><MoreVertical size={16} /></button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 z-20 mt-1 w-56 rounded-xl border border-[#E2E8E4] bg-white p-1 shadow-lg dark:border-white/10 dark:bg-[#161922]">
                <button role="menuitem" type="button" onClick={() => { setMenuOpen(false); setLinkOpen(true) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-gray-50 dark:hover:bg-white/5"><KeyRound size={14} />{link?.linked ? "ผูกบัญชี ATMS ใหม่" : "ผูกบัญชี ATMS"}</button>
                {link?.linked && <button role="menuitem" type="button" onClick={unlink} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10">เลิกผูกบัญชี ATMS</button>}
              </div>
            )}
          </div>
        </div>
      </div>

      {link && !link.linked && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          <span>ยังไม่ได้ผูกบัญชี ATMS — ผูกก่อนจึงจะส่งของ ตัดยอด หรือรับคืนได้</span>
          <button type="button" onClick={() => setLinkOpen(true)} className="rounded-lg bg-amber-600 px-3 py-1.5 text-white">ผูกบัญชี</button>
        </div>
      )}
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}

      {!data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="h-48 animate-pulse rounded-2xl bg-gray-100 dark:bg-white/5" />)}</div>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-4" data-testid="board" data-total={total}>
          {COLS.map((c) => {
            const items = data.columns[c.key]
            const keyed = c.key === "DONE_TODAY" ? data.atmsKeyed : []
            return (
              <section key={c.key} data-col={c.key} className="min-w-0 rounded-2xl bg-[#F6F8F7] p-3 dark:bg-white/[0.03]">
                <h2 className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold text-gray-700 dark:text-gray-200">
                  <span className={`h-2.5 w-2.5 rounded-full ${c.dot}`} />{c.title}
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-white/10">{items.length + keyed.length}</span>
                </h2>
                {items.length + keyed.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-[#E2E8E4] px-3 py-6 text-center text-xs text-gray-400 dark:border-white/10">ไม่มีงาน</p>
                ) : (
                  <ul className="space-y-3">
                    {items.map((i) => <TicketCard key={itemKey(i)} item={i} now={now} busy={busy.has(itemKey(i))} actions={actions} column={c.key} />)}
                    {keyed.map((k, n) => <KeyedCard key={`${k.id ?? k.code}-${n}`} row={k} />)}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}

      {busy.size > 0 && <span className="sr-only" aria-live="polite"><Loader2 className="animate-spin" />กำลังทำรายการ</span>}

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
