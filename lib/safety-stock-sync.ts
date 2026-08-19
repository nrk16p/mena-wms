// lib/safety-stock-sync.ts
// ตรรกะของ /api/cron/atms-sku-sync แยกเป็นฟังก์ชันล้วน — เรียกได้ทั้งจาก route handler ของตัวเอง
// และจาก /api/cron/atms-sku-report ที่ chain ต่อท้ายในสล็อตเดียวกัน (ดู route.ts ทั้งสองไฟล์)
import { AtmsSessionError, AtmsNetworkError } from "@/lib/atms-sync"
import { atmsSkuSession, ensureRowsPerPage, fetchSkuIndexPage } from "@/lib/atms-sku-log"
import { WAREHOUSES, mergeWarehouseResults } from "@/lib/safety-stock-core"
import clientPromise from "@/lib/mongo"

const DB = process.env.MONGO_DB ?? "master_data"

const ROWS_PER_PAGE = 1000
/** ATMS ล่มเมื่อยิงรัว — วัดจริง 2026-08-17: 176 requests @1s ทำให้ error rate ไต่ถึง 40% ใน 35 นาที */
const PACE_MS = 3000
const MAX_PAGES = 30
const RETRIES = 3

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const SESSION_EXPIRED_MSG =
  "Session expired — ตั้ง ATMS_SKU_SESSION ใหม่ (หรือแก้ fallback ใน lib/atms-sku-log.ts)"

/** ใช้เมื่อ /api/cron/atms-sku-report ส่ง deadline มา (chain ต่อท้ายในสล็อตเดียวกับงานเดิม) แล้วเวลาหมดก่อนถึงคลังนี้
 *  ตั้งใจให้ error ไม่ใช่ null — ทำให้ ok คำนวณเป็น false อัตโนมัติ ไม่ต้องเขียนโค้ดแยกเพื่อบังคับ ok=false */
const DEADLINE_SKIP_MSG = "ข้ามคลังนี้ — เกิน time budget ของรอบนี้แล้ว จะซิงก์ในรอบถัดไป"

export type SkuSyncWarehouseResult = {
  inventoryId: string
  upserted: number
  pages: number
  total: number | null
  error: string | null
  /** true เฉพาะแถวที่ถูกข้ามเพราะ deadline — ไม่ใส่ (undefined) เมื่อรันจนจบตามปกติ
   *  เพื่อไม่ให้ response shape ของ route แบบไม่มี deadline เปลี่ยนไปจากเดิมแม้แต่ field เดียว */
  skipped?: boolean
}

export type SkuSyncResult = {
  trigger: "sku-sync"
  ok: boolean
  results: SkuSyncWarehouseResult[]
  upserted: number
  error: string | null
  syncedAt: Date
}

/** ดึง SKU ทุกคลังใน WAREHOUSES จากหน้า index ของ ATMS (ทีละคลัง) — upsert stock/min/max เข้า atms_sku_master
 *  ให้ runSafetyStockBuild ใช้ต่อ · inventoryParam ไม่ null จำกัดซิงก์คลังเดียว
 *  เขียน log ไปที่ safety_stock_sync_log (trigger: "sku-sync") เหมือน route เดิมทุกประการ
 *
 *  `deadline` เป็น epoch ms — ไม่ใส่ (undefined) เมื่อเรียกจาก route ของตัวเอง (พฤติกรรมเดิมทุกประการ ไม่มี time budget)
 *  ใส่เฉพาะตอนที่ /api/cron/atms-sku-report เรียก chain ต่อท้ายงานเดิมในสล็อตเดียวกัน ซึ่งต้องแบ่งเวลากับงานอื่นด้วย
 *  เช็คเฉพาะ "ระหว่างคลัง" เท่านั้น (ก่อนเริ่มคลังถัดไป) ไม่มีทางตัดกลางคลังที่กำลังซิงก์อยู่ — ครึ่งๆ กลางๆ แย่กว่าข้ามไปเลย */
