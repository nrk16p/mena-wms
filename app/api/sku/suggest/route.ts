// app/api/sku/suggest/route.ts — ปุ่ม "ให้ AI ช่วยแนะนำ" ในหน้า /sku/new
//
//   POST { name, group?, type, brand?, l1Hint?[] } → ตัวเลือก L1/L2/L3 + ชื่อมาตรฐานไทย/อังกฤษ
//
// เป็นคำแนะนำเท่านั้น — คนกดเลือกเอง หน้าเว็บไม่เติมลงฟอร์มเงียบ ๆ (ดู lib/sku-suggest.ts)
// ชั้นกัน: ต้องมี session · จำผลเดิมไว้ 7 วันตามชื่อ+กลุ่ม+ประเภท (ชื่อซ้ำกันเยอะ ไม่ต้องถาม AI ซ้ำ)
// · เพดานต่อคนต่อวัน กันกดรัวจนโควตาฟรีหมดทั้งบริษัท
import { createHash } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { suggestTaxonomy, type SuggestResult } from "@/lib/sku-suggest"
import type { MasterCodeRow } from "@/lib/sku-convert-types"
import { GROUP_HINT } from "@/lib/atms-sku-autofill"

const DB = process.env.MONGO_DB ?? "master_data"
const CACHE_COLL = "sku_suggest_cache"
const LOG_COLL = "sku_suggest_logs"
const CACHE_DAYS = 7
/** ต่อคนต่อวัน — คนหนึ่งเปิด SKU วันละไม่กี่สิบตัว เผื่อไว้เท่าตัว */
const DAILY_CAP = 200
/** อ่าน master_codes ซ้ำทุกคำขอไม่คุ้ม — ผังสินค้าเปลี่ยนไม่กี่ครั้งต่อเดือน */
const BOOK_TTL_MS = 10 * 60 * 1000

export const dynamic = "force-dynamic"
export const maxDuration = 60

let bookCache: { rows: MasterCodeRow[]; at: number } | null = null

async function codeRows(): Promise<MasterCodeRow[]> {
  if (bookCache && Date.now() - bookCache.at < BOOK_TTL_MS) return bookCache.rows
  const client = await clientPromise
  const rows = await client.db(DB).collection<MasterCodeRow>("master_codes")
    .find({ dict: { $in: ["SYSTEM_L1", "SUB_ASSEMBLY_L2", "COMPONENT_L3"] } },
          { projection: { _id: 0, dict: 1, code: 1, th: 1, en: 1, parent: 1, order: 1, meta: 1 } })
    .toArray()
  bookCache = { rows, at: Date.now() }
  return rows
}

const norm = (v: string) => v.replace(/\s+/g, " ").trim().toLowerCase()

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email ?? ""
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => null) as
    { name?: string; group?: string; type?: string; brand?: string; l1Hint?: string[] } | null
  const name = (body?.name ?? "").trim().slice(0, 200)
  const type = (body?.type ?? "").trim().toUpperCase()
  if (name.length < 2) return NextResponse.json({ error: "ต้องมีชื่อสินค้าอย่างน้อย 2 ตัวอักษร" }, { status: 400 })
  if (!type) return NextResponse.json({ error: "ต้องระบุประเภทค่าใช้จ่าย" }, { status: 400 })

  const group = (body?.group ?? "").trim().slice(0, 120)
  const brand = (body?.brand ?? "").trim().slice(0, 80)
  // กลุ่มสินค้าของ ATMS ชี้ระบบมาอยู่แล้ว (เช่น "ระบบโม่" → MXS) — เติมให้เองถ้าหน้าเว็บไม่ได้ส่งมา
  const hint = GROUP_HINT[group] ?? {}
  const fromGroup = hint.l1Options ?? (hint.l1 ? [hint.l1] : [])
  const sent = (body?.l1Hint ?? []).filter((x) => typeof x === "string")
  const l1Hint = [...new Set([...sent, ...fromGroup])].slice(0, 4)

  const client = await clientPromise
  const db = client.db(DB)
  const key = createHash("sha1").update([norm(name), norm(group), type, l1Hint.join("+")].join("|")).digest("hex")

  const cached = await db.collection<{ key: string; result: SuggestResult; at: Date }>(CACHE_COLL)
    .findOne({ key, at: { $gte: new Date(Date.now() - CACHE_DAYS * 864e5) } })
  if (cached?.result?.options?.length) {
    return NextResponse.json({ ...cached.result, cached: true })
  }

  // เพดานต่อคนต่อวัน — นับจาก log ที่ยิง AI จริง (ผลที่มาจากแคชไม่นับ)
  const since = new Date(Date.now() - 864e5)
  const used = await db.collection(LOG_COLL).countDocuments({ email, at: { $gte: since } })
  if (used >= DAILY_CAP) {
    return NextResponse.json({ error: `วันนี้ใช้ตัวช่วยครบ ${DAILY_CAP} ครั้งแล้ว — พรุ่งนี้ใช้ได้อีก` }, { status: 429 })
  }

  const rows = await codeRows()
  const result = await suggestTaxonomy(rows, { name, group, type, brand, l1Hint })

  // เขียนแคช/log แบบไม่ขวางคำตอบ — ล้มก็แค่ถาม AI ซ้ำรอบหน้า
  await Promise.all([
    result.options.length
      ? db.collection(CACHE_COLL).updateOne({ key }, { $set: { key, result, at: new Date() } }, { upsert: true })
      : Promise.resolve(),
    db.collection(LOG_COLL).insertOne({
      email, at: new Date(), name, group, type, engine: result.engine, ms: result.ms,
      picked: result.options.map((o) => `${o.l1}:${o.l2}:${o.l3}`), nameTh: result.nameTh,
    }),
  ]).catch((e) => console.warn(`[sku-suggest] เขียนแคช/log ไม่สำเร็จ: ${e?.message ?? e}`))

  return NextResponse.json({ ...result, cached: false })
}
