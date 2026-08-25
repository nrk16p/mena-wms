// lib/safety-stock-sync.ts
// ตรรกะของ /api/cron/atms-sku-sync แยกเป็นฟังก์ชันล้วน — เรียกได้ทั้งจาก route handler ของตัวเอง
// และจาก /api/cron/atms-sku-report ที่ chain ต่อท้ายในสล็อตเดียวกัน (ดู route.ts ทั้งสองไฟล์)
import { AtmsSessionError, AtmsNetworkError } from "@/lib/atms-sync"
import {
  atmsSkuSession, ensureRowsPerPage, fetchSkuIndexPage,
  fetchStockLocationPage, ictDdmmyyyy, type StockLocationRow,
} from "@/lib/atms-sku-log"
import { WAREHOUSES, mergeWarehouseResults } from "@/lib/safety-stock-core"
import clientPromise from "@/lib/mongo"

const DB = process.env.MONGO_DB ?? "master_data"

const ROWS_PER_PAGE = 1000
/** ATMS ล่มเมื่อยิงรัว — วัดจริง 2026-08-17: 176 requests @1s ทำให้ error rate ไต่ถึง 40% ใน 35 นาที */
const PACE_MS = 3000
const MAX_PAGES = 30
const RETRIES = 3

/** ตารางประวัติสต๊อก (แหล่งเดียวที่มี "สถานที่จัดเก็บ") — ลาดกระบัง ~9,800 แถว = 10 หน้า, สระบุรี 5,000 = 5 หน้า
 *  15 เผื่อไว้เท่าตัวโดยยังไม่ปล่อยให้วนไม่รู้จบถ้า ATMS คืนหน้าเดิมซ้ำ */
const LOC_MAX_PAGES = 15
/** ATMS ปิดยอดแถวประวัติสต๊อกของแต่ละวันตอนสิ้นวัน — ยิงตอนตี 3 จึงยังไม่มีของ "วันนี้"
 *  (วัดจริง 25/08/2026: วันนี้ 0 แถว · เมื่อวาน 9,812 แถว) ถอยหลังหาวันที่มีข้อมูลได้ถึง 7 วัน
 *  สถานที่จัดเก็บเป็นคุณสมบัติของรหัสสินค้าไม่ใช่ของวัน — ใช้วันล่าสุดที่มีข้อมูลก็ได้ค่าเดียวกัน */
const LOC_DATE_LOOKBACK = 7
/** ต้องเหลือเวลาก่อน deadline อย่างน้อยเท่านี้ ถึงจะเริ่มดึงสถานที่จัดเก็บของคลังนั้น
 *  วัดจริงจาก log คืน 25/08/2026 (maxDuration 300s): งาน atms-sku-report ~50s · sku-sync 2 คลัง 43s · build 2 คลัง 115s
 *  ดึงสถานที่เพิ่มอีกคลังละ ~30s — คืนที่เวลาตึงต้องยอมข้ามสถานที่ ไม่ใช่ไปเบียดเวลาของ build จน Vercel ฆ่ากลางคัน
 *  (min/max สำคัญกว่า และสถานที่จัดเก็บแทบไม่เปลี่ยนรายวัน ข้ามคืนนี้แล้วได้ในคืนถัดไปก็ทัน)
 *  ยิงเองผ่าน /api/cron/atms-sku-sync ซึ่งไม่มี deadline จะดึงสถานที่ครบทุกคลังเสมอ */
