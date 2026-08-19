// app/api/cron/safety-stock-build/route.ts
import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { buildSnapshotRows, type BuildStats } from "@/lib/safety-stock-build"
import { derive, DEFAULT_WINDOW, DEFAULT_Z, WAREHOUSES } from "@/lib/safety-stock-core"

const DB = process.env.MONGO_DB ?? "master_data"

export const maxDuration = 300
export const dynamic = "force-dynamic"

type WarehouseResult = {
  inventoryId: string
  written: number
  latestMovementDate: string | null
  stats: BuildStats | null
  months: string[]
  error: string | null
}

// GET /api/cron/safety-stock-build — สร้าง safety_stock_snapshot จาก atms_sku_master + v5 + PR
// ต้องรันหลัง /api/cron/atms-sku-sync
// เดินทุกคลังใน WAREHOUSES ตามลำดับ (ทีละคลัง กันโหลด Mongo พร้อมกัน) — ?inventory=<id> จำกัดคลังเดียว
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const inventoryParam = req.nextUrl.searchParams.get("inventory")
  const targets = inventoryParam ? [inventoryParam] : WAREHOUSES.map((w) => w.id)

  const client = await clientPromise
  const db = client.db(DB)
  const col = db.collection("safety_stock_snapshot")
  const syncedAt = new Date()

  // คลังเดียวพังไม่กระทบคลังอื่น — คืน error ในผลลัพธ์แทนการ throw เพื่อให้คลังถัดไปสร้างต่อได้
  async function buildOneWarehouse(inventoryId: string): Promise<WarehouseResult> {
    // เก็บนอก try เพื่อให้ catch (เช่น deleteMany พังทีหลัง) ยังรายงานค่าที่เขียนสำเร็จจริงได้ ไม่ใช่ 0 เสมอ
    let written = 0
    let latestMovementDate: string | null = null
    let stats: BuildStats | null = null
    let months: string[] = []

    try {
      const built = await buildSnapshotRows(inventoryId, syncedAt)
      latestMovementDate = built.latestMovementDate
      stats = built.stats
      months = built.months

      if (built.rows.length > 0) {
        await col.bulkWrite(
          built.rows.map((r) => ({
            updateOne: {
              filter: { _id: `${inventoryId}|${r.code}` as unknown as never },
              // ลำดับ spread ตรงนี้ load-bearing: r ต้องมาทีหลัง derive() เสมอ
              // derive() คืน adu/sdDaily เป็นตัวเลขของ window เดียว ถ้าทับ r.adu/r.sdDaily (object {m3,m6,m12})
              // window switcher ฝั่ง client (Task 8, derive(row, win) อ่าน r.adu[win]) จะพังเป็น NaN ทันที
              update: { $set: { ...derive(r, DEFAULT_WINDOW, DEFAULT_Z), ...r, updatedAt: syncedAt } },
              upsert: true,
            },
          })),
          { ordered: false }
        )
        written = built.rows.length
        // ลบของที่หลุดออกจากเงื่อนไขแล้ว (store ถอด min/max ออก) — ทำเฉพาะตอนที่เขียนแถวจริงสำเร็จเท่านั้น
        // build ว่าง (0 แถว) ต้องไม่ลบของเดิมทิ้ง ไม่งั้น build ว่างเปล่าๆ (เช่น query พลาด) จะเท่ากับลบทั้งคลัง
        await col.deleteMany({ inventoryId, updatedAt: { $lt: syncedAt } })
      }

      return { inventoryId, written, latestMovementDate, stats, months, error: null }
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error"
      // written/latestMovementDate/stats/months อาจไม่ใช่ค่าว่างแล้ว ณ จุดนี้ — เช่น bulkWrite สำเร็จแต่ deleteMany พังทีหลัง
      return { inventoryId, written, latestMovementDate, stats, months, error }
    }
  }

  const results: WarehouseResult[] = []
  for (const inventoryId of targets) {
    results.push(await buildOneWarehouse(inventoryId))
  }

  // สร้าง index ครั้งเดียวหลังจบทุกคลัง — collection เดียวใช้ร่วมกัน 4 คลัง ต้อง prefix ด้วย inventoryId
  await col.createIndex({ inventoryId: 1, status: 1, value: -1 })
  await col.createIndex({ inventoryId: 1, code: 1 })

  const written = results.reduce((sum, r) => sum + r.written, 0)
  const ok = results.every((r) => r.error === null)
  const error = results.find((r) => r.error !== null)?.error ?? null

  await db.collection("safety_stock_sync_log").updateOne(
    { trigger: "build" },
    { $set: { trigger: "build", ok, results, written, error, syncedAt } },
    { upsert: true }
  )

  return NextResponse.json(
    { trigger: "build", ok, results, written, error, syncedAt },
    { status: ok ? 200 : 500 }
  )
}
