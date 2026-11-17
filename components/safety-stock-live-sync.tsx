"use client"
// ปุ่ม "ดึงข้อมูลล่าสุดจาก ATMS" + ขั้นตอนที่กำลังทำ — งานจริงเดินที่ api-ncac (ดู lib/safety-stock-live-sync.ts)
// หน้านี้แค่ถามสถานะซ้ำทุก 5 วิระหว่างที่มีรอบเดินอยู่ แล้วบอกหน้าแม่ให้โหลดข้อมูลใหม่ทุกครั้งที่คำนวณเสร็จหนึ่งรอบ
import { useCallback, useEffect, useRef, useState } from "react"
import { Check, Loader2, RefreshCw, X } from "lucide-react"
import { swalError, swalToast } from "@/lib/swal"
import { WAREHOUSES } from "@/lib/safety-stock-core"
import {
  LIVE_STEPS, LIVE_SYNC_DAYS, lastBuildDoneAt, type LiveStepStatus, type LiveSyncState,
} from "@/lib/safety-stock-live-sync"

const POLL_MS = 5_000
const whName = (id?: string) => WAREHOUSES.find((w) => w.id === id)?.name ?? (id ? `คลัง ${id}` : "")

function StepIcon({ status }: { status: LiveStepStatus }) {
  if (status === "ok") return <Check size={13} color="#16A34A" />
  if (status === "error") return <X size={13} color="#DC2626" />
  if (status === "running") return <Loader2 size={13} color="#2563EB" className="animate-spin" />
  return <span style={{ width: 13, height: 13, borderRadius: 999, border: "1.5px solid #D1D5DB", display: "inline-block" }} />
}

export function SafetyStockLiveSync({ inventoryId, onFresh }: { inventoryId: string; onFresh: (afterIso: string) => void }) {
  const [state, setState] = useState<LiveSyncState | null>(null)
  const [waitMin, setWaitMin] = useState(0)
  const [starting, setStarting] = useState(false)
  // โชว์ขั้นตอนระหว่างรอบเดิน + 30 นาทีหลังจบ (รอบเก่ากว่านั้นไม่ต้องโชว์) — คิดตอนได้สถานะ ไม่ใช่ตอน render
  const [recent, setRecent] = useState(false)
  const notified = useRef<string | null>(null)
  const wasRunning = useRef(false)
  const onFreshRef = useRef(onFresh)
  useEffect(() => { onFreshRef.current = onFresh }, [onFresh])

  const apply = useCallback((s: LiveSyncState | null, wait?: number) => {
    setState(s)
    setRecent(!!s && (s.status === "running" || (!!s.finishedAt && Date.now() - new Date(s.finishedAt).getTime() < 30 * 60_000)))
    if (wait != null) setWaitMin(wait)
    // คำนวณเสร็จรอบใหม่ของคลังที่กำลังดู → ให้หน้าแม่ดึงข้อมูลใหม่ (รอบละครั้ง)
    const done = lastBuildDoneAt(s)
    if (done && s?.inventory === inventoryId && notified.current !== done) {
      // รอบที่จบไปก่อนเปิดหน้า ไม่ต้องโหลดซ้ำ — จำไว้เฉยๆ
      if (notified.current !== null || s?.status === "running") onFreshRef.current(done)
      notified.current = done
    }
    if (wasRunning.current && s && s.status !== "running") {
      if (s.status === "ok") swalToast("success", "ดึงข้อมูลล่าสุดจาก ATMS ครบแล้ว")
      else swalError(`ดึงข้อมูลบางขั้นไม่สำเร็จ${s.error ? `: ${s.error}` : ""} ตัวเลขที่เห็นมาจากขั้นที่ผ่านแล้ว`)
    }
    wasRunning.current = s?.status === "running"
  }, [inventoryId])

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/safety-stock/live-sync", { cache: "no-store" })
      const json = await res.json()
      if (res.ok) apply(json.state, json.waitMin)
    } catch { /* ถามรอบหน้าใหม่ */ }
  }, [apply])

  // ถามครั้งแรกตอนเปิดหน้า/สลับคลัง · ระหว่างมีรอบเดินอยู่ถามทุก 5 วิ
  useEffect(() => {
    notified.current = null
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])
  const running = state?.status === "running"
  useEffect(() => {
    if (!running) return
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [running, load])
  // นับถอยหลัง cooldown ทีละนาที
  useEffect(() => {
    if (running || waitMin <= 0) return
    const t = setInterval(() => setWaitMin((m) => Math.max(0, m - 1)), 60_000)
    return () => clearInterval(t)
  }, [running, waitMin])

  async function start() {
    setStarting(true)
    try {
      const res = await fetch("/api/safety-stock/live-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inventory: inventoryId }),
      })
      const json = await res.json()
      if (res.status === 429) {
        setWaitMin(json.retry_after_min ?? 1)
        swalToast("info", `เพิ่งมีคนดึงไป กดได้อีกใน ${json.retry_after_min} นาที`)
        return
      }
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      if (!json.started) swalToast("info", `มีรอบที่กำลังดึงอยู่แล้ว (${whName(json.state?.inventory)}) รอดูผลได้เลย`)
      apply(json.state, json.waitMin)
    } catch (e) {
      swalError(`สั่งดึงข้อมูลไม่สำเร็จ: ${e instanceof Error ? e.message : e}`)
    } finally {
      setStarting(false)
    }
  }

  const disabled = starting || running || waitMin > 0
  const showSteps = !!state?.steps && recent

  return (
    <div style={{ border: "1px solid #E5E7EB", borderRadius: 10, background: "#fff", padding: "10px 14px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          onClick={start}
          disabled={disabled}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "none",
            background: disabled ? "#E5E7EB" : "#111827", color: disabled ? "#6B7280" : "#fff",
            fontSize: 13, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          <RefreshCw size={14} className={running || starting ? "animate-spin" : ""} />
          {running ? "กำลังดึงจาก ATMS…" : `ดึงข้อมูลล่าสุดจาก ATMS (${LIVE_SYNC_DAYS} วัน)`}
        </button>
        <span style={{ fontSize: 12, color: "#6B7280" }}>
          {running
            ? `${whName(state?.inventory)}${state?.user ? ` · กดโดย ${state.user}` : ""} · ใช้เวลาราว 5–15 นาที ปิดหน้านี้ได้ ระบบดึงต่อเอง`
            : waitMin > 0
              ? `เพิ่งดึงไป กดได้อีกใน ${waitMin} นาที`
              : "ไม่ต้องรอรอบถัดไป คงเหลือ/min/max ขึ้นก่อนในราว 1 นาที PR/PO ตามมาทีหลัง"}
        </span>
      </div>

      {showSteps && state?.steps && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, fontSize: 12 }}>
          {state.inventory !== inventoryId && (
            <span style={{ color: "#B45309", fontWeight: 600 }}>รอบนี้เป็นของ{whName(state.inventory)}</span>
          )}
          {LIVE_STEPS.map(({ key, label }) => {
            const s = state.steps![key]
            return (
              <span key={key} title={s?.note ?? undefined} style={{ display: "inline-flex", alignItems: "center", gap: 5, color: s?.status === "pending" ? "#9CA3AF" : "#374151" }}>
                <StepIcon status={s?.status ?? "pending"} /> {label}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
