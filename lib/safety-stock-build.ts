// lib/safety-stock-build.ts
// ชั้นคุย MongoDB ฝั่งสร้าง snapshot ของหน้า /safety-stock — ตรรกะสูตรอยู่ใน safety-stock-core.ts
// runSafetyStockBuild() คือตรรกะของ /api/cron/safety-stock-build เอง เรียกได้ทั้งจาก route handler ของตัวเอง
// และจาก /api/cron/atms-sku-report ที่ chain ต่อท้ายในสล็อตเดียวกัน (ดู route.ts ทั้งสองไฟล์)
import clientPromise from "@/lib/mongo"
import { getDeadstock } from "@/lib/deadstock"
import {
  aduFrom, sdDailyFrom, median, prCodeFromNote, leadTimeDaysBetween, derive, mergeWarehouseResults,
  LT_MIN_SAMPLES, LT_LOOKBACK_MONTHS, USAGE_LOOKBACK_MONTHS, DEFAULT_WINDOW, DEFAULT_Z, WAREHOUSES,
  type SnapshotRow, type LeadTimeSource,
} from "@/lib/safety-stock-core"

const MASTER_DB = process.env.MONGO_DB ?? "master_data"
const ATMS_DB = "atms"
const MOVE_COLL = "stockmovement_v5"
const PR_KEY = "ใบขอสั่งซื้อ (PR)"

/** ปัด 6 ตำแหน่งทศนิยม — ใช้กับ adu/sdDaily ก่อนเก็บลง Mongo (ดูจุดที่ใช้ด้านล่าง) */
const r6 = (n: number) => Math.round(n * 1e6) / 1e6

export type BuildStats = {
  skuTotal: number; withMinMax: number
  ltFromSku: number; ltFromGroup: number; ltFromWarehouse: number
  prMatched: number; prMissed: number
}

