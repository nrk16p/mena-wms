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
    try {
      const built = await buildSnapshotRows(inventoryId, syncedAt)

      if (built.rows.length > 0) {
        await col.bulkWrite(
          built.rows.map((r) => ({
            updateOne: {
              filter: { _id: `${inventoryId}|${r.code}` as unknown as never },
              update: { $set: { ...r, ...derive(r, DEFAULT_WINDOW, DEFAULT_Z), updatedAt: syncedAt } },
              upsert: true,
            },
          })),
          { ordered: false }
        )
      }
      // ลบของที่หลุดออกจากเงื่อนไขแล้ว (store ถอด min/max ออก) — ทำหลังเขียนสำเร็จเท่านั้น
      // ไม่ทำในบล็อก catch เพื่อไม่ให้ลบของเดิมทิ้งเมื่อ build คลังนี้พังกลางทาง
      await col.deleteMany({ inventoryId, updatedAt: { $lt: syncedAt } })

      return {
        inventoryId,
        written: built.rows.length,
        latestMovementDate: built.latestMovementDate,
        stats: built.stats,
        error: null,
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error"
      return { inventoryId, written: 0, latestMovementDate: null, stats: null, error }
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
