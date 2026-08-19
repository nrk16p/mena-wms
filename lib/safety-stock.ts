// lib/safety-stock.ts
// ชั้นคุย MongoDB ฝั่งอ่านของหน้า /safety-stock — snapshot สร้างไว้แล้วโดย cron จึงแค่อ่านออกมา
import clientPromise from "@/lib/mongo"
import { INVENTORY_ID, WAREHOUSES, type SafetyStockPayload, type SnapshotRow } from "@/lib/safety-stock-core"

const DB = process.env.MONGO_DB ?? "master_data"

// snapshot เปลี่ยนวันละครั้ง ไม่มีเหตุให้ยิง DB ทุก request
// เก็บบน globalThis เพื่อให้รอดข้าม hot-reload ตอน dev และข้าม warm invocation บน Vercel
const TTL_MS = 60 * 60 * 1000

declare global {
  var _safetyStockCache: Record<string, { at: number; data: SafetyStockPayload } | undefined> | undefined
}

/** รูปร่างที่พอต้องใช้ของ 1 แถวใน `results[]` ของ safety_stock_sync_log — ทั้ง trigger "build" และ "sku-sync"
 *  เก็บ field อื่นเพิ่มเติมได้ (Mongo ไม่บังคับ schema) จึงไม่ import type เต็มจาก route/lib ฝั่งเขียน ตรงนี้อ่านแค่เท่าที่ใช้จริง */
type SyncLogResultEntry = {
  inventoryId: string
  latestMovementDate?: string | Date | null
  months?: string[]
  error: string | null
}

export async function getSafetyStock(
  inventoryId: string = INVENTORY_ID,
  force = false
): Promise<SafetyStockPayload> {
  globalThis._safetyStockCache ??= {}
  const hit = globalThis._safetyStockCache[inventoryId]
  // ผู้เรียกอาจ sort/mutate ได้ ห้ามคืนตัวเดียวกับที่ cache ไว้
  if (!force && hit && Date.now() - hit.at < TTL_MS) return structuredClone(hit.data)

  const client = await clientPromise
  const db = client.db(DB)

  const [rows, buildLog, skuLog] = await Promise.all([
    db.collection("safety_stock_snapshot")
      .find({ inventoryId })
      // safetyStock/reorderPoint/daysOfSupply/status/minVerdict/suggestQty ยัง "เก็บ" ไว้เสมอ (ต้องมีต่อไป —
      // ดัชนี {inventoryId,status,value} ข้างล่างใช้ status) แต่เบราว์เซอร์ไม่เคยอ่านทั้ง 6 ฟิลด์นี้จาก payload เลย
      // เพราะ derive() คำนวณใหม่ฝั่ง client ทุกครั้งอยู่แล้ว (ตาม service level/window ที่ผู้ใช้เลือก) — ตัดออกจาก
      // การอ่านเพื่อลดขนาด payload โดยไม่กระทบอะไร ลาดกระบัง ~4,100 แถวใกล้เพดาน response 4.5 MB ของ Vercel
      .project({
        _id: 0, updatedAt: 0,
        safetyStock: 0, reorderPoint: 0, daysOfSupply: 0, status: 0, minVerdict: 0, suggestQty: 0,
      })
      .toArray() as unknown as Promise<SnapshotRow[]>,
    db.collection("safety_stock_sync_log").findOne({ trigger: "build" }),
    db.collection("safety_stock_sync_log").findOne({ trigger: "sku-sync" }),
  ])

  // Resolve latestMovementDate + months (สำหรับกราฟยอดเบิกรายเดือน) from build log results array
  let latestMovementDate: string | null = null
  let months: string[] = []
  if (buildLog?.results && Array.isArray(buildLog.results)) {
    const buildResult = (buildLog.results as SyncLogResultEntry[]).find((r) => r.inventoryId === inventoryId)
    if (buildResult?.latestMovementDate) {
      latestMovementDate = new Date(buildResult.latestMovementDate as Date).toISOString()
    }
    // log เก่าก่อนมี months (แถวที่ build ไว้ก่อนหน้านี้) จะไม่มี field นี้ — default [] แล้วให้หน้าเว็บกันเอง
    if (Array.isArray(buildResult?.months)) months = buildResult.months
  }

  // Resolve skuSyncedAt from sku-sync log results array
  let skuSyncedAt: string | null = null
  if (skuLog?.results && Array.isArray(skuLog.results)) {
    const skuResult = (skuLog.results as SyncLogResultEntry[]).find((r) => r.inventoryId === inventoryId)
    if (skuResult && skuResult.error === null && skuLog.syncedAt) {
      skuSyncedAt = new Date(skuLog.syncedAt as Date).toISOString()
    }
  }

  // Resolve warehouse name from WAREHOUSES array
  const warehouseName = WAREHOUSES.find((w) => w.id === inventoryId)?.name ?? inventoryId

  const data: SafetyStockPayload = {
    asOf: new Date().toISOString(),
    warehouse: warehouseName,
    inventoryId,
    latestMovementDate,
    skuSyncedAt,
    months,
    rows,
  }

  globalThis._safetyStockCache[inventoryId] = { at: Date.now(), data }
  // ผู้เรียกอาจ sort/mutate ได้ ห้ามคืนตัวเดียวกับที่ cache ไว้
  return structuredClone(data)
}
