// app/api/ap-tracking/search/route.ts
// ค้นข้ามเดือนทั้งฐาน — ใช้ตอนช่องค้นหาหลัก (ซึ่งค้นเฉพาะเดือนที่เปิดอยู่) หาไม่เจอ
// คืนแค่ "ใบไหน อยู่เดือนไหน" พอให้กดกระโดดไป ไม่ใช่ข้อมูลเต็มแถว (เดือนปลายทางโหลดเองอยู่แล้ว)
import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { AP_NO_FIELDS, parseAmount, parseDmy } from "@/lib/ap-tracking"

export const dynamic = "force-dynamic"

const LIMIT = 20
const s = (v: unknown) => (v == null ? "" : String(v)).trim()

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
  // สั้นกว่า 3 ตัวอักษร = กว้างเกินกว่าจะมีความหมาย และกันยิงถี่ระหว่างพิมพ์
  if (q.length < 3) return NextResponse.json({ hits: [] })

  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
  const client = await clientPromise

  // เลขที่เอกสาร (ใบกำกับ/ใบวางบิล/บิลเงินสด/ใบกำกับภาษี) อยู่ใน ap_tracking ไม่ใช่ ATMS
  // — หาเลขใบ DD ที่มีเลขพวกนี้ก่อน แล้วค่อยไปเอาหัวใบ
  const md = process.env.MONGO_DB ?? "master_data"
  const byDocNo = await client.db(md).collection("ap_tracking")
    .find({ $or: [...AP_NO_FIELDS.map((f) => ({ [f.key]: rx })), { "paid.paymentNos": rx }] },
      { projection: { _id: 0, depositCode: 1 } })
    .limit(40).maxTimeMS(10_000).toArray()
  const docNoCodes = byDocNo.map((d) => s(d.depositCode)).filter(Boolean)

  // ทะเบียนรถอยู่บน PO · หมายเหตุ (เลขใบแจ้งซ่อม/ทะเบียน/ช่าง) อยู่บน PR
  // — ไล่กลับมาเป็นเลข PO เพื่อชี้ไปหาใบ DD (DD ผูก PO ไว้ที่ purchase_order)
  const atms = client.db("atms")
  const [poByVehicle, prByNote] = await Promise.all([
    atms.collection("purchase_orders")
      .find({ "ยานพาหนะ": rx }, { projection: { _id: 0, "รหัส": 1 } })
      .limit(60).maxTimeMS(10_000).toArray(),
    atms.collection("purchase_requests")
      .find({ "หมายเหตุ": rx }, { projection: { _id: 0, "ใบขอสั่งซื้อ (PR)": 1 } })
      .limit(60).maxTimeMS(10_000).toArray(),
  ])
  const prCodes = prByNote.map((x) => s(x["ใบขอสั่งซื้อ (PR)"])).filter(Boolean)
  const poFromPr = prCodes.length
    ? await atms.collection("purchase_orders")
        .find({ "ใบขอสั่งซื้อ (PR)": { $in: prCodes } }, { projection: { _id: 0, "รหัส": 1 } })
        .limit(60).maxTimeMS(10_000).toArray()
    : []
  const poCodes = [...new Set([...poByVehicle, ...poFromPr].map((x) => s(x["รหัส"])).filter(Boolean))]

  const or: Record<string, unknown>[] = [
    { deposit_code: rx }, { purchase_order: rx }, { supplier_ref_no: rx }, { supplier: rx },
  ]
  if (docNoCodes.length) or.push({ deposit_code: { $in: docNoCodes } })
  if (poCodes.length) or.push({ purchase_order: { $in: poCodes } })

  const heads = await atms.collection("deposit_header")
    .find({ $or: or, $nor: [{ supplier: "", purchase_order: "" }] },   // ตัดแถวคืนสต๊อกภายในเหมือนหน้าหลัก
      { projection: { _id: 0, deposit_code: 1, purchase_order: 1, supplier: 1, warehouse: 1, amount: 1, received_at: 1 } })
    .limit(LIMIT * 3).maxTimeMS(10_000).toArray()

  const hits = heads
    .map((h) => ({
      depositCode: s(h.deposit_code),
      purchaseOrder: s(h.purchase_order),
      supplier: s(h.supplier),
      warehouse: s(h.warehouse),
      amount: parseAmount(h.amount),
      receivedAt: parseDmy(h.received_at),
      month: parseDmy(h.received_at).slice(0, 7),
    }))
    .filter((h) => h.month)                       // ไม่มีวันรับของที่อ่านได้ = กระโดดไปเดือนไหนไม่ได้
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    .slice(0, LIMIT)

  return NextResponse.json({ hits, total: hits.length })
}
