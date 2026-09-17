"use client"

// components/safety-stock-runs-bar.tsx
// แถบ "รอบอัปเดตวันนี้" ของหน้า /safety-stock — บอกว่าวันนี้คำนวณไปแล้วกี่รอบ รอบไหนสำเร็จ/พลาด รอบหน้าอีกนานเท่าไร
//
// ข้อมูลมาจาก /api/safety-stock/runs (ไม่แคช) คนละ endpoint กับ payload หลักที่แคชไว้ — ดูคอมเมนต์ในไฟล์ route
// ช่องในแถบมาจาก BUILD_SCHEDULE ใน lib/safety-stock-core.ts ซึ่งต้องตรงกับ scheduler ของ api-ncac + vercel.json
import { useCallback, useEffect, useState } from "react"
import { Check, X, TriangleAlert } from "lucide-react"
import { fmtMovementDate, WAREHOUSES, type BuildSource } from "@/lib/safety-stock-core"

type SlotStatus = "ok" | "error" | "running" | "stale" | "pending" | "missed"

type Slot = {
  hhmm: string
  source: BuildSource
  /** ที่มาจริงของรอบที่มาตกช่องนี้ — null เมื่อยังไม่มีรอบ ให้ถอยไปใช้ source ตามตาราง */
  runSource: BuildSource | null
  label: string
  scheduledAt: string
  status: SlotStatus
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  written: number | null
  error: string | null
  warehouse: { written: number; latestMovementDate: string | null; error: string | null } | null
  /** คลังอื่นที่พลาดในรอบเดียวกัน (จุดใช้ผลของคลังที่ดูอยู่) */
  otherErrors?: { inventoryId: string; error: string }[]
}

type RunsPayload = {
  now: string
  slots: Slot[]
  extraRuns: { source: string; startedAt: string; status: string; written: number | null }[]
  doneCount: number
  totalCount: number
  nextAt: string | null
  lastRunAt: string | null
}

/** ต้องระบุ timeZone ตรงๆ — ผู้ใช้เปิดจากเครื่องที่ตั้งโซนเวลาอื่นได้ เวลาบนแถบต้องเป็นเวลาไทยเสมอ
 *  ไม่งั้นเลข 12:30 ในตารางกับเวลาที่โชว์ว่ารันจริงจะดูไม่ตรงกันโดยไม่มีสาเหตุที่ผู้ใช้เดาได้ */
const bkkTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }) : "—"
const bkkDay = (iso: string) =>
  new Date(iso).toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" })