/** "YYYY-MM" ของ n เดือนก่อน asOf (รวมเดือนปัจจุบัน) */
function ymBack(asOf: Date, n: number): string {
  const d = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - (n - 1), 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

/** รายชื่อเดือนย้อนหลัง n เดือนถึงเดือนของ asOf — ต้องเติมเดือนที่ไม่มีการเบิกเป็น 0 ด้วย
 *  ไม่งั้น SD จะคำนวณจากเฉพาะเดือนที่มีการเบิก ซึ่งทำให้ความผันผวนต่ำกว่าความจริงมาก */
function ymList(asOf: Date, n: number): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`)
  }
  return out
}

type IssueDoc = { _id: { i: string | null; m: string | null }; q: number | null; n: number | null }
type RecvDoc = { i: string | null; d: Date | null; note: string | null; c: number | null; g: string | null }

export async function buildSnapshotRows(
  inventoryId: string,
  asOf: Date
): Promise<{ rows: SnapshotRow[]; latestMovementDate: string | null; stats: BuildStats; months: string[] }> {
  const client = await clientPromise
  const atms = client.db(ATMS_DB)
  const move = atms.collection(MOVE_COLL)
  const masterCol = client.db(MASTER_DB).collection("atms_sku_master")

  const usageStartYm = ymBack(asOf, USAGE_LOOKBACK_MONTHS)
  const ltStartYm = ymBack(asOf, LT_LOOKBACK_MONTHS)
  const notLabour = { กลุ่มสินค้า: { $not: /^ค่าแรง/ } }

  // 1) SKU ที่ตั้ง min หรือ max ไว้เท่านั้น — คัดที่ Mongo ไม่ดึงทั้ง 9,630 แถวมา
  const masters = await masterCol
    .find({
      inventoryId,
      $or: [{ minQty: { $gt: 0 } }, { maxQty: { $gt: 0 } }],
      group: { $not: /^ค่าแรง/ },
    })
    .project({ _id: 0, skuPk: 1, code: 1, name: 1, group: 1, unit: 1, brand: 1, oracleCode: 1, stockQty: 1, minQty: 1, maxQty: 1 })
    .toArray()

  const skuTotal = await masterCol.countDocuments({ inventoryId })

  // 2) ยอดเบิกรายเดือน 12 เดือน — ยุบที่ Mongo ก่อนเสมอ (ดึงแถวดิบใช้เวลาต่างกันเป็นร้อยเท่า)
  const issues = await move
    .aggregate<IssueDoc>(
      [
        { $match: { inventory_id: inventoryId, year_month: { $gte: usageStartYm }, จ่าย: { $gt: 0 }, ...notLabour } },
        { $group: { _id: { i: "$รหัสสินค้า", m: "$year_month" }, q: { $sum: "$จ่าย" }, n: { $sum: 1 } } },
      ],
      { maxTimeMS: 60_000 }
    )
    .toArray()

  // 3) แถวรับ 24 เดือน — ต้องได้ `หมายเหตุ` รายแถวเพื่อแกะเลข PR จึงยุบไม่ได้
  const receipts = await move
    .aggregate<RecvDoc>(
      [
        { $match: { inventory_id: inventoryId, year_month: { $gte: ltStartYm }, รับ: { $gt: 0 }, ...notLabour } },
        { $project: { _id: 0, i: "$รหัสสินค้า", d: "$วันที่", note: "$หมายเหตุ", c: "$ราคาทุน", g: "$กลุ่มสินค้า" } },
      ],
      { maxTimeMS: 60_000 }
    )
    .toArray()

  // 4) วันที่ของ PR ที่ถูกอ้างถึงจริงเท่านั้น — bounded ตามจำนวน PR ที่พบในข้อ 3
  const prCodes = [...new Set(receipts.map((r) => prCodeFromNote(r.note)).filter((x): x is string => !!x))]
  const prDocs = prCodes.length
    ? ((await atms
        .collection("purchase_requests")
        .find({ [PR_KEY]: { $in: prCodes } })
        .project({ _id: 0, [PR_KEY]: 1, "วันที่": 1 })
        .toArray()) as Record<string, unknown>[])
    : []
  const prDate = new Map<string, string>()
  for (const d of prDocs) prDate.set(String(d[PR_KEY] ?? ""), String(d["วันที่"] ?? ""))

  // 5) lead time รายรหัส + รายกลุ่ม + ทั้งคลัง
  const ltBySku = new Map<string, number[]>()
  const ltByGroup = new Map<string, number[]>()
  const allLt: number[] = []
  const costBySku = new Map<string, number>()
  // วันที่ (epoch ms) ของแถวที่ใช้ตั้งค่า costBySku ล่าสุด — ข้อมูลนี้ back-date/backfill บ่อย
  // ลำดับที่ Mongo คืนมาจึงไม่ตรงกับ วันที่ จริง ต้องเทียบวันที่ฝั่ง client เอง
  // (ไม่เพิ่ม $sort ในฝั่ง aggregation เพื่อไม่เพิ่มภาระ Mongo)
  const costDateBySku = new Map<string, number>()
  let prMatched = 0
  let prMissed = 0

  for (const r of receipts) {
    const code = r.i ?? ""
    if (!code) continue
    if (r.c != null && r.c > 0) {
      // ราคาทุนล่าสุดที่เจอ — ยึดตาม วันที่ จริง ไม่ใช่ลำดับที่ Mongo คืนมา
      const t = r.d ? new Date(r.d).getTime() : NaN
      if (Number.isFinite(t)) {
        const prevT = costDateBySku.get(code)
        if (prevT === undefined || t >= prevT) {
          costBySku.set(code, r.c)
          costDateBySku.set(code, t)
        }
      } else if (!costDateBySku.has(code)) {
        // ไม่มีวันที่ใช้ได้ — seed ไว้ก่อนเฉพาะตอนยังไม่เคยเจอแถวที่มีวันที่ ห้ามทับค่าที่มีวันที่แล้ว
        costBySku.set(code, r.c)
      }
    }
    const pr = prCodeFromNote(r.note)
    if (!pr) continue
    const pd = prDate.get(pr)
    if (!pd) { prMissed++; continue }
    const days = r.d ? leadTimeDaysBetween(pd, r.d) : null
    if (days === null) { prMissed++; continue }
    prMatched++
    if (!ltBySku.has(code)) ltBySku.set(code, [])
    ltBySku.get(code)!.push(days)
    const g = (r.g ?? "").trim() || "ไม่ระบุ"
    if (!ltByGroup.has(g)) ltByGroup.set(g, [])
    ltByGroup.get(g)!.push(days)
    allLt.push(days)
  }

  // ใช้ floor เดียวกับรายรหัส/รายกลุ่ม (LT_MIN_SAMPLES) — ตัวอย่างเดียวก็ยึดเป็นค่ากลางทั้งคลังไม่ได้
  // ค่าผิดปกติตัวเดียว (เช่น PR ค้าง 200 วัน) ในคลังเล็กจะลาก ROP ของทุกรหัสที่ fallback มาที่นี่ให้พองทั้งคลัง
  const warehouseLt = allLt.length >= LT_MIN_SAMPLES ? median(allLt) : 30 // ตัวอย่างไม่พอ (หรือไม่มีเลย) ใช้ 30 วันเป็นค่าตั้งต้น
  const groupLt = new Map<string, number>()
  for (const [g, xs] of ltByGroup) if (xs.length >= LT_MIN_SAMPLES) groupLt.set(g, median(xs))

  // 6) ยอดเบิกรายเดือนต่อรหัส — เติมเดือนที่ไม่มีการเบิกเป็น 0
  const issueByCode = new Map<string, Map<string, { q: number; n: number }>>()
  for (const d of issues) {
    const code = d._id.i ?? ""
    const m = d._id.m ?? ""
    if (!code || !m) continue
    if (!issueByCode.has(code)) issueByCode.set(code, new Map())
    issueByCode.get(code)!.set(m, { q: d.q ?? 0, n: d.n ?? 0 })
  }

  const months12 = ymList(asOf, 12)
  const windows: { key: "m3" | "m6" | "m12"; months: string[] }[] = [
    { key: "m3", months: months12.slice(-3) },
    { key: "m6", months: months12.slice(-6) },
    { key: "m12", months: months12 },
  ]

  // 7) FIFO จากหน้า /deadstock — ข้อมูลประกอบ ใช้ cache เดิม ไม่ยิง DB ซ้ำ
  //    ข้อมูล FIFO มีเฉพาะคลังลาดกระบัง (inv 4) — คลังอื่นข้ามไปเลย ไม่ต้องยิง cache/DB เปล่าๆ
  const dead = inventoryId === "4" ? await getDeadstock() : null
  const fifoByCode = new Map((dead?.items ?? []).map((it) => [it.itemCode, it]))

  const stats: BuildStats = {
    skuTotal, withMinMax: masters.length,
    ltFromSku: 0, ltFromGroup: 0, ltFromWarehouse: 0,
    prMatched, prMissed,
  }

  const rows: SnapshotRow[] = masters.map((m) => {
    const code = String(m.code ?? "")
    const group = (String(m.group ?? "").trim()) || "ไม่ระบุ"
    const perMonth = issueByCode.get(code) ?? new Map()

    const usage = { m3: 0, m6: 0, m12: 0 }
    const issueCounts = { m3: 0, m6: 0, m12: 0 }
    const adu = { m3: 0, m6: 0, m12: 0 }
    const sdDaily = { m3: 0, m6: 0, m12: 0 }

    for (const w of windows) {
      const qs = w.months.map((ym) => perMonth.get(ym)?.q ?? 0)
      const ns = w.months.map((ym) => perMonth.get(ym)?.n ?? 0)
      const totalQ = qs.reduce((a, b) => a + b, 0)
      usage[w.key] = Math.round(totalQ * 100) / 100
      issueCounts[w.key] = ns.reduce((a, b) => a + b, 0)
      // ปัด 6 ตำแหน่งทศนิยม — ค่าดิบจากการหารมี ~17 หลักนัยสำคัญ ละเอียดเกินความจริงของอัตราเบิกใดๆ
      // ลดขนาด payload ที่หน้า /safety-stock ต้องส่งออกเบราว์เซอร์โดยไม่กระทบความแม่นยำที่ใช้จริง
      adu[w.key] = r6(aduFrom(totalQ, w.months.length))
      sdDaily[w.key] = r6(sdDailyFrom(qs))
    }

    const skuSamples = ltBySku.get(code) ?? []
    let leadTimeDays: number
    let leadTimeSource: LeadTimeSource
    if (skuSamples.length >= LT_MIN_SAMPLES) {
      leadTimeDays = median(skuSamples); leadTimeSource = "sku"; stats.ltFromSku++
    } else if (groupLt.has(group)) {
      leadTimeDays = groupLt.get(group)!; leadTimeSource = "group"; stats.ltFromGroup++
    } else {
      leadTimeDays = warehouseLt; leadTimeSource = "warehouse"; stats.ltFromWarehouse++
    }

    const fifo = fifoByCode.get(code)
    const cost = costBySku.get(code) ?? 0
    const stockQty = Number(m.stockQty ?? 0)

    // ยอดเบิกรายเดือน 12 เดือน เก่า→ใหม่ ตรงตำแหน่งกับ months12 ที่คืนออกไปเป็น SafetyStockPayload.months
    // เติมเดือนที่ไม่มีการเบิกเป็น 0 เหมือนกับที่ sdDailyFrom ใช้อยู่แล้ว (perMonth ไม่มี key ของเดือนนั้น)
    const monthly = months12.map((ym) => Math.round((perMonth.get(ym)?.q ?? 0) * 100) / 100)

    return {
      code,
      name: String(m.name ?? ""),
      group,
      unit: String(m.unit ?? ""),
      brand: String(m.brand ?? ""),
      oracleCode: String(m.oracleCode ?? ""),
      inventoryId,
      minQty: Number(m.minQty ?? 0),
      maxQty: Number(m.maxQty ?? 0),
      stockQty,
      fifoRemaining: fifo?.remaining ?? 0,
      oldestAgeDays: fifo?.oldestAgeDays ?? 0,
      usage, issueCounts, adu, sdDaily, monthly,
      leadTimeDays: Math.round(leadTimeDays * 10) / 10,
      leadTimeSource,
      leadTimeSamples: skuSamples.length,
      cost: Math.round(cost * 100) / 100,
      value: Math.round(stockQty * cost * 100) / 100,
    }
  })

  const latest = await move
    .find({ inventory_id: inventoryId }, { maxTimeMS: 60_000 })
    // ใช้ index วันที่_1 ที่มีอยู่แล้ว — ตั้งใจไม่กรอง year_month เพราะ query นี้มีไว้จับ
    // pipeline ที่ตายเงียบ ยิ่งข้อมูลเก่าที่สุดยิ่งต้องเห็น กรองช่วงเวลาจะพลาดจุดประสงค์นี้ไปเลย
    .sort({ วันที่: -1 })
    .limit(1)
    .project({ _id: 0, "วันที่": 1 })
    .toArray()
  const latestMovementDate = latest[0]?.["วันที่"] ? new Date(latest[0]["วันที่"] as Date).toISOString() : null

  return { rows, latestMovementDate, stats, months: months12 }
}

export type BuildWarehouseResult = {
  inventoryId: string
  written: number
  latestMovementDate: string | null
  stats: BuildStats | null
  months: string[]
  error: string | null
  /** true เฉพาะแถวที่ถูกข้ามเพราะ deadline — ไม่ใส่ (undefined) เมื่อรันจนจบตามปกติ
   *  เพื่อไม่ให้ response shape ของ route แบบไม่มี deadline เปลี่ยนไปจากเดิมแม้แต่ field เดียว */
  skipped?: boolean
}

export type BuildResult = {
  trigger: "build"
  ok: boolean
  results: BuildWarehouseResult[]
  written: number
  error: string | null
  syncedAt: Date
}

/** ใช้เมื่อ /api/cron/atms-sku-report ส่ง deadline มา (chain ต่อท้ายในสล็อตเดียวกับงานเดิม) แล้วเวลาหมดก่อนถึงคลังนี้
 *  ตั้งใจให้ error ไม่ใช่ null — ทำให้ ok คำนวณเป็น false อัตโนมัติ ไม่ต้องเขียนโค้ดแยกเพื่อบังคับ ok=false */
const DEADLINE_SKIP_MSG = "ข้ามคลังนี้ — เกิน time budget ของรอบนี้แล้ว จะ build ในรอบถัดไป"

/** สร้าง safety_stock_snapshot จาก atms_sku_master + v5 + PR — ต้องรันหลัง runSkuSync()
 *  เดินทุกคลังใน WAREHOUSES ตามลำดับ (ทีละคลัง กันโหลด Mongo พร้อมกัน) — inventoryParam ไม่ null จำกัดคลังเดียว
 *  เขียน log ไปที่ safety_stock_sync_log (trigger: "build") เหมือน route เดิมทุกประการ
 *
 *  `deadline` เป็น epoch ms — ไม่ใส่ (undefined) เมื่อเรียกจาก route ของตัวเอง (พฤติกรรมเดิมทุกประการ ไม่มี time budget)
 *  ใส่เฉพาะตอนที่ /api/cron/atms-sku-report เรียก chain ต่อท้ายงานเดิมในสล็อตเดียวกัน ซึ่งต้องแบ่งเวลากับงานอื่นด้วย
 *  เช็คเฉพาะ "ระหว่างคลัง" เท่านั้น (ก่อนเริ่มคลังถัดไป) ไม่มีทางตัดกลางคลังที่กำลัง build อยู่ */
export async function runSafetyStockBuild(inventoryParam: string | null, deadline?: number): Promise<BuildResult> {
  const targets = inventoryParam ? [inventoryParam] : WAREHOUSES.map((w) => w.id)

  const client = await clientPromise
  const db = client.db(MASTER_DB)
  const col = db.collection("safety_stock_snapshot")
  const syncedAt = new Date()

  // คลังเดียวพังไม่กระทบคลังอื่น — คืน error ในผลลัพธ์แทนการ throw เพื่อให้คลังถัดไปสร้างต่อได้
  async function buildOneWarehouse(inventoryId: string): Promise<BuildWarehouseResult> {
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
              // window switcher ฝั่ง client (derive(row, win) อ่าน r.adu[win]) จะพังเป็น NaN ทันที
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

  const results: BuildWarehouseResult[] = []
  const deadlinePassed = () => deadline !== undefined && Date.now() >= deadline

  for (let i = 0; i < targets.length; i++) {
    // เช็คก่อนเริ่มคลังถัดไปเท่านั้น — ไม่มีทางตัดกลางคลังที่กำลัง build อยู่ (ครึ่งๆ กลางๆ แย่กว่าข้ามไปเลย)
    if (deadlinePassed()) {
      for (let j = i; j < targets.length; j++) {
        results.push({
          inventoryId: targets[j], written: 0, latestMovementDate: null, stats: null, months: [],
          error: DEADLINE_SKIP_MSG, skipped: true,
        })
      }
      break
    }
    results.push(await buildOneWarehouse(targets[i]))
  }

  // สร้าง index ครั้งเดียวหลังจบทุกคลัง — collection เดียวใช้ร่วมกัน 4 คลัง ต้อง prefix ด้วย inventoryId
  // wrap catch ไว้ — ถ้า createIndex พังจะได้ไม่ข้ามการเขียน safety_stock_sync_log ด้านล่างไปเลยทั้งที่ snapshot
  // เขียนสำเร็จแล้ว (ไม่งั้นหน้าเว็บจะอ่านแถวใหม่คู่กับ months[] ของรอบก่อนหน้า ป้ายเดือนกราฟจะเลื่อนผิดแบบเงียบๆ)
  await col.createIndex({ inventoryId: 1, status: 1, value: -1 }).catch(() => {})
  await col.createIndex({ inventoryId: 1, code: 1 }).catch(() => {})

  // ok/error/written วัดจากผลของ "รอบนี้" เท่านั้น (ตาม targets) — ต้องไม่ถูกลากด้วยของเก่าที่ merge เข้ามาแค่เพื่อกันข้อมูลหาย
  // ห้ามให้แถวที่ preserve มาจากรอบก่อนทำให้ ok ดูเหมือนสำเร็จทั้งที่รอบนี้จริงๆ มีการข้าม/error
  const written = results.reduce((sum, r) => sum + r.written, 0)
  const ok = results.every((r) => r.error === null)
  const error = results.find((r) => r.error !== null)?.error ?? null

  // doc เป็น singleton ถือ results[] ของ 4 คลังรวมกัน — ต้องอ่านของเดิมมา merge ก่อนเขียน ห้ามทับทั้งก้อน
  // สำคัญกว่าฝั่ง sync อีก: คลังที่ถูกข้ามแล้วเขียน latestMovementDate:null ทับ จะทำให้แถบเตือน "ข้อมูลไม่สด"
  // ที่ควรยิ่งเข้มขึ้นกลับเงียบไปแทน (isStale = staleDays !== null && staleDays > 2 — null ทำให้เงื่อนไขเป็นเท็จ)
  const existingDoc = await db.collection("safety_stock_sync_log").findOne({ trigger: "build" })
  const mergedResults = mergeWarehouseResults(existingDoc?.results as BuildWarehouseResult[] | undefined, results)

  await db.collection("safety_stock_sync_log").updateOne(
    { trigger: "build" },
    { $set: { trigger: "build", ok, results: mergedResults, written, error, syncedAt } },
    { upsert: true }
  )

  return { trigger: "build", ok, results, written, error, syncedAt }
}
