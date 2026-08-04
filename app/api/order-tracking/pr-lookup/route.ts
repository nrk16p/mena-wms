import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { fetchPrSnapshots } from "@/lib/pr-snapshot"
import { statusFromSnapshot } from "@/lib/order-tracking"

export const dynamic = "force-dynamic"

const PR_KEY = "ใบขอสั่งซื้อ (PR)"
const s = (v: unknown) => (v == null ? "" : String(v)).trim()

// GET /api/order-tracking/pr-lookup
//   ?q=      → autocomplete: ค้นเลข PR จาก atms.purchase_requests (สูงสุด 10)
//   ?code=   → snapshot เต็ม + สถานะที่ระบบจะตั้งให้ (สำหรับ preview ในฟอร์ม)
//   ?depts=1 → รายชื่อแผนกทั้งหมด (dropdown แผนกผู้ขอ)
//   ?requesters=1 → รายชื่อผู้ขอซื้อทั้งหมด (autocomplete ผู้เปิดเรื่อง)
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const q     = searchParams.get("q")?.trim()    ?? ""
  const code  = searchParams.get("code")?.trim() ?? ""
  const depts = searchParams.get("depts")?.trim() ?? ""
  const requesters = searchParams.get("requesters")?.trim() ?? ""

  const client = await clientPromise

  if (depts) {
    const list = await client.db("atms").collection("purchase_requests").distinct("แผนก") as unknown[]
    return NextResponse.json({ depts: list.map(s).filter(Boolean).sort((a, b) => a.localeCompare(b, "th")) })
  }

  if (requesters) {
    const list = await client.db("atms").collection("purchase_requests").distinct("ผู้ขอซื้อ") as unknown[]
    return NextResponse.json({ requesters: list.map(s).filter(Boolean).sort((a, b) => a.localeCompare(b, "th")) })
  }

  if (code) {
    const snaps = await fetchPrSnapshots(client, [code])
    const snap  = snaps.get(code) ?? null
    if (!snap) return NextResponse.json({ found: false })
    return NextResponse.json({ found: true, snapshot: snap, autoStatus: statusFromSnapshot(snap, "แจ้งเรื่อง") })
  }

  if (q) {
    // escape regex พิเศษ — ค้นเลข PR บางส่วน
    const rx = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const rows = await client.db("atms").collection("purchase_requests")
      .find({ [PR_KEY]: { $regex: rx, $options: "i" } })
      .project({ [PR_KEY]: 1, "วันที่": 1, "คลังสินค้า": 1, "แผนก": 1, "ผู้ขอซื้อ": 1, "รวม": 1, _id: 0 })
      .sort({ "วันที่": -1 })
      .limit(10)
      .toArray()
    return NextResponse.json(rows.map((r) => ({
      code: s(r[PR_KEY]), date: s(r["วันที่"]), warehouse: s(r["คลังสินค้า"]),
      dept: s(r["แผนก"]), requester: s(r["ผู้ขอซื้อ"]), total: Number(r["รวม"]) || 0,
    })))
  }

  return NextResponse.json([])
}
