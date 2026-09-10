import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getInvite, getCatalog } from "@/lib/rfq"
import { buildRfqWorkbook } from "@/lib/rfq-xlsx"
export const dynamic = "force-dynamic"
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await getServerSession(authOptions)
  if (!s?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const inv = await getInvite(id)
  if (!inv) return NextResponse.json({ error: "not found" }, { status: 404 })
  const cat = await getCatalog(inv.catalogVersion)
  const sheets = new Set(inv.sheets)
  const buf = await buildRfqWorkbook(inv, cat.jobs.filter((j) => sheets.has(j.sheet)), cat.parts.filter((p) => sheets.has(p.sheet)))
  const name = encodeURIComponent(`ใบเสนอราคา_${inv.vendor}_${inv.title}.xlsx`.replace(/[\\/:*?"<>|]/g, "-"))
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename*=UTF-8''${name}` } })
}
