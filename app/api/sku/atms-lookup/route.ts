// app/api/sku/atms-lookup/route.ts — ช่อง "รหัสสินค้า ATMS" ของ /sku/new
//
//   GET ?q=<คำค้น>   → รายการให้เลือกใน dropdown (อ่านจากสำเนาในฐาน ไม่แตะ ATMS)
//   GET ?code=<รหัส> → ข้อมูลรหัสนั้น "สด" จาก ATMS ผ่าน api-ncac + ค่าที่เอาไปเติมในฟอร์ม
//
// ทำไมแยกสองโหมด: ตอนพิมพ์ค้นหาคนกดทีละตัวอักษร ยิง ATMS ทุกครั้งคือสิ่งที่ทำให้ ATMS ทรุด
// (วัดจริง 2026-08-17: 176 requests ติดกันทำ error rate ขึ้น 40%) — ค้นจากสำเนาในฐานซึ่งซิงก์คืนละครั้ง
// แล้วจ่ายค่า "สด" ครั้งเดียวตอนผู้ใช้เลือกรหัสจริง ๆ = 1 request ต่อการเลือก 1 รหัส
//
// รหัสที่ซิงก์คืนล่าสุดยังไม่มี (คลังเพิ่งเปิดวันนี้) จะหาไม่เจอใน dropdown — พิมพ์รหัสเต็มแล้วกด Enter
// ได้เลย โหมด code= ไปอ่านจาก ATMS ตรง ไม่ง้อสำเนาในฐาน
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { fetchLiveSku, type AtmsSkuLiveRow } from "@/lib/atms-sku-live"
import { prefillFromAtms, type AtmsPrefill } from "@/lib/atms-sku-autofill"

const DB = process.env.MONGO_DB ?? "master_data"
const COLL = "atms_sku_master"
export const dynamic = "force-dynamic"

export type AtmsSkuHit = { code: string; name: string; group: string; unit: string; warehouse: string; brand: string }

export type AtmsLookupResult = {
  code: string
  found: boolean
  /** atms = อ่านสดสำเร็จ · cache = เรียก ATMS ไม่ได้ ใช้สำเนาในฐาน · missing = ไม่มีรหัสนี้ทั้งสองที่ */
  source: "atms" | "cache" | "missing"
  row: AtmsSkuHit & { warehouses: string[]; oracleCode: string; stockQty: number | null } | null
  prefill: AtmsPrefill | null
}

type MasterDoc = {
  skuPk?: number; code?: string; name?: string; group?: string; warehouse?: string
  oracleCode?: string; brand?: string; unit?: string; stockQty?: number
}

const s = (v: unknown) => (v == null ? "" : String(v).trim())

/** หลายคลังถือรหัสเดียวกันได้ — เอาแถวที่มีของก่อน ให้ตรงกับที่ api-ncac เลือก */
const pickDoc = (docs: MasterDoc[]) =>
  [...docs].sort((a, b) => (b.stockQty ?? 0) - (a.stockQty ?? 0) || (a.skuPk ?? 0) - (b.skuPk ?? 0))[0]

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const code = (sp.get("code") || "").trim()
  const client = await clientPromise
  const col = client.db(DB).collection<MasterDoc>(COLL)

  // ── โหมดค้นหา (dropdown) ──────────────────────────────────────────────────
  if (!code) {
    // ตัดคำค้นที่ 64 ตัว — ยาวกว่านั้นไม่ได้ช่วยหาอะไรเจอ แต่ทำให้ Mongo ไล่ scan ด้วย pattern ยาวเปล่า ๆ
    const q = (sp.get("q")?.trim() || "").slice(0, 64)
    if (q.length < 2) return NextResponse.json([] as AtmsSkuHit[])
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const rows = await col.aggregate<AtmsSkuHit>([
      {
        $match: {
          code: { $ne: "-" },
          $or: [{ code: { $regex: "^" + esc, $options: "i" } }, { name: { $regex: esc, $options: "i" } }],
        },
      },
      {
        $group: {
          _id: "$code", name: { $first: "$name" }, group: { $first: "$group" },
          unit: { $first: "$unit" }, warehouse: { $first: "$warehouse" }, brand: { $first: "$brand" },
        },
      },
      { $sort: { _id: 1 } },
      { $limit: 20 },
      { $project: { _id: 0, code: "$_id", name: 1, group: 1, unit: 1, warehouse: 1, brand: 1 } },
    ]).toArray()
    return NextResponse.json(rows)
  }

  // ── โหมดอ่านสดรายรหัส ────────────────────────────────────────────────────
  const live: AtmsSkuLiveRow | undefined = (await fetchLiveSku([code])).get(code)
  if (live) {
    // เก็บค่าที่เพิ่งอ่านได้ลงสำเนาในฐานด้วย — คนถัดไปที่ค้นคำเดียวกันจะเห็นชื่อ/หน่วยที่ถูกแก้แล้วทันที
    // เขียนชุดเดียวกับที่ /api/cron/atms-sku-sync เขียน (filter skuPk = unique index) ไม่แตะ inventoryId
    if (live.skuPk) {
      await col.updateOne(
        { skuPk: live.skuPk },
        {
          $set: {
            skuPk: live.skuPk, code: live.code, name: live.name, group: live.group,
            warehouse: live.warehouse, oracleCode: live.oracleCode, brand: live.brand,
            unit: live.unit, stockQty: live.stockQty, minQty: live.minQty, maxQty: live.maxQty,
            syncedAt: new Date(),
          },
        },
        { upsert: true },
      ).catch((e) => console.warn(`[atms-lookup] อัปเดตสำเนาในฐานไม่สำเร็จ: ${e?.message ?? e}`))
    }
    const out: AtmsLookupResult = {
      code: live.code, found: true, source: "atms",
      row: {
        code: live.code, name: live.name, group: live.group, unit: live.unit,
        warehouse: live.warehouse, brand: live.brand, warehouses: live.warehouses,
        oracleCode: live.oracleCode, stockQty: live.stockQty,
      },
      prefill: prefillFromAtms(live),
    }
    return NextResponse.json(out)
  }

  // ATMS/NCAC ล่มหรือหมดเวลา — ใช้สำเนาในฐานต่อ แล้วบอกผู้ใช้ว่านี่ไม่ใช่ของสด
  const docs = await col.find({ code }, { projection: { _id: 0 } }).limit(10).toArray()
  if (!docs.length) {
    const out: AtmsLookupResult = { code, found: false, source: "missing", row: null, prefill: null }
    return NextResponse.json(out)
  }
  const d = pickDoc(docs)
  const row = {
    code: s(d.code) || code, name: s(d.name), group: s(d.group), unit: s(d.unit),
    warehouse: s(d.warehouse), brand: s(d.brand),
    warehouses: [...new Set(docs.map((x) => s(x.warehouse)).filter(Boolean))],
    oracleCode: s(d.oracleCode), stockQty: typeof d.stockQty === "number" ? d.stockQty : null,
  }
  const out: AtmsLookupResult = {
    code: row.code, found: true, source: "cache", row,
    prefill: prefillFromAtms({ ...row, stockQty: row.stockQty ?? undefined }),
  }
  return NextResponse.json(out)
}
