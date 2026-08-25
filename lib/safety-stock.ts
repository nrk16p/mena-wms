// lib/safety-stock.ts
// ชั้นคุย MongoDB ฝั่งอ่านของหน้า /safety-stock — snapshot สร้างไว้แล้วโดย cron จึงแค่อ่านออกมา
import clientPromise from "@/lib/mongo"
import { EXCLUDED_PRODUCT_GROUP, INVENTORY_ID, WAREHOUSES, type SafetyStockPayload, type SnapshotRow } from "@/lib/safety-stock-core"

const DB = process.env.MONGO_DB ?? "master_data"

// snapshot เปลี่ยนวันละครั้ง ไม่มีเหตุให้ยิง DB ทุก request
// เก็บบน globalThis เพื่อให้รอดข้าม hot-reload ตอน dev และข้าม warm invocation บน Vercel
const TTL_MS = 60 * 60 * 1000

/** "full" = snapshot ทั้งหมดของคลัง ไม่กรองอะไร (พฤติกรรมเดิมทุกประการ) — /tire/{branch}/stock-tire
 *  (app/api/tire-stock/safety/route.ts) เรียกด้วยค่านี้เพราะ safety_stock_snapshot เป็นชุดข้อมูลที่ /tire/*
 *  ใช้ร่วมกับหน้านี้ ต้องเห็นครบทุกกลุ่ม/ทุกรหัส แล้วไปกรองเฉพาะกลุ่ม "ยาง" หน่วย "เส้น" เอาเองที่ lib/tire-stock-safety.ts
 *  "parts" = มุมมอง "นโยบายอะไหล่" ของหน้า /safety-stock เอง — ตัดกลุ่ม EXCLUDED_PRODUCT_GROUP ("ยาง" เป๊ะๆ
 *  ไม่รวม "เครื่องมือยาง") และต้องมีทั้ง min และ max พร้อมกัน — กรองตรงนี้ (Mongo query) ไม่ใช่ฝั่งเบราว์เซอร์
 *  เพื่อให้ payload ที่ /api/safety-stock ส่งออกมีแค่ ~1,248 แถวจริงๆ ไม่ใช่ส่งเต็มแล้วซ่อนที่ client */
type SafetyStockScope = "full" | "parts"

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
  force = false,
  scope: SafetyStockScope = "full"
): Promise<SafetyStockPayload> {
  globalThis._safetyStockCache ??= {}
  // key ต้องแยกตาม scope ด้วย ไม่ใช่แค่ inventoryId — "full" (/tire/*) กับ "parts" (/safety-stock) เป็นคนละ
  // ผลลัพธ์กัน ถ้าใช้ key เดียวกันคลังไหนถูกเรียกก่อนจะแคชทับอีกฝั่งให้เห็นข้อมูลผิดชุด
  const cacheKey = `${inventoryId}:${scope}`
  const hit = globalThis._safetyStockCache[cacheKey]
  // ผู้เรียกอาจ sort/mutate ได้ ห้ามคืนตัวเดียวกับที่ cache ไว้
  if (!force && hit && Date.now() - hit.at < TTL_MS) return structuredClone(hit.data)

  const client = await clientPromise
  const db = client.db(DB)

  // scope "parts": มุมมอง "นโยบายอะไหล่" ของหน้า /safety-stock เอง — ตัดกลุ่ม "ยาง" เป๊ะๆ (ไม่รวมเครื่องมือยาง)
  // และต้องมีทั้ง min และ max พร้อมกัน กรองที่นี่ (Mongo query) ไม่ใช่ทั้งก้อนแล้วซ่อนที่เบราว์เซอร์ — ดูคอมเมนต์
  // SafetyStockScope ด้านบน · scope "full" (ค่าเริ่มต้น) ไม่แตะ filter เลย พฤติกรรมเดิมทุกประการสำหรับ /tire/*
  const scopeFilter = scope === "parts" ? { group: { $ne: EXCLUDED_PRODUCT_GROUP }, minQty: { $gt: 0 }, maxQty: { $gt: 0 } } : {}

  const [rows, buildLog, skuLog] = await Promise.all([
    db.collection("safety_stock_snapshot")
      .find({ inventoryId, ...scopeFilter })
      // safetyStock/reorderPoint/daysOfSupply/status/minVerdict/suggestQty ยัง "เก็บ" ไว้เสมอ (ต้องมีต่อไป —
      // ดัชนี {inventoryId,status,value} ข้างล่างใช้ status) แต่เบราว์เซอร์ไม่เคยอ่านทั้ง 6 ฟิลด์นี้จาก payload เลย
      // เพราะ derive() คำนวณใหม่ฝั่ง client ทุกครั้งอยู่แล้ว (ตาม service level/window ที่ผู้ใช้เลือก) — ตัดออกจาก
      // การอ่านเพื่อลดขนาด payload โดยไม่กระทบอะไร ลาดกระบัง ~4,100 แถวใกล้เพดาน response 4.5 MB ของ Vercel
      .project({
        _id: 0, updatedAt: 0,
        // coveredByOrder ที่ build เก็บไว้เป็น false เสมอ (build ไม่ส่ง onOrder เข้า derive) — เบราว์เซอร์
        // คำนวณใหม่เองจาก row.onOrder อยู่แล้ว ส่งไปก็เปลืองเปล่าเหมือน 6 ตัวข้างล่าง
        safetyStock: 0, reorderPoint: 0, daysOfSupply: 0, status: 0, minVerdict: 0, suggestQty: 0, coveredByOrder: 0,
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
