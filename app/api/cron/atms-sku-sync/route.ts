// app/api/cron/atms-sku-sync/route.ts
import { NextRequest, NextResponse } from "next/server"
import { AtmsSessionError, AtmsNetworkError } from "@/lib/atms-sync"
import { atmsSkuSession, ensureRowsPerPage, fetchSkuIndexPage } from "@/lib/atms-sku-log"
import { WAREHOUSES } from "@/lib/safety-stock-core"
import clientPromise from "@/lib/mongo"

const DB = process.env.MONGO_DB ?? "master_data"

export const maxDuration = 300
export const dynamic = "force-dynamic"

const ROWS_PER_PAGE = 1000
/** ATMS ล่มเมื่อยิงรัว — วัดจริง 2026-08-17: 176 requests @1s ทำให้ error rate ไต่ถึง 40% ใน 35 นาที */
const PACE_MS = 3000
const MAX_PAGES = 30
const RETRIES = 3

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const SESSION_EXPIRED_MSG =
  "Session expired — ตั้ง ATMS_SKU_SESSION ใหม่ (หรือแก้ fallback ใน lib/atms-sku-log.ts)"

type WarehouseResult = {
  inventoryId: string
  upserted: number
  pages: number
  total: number | null
  error: string | null
}

// GET /api/cron/atms-sku-sync — ดึง SKU ทุกคลังใน WAREHOUSES จากหน้า index ของ ATMS (ทีละคลัง)
// upsert stock/min/max เข้า atms_sku_master ให้ /api/cron/safety-stock-build ใช้ต่อ
// ?inventory=<id> ซิงก์คลังเดียว — ข้าม WAREHOUSES ทั้งหมด
// ป้องกันด้วย Authorization: Bearer <CRON_SECRET>
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const inventoryParam = req.nextUrl.searchParams.get("inventory")
  const targets = inventoryParam ? [inventoryParam] : WAREHOUSES.map((w) => w.id)

  const phpsessid = atmsSkuSession()
  const client = await clientPromise
  const db = client.db(DB)
  const col = db.collection("atms_sku_master")
  const syncedAt = new Date()

  // ซิงก์คลังเดียว — คืน error ในผลลัพธ์แทนการ throw เพื่อให้คลังอื่นซิงก์ต่อได้
  // ยกเว้น session ตาย ซึ่งกระทบทุกคลังเท่ากัน ผู้เรียก (loop ด้านล่าง) จะเห็นจาก error ที่ตรงกับ SESSION_EXPIRED_MSG แล้วหยุดทั้งรอบ
  async function syncOneWarehouse(inventoryId: string): Promise<WarehouseResult> {
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

  const results: WarehouseResult[] = []

  try {
    await ensureRowsPerPage(phpsessid, ROWS_PER_PAGE)

    for (let i = 0; i < targets.length; i++) {
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

  const upserted = results.reduce((sum, r) => sum + r.upserted, 0)
  const ok = results.length === targets.length && results.every((r) => r.error === null)
  const error = results.find((r) => r.error !== null)?.error ?? null

  await db.collection("safety_stock_sync_log").updateOne(
    { trigger: "sku-sync" },
    { $set: { trigger: "sku-sync", ok, results, upserted, error, syncedAt } },
    { upsert: true }
  )

  return NextResponse.json(
    { trigger: "sku-sync", ok, results, upserted, error, syncedAt },
    { status: ok ? 200 : 500 }
  )
}
