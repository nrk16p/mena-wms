// app/api/ap-tracking/dashboard/route.ts
// สรุปภาพรวมทุกเดือนสำหรับแดชบอร์ดผู้จัดการ — aggregate ฝั่งเซิร์ฟเวอร์แล้วส่งเฉพาะตัวเลข
// (คลัง × สถานะ × เดือน ราว 600 แถว ไม่กี่ KB) ไม่ใช่แถวดิบ 16k แถวที่ชนเพดาน 4.5MB
import { NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { AP_GO_LIVE, apStage, monthInApScope, parseAmount, parseDmy, type ApDocs } from "@/lib/ap-tracking"

export const dynamic = "force-dynamic"

const MD = process.env.MONGO_DB ?? "master_data"
const s = (v: unknown) => (v == null ? "" : String(v)).trim()

export async function GET() {
  const client = await clientPromise

  // หัวใบทุกเดือน — projection เล็กที่สุดที่พอคำนวณได้ (ทั้ง collection ~16k ใบ วิ่งครั้งเดียวจบ)
  const heads = await client.db("atms").collection("deposit_header")
    .find({ $nor: [{ supplier: "", purchase_order: "" }] },     // ตัดคืนสต๊อกภายในเหมือนหน้าหลัก
      { projection: { _id: 0, deposit_code: 1, warehouse: 1, amount: 1, received_at: 1, created_at: 1 } })
    .maxTimeMS(30_000).toArray()

  const tracks = await client.db(MD).collection("ap_tracking")
    .find({}, { projection: { _id: 0, depositCode: 1, docs: 1, sentDate: 1, "review.status": 1 } })
    .maxTimeMS(30_000).toArray()
  const trackBy = new Map(tracks.map((t) => [s(t.depositCode), t]))

  // รวมเป็น (เดือน × คลัง × ขั้นของงาน) — ขั้นคิดด้วย apStage ตัวเดียวกับหน้าหลัก
  // เพื่อไม่ให้แดชบอร์ดกับตารางเล่าตัวเลขคนละเรื่อง
  const agg = new Map<string, { ym: string; warehouse: string; stage: string; n: number; amount: number }>()
  let dataAsOf = ""
  for (const h of heads) {
    const ym = parseDmy(h.received_at).slice(0, 7)
    if (!ym || !monthInApScope(ym, AP_GO_LIVE)) continue
    const c = parseDmy(h.created_at)
    if (c > dataAsOf) dataAsOf = c
    const t = trackBy.get(s(h.deposit_code))
    const stage = apStage({
      docs: (t?.docs ?? {}) as ApDocs,
      sentDate: s(t?.sentDate),
      review: (t?.review ?? null) as { status?: string } | null,
    })
    const warehouse = s(h.warehouse) || "(ไม่ระบุคลัง)"
    const key = `${ym}|${warehouse}|${stage}`
    const cur = agg.get(key) ?? { ym, warehouse, stage, n: 0, amount: 0 }
    cur.n++
    cur.amount += parseAmount(h.amount)
    agg.set(key, cur)
  }

  return NextResponse.json({ entries: [...agg.values()], dataAsOf, since: AP_GO_LIVE })
}
