"use client"

// Data + row-lock hook for the /sku/convert/edit work page.
// API (built by the other lane): GET /api/sku-convert/codes, GET|PUT /api/sku-convert/item?id=, POST /api/sku-convert/lock?id=
import { useCallback, useEffect, useRef, useState } from "react"
import { entryFromSuggest } from "@/lib/sku-convert-core"
import type { CodeBook, ConvertDetailResponse, ConvertItem, Entry, Lock } from "@/lib/sku-convert-types"

const HEARTBEAT_MS = 120_000

type TakeResult = { kind: "ok" } | { kind: "held"; holder: Lock | null } | { kind: "error"; message: string }

async function takeLockRequest(id: string): Promise<TakeResult> {
  try {
    const r = await fetch(`/api/sku-convert/lock?id=${encodeURIComponent(id)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "take" }),
    })
    if (r.ok) return { kind: "ok" }
    if (r.status === 409) return { kind: "held", holder: ((await r.json().catch(() => null)) as { holder?: Lock } | null)?.holder ?? null }
    return { kind: "error", message: `จองรหัสไม่สำเร็จ (${r.status})` }
  } catch {
    return { kind: "error", message: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" }
  }
}

function releaseBeacon(id: string) {
  try {
    navigator.sendBeacon(`/api/sku-convert/lock?id=${encodeURIComponent(id)}`, JSON.stringify({ action: "release" }))
  } catch { /* best effort — the lock expires after 30 min anyway */ }
}

export interface SaveResult { ok: boolean; item?: ConvertItem }

export function useConvertItem(id: string) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [item, setItem] = useState<ConvertItem | null>(null)
  const [book, setBook] = useState<CodeBook | null>(null)
  const [liveStock, setLiveStock] = useState<ConvertDetailResponse["liveStock"]>(null)
  const [next, setNext] = useState<string | null>(null)
  const [me, setMe] = useState<ConvertDetailResponse["me"] | null>(null)
  const [entries, setEntriesState] = useState<Entry[]>([])
  const [dirty, setDirty] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const [holder, setHolder] = useState<Lock | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [reloadKey, setReloadKey] = useState(0)
  const held = useRef(false)

  // ---- load codes + item, then take the lock
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [cr, ir] = await Promise.all([
          fetch("/api/sku-convert/codes"),
          fetch(`/api/sku-convert/item?id=${encodeURIComponent(id)}`),
        ])
        if (cancelled) return
        if (ir.status === 404) throw new Error("ไม่พบรหัสนี้")
        if (!cr.ok || !ir.ok) throw new Error(`โหลดข้อมูลไม่สำเร็จ (${!cr.ok ? cr.status : ir.status})`)
        const [b, d] = (await Promise.all([cr.json(), ir.json()])) as [CodeBook, ConvertDetailResponse]
        if (cancelled) return
        const lock = await takeLockRequest(id)
        if (cancelled) { if (lock.kind === "ok") releaseBeacon(id); return }
        held.current = lock.kind === "ok"
        setBook(b); setItem(d.item); setLiveStock(d.liveStock); setNext(d.next); setMe(d.me)
        setEntriesState(d.item.entries.length ? d.item.entries : [entryFromSuggest(d.item)])
        setDirty(false)
        setReadOnly(lock.kind !== "ok")
        setHolder(lock.kind === "held" ? lock.holder : null)
        setError(lock.kind === "error" ? `${lock.message} — เปิดดูได้อย่างเดียว` : "")
        setLoadError("")
        setLoading(false)
      } catch (e) {
        if (cancelled) return
        setLoadError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ")
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [id, reloadKey])

  // ---- heartbeat + release on leave
  useEffect(() => {
    const t = setInterval(async () => {
      if (!held.current) return
      const r = await takeLockRequest(id)
      if (r.kind === "held") { held.current = false; setReadOnly(true); setHolder(r.holder); setError("ล็อกหมดอายุและมีคนอื่นรับไปแล้ว — ยังไม่ได้บันทึกอะไรเพิ่ม") }
    }, HEARTBEAT_MS)
    const onHide = () => { if (held.current) releaseBeacon(id) }
    window.addEventListener("pagehide", onHide)
    return () => {
      clearInterval(t)
      window.removeEventListener("pagehide", onHide)
      if (held.current) { held.current = false; releaseBeacon(id) }
    }
  }, [id])

  const setEntries = useCallback((updater: Entry[] | ((prev: Entry[]) => Entry[])) => {
    setEntriesState(updater)
    setDirty(true)
  }, [])

  const save = useCallback(async (release: boolean): Promise<SaveResult> => {
    if (readOnly) return { ok: false }
    setSaving(true); setError("")
    try {
      const r = await fetch(`/api/sku-convert/item?id=${encodeURIComponent(id)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entries, release }),
      })
      const body = (await r.json().catch(() => null)) as { item?: ConvertItem; error?: string; holder?: Lock } | null
      if (r.status === 409) {
        held.current = false; setReadOnly(true); setHolder(body?.holder ?? null)
        setError(body?.error ?? "มีคนอื่นรับรหัสนี้ไปแล้ว — บันทึกไม่สำเร็จ")
        return { ok: false }
      }
      if (!r.ok || !body?.item) { setError(body?.error ?? `บันทึกไม่สำเร็จ (${r.status})`); return { ok: false } }
      setItem(body.item)
      if (body.item.entries.length) setEntriesState(body.item.entries)
      setDirty(false)
      if (release) held.current = false
      return { ok: true, item: body.item }
    } catch {
      setError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ลองบันทึกอีกครั้ง")
      return { ok: false }
    } finally {
      setSaving(false)
    }
  }, [id, entries, readOnly])

  /** After "locked by someone else": try again (reloads the row so we see their saved work). */
  const retake = useCallback(() => { setLoading(true); setReloadKey((n) => n + 1) }, [])

  return { loading, loadError, item, book, liveStock, next, me, entries, setEntries, dirty, readOnly, holder, saving, error, save, retake }
}
