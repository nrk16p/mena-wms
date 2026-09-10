// app/api/price-compare/sku-search/route.ts — ค้นหารหัสสินค้า ATMS สำหรับ SkuPicker ในใบเทียบราคา
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"

const DB = process.env.MONGO_DB ?? "master_data"
export const dynamic = "force-dynamic"

export type SkuHit = { code: string; name: string; group: string; unit: string }

async function requireSession() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  return { name: session.user.name || session.user.email || "", email: session.user.email || "" }
}

// GET /api/price-compare/sku-search?q=<text> — ต้องมี session; q < 2 ตัว → []
export async function GET(req: NextRequest) {
  const me = await requireSession()
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const q = req.nextUrl.searchParams.get("q")?.trim() || ""
  if (q.length < 2) return NextResponse.json([])

  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const client = await clientPromise
  const rows = await client.db(DB).collection("atms_sku_master").aggregate<SkuHit>([
    {
      $match: {
        code: { $ne: "-" },
        $or: [{ code: { $regex: "^" + esc, $options: "i" } }, { name: { $regex: esc, $options: "i" } }],
      },
    },
    { $group: { _id: "$code", name: { $first: "$name" }, group: { $first: "$group" }, unit: { $first: "$unit" } } },
    { $sort: { _id: 1 } },
    { $limit: 20 },
    { $project: { _id: 0, code: "$_id", name: 1, group: 1, unit: 1 } },
  ]).toArray()

  return NextResponse.json(rows)
}
