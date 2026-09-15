// app/api/safety-stock/runs/route.ts
// รอบ build ของ "วันนี้" (เวลาไทย) สำหรับแถบ "รอบอัปเดตวันนี้" บนหน้า /safety-stock
//
// แยก endpoint ออกจาก /api/safety-stock โดยตั้งใจ — payload หลักนั้นแคชไว้ (TTL ใน lib/safety-stock.ts)
// เพราะเป็นข้อมูลก้อนใหญ่ที่เปลี่ยนเฉพาะตอน build เท่านั้น ส่วนแถบสถานะต้องสดจริงทุกครั้งที่เปิดดู
// ไม่งั้นจะโชว์ว่า "ยังไม่รัน" ทั้งที่รันไปแล้ว · ราคาที่จ่ายคือ find บน collection ที่มีไม่เกิน ~200 doc
// (TTL 30 วัน ดู RUNS_COLL ใน lib/safety-stock-build.ts) ซึ่งถูกกว่าการรื้อ cache ของ payload หลักมาก
import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import {
  BUILD_SCHEDULE, SLOT_MATCH_WINDOW_MIN, RUN_STALE_AFTER_MIN, INVENTORY_ID,
  type BuildSource,
} from "@/lib/safety-stock-core"

export const dynamic = "force-dynamic"

const DB = process.env.MONGO_DB ?? "master_data"
const TH_OFFSET_MS = 7 * 3600_000
/** เผื่อรอบที่เริ่มก่อนเวลาในตารางเล็กน้อย (นาฬิกาสองเครื่องไม่ตรงกันเป๊ะ) ให้ยังนับเป็นของช่องนั้น */
const SLOT_LEAD_MIN = 5

export type SlotStatus = "ok" | "error" | "running" | "stale" | "pending" | "missed"

type RunDoc = {
  startedAt: Date
  finishedAt?: Date | null
  durationMs?: number | null
  source?: BuildSource
  status?: string
  written?: number
  error?: string | null
  warehouses?: { inventoryId: string; written: number; latestMovementDate: string | null; error: string | null }[]
}

/** เที่ยงคืนของ "วันนี้" ตามเวลาไทย คืนเป็น Date ของ UTC จริง — ไทยไม่มี DST เลื่อน 7 ชม.ตรงๆ ได้ */
function thaiMidnightUtc(now: Date): Date {
  const th = new Date(now.getTime() + TH_OFFSET_MS)
  return new Date(Date.UTC(th.getUTCFullYear(), th.getUTCMonth(), th.getUTCDate()) - TH_OFFSET_MS)
}

export async function GET(req: NextRequest) {
  try {
    const inventoryId = req.nextUrl.searchParams.get("inventory") ?? INVENTORY_ID
    const now = new Date()
    const dayStart = thaiMidnightUtc(now)

    const client = await clientPromise
    const runs = (await client
      .db(DB)
      .collection("safety_stock_build_runs")
      .find({ startedAt: { $gte: dayStart } })
      .sort({ startedAt: 1 })
      .limit(50) // เพดานกันกรณีมีคนยิง build รัวๆ เอง — ตารางปกติมี 6 รอบ/วัน
      .maxTimeMS(10_000)
      .toArray()) as unknown as RunDoc[]

    // จับรอบจริงเข้าช่องตามตาราง — ช่องละไม่เกินหนึ่งรอบ รอบที่เหลือไปกอง extraRuns
    const taken = new Set<number>()
    const slots = BUILD_SCHEDULE.map((slot) => {
      const [hh, mm] = slot.hhmm.split(":").map(Number)
      const slotAt = new Date(dayStart.getTime() + (hh * 60 + mm) * 60_000)
      const from = slotAt.getTime() - SLOT_LEAD_MIN * 60_000
      const to = slotAt.getTime() + SLOT_MATCH_WINDOW_MIN * 60_000

      const idx = runs.findIndex((r, i) => {
        if (taken.has(i)) return false
        const t = new Date(r.startedAt).getTime()
        return t >= from && t <= to
      })
      const run = idx >= 0 ? runs[idx] : null
      if (idx >= 0) taken.add(idx)

      let status: SlotStatus
      if (!run) status = now.getTime() <= to ? "pending" : "missed"
      else if (run.status === "running") {
        const ageMin = (now.getTime() - new Date(run.startedAt).getTime()) / 60_000
        status = ageMin > RUN_STALE_AFTER_MIN ? "stale" : "running"
      } else status = run.status === "ok" ? "ok" : "error"

      // ข้อมูลรายคลังของคลังที่กำลังดูอยู่ — คลังอื่นในรอบเดียวกันอาจสำเร็จ/พลาดไม่เหมือนกัน
      const wh = run?.warehouses?.find((w) => w.inventoryId === inventoryId) ?? null

      return {
        hhmm: slot.hhmm,
        source: slot.source,
        // ที่มาจริงของรอบที่มาตกช่องนี้ — ไม่จำเป็นต้องตรงกับ slot.source ที่เป็นแค่ "ที่คาดว่าจะเป็น"
        // (เช่น คนรัน build เองตอน 13:33 จะมาตกช่อง 12:30 ซึ่งตามตารางเป็นของ pipeline) tooltip ต้องบอกของจริง
        runSource: run?.source ?? null,
        label: slot.label,
        scheduledAt: slotAt.toISOString(),
        status,
        startedAt: run ? new Date(run.startedAt).toISOString() : null,
        finishedAt: run?.finishedAt ? new Date(run.finishedAt).toISOString() : null,
        durationMs: run?.durationMs ?? null,
        written: run?.written ?? null,
        error: run?.error ?? null,
        warehouse: wh ? { written: wh.written, latestMovementDate: wh.latestMovementDate, error: wh.error } : null,
      }
    })

    const extraRuns = runs
      .filter((_, i) => !taken.has(i))
      .map((r) => ({
        source: r.source ?? "manual",
        startedAt: new Date(r.startedAt).toISOString(),
        status: r.status === "ok" ? "ok" : r.status === "running" ? "running" : "error",
        written: r.written ?? null,
      }))

    const done = slots.filter((s) => s.status === "ok").length
    const next = slots.find((s) => s.status === "pending") ?? null
    const lastDone = [...slots].reverse().find((s) => s.startedAt && s.status !== "pending") ?? null

    return NextResponse.json({
      now: now.toISOString(),
      inventoryId,
      slots,
      extraRuns,
      doneCount: done,
      totalCount: slots.length,
      nextAt: next?.scheduledAt ?? null,
      lastRunAt: lastDone?.finishedAt ?? lastDone?.startedAt ?? null,
    })
  } catch (e) {
    console.error("[safety-stock/runs] ", e)
    return NextResponse.json({ error: "ดึงสถานะรอบอัปเดตไม่สำเร็จ", detail: String(e) }, { status: 500 })
  }
}
