// GET /api/sku-convert?wh=LK&kind=parts&q=&group=&status=&hint=1&stock=1&page=1 — แปลงรหัส ATMS: รายการ
// → ConvertListResponse (rows 50/page sorted moves desc, issueAmt desc; counts + groups of the whole tab)
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { listItems } from "@/lib/sku-convert-db"
import type { Kind, RowStatus, Wh } from "@/lib/sku-convert-types"

const DB = process.env.MONGO_DB ?? "master_data"
export const dynamic = "force-dynamic"

const WH: readonly string[] = ["LK", "SR"] satisfies Wh[]
const KIND: readonly string[] = ["parts", "svc"] satisfies Kind[]
const STATUS: readonly string[] = ["todo", "draft", "done"] satisfies RowStatus[]

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const wh = sp.get("wh") || "LK"
  const kind = sp.get("kind") || "parts"
  const status = sp.get("status") || ""
  if (!WH.includes(wh)) return NextResponse.json({ error: `wh ต้องเป็น ${WH.join("/")}` }, { status: 400 })
  if (!KIND.includes(kind)) return NextResponse.json({ error: `kind ต้องเป็น ${KIND.join("/")}` }, { status: 400 })
  if (status && !STATUS.includes(status)) {
    return NextResponse.json({ error: `status ต้องเป็น ${STATUS.join("/")}` }, { status: 400 })
  }
  const limit = parseInt(sp.get("limit") ?? "", 10)

  const db = (await clientPromise).db(DB)
  const res = await listItems(db, {
    wh: wh as Wh,
    kind: kind as Kind,
    q: sp.get("q") ?? "",
    group: sp.get("group") ?? "",
    status: (status || undefined) as RowStatus | undefined,
    hint: sp.get("hint") === "1",
    stock: sp.get("stock") === "1",
    page: parseInt(sp.get("page") ?? "1", 10) || 1,
    limit: Number.isFinite(limit) ? limit : undefined,
  })
  return NextResponse.json(res)
}
