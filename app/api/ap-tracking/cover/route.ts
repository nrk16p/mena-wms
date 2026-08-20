// app/api/ap-tracking/cover/route.ts
// ข้อมูลใบปะหน้าส่งเข้า สกท. — รายชิ้นสินค้าของใบ DD ที่ขอมา (ฟอร์มจริงเป็นรายชิ้น ไม่ใช่รายใบ)
// ต้องมี endpoint แยกเพราะตารางหลักไม่แบกรายการสินค้า (โมดัลดึงทีละใบ แต่ export ต้องทีละหลายร้อยใบ)
import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { cleanDocNos, parseAmount, parseDmy } from "@/lib/ap-tracking"

export const dynamic = "force-dynamic"

const MD = process.env.MONGO_DB ?? "master_data"
const MAX_CODES = 1500          // แท็บผ่านเดือนเดียว ~1,100 ใบ — เผื่อแล้วแต่ยัง bounded
const s = (v: unknown) => (v == null ? "" : String(v)).trim()

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const codes: string[] = Array.isArray(body?.codes)
    ? body.codes.filter((c: unknown) => typeof c === "string" && /^[A-Z]{2,4}DD\d+$/.test(c)).slice(0, MAX_CODES)
    : []
  if (!codes.length) return NextResponse.json({ rows: [] })

  const client = await clientPromise
  const atms = client.db("atms")
  const heads = await atms.collection("deposit_header")
    .find({ deposit_code: { $in: codes } },
      { projection: { _id: 0, deposit_id: 1, deposit_code: 1, supplier: 1, received_at: 1, amount: 1 } })
    .maxTimeMS(30_000).toArray()
  const ids = heads.map((h) => h.deposit_id).filter((x) => typeof x === "number")
  const [items, tracks] = await Promise.all([
    atms.collection("deposit_items")
      .find({ deposit_id: { $in: ids } }, { projection: { _id: 0, deposit_id: 1, item: 1, total: 1 } })
      .maxTimeMS(30_000).toArray(),
    client.db(MD).collection("ap_tracking")
      .find({ depositCode: { $in: codes } },
        { projection: { _id: 0, depositCode: 1, voucherNos: 1, billingNoteNos: 1, note: 1 } })
      .maxTimeMS(30_000).toArray(),
  ])
  const itemsBy = new Map<number, { item: string; total: number }[]>()
  for (const it of items) {
    const id = it.deposit_id as number
    itemsBy.set(id, [...(itemsBy.get(id) ?? []), { item: s(it.item), total: parseAmount(it.total) }])
  }
  const trackBy = new Map(tracks.map((t) => [s(t.depositCode), t]))

  // เรียงตามวันรับของ→เลขใบ ให้เหมือนที่บัญชีไล่ในฟอร์มจริง · ใบที่ไม่มีรายการสินค้า
  // (ใบเปล่ายอด 0 หรือรายการยังไม่ถูกดึง) ออก 1 แถวใช้ยอดหัวใบ — ห้ามหายไปจากใบปะหน้า
  const rows = heads
    .sort((a, b) => parseDmy(a.received_at).localeCompare(parseDmy(b.received_at)) || s(a.deposit_code).localeCompare(s(b.deposit_code)))
    .flatMap((h) => {
      const t = trackBy.get(s(h.deposit_code))
      const base = {
        date: parseDmy(h.received_at),
        depositCode: s(h.deposit_code),
        supplier: s(h.supplier),
        voucher: cleanDocNos(t?.voucherNos).join(", "),
        billingNo: cleanDocNos(t?.billingNoteNos).join(", "),
        note: s(t?.note),
      }
      const its = itemsBy.get(h.deposit_id as number) ?? []
      return its.length
        ? its.map((it) => ({ ...base, item: it.item, amount: it.total }))
        : [{ ...base, item: "", amount: parseAmount(h.amount) }]
    })
  return NextResponse.json({ rows })
}