const LOC_MIN_REMAINING_MS = 150_000

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
  /** จำนวนรหัสที่ได้ "สถานที่จัดเก็บ" มาในรอบนี้ · null = ดึงไม่สำเร็จ (ดู locationError) แล้วไม่แตะค่าเดิมใน DB */
  locations: number | null
  /** เหตุผลที่ดึงสถานที่จัดเก็บไม่สำเร็จ — แยกจาก error เพราะไม่ทำให้การซิงก์ min/max ของคลังนี้ล้มเหลว */
  locationError: string | null
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

  // ต้องมี index บน skuPk ก่อนเริ่ม bulkWrite — คืนนี้ต่อคืน upsert ~17,400 doc ด้วย filter:{skuPk} ถ้าไม่มี index
  // จะ collscan ทั้ง collection ทุกแถวทุกครั้ง ภายใน time budget 240s กระทบ Mongo โดยตรง (มีกฎห้ามโหลด DB หนักจากเหตุ
  // CPU 100% มาก่อน) createIndex() เป็น no-op เร็วถ้ามีอยู่แล้ว — wrap catch ไว้กันพังทั้งรอบถ้าสร้างไม่สำเร็จ
  await col.createIndex({ skuPk: 1 }, { unique: true }).catch(() => {})

  // ซิงก์คลังเดียว — คืน error ในผลลัพธ์แทนการ throw เพื่อให้คลังอื่นซิงก์ต่อได้
  // ยกเว้น session ตาย ซึ่งกระทบทุกคลังเท่ากัน ผู้เรียก (loop ด้านล่าง) จะเห็นจาก error ที่ตรงกับ SESSION_EXPIRED_MSG แล้วหยุดทั้งรอบ
  /** รหัสสินค้า → สถานที่จัดเก็บ ของทั้งคลัง จากตารางประวัติสต๊อก (ATMS ไม่มีค่านี้ในตาราง SKU index)
   *  โยน error เมื่อได้มาไม่ครบ — ผู้เรียกจะถือว่า "ไม่มีข้อมูลสถานที่รอบนี้" แล้วไม่เขียนทับของเดิม
   *  ห้ามคืนแมปที่ไม่ครบเด็ดขาด: รหัสที่หายไปจากแมปจะถูกเขียนเป็นค่าว่าง = ลบสถานที่ที่คนคลังกรอกไว้ทิ้ง */
  async function fetchLocations(inventoryId: string): Promise<Map<string, string>> {
    let dateText: string | null = null
    let first: { rows: StockLocationRow[]; total: number | null } | null = null
    for (let back = 0; back <= LOC_DATE_LOOKBACK; back++) {
      const d = ictDdmmyyyy(back)
      const res = await fetchStockLocationPage(inventoryId, 1, d, phpsessid)
      if (res.rows.length > 0) { dateText = d; first = res; break }
      await sleep(PACE_MS)
    }
    if (!dateText || !first) throw new Error(`ไม่พบแถวประวัติสต๊อกย้อนหลัง ${LOC_DATE_LOOKBACK} วัน`)

    const map = new Map<string, string>()
    for (const r of first.rows) map.set(r.code, r.location)
    let fetched = first.rows.length
    let last = first.rows.length
    for (let page = 2; page <= LOC_MAX_PAGES && last >= ROWS_PER_PAGE; page++) {
      await sleep(PACE_MS)
      const res = await fetchStockLocationPage(inventoryId, page, dateText, phpsessid)
      for (const r of res.rows) map.set(r.code, r.location)
      fetched += res.rows.length
      last = res.rows.length
      if (first.total !== null && fetched >= first.total) break
    }
    // เหตุผลเดียวกับด่านตรวจของลูป SKU ด้านล่าง — ได้มาไม่ครบต้องรู้ตัว ไม่ใช่เขียนทับด้วยของครึ่งเดียว
    if (first.total !== null && fetched < first.total) {
      throw new Error(`ดึงสถานที่จัดเก็บไม่ครบ — ได้ ${fetched} จาก ${first.total} แถวที่ ATMS รายงาน`)
    }
    return map
  }

  async function syncOneWarehouse(inventoryId: string): Promise<SkuSyncWarehouseResult> {
    let upserted = 0
    let pages = 0
    let total: number | null = null
    let error: string | null = null
    let locations: Map<string, string> | null = null
    let locationError: string | null = null

    try {
      // ดึงสถานที่จัดเก็บก่อนเริ่มลูป SKU — พังแล้วไม่ล้มทั้งคลัง แค่รอบนี้ไม่อัพเดทสถานที่ (ค่าเดิมใน DB อยู่ครบ)
      // ยกเว้น session ตายที่ต้องหยุดทั้งรอบเหมือนเดิม ปล่อยให้ throw ออกไปให้ catch ด้านล่างจัดการ
      if (deadline !== undefined && deadline - Date.now() < LOC_MIN_REMAINING_MS) {
        locationError = `ข้ามการดึงสถานที่จัดเก็บ — เหลือเวลาไม่ถึง ${Math.round(LOC_MIN_REMAINING_MS / 1000)} วินาทีก่อนหมด time budget จะดึงในรอบถัดไป`
      } else {
        try {
          locations = await fetchLocations(inventoryId)
          await sleep(PACE_MS)
        } catch (e) {
          if (e instanceof AtmsSessionError) throw e
          locations = null
          locationError = e instanceof Error ? e.message : "Unknown error"
        }
      }

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
        if (res.rows.length === 0) {
          // หน้า 1 ว่าง = ผิดปกติ ไม่ใช่จบการแบ่งหน้าตามปกติ — fetchSkuIndexPage คืน rows:[] เมื่อ <tbody> regex
          // จับไม่ได้เลย ซึ่งเกิดได้จากหน้า error/maintenance ของ ATMS หรือหน้า login ที่ render มาพร้อม HTTP 200
          // (ไม่ redirect ให้จับได้ทาง location header) ถ้าปล่อยผ่านไปเงียบๆ atms_sku_master จะค้างค่าของเมื่อวาน
          // ทั้งที่ log บันทึกว่า ok — ต้องถือเป็น error ของคลังนี้ ห้ามเขียนอะไรทับข้อมูลเดิม (หน้าอื่นที่ไม่ใช่หน้า 1
          // ว่างยังถือเป็นจบการแบ่งหน้าปกติได้ เพราะหน้า 1 พิสูจน์แล้วว่าตารางจริงมาถูกต้อง)
          if (page === 1) {
            throw new Error("หน้าแรกไม่มีข้อมูล (0 แถว) — อาจเป็นหน้า error/login ของ ATMS ไม่ใช่ตารางสินค้าจริง")
          }
          break
        }

        await col.bulkWrite(
          res.rows.map((r) => ({
            updateOne: {
              filter: { skuPk: r.skuPk },
              // storageLocation เขียนเฉพาะรอบที่ดึงสถานที่มาครบเท่านั้น (locations ไม่ใช่ null) — รหัสที่ไม่มีใน
              // แมปแปลว่าคนคลังยังไม่ได้กรอก ต้องเขียนค่าว่างทับจริงๆ เพื่อให้ค่าที่ถูกลบใน ATMS หายตามไปด้วย
              update: { $set: { ...r, inventoryId, syncedAt, ...(locations ? { storageLocation: locations.get(r.code) ?? "" } : {}) } },
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

      // ตรวจหลังจบลูปเสมอ ไม่ว่าจะจบเพราะครบ total, ครบ MAX_PAGES, หรือหน้าสุดท้ายสั้นกว่า ROWS_PER_PAGE —
      // จับเคส ensureRowsPerPage ถูก no-op แบบเงียบ (เช่น คุกกี้มีปัญหาบางส่วน) แล้วได้แค่หน้าละ 20 แถว
      // MAX_PAGES × 20 ยังไงก็ไม่มีทางครบคลังใหญ่ๆ ได้ — ต้องรู้ตัวว่าซิงก์ไม่ครบ ไม่ใช่ปล่อยให้ log ขึ้น ok เงียบๆ
      if (total !== null && upserted < total) {
        throw new Error(`ซิงก์ไม่ครบ — ได้ ${upserted} จาก total ${total} ที่ ATMS รายงาน (ตรวจ ensureRowsPerPage หรือหน้าที่ถูกตัดกลางทาง)`)
      }
    } catch (err) {
      // ไม่เขียนทับข้อมูลเดิมเมื่อพัง — ของเก่าที่ถูกต้องดีกว่าตารางว่าง
      if (err instanceof AtmsSessionError) error = SESSION_EXPIRED_MSG
      else if (err instanceof AtmsNetworkError) error = `Network error: ${err.message}`
      else if (err instanceof Error) error = err.message
      else error = "Unknown error"
    }

    return { inventoryId, upserted, pages, total, error, locations: locations?.size ?? null, locationError }
  }

  const results: SkuSyncWarehouseResult[] = []
  const deadlinePassed = () => deadline !== undefined && Date.now() >= deadline

  if (deadlinePassed()) {
    // เกิน time budget ไปแล้วตั้งแต่ก่อนเริ่ม (เช่น atms-sku-report ด้านบนกินเวลาไปเกือบหมด) — ข้ามทั้งรอบ ไม่ยิง ATMS แม้แต่ครั้งเดียว
    for (const inventoryId of targets) {
      results.push({ inventoryId, upserted: 0, pages: 0, total: null, error: DEADLINE_SKIP_MSG, locations: null, locationError: null, skipped: true })
    }
  } else {
    try {
      await ensureRowsPerPage(phpsessid, ROWS_PER_PAGE)

      for (let i = 0; i < targets.length; i++) {
        // เช็คก่อนเริ่มคลังถัดไปเท่านั้น — ไม่เช็คระหว่างหน้าในคลังเดียวกัน กันตัดกลางคลังที่กำลังซิงก์อยู่
        if (deadlinePassed()) {
          for (let j = i; j < targets.length; j++) {
            results.push({ inventoryId: targets[j], upserted: 0, pages: 0, total: null, error: DEADLINE_SKIP_MSG, locations: null, locationError: null, skipped: true })
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
      results.push({ inventoryId: targets[0], upserted: 0, pages: 0, total: null, error: msg, locations: null, locationError: null })
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
