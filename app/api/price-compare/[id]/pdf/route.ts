// app/api/price-compare/[id]/pdf/route.ts — export PDF ใบเทียบราคา + หลักฐานแนบ
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { normalizeDoc } from "@/lib/price-compare"
import { PC_COLL, docFilter } from "@/lib/price-compare-db"
import { pdfFilename } from "@/lib/price-compare-pdf"
import { collectAttachments, assemblePdf } from "@/lib/price-compare-attachments"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"
const DB = process.env.MONGO_DB ?? "master_data"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await getServerSession(authOptions)
  if (!s?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const filter = docFilter(id)
  if (!filter) return NextResponse.json({ error: "bad id" }, { status: 400 })
  const raw = await (await clientPromise).db(DB).collection(PC_COLL).findOne(filter)
  if (!raw) return NextResponse.json({ error: "not found" }, { status: 404 })
  const doc = normalizeDoc(raw)
  try {
    const withAttachments = req.nextUrl.searchParams.get("attachments") !== "0"
    const plan = withAttachments ? await collectAttachments(doc) : { imagePages: [], pdfInserts: [], failed: [] }
    const bytes = await assemblePdf(doc, plan)
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(pdfFilename(doc))}`,
        "X-Attachments-Failed": String(plan.failed.length),
      },
    })
  } catch (e) {
    console.error("[price-compare pdf]", e)
    return NextResponse.json({ error: "pdf generation failed", detail: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
