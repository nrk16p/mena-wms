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
  BUILD_SCHEDULE, SLOT_LEAD_MIN, INVENTORY_ID, hourSlotStatus, runSlotStatus,
  type BuildSource, type RunSlotStatus,
} from "@/lib/safety-stock-core"

export const dynamic = "force-dynamic"

const DB = process.env.MONGO_DB ?? "master_data"
const TH_OFFSET_MS = 7 * 3600_000

export type SlotStatus = RunSlotStatus

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
    const allRuns = (await client
      .db(DB)
      .collection("safety_stock_build_runs")
      .find({ startedAt: { $gte: dayStart } })
      .sort({ startedAt: 1 })
      .limit(80) // เพดานกันกรณีมีคนยิง build รัวๆ เอง — ตารางปกติ ~20 รอบ/วัน (PR รายชั่วโมง 14 + ความเคลื่อนไหว 5 + daily-cron 1)
      .maxTimeMS(10_000)
      .toArray()) as unknown as RunDoc[]

    // ช่องละ 1 ชั่วโมง: ทุกรอบที่เริ่มใน [HH:00−5 นาที, HH+1:00−5 นาที) ตกช่องนี้ — ดู BUILD_SCHEDULE
    const taken = new Set<number>()
    const slots = BUILD_SCHEDULE.map((slot) => {
      const [hh, mm] = slot.hhmm.split(":").map(Number)
      const slotAt = new Date(dayStart.getTime() + (hh * 60 + mm) * 60_000)
      const from = dayStart.getTime() + (hh * 60 - SLOT_LEAD_MIN) * 60_000
      const to = from + 60 * 60_000

      const inSlot: RunDoc[] = []
      allRuns.forEach((r, i) => {
        const t = new Date(r.startedAt).getTime()
        if (t >= from && t < to) { inSlot.push(r); taken.add(i) }
      })
      const status: SlotStatus = hourSlotStatus(inSlot, inventoryId, now.getTime(), to)
      // รอบตัวแทนของช่อง (ตัวเลขใต้แถบ + tooltip หลัก) = รอบล่าสุดที่สำเร็จ ไม่มีก็รอบล่าสุด
      const okRuns = inSlot.filter((r) => runSlotStatus(r, inventoryId, now.getTime(), to) === "ok")
      const run = okRuns[okRuns.length - 1] ?? inSlot[inSlot.length - 1] ?? null
      const wh = run?.warehouses?.find((w) => w.inventoryId === inventoryId) ?? null
      // คลังอื่นที่พลาดในรอบเดียวกัน — บอกใน tooltip ไม่ให้หายเงียบ แม้จุดของคลังนี้จะเป็น ✓
      const otherErrors = (run?.warehouses ?? [])
        .filter((w) => w.inventoryId !== inventoryId && w.error)
        .map((w) => ({ inventoryId: w.inventoryId, error: w.error as string }))

      return {
        hhmm: slot.hhmm,
        source: slot.source,
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
        otherErrors,
        // ทุกรอบในชั่วโมงนี้ — ให้ tooltip บอกได้ว่ารอบไหนมาจากอะไร ใช้เวลาเท่าไร
        runs: inSlot.map((r) => ({
          source: r.source ?? "manual",
          startedAt: new Date(r.startedAt).toISOString(),
          durationMs: r.durationMs ?? null,
          status: runSlotStatus(r, inventoryId, now.getTime(), to),
        })),
      }
    })

    const extraRuns = allRuns
      .filter((_, i) => !taken.has(i))
      .map((r) => ({
        source: r.source ?? "manual",
        startedAt: new Date(r.startedAt).toISOString(),
        status: r.status === "ok" ? "ok" : r.status === "running" ? "running" : "error",
        written: r.written ?? null,
      }))

    const done = slots.filter((s) => s.status === "ok").length
    const next = slots.find((s) => s.status === "pending" && new Date(s.scheduledAt).getTime() > now.getTime())
      ?? slots.find((s) => s.status === "pending") ?? null
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