/** "3 ชม. 56 นาที" — ตัดหน่วยที่เป็นศูนย์ทิ้ง ไม่โชว์ "0 ชม. 56 นาที" */
function humanGap(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000))
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} นาที`
  if (m === 0) return `${h} ชม.`
  return `${h} ชม. ${m} นาที`
}

const STATUS_COLOR: Record<SlotStatus, string> = {
  ok: "#16A34A", error: "#DC2626", running: "#2563EB",
  stale: "#B45309", missed: "#F59E0B", pending: "#D1D5DB",
}

const STATUS_TEXT: Record<SlotStatus, string> = {
  ok: "สำเร็จ", error: "ล้มเหลว", running: "กำลังคำนวณ",
  stale: "ค้าง — ไม่รู้ผล", missed: "ไม่ได้รัน", pending: "ยังไม่ถึงรอบ",
}

const SOURCE_TEXT: Record<BuildSource, string> = {
  pipeline: "api-ncac ยิงมาหลังข้อมูลลง Mongo",
  "daily-cron": "cron รายวันของ Vercel",
  manual: "เรียกเอง",
}

const whName = (id: string) => WAREHOUSES.find((w) => w.id === id)?.name ?? `คลัง ${id}`

function tooltipOf(s: Slot): string {
  const lines = [
    `${s.hhmm} — ${STATUS_TEXT[s.status]}`,
    `ที่มา: ${SOURCE_TEXT[s.runSource ?? s.source]} (${s.label})`,
  ]
  if (s.startedAt) lines.push(`เริ่ม ${bkkTime(s.startedAt)}${s.finishedAt ? ` · เสร็จ ${bkkTime(s.finishedAt)}` : ""}`)
  if (s.durationMs != null) lines.push(`ใช้เวลา ${(s.durationMs / 1000).toFixed(1)} วินาที`)
  if (s.warehouse) {
    lines.push(`คลังนี้: เขียน ${s.warehouse.written.toLocaleString("th-TH")} แถว`)
    if (s.warehouse.latestMovementDate) lines.push(`เคลื่อนไหวล่าสุดถึง ${fmtMovementDate(s.warehouse.latestMovementDate)}`)
    if (s.warehouse.error) lines.push(`⚠️ ${s.warehouse.error}`)
  } else if (s.written != null) {
    lines.push(`เขียนรวมทุกคลัง ${s.written.toLocaleString("th-TH")} แถว`)
  }
  // error ของทั้งรอบซ้ำกับของคลังอื่นด้านล่างอยู่แล้ว — โชว์เฉพาะเมื่อไม่มีผลรายคลังให้ดู
  if (s.error && !s.warehouse) lines.push(`⚠️ ${s.error}`)
  for (const o of s.otherErrors ?? []) lines.push(`คลังอื่นในรอบนี้ — ${whName(o.inventoryId)}: ⚠️ ${o.error}`)
  return lines.join("\n")
}

function Dot({ status }: { status: SlotStatus }) {
  const color = STATUS_COLOR[status]
  const filled = status !== "pending"
  return (
    <div
      style={{
        width: 20, height: 20, borderRadius: 999, flexShrink: 0,
        border: `2px solid ${color}`,
        background: filled ? color : "#fff",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#fff", zIndex: 1,
      }}
    >
      {status === "ok" && <Check size={12} strokeWidth={3.5} />}
      {status === "error" && <X size={12} strokeWidth={3.5} />}
      {(status === "stale" || status === "missed") && <TriangleAlert size={11} strokeWidth={3} />}
      {status === "running" && (
        <span
          style={{
            width: 8, height: 8, borderRadius: 999, background: "#fff",
            animation: "ssPulse 1s ease-in-out infinite",
          }}
        />
      )}
    </div>
  )
}

export function SafetyStockRunsBar({ inventoryId }: { inventoryId: string }) {
  const [data, setData] = useState<RunsPayload | null>(null)
  const [failed, setFailed] = useState(false)
  // นาฬิกาเดินเองทุก 30 วิ เพื่อให้ข้อความ "อีก x นาที" ขยับโดยไม่ต้องยิง API ใหม่
  // ตั้งค่าเริ่มต้นเป็น 0 ไม่ใช่ Date.now() — ค่าที่ต่างกันระหว่าง SSR กับ client ทำให้ hydration ไม่ตรง
  const [nowMs, setNowMs] = useState(0)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/safety-stock/runs?inventory=${inventoryId}`, { cache: "no-store" })
      if (!res.ok) throw new Error(String(res.status))
      setData(await res.json())
      setFailed(false)
    } catch {
      // แถบนี้เป็นข้อมูลประกอบ พังแล้วต้องไม่บังหน้าหลัก — ซ่อนตัวเองเงียบๆ
      setFailed(true)
    }
  }, [inventoryId])

  // โหลดครั้งแรก/ตอนสลับคลัง — เขียนเป็นเชน .then แบบเดียวกับ safety-stock-page.tsx ไม่ใช่ `void load()`
  // เพราะกฎ react-hooks/set-state-in-effect มองไม่เห็นว่า setState ของฟังก์ชัน async เกิดหลัง await
  useEffect(() => {
    let cancelled = false
    fetch(`/api/safety-stock/runs?inventory=${inventoryId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: RunsPayload) => { if (!cancelled) { setData(d); setFailed(false) } })
      // แถบนี้เป็นข้อมูลประกอบ พังแล้วต้องไม่บังหน้าหลัก — ซ่อนตัวเองเงียบๆ
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [inventoryId])
  // ตั้งนาฬิกาจาก interval เท่านั้น ไม่เซ็ตทันทีในตัว effect (กฎ react-hooks/set-state-in-effect)
  // ช่วง 30 วิแรกหลัง mount จึงใช้เวลาของเซิร์ฟเวอร์จาก payload ซึ่งเพิ่งดึงมาสดๆ อยู่แล้ว
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  // ระหว่างที่มีรอบกำลังรัน ถามถี่ขึ้น (30 วิ) นอกนั้นถามทุก 5 นาทีพอ — collection เล็กแต่ไม่มีเหตุให้ยิงถี่เปล่าๆ
  useEffect(() => {
    const running = data?.slots.some((s) => s.status === "running") ?? false
    const t = setInterval(() => void load(), running ? 30_000 : 300_000)
    return () => clearInterval(t)
  }, [data, load])

  if (failed || !data) return null

  // nowMs = 0 คือยังไม่ทันตั้งนาฬิกา (render แรกหลัง mount) — ใช้เวลาจากเซิร์ฟเวอร์ไปก่อน
  const now = nowMs || new Date(data.now).getTime()
  const nextGap = data.nextAt ? new Date(data.nextAt).getTime() - now : null
  const lastSlot = [...data.slots].reverse().find((s) => s.startedAt) ?? null
  const hasProblem = data.slots.some((s) => s.status === "error" || s.status === "stale" || s.status === "missed")

  return (
    <div
      style={{
        border: `1px solid ${hasProblem ? "#FDE68A" : "#E5E7EB"}`,
        background: hasProblem ? "#FFFBEB" : "#fff",
        borderRadius: 10, padding: "12px 16px 10px", marginBottom: 16,
      }}
    >
      <style>{`@keyframes ssPulse { 0%,100% { opacity: 1 } 50% { opacity: .25 } }`}</style>

      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>รอบอัปเดตวันนี้</span>
        <span style={{ fontSize: 12, color: "#9CA3AF" }}>{bkkDay(data.now)}</span>
        <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: hasProblem ? "#B45309" : "#16A34A" }}>
          เสร็จ {data.doneCount} จาก {data.totalCount} รอบ
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start" }}>
        {data.slots.map((s, i) => {
          const prev = i > 0 ? data.slots[i - 1] : null
          // เส้นเชื่อมทึบเมื่อรอบก่อนหน้า "ผ่านไปแล้ว" (ไม่ว่าผลจะสำเร็จหรือไม่) — เส้นบอกความคืบหน้าของเวลา
          // ไม่ใช่ความสำเร็จ ซึ่งจุดเป็นคนบอกอยู่แล้ว
          const linkDone = prev != null && prev.status !== "pending"
          return (
            <div key={s.hhmm} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
              {i > 0 && (
                <div
                  style={{
                    position: "absolute", top: 9, right: "50%", left: "-50%", height: 2,
                    background: linkDone ? "#9CA3AF" : "transparent",
                    borderTop: linkDone ? "none" : "2px dashed #E5E7EB",
                  }}
                />
              )}
              <div title={tooltipOf(s)} style={{ display: "flex", flexDirection: "column", alignItems: "center", cursor: "help" }}>
                <Dot status={s.status} />
                <div style={{ fontSize: 11, marginTop: 6, fontWeight: s.status === "pending" ? 400 : 700, color: s.status === "pending" ? "#9CA3AF" : "#374151" }}>
                  {s.hhmm}
                </div>
                {s.source === "daily-cron" && (
                  <div style={{ fontSize: 9.5, color: "#9CA3AF", marginTop: 1, whiteSpace: "nowrap" }}>+ คงเหลือ</div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ fontSize: 11.5, color: "#6B7280", marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
        {lastSlot && (
          <span>
            ล่าสุด {bkkTime(lastSlot.finishedAt ?? lastSlot.startedAt)} น.
            {lastSlot.warehouse ? ` · ${lastSlot.warehouse.written.toLocaleString("th-TH")} แถว` : ""}
            {lastSlot.warehouse?.latestMovementDate ? ` · เคลื่อนไหวล่าสุด ${fmtMovementDate(lastSlot.warehouse.latestMovementDate)}` : ""}
          </span>
        )}
        {nextGap != null && nextGap > 0 && (
          <span>· รอบถัดไป {bkkTime(data.nextAt)} น. (อีก {humanGap(nextGap)})</span>
        )}
        {nextGap == null && <span>· หมดรอบของวันนี้แล้ว รอบถัดไปพรุ่งนี้ {data.slots[0]?.hhmm} น.</span>}
        {data.extraRuns.length > 0 && <span>· มีรอบนอกตารางอีก {data.extraRuns.length} รอบ</span>}
      </div>
    </div>
  )
}