export async function runSkuSync(inventoryParam: string | null, deadline?: number): Promise<SkuSyncResult> {
  const targets = inventoryParam ? [inventoryParam] : WAREHOUSES.map((w) => w.id)

  const phpsessid = atmsSkuSession()
  const client = await clientPromise
  const db = client.db(DB)
  const col = db.collection("atms_sku_master")
  const syncedAt = new Date()

  // ซิงก์คลังเดียว — คืน error ในผลลัพธ์แทนการ throw เพื่อให้คลังอื่นซิงก์ต่อได้
  // ยกเว้น session ตาย ซึ่งกระทบทุกคลังเท่ากัน ผู้เรียก (loop ด้านล่าง) จะเห็นจาก error ที่ตรงกับ SESSION_EXPIRED_MSG แล้วหยุดทั้งรอบ
  async function syncOneWarehouse(inventoryId: string): Promise<SkuSyncWarehouseResult> {
    let upserted = 0
    let pages = 0
    let total: number | null = null
    let error: string | null = null

    try {
      for (let page = 1; page <= MAX_PAGES; page++) {
        let res: Awaited<ReturnType<typeof fetchSkuIndexPage>> | null = null
        for (let attempt = 1; attempt <= RETRIES; attempt++) {
          try {
            res = await fetchSkuIndexPage(inventoryId, page, phpsessid)
            break
          } catch (e) {
            // คุกกี้ตายต้องหยุดทันที ไม่ต้อง retry ให้ ATMS โหลดหนักเปล่าๆ
            if (e instanceof AtmsSessionError) throw e
            if (attempt === RETRIES) throw e
            await sleep(PACE_MS * attempt * 2)
          }
        }
        if (!res) break
        pages = page
        if (total === null) total = res.total
        if (res.rows.length === 0) break

        await col.bulkWrite(
          res.rows.map((r) => ({
            updateOne: {
              filter: { skuPk: r.skuPk },
              update: { $set: { ...r, inventoryId, syncedAt } },
              upsert: true,
            },
          })),
          { ordered: false }
        )
        upserted += res.rows.length

        if (res.rows.length < ROWS_PER_PAGE) break
        if (total !== null && upserted >= total) break
        await sleep(PACE_MS)
      }
    } catch (err) {
      // ไม่เขียนทับข้อมูลเดิมเมื่อพัง — ของเก่าที่ถูกต้องดีกว่าตารางว่าง
      if (err instanceof AtmsSessionError) error = SESSION_EXPIRED_MSG
      else if (err instanceof AtmsNetworkError) error = `Network error: ${err.message}`
      else if (err instanceof Error) error = err.message
      else error = "Unknown error"
    }

    return { inventoryId, upserted, pages, total, error }
  }

  const results: SkuSyncWarehouseResult[] = []
  const deadlinePassed = () => deadline !== undefined && Date.now() >= deadline

  if (deadlinePassed()) {
    // เกิน time budget ไปแล้วตั้งแต่ก่อนเริ่ม (เช่น atms-sku-report ด้านบนกินเวลาไปเกือบหมด) — ข้ามทั้งรอบ ไม่ยิง ATMS แม้แต่ครั้งเดียว
    for (const inventoryId of targets) {
      results.push({ inventoryId, upserted: 0, pages: 0, total: null, error: DEADLINE_SKIP_MSG, skipped: true })
    }
  } else {
    try {
      await ensureRowsPerPage(phpsessid, ROWS_PER_PAGE)

      for (let i = 0; i < targets.length; i++) {
        // เช็คก่อนเริ่มคลังถัดไปเท่านั้น — ไม่เช็คระหว่างหน้าในคลังเดียวกัน กันตัดกลางคลังที่กำลังซิงก์อยู่
        if (deadlinePassed()) {
          for (let j = i; j < targets.length; j++) {
            results.push({ inventoryId: targets[j], upserted: 0, pages: 0, total: null, error: DEADLINE_SKIP_MSG, skipped: true })
          }
          break
        }
        const result = await syncOneWarehouse(targets[i])
        results.push(result)
        // session ตายกระทบทุกคลังเท่ากัน — หยุดทั้งรอบทันที ไม่ต้องลองคลังถัดไป
        if (result.error === SESSION_EXPIRED_MSG) break
        if (i < targets.length - 1) await sleep(PACE_MS)
      }
    } catch (err) {
      // ensureRowsPerPage พังก่อนเริ่มคลังแรก — ไม่มีคลังไหนถูกลองเลย
      const msg =
        err instanceof AtmsSessionError ? SESSION_EXPIRED_MSG
        : err instanceof AtmsNetworkError ? `Network error: ${err.message}`
        : err instanceof Error ? err.message
        : "Unknown error"
      results.push({ inventoryId: targets[0], upserted: 0, pages: 0, total: null, error: msg })
    }
  }

  // ok/error/upserted วัดจากผลของ "รอบนี้" เท่านั้น (ตาม targets) — ต้องไม่ถูกลากด้วยของเก่าที่ merge เข้ามาแค่เพื่อกันข้อมูลหาย
  // ห้ามให้แถวที่ preserve มาจากรอบก่อนทำให้ ok ดูเหมือนสำเร็จทั้งที่รอบนี้จริงๆ มีการข้าม/error
  const upserted = results.reduce((sum, r) => sum + r.upserted, 0)
  const ok = results.length === targets.length && results.every((r) => r.error === null)
  const error = results.find((r) => r.error !== null)?.error ?? null

  // doc เป็น singleton ถือ results[] ของ 4 คลังรวมกัน — ต้องอ่านของเดิมมา merge ก่อนเขียน ห้ามทับทั้งก้อน
  // (คลังที่รอบนี้ไม่แตะ/ถูกข้ามเพราะ deadline ต้องไม่หาย ดู mergeWarehouseResults ใน safety-stock-core.ts)
  const existingDoc = await db.collection("safety_stock_sync_log").findOne({ trigger: "sku-sync" })
  const mergedResults = mergeWarehouseResults(existingDoc?.results as SkuSyncWarehouseResult[] | undefined, results)

  await db.collection("safety_stock_sync_log").updateOne(
    { trigger: "sku-sync" },
    { $set: { trigger: "sku-sync", ok, results: mergedResults, upserted, error, syncedAt } },
    { upsert: true }
  )

  return { trigger: "sku-sync", ok, results, upserted, error, syncedAt }
}
