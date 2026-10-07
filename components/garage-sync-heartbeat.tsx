"use client"

// ส่งสัญญาณ sync อู่ Mena-Next → WMS ทุก 2 นาที ขณะที่มีคนเปิด WMS อยู่ (แท็บที่มองเห็นเท่านั้น)
// server มีล็อกกลาง ทำงานจริงไม่เกิน 1 รอบ / 2 นาที ไม่ว่าเปิดกี่แท็บ — ดู lib/garage-sync-run.ts
import { useEffect } from "react"
import { useSession } from "next-auth/react"

const EVERY_MS = 2 * 60 * 1000

export function GarageSyncHeartbeat() {
  const { status } = useSession()
  useEffect(() => {
    if (status !== "authenticated") return
    const tick = () => {
      if (document.visibilityState !== "visible") return
      fetch("/api/garage-sync/tick", { method: "POST", keepalive: true }).catch(() => {})
    }
    tick()
    const t = setInterval(tick, EVERY_MS)
    // กลับมาที่แท็บหลังซ่อนไว้นาน → ส่งทันที (server ตัดสินเองว่าถึงรอบหรือยัง)
    const onVis = () => { if (document.visibilityState === "visible") tick() }
    document.addEventListener("visibilitychange", onVis)
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis) }
  }, [status])
  return null
}
