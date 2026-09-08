// app/api/ap-tracking/by-supplier/route.ts
// สรุปรายเจ้าหนี้ทั้งปี — GET ?year=YYYY&warehouse=
// ยุบใบ DD ทั้งปี (~13k ใบ) เป็นแถวละเจ้า (~350 แถว ไม่กี่สิบ KB) ฝั่งเซิร์ฟเวอร์
// แถวดิบทั้งปี ≈ 7MB ชนเพดาน 4.5MB ของ Vercel — ห้ามส่งกลับไปให้หน้าเว็บยุบเอง
// (รูปแบบเดียวกับ /api/ap-tracking/dashboard) · ขั้นของงานคิดด้วย apStage ตัวเดียวกับหน้าหลัก
import { NextResponse, type NextRequest } from "next/server"
import clientPromise from "@/lib/mongo"
import {
  AP_GO_LIVE, aggregateSupplierYear, apStage, inApScope, parseAmount, parseDmy, todayICT,
  type ApDocs, type ApSupplierYearInput,
} from "@/lib/ap-tracking"

export const dynamic = "force-dynamic"

const MD = process.env.MONGO_DB ?? "master_data"
const s = (v: unknown) => (v == null ? "" : String(v)).trim()
type Doc = Record<string, unknown>

export async function GET(req: NextRequest) {
  try {
    const sp        = req.nextUrl.searchParams
    const rawYear   = sp.get("year")?.trim() ?? ""
    const year      = /^\d{4}$/.test(rawYear) ? rawYear : todayICT().slice(0, 4)
    const warehouse = sp.get("warehouse")?.trim() ?? ""

    const client = await clientPromise
    const atms   = client.db("atms")
    const md     = client.db(MD)

    // received_at = "DD/MM/YYYY HH:mm" (มีเวลาต่อท้ายเสมอ · วัน/เดือนอาจไม่เติมศูนย์)
    // year ผ่าน ^\d{4}$ แล้ว จึงฝังใน regex ได้โดยไม่มีความเสี่ยง injection
    const match: Record<string, unknown> = {
      received_at: { $regex: new RegExp(`^\\d{1,2}/\\d{1,2}/${year}(?:\\s.*)?$`) },
      // ตัดใบคืนสต๊อกภายใน (supplier + PO ว่างทั้งคู่) เหมือนหน้าหลัก
      $nor: [{ supplier: "", purchase_order: "" }],
    }
    if (warehouse) match.warehouse = warehouse

    const heads = await atms.collection("deposit_header")
      .find(match, { projection: { _id: 0, deposit_code: 1, supplier: 1, purchase_order: 1, amount: 1, received_at: 1, created_at: 1 } })
      .maxTimeMS(30_000).toArray() as Doc[]

    const codes  = heads.map((h) => s(h.deposit_code)).filter(Boolean)
    const tracks = codes.length
      ? await md.collection("ap_tracking")
          .find({ depositCode: { $in: codes } },
            { projection: { _id: 0, depositCode: 1, docs: 1, sentDate: 1, "review.status": 1, "paid.paymentNos": 1 } })
          .maxTimeMS(30_000).toArray() as Doc[]
      : []
    const trackBy = new Map(tracks.map((t) => [s(t.depositCode), t]))

    let dataAsOf = ""
    const items: ApSupplierYearInput[] = []
    for (const h of heads) {
      const receivedAt = parseDmy(h.received_at)
      if (!inApScope(receivedAt, AP_GO_LIVE)) continue
      const c = parseDmy(h.created_at)
      if (c > dataAsOf) dataAsOf = c
      const t = trackBy.get(s(h.deposit_code))
      items.push({
        supplier: s(h.supplier),
        purchaseOrder: s(h.purchase_order),
        amount: parseAmount(h.amount),
        receivedAt,
        stage: apStage({
          docs: (t?.docs ?? {}) as ApDocs,
          sentDate: s(t?.sentDate),
          review: (t?.review ?? null) as { status?: string } | null,
          paid: (t?.paid ?? null) as { paymentNos?: string[] } | null,
        }),
      })
    }

    const rows = aggregateSupplierYear(items)
    // เครดิตเทอมของเจ้า (ระดับ master — ใบแต่ละใบอาจต่างกันตาม ap term บน PO ดูในหน้ารายใบ)
    const names = rows.map((r) => r.supplier)
    const sups  = names.length
      ? await md.collection("ap_supplier")
          .find({ name: { $in: names } }, { projection: { _id: 0, name: 1, creditTerm: 1, override: 1, atmsTerm: 1 } })
          .toArray() as Doc[]
      : []
    const termBy = new Map(sups.map((x) => [s(x.name), s(x.override) || s(x.atmsTerm) || s(x.creditTerm)]))

    return NextResponse.json({
      year, warehouse, dataAsOf, since: AP_GO_LIVE,
      rows: rows.map((r) => ({ ...r, creditTerm: termBy.get(r.supplier) ?? "" })),
    })
  } catch (e) {
    console.error("[ap-tracking/by-supplier] GET failed", e)
    return NextResponse.json({ error: "โหลดข้อมูลไม่สำเร็จ" }, { status: 500 })
  }
}
