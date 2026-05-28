import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "master_sku"

/**
 * GET /api/sku/oe-search?q=PART_NUMBER
 *
 * Cross-reference search across three part-number fields.
 * Returns all approved SKUs where any of these fields match the query:
 *   เบอร์อะไหล่        — own part number
 *   เบอร์แท้อ้างอิง   — OEM reference
 *   เบอร์เทียบอ้างอิง — compatible references (array)
 *
 * Each result includes a `matchedFields` array indicating which field(s) hit.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
  if (!q) return NextResponse.json({ items: [], total: 0 })

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  // Exact-match first, then regex fallback for partial
  const exactRe = new RegExp(`^${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")
  const partialRe = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")

  const items = await col
    .find({
      status: "approved",
      $or: [
        { "เบอร์อะไหล่":        { $regex: partialRe } },
        { "เบอร์แท้อ้างอิง":   { $regex: partialRe } },
        { "เบอร์เทียบอ้างอิง": { $elemMatch: { $regex: partialRe } } },
      ],
    } as never)
    .project({
      SKU: 1,
      ชื่ออะไหล่_TH: 1,
      Part_Name_EN: 1,
      เบอร์อะไหล่: 1,
      เบอร์แท้อ้างอิง: 1,
      เบอร์เทียบอ้างอิง: 1,
      ประเภทค่าใช้จ่าย: 1,
      คลังสินค้า: 1,
      ยี่ห้อ: 1,
      Grade: 1,
      ราคาต่อหน่วย: 1,
      หน่วย: 1,
      ระบบ_L1: 1,
      ชุดประกอบ_L2: 1,
      ชิ้นส่วน_L3: 1,
    })
    .limit(100)
    .toArray()

  // Annotate each result with which fields matched
  type Item = Record<string, unknown> & { matchedFields: string[] }
  const annotated: Item[] = items.map((doc) => {
    const matched: string[] = []
    const partNo   = String(doc["เบอร์อะไหล่"]      ?? "")
    const oemRef   = String(doc["เบอร์แท้อ้างอิง"]  ?? "")
    const compatArr = Array.isArray(doc["เบอร์เทียบอ้างอิง"])
      ? (doc["เบอร์เทียบอ้างอิง"] as string[])
      : doc["เบอร์เทียบอ้างอิง"] ? [String(doc["เบอร์เทียบอ้างอิง"])] : []

    if (partialRe.test(partNo))                         matched.push("เบอร์อะไหล่")
    if (oemRef && partialRe.test(oemRef))                matched.push("เบอร์แท้อ้างอิง")
    if (compatArr.some((c) => partialRe.test(c)))        matched.push("เบอร์เทียบอ้างอิง")

    // Exact match → sort to top (handled client-side via matchedFields[0] === "เบอร์อะไหล่")
    const isExact = exactRe.test(partNo) || exactRe.test(oemRef) || compatArr.some((c) => exactRe.test(c))

    return { ...doc, matchedFields: matched, isExact }
  })

  // Sort: exact matches first, then by SKU
  annotated.sort((a, b) => {
    if (a.isExact && !b.isExact) return -1
    if (!a.isExact && b.isExact) return  1
    return String(a.SKU).localeCompare(String(b.SKU))
  })

  return NextResponse.json({ items: annotated, total: annotated.length, q })
}
