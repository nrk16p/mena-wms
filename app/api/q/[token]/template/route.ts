// เทมเพลต Excel ให้อู่โหลดไปกรอกออฟไลน์ (ผู้ใช้ขอ 2026-09-21) — ฝั่งอู่ ไม่มี session · token คือสิทธิ์
import { NextRequest, NextResponse } from "next/server"
import { getInviteByToken, getCatalog } from "@/lib/rfq"
import { buildRfqTemplate } from "@/lib/rfq-template-xlsx"
import { jobsForInvite, partsForInvite } from "@/lib/rfq-core"
export const dynamic = "force-dynamic"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const inv = await getInviteByToken(token)
  if (!inv) return NextResponse.json({ error: "not found" }, { status: 404 })
  const cat = await getCatalog(inv.catalogVersion)
  const buf = await buildRfqTemplate(inv, jobsForInvite(inv, cat.jobs), partsForInvite(inv, cat.parts))
  const name = encodeURIComponent(`ใบขอราคา_${inv.vendor}_${inv.title}.xlsx`.replace(/[\\/:*?"<>|]/g, "-"))
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename*=UTF-8''${name}` } })
}
