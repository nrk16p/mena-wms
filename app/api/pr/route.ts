import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

export const dynamic = "force-dynamic"

const PR_KEY = "ใบขอสั่งซื้อ (PR)"
const PO_KEY = "รหัส"

type Doc = Record<string, unknown>
const s = (v: unknown) => (v == null ? "" : String(v)).trim()

// GET /api/pr — PR ที่อนุมัติแล้ว (is approved = true) แต่ยังไม่มี DD (ไม่มีการรับของ)
// join: PR → PO (ใบขอสั่งซื้อ (PR)) → DD (deposit_header.purchase_order)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const q         = searchParams.get("q")?.trim()         ?? ""
    const warehouse = searchParams.get("warehouse")?.trim() ?? ""
    const dept      = searchParams.get("dept")?.trim()      ?? ""
    const limit     = Math.min(parseInt(searchParams.get("limit") ?? "1000"), 5000)

    const client = await clientPromise
    const db     = client.db("atms")
    const prCol  = db.collection("purchase_requests")
    const poCol  = db.collection("purchase_orders")
    const ddCol  = db.collection("deposit_header")

    // 1) PR ที่อนุมัติแล้ว + ตัวกรอง
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prFilter: Record<string, any> = { "is approved": true }
    if (warehouse) prFilter["คลังสินค้า"] = warehouse
    if (dept)      prFilter["แผนก"]       = dept
    if (q) {
      prFilter["$or"] = [
        { [PR_KEY]:      { $regex: q, $options: "i" } },
        { "ทะเบียน":     { $regex: q, $options: "i" } },
        { "ผู้ขอซื้อ":    { $regex: q, $options: "i" } },
        { "หมายเหตุ":    { $regex: q, $options: "i" } },
        { "คลังสินค้า":   { $regex: q, $options: "i" } },
        { "แผนก":        { $regex: q, $options: "i" } },
      ]
    }

    const prs = await prCol.find(prFilter).sort({ "วันที่": -1, _id: -1 }).limit(limit).toArray() as Doc[]
    const prCodes = prs.map((p) => s(p[PR_KEY])).filter(Boolean)

    // 2) PO ของ PR เหล่านี้ → map pr → [po], po → received status
    const pos = prCodes.length
      ? await poCol.find({ [PR_KEY]: { $in: prCodes } }).project({ [PO_KEY]: 1, [PR_KEY]: 1, "สถานะการรับสินค้า": 1, "ซัพพลายเออร์": 1, "รวม": 1, _id: 0 }).toArray() as Doc[]
      : []
    const posByPr = new Map<string, Doc[]>()
    const allPoCodes: string[] = []
    for (const po of pos) {
      const pr = s(po[PR_KEY]); const code = s(po[PO_KEY])
      if (!pr) continue
      if (!posByPr.has(pr)) posByPr.set(pr, [])
      posByPr.get(pr)!.push(po)
      if (code) allPoCodes.push(code)
    }

    // 3) DD ที่อ้าง PO เหล่านี้ → เซ็ตของ po ที่มีการรับของแล้ว
    const ddPoCodes = allPoCodes.length
      ? await ddCol.distinct("purchase_order", { purchase_order: { $in: allPoCodes } }) as string[]
      : []
    const receivedPo = new Set(ddPoCodes.map(s).filter(Boolean))

    // 4) เก็บเฉพาะ PR ที่ "ไม่มี DD" (ไม่มี PO ตัวไหนถูกรับของเลย — รวม PR ที่ยังไม่มี PO)
    const rows = prs
      .map((p) => {
        const pr = s(p[PR_KEY])
        const myPos = posByPr.get(pr) ?? []
        const hasDD = myPos.some((po) => receivedPo.has(s(po[PO_KEY])))
        return { p, pr, myPos, hasDD }
      })
      .filter((r) => !r.hasDD)
      .map(({ p, pr, myPos }) => ({
        pr_code:   pr,
        date:      s(p["วันที่"]),
        warehouse: s(p["คลังสินค้า"]),
        dept:      s(p["แผนก"]),
        plate:     s(p["ทะเบียน"]),
        requester: s(p["ผู้ขอซื้อ"]),
        total:     typeof p["รวม"] === "number" ? p["รวม"] : Number(p["รวม"]) || 0,
        note:      s(p["หมายเหตุ"]),
        po_codes:  myPos.map((po) => s(po[PO_KEY])).filter(Boolean),
        po_count:  myPos.length,
        received_status: myPos.map((po) => s(po["สถานะการรับสินค้า"])).filter(Boolean),
        suppliers: [...new Set(myPos.map((po) => s(po["ซัพพลายเออร์"])).filter(Boolean))],
      }))

    return NextResponse.json({
      count: rows.length,
      total_value: rows.reduce((a, r) => a + (r.total || 0), 0),
      no_po: rows.filter((r) => r.po_count === 0).length,
      rows,
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// GET filters helper is inline; distinct lists for dropdowns
export async function POST() {
  return NextResponse.json({ error: "not supported" }, { status: 405 })
}
