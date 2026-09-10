import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { catalogSummary } from "@/lib/rfq"
export const dynamic = "force-dynamic"
export async function GET() {
  const s = await getServerSession(authOptions)
  if (!s?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  return NextResponse.json(await catalogSummary())
}
