// GET /api/sku-convert/codes — every dropdown list of the convert pages (CodeBook from master_codes, 5-min cache)
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { loadCodeBook } from "@/lib/sku-convert-db"

const DB = process.env.MONGO_DB ?? "master_data"
export const dynamic = "force-dynamic"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const db = (await clientPromise).db(DB)
  return NextResponse.json(await loadCodeBook(db))
}
