import { NextRequest, NextResponse } from "next/server"
import { AtmsSessionError, AtmsNetworkError } from "@/lib/atms-sync"
import {
  atmsSkuSession, ensureRowsPerPage, fetchAddEvents, fetchMonthCount,
  fetchLogInput, fetchSkuByCode, INVENTORY_NAMES,
} from "@/lib/atms-sku-log"
import clientPromise from "@/lib/mongo"
import { runSkuSync, type SkuSyncResult } from "@/lib/safety-stock-sync"
import { runSafetyStockBuild, type BuildResult } from "@/lib/safety-stock-build"

const DB = process.env.MONGO_DB ?? "master_data"

export const maxDuration = 300

// GET /api/cron/atms-sku-report — invoked by Vercel Cron daily
// Syncs SKU "add" events from the ATMS activity log:
//   • upserts the last 7 days of events into atms_sku_add_events (overlap-safe)
//   • enriches new events with warehouse/code/name/group (log detail + SKU index lookup)
//   • refreshes current + previous month counts in atms_new_sku_monthly
// Protected by Authorization: Bearer <CRON_SECRET>
export async function GET(req: NextRequest) {
  // จับเวลาไว้ตั้งแต่บรรทัดแรก — budget ของ chain ด้านล่างต้องหักเวลาที่งาน atms-sku-report เดิม (ด้านล่าง) ใช้ไปด้วย
  // ไม่ใช่แค่เวลาของ chain เอง ไม่งั้น sync+build รวมกับงานเดิมอาจเกิน maxDuration 300s แล้วโดน Vercel ฆ่ากลางคัน
  const startedAt = Date.now()

  const secret = process.env.CRON_SECRET
  if (secret) {
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const phpsessid = atmsSkuSession()
  const client    = await clientPromise
  const db        = client.db(DB)
  const eventsCol = db.collection("atms_sku_add_events")
  const masterCol = db.collection("atms_sku_master")
  const syncedAt  = new Date()

  let eventsUpserted = 0
  let enriched = 0
  const months: Record<string, number> = {}
  let ok = true
  let error: string | null = null

  try {
    await ensureRowsPerPage(phpsessid, 1000)

    // 1. last 7 days of add events, upserted by skuPk (warehouse etc. preserved if already set)
    const from = new Date(syncedAt)
    from.setDate(from.getDate() - 7)
    const events = await fetchAddEvents(from, syncedAt, phpsessid)
    if (events.length > 0) {
      const r = await eventsCol.bulkWrite(
        events.map((e) => ({
          updateOne: {
            filter: { skuPk: e.skuPk },
            update: { $set: { syncedAt }, $setOnInsert: e },
            upsert: true,
          },
        }))
      )
      eventsUpserted = r.upsertedCount
    }

    // 2. enrich events that don't have a warehouse yet (new since last run)
    const pending = await eventsCol
      .find({ warehouse: { $exists: false }, logId: { $ne: "" } })
      .sort({ addedAt: -1 })
      .limit(50) // safety cap per run; leftovers are picked up next day
      .toArray()
    for (const ev of pending) {
      const input = await fetchLogInput(ev.logId, phpsessid)
      if (!input?.code) continue
      const master = await fetchSkuByCode(input.code, phpsessid)
      const fields = master
        ? { code: master.code, name: master.name, group: master.group, warehouse: master.warehouse }
        : { code: input.code, name: input.name, group: "ไม่ระบุ",
            warehouse: INVENTORY_NAMES[input.inventoryId] ?? "ไม่ระบุ" }
      await eventsCol.updateOne({ skuPk: ev.skuPk }, { $set: fields })
      if (master) {
        await masterCol.updateOne(
          { skuPk: master.skuPk },
          { $set: { ...master, updatedAt: syncedAt } },
          { upsert: true }
        )
      }
      enriched++
    }

    // 3. refresh monthly counts for current + previous month
    const cur  = { y: syncedAt.getFullYear(), m: syncedAt.getMonth() + 1 }
    const prev = cur.m === 1 ? { y: cur.y - 1, m: 12 } : { y: cur.y, m: cur.m - 1 }
    for (const { y, m } of [prev, cur]) {
      const month = `${y}-${String(m).padStart(2, "0")}`
      const count = await fetchMonthCount(y, m, phpsessid)
      months[month] = count
      await db.collection("atms_new_sku_monthly").updateOne(
        { month },
        { $set: { month, count, updatedAt: syncedAt } },
        { upsert: true }
      )
    }
  } catch (err) {
    ok = false
    if (err instanceof AtmsSessionError)      error = "Session expired — update ATMS_SKU_SESSION env var (or the fallback cookie in lib/atms-sku-log.ts)"
    else if (err instanceof AtmsNetworkError) error = `Network error: ${err.message}`
    else if (err instanceof Error)            error = err.message
    else                                      error = "Unknown error"
  }

  await db.collection("atms_sku_report_sync_log").updateOne(
    { trigger: "cron" },
    { $set: { trigger: "cron", ok, eventsUpserted, enriched, months, error, syncedAt } },
    { upsert: true }
  )

  // Vercel Hobby จำกัด cron ไว้แค่ 2 รายการ (ใช้เต็มแล้วโดย tire-sync + งานด้านบนของไฟล์นี้) และการยิง ATMS
  // ด้วยหลาย cron พร้อมกันคือสิ่งที่ทำให้ ATMS ล่ม — จึงต่อ sku-sync + safety-stock build ท้ายสล็อตนี้แทนแยก cron ใหม่
  // ต้อง catch ทุกอย่างในนี้ ห้าม throw ออกไปทับผลลัพธ์/สถานะ HTTP ของงาน atms-sku-report ด้านบนซึ่งทำสำเร็จไปแล้วก่อนหน้านี้
  //
  // ทั้ง 3 งาน (atms-sku-report เดิม + sku-sync 4 คลัง + build 4 คลัง) ต้องแบ่งกันอยู่ใน maxDuration 300s เดียว
  // sync มี pacing ≥3s ต่อหน้า/ต่อคลัง บวก backoff ที่ยาวขึ้นตอน ATMS แย่ (attempt × 2) — เคสที่ควรกลัวที่สุดคือ
  // ATMS ช้าพอดีตอนนั้น ให้ budget 240s (เหลือ 60s กันชนสำหรับเขียน log/คืนค่า) แล้วให้ runSkuSync/runSafetyStockBuild
  // เช็คเอง "ระหว่างคลัง" ว่ายังพอเวลาไหม ถ้าไม่พอให้ข้ามคลังที่เหลือแบบบันทึกไว้ชัดเจน (ok=false, error ไม่ null)
  // ดีกว่าปล่อยให้ Vercel ฆ่ากลางคันซึ่งจะทำให้ log ของคลังที่กำลังทำค้างไม่มีการบันทึกอะไรเลย
  const CHAIN_BUDGET_MS = 240_000
  const deadline = startedAt + CHAIN_BUDGET_MS

  const chain: {
    skuSync: SkuSyncResult | null
    build: BuildResult | null
    buildSkipped: string | null
    error: string | null
  } = { skuSync: null, build: null, buildSkipped: null, error: null }
  try {
    chain.skuSync = await runSkuSync(null, deadline)
    if (Date.now() >= deadline) {
      // เกิน budget ไปแล้วทันทีที่ sync จบ (ไม่ว่า sync เองจะข้ามคลังไปแล้วหรือไม่) — ข้าม build ทั้งหมด ไม่เริ่มเลย
      chain.buildSkipped = "ข้าม build ทั้งหมด — เกิน time budget (240s) ตั้งแต่ก่อนเริ่ม build จะรันในรอบถัดไป"
    } else {
      chain.build = await runSafetyStockBuild(null, deadline)
    }
  } catch (err) {
    chain.error = err instanceof Error ? err.message : "Unknown error"
  }

  return NextResponse.json({ ok, eventsUpserted, enriched, months, error, chain }, { status: ok ? 200 : 500 })
}
