import { NextRequest, NextResponse } from "next/server"
import { ncacWithSession } from "@/lib/atms-cookie"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ ref: string }> }

// GET /api/atms/openjob/[ref] — ดึง job ที่เปิดไว้บน ATMS
//   ref = maintenance_request_id (175039) หรือเลขที่เอกสาร (SBMR26070457) ก็ได้
//   คืน { maintenance_request_id, info, fields, labels, items } — fields ชื่อตรงกับตอน POST
export async function GET(req: NextRequest, { params }: Params) {
  const { ref } = await params
  const clean = decodeURIComponent(ref).trim()
  if (!clean) return NextResponse.json({ error: "ref is required" }, { status: 400 })

  // "options" เป็น route ของตัวเอง — กันชนกันเวลา Next จับคู่ path
  if (clean === "options") return NextResponse.json({ error: "not_found" }, { status: 404 })

  const withItems = req.nextUrl.searchParams.get("items") !== "0"

  try {
    const res = await ncacWithSession(`/atms/openjob/${encodeURIComponent(clean)}?items=${withItems}`)
    if (res.ok) return NextResponse.json(res.data)

    return NextResponse.json(
      {
        error: res.expired ? "atms_session_expired" : "job_fetch_failed",
        ref: clean,
        detail: res.data,
      },
      { status: res.status },
    )
  } catch (e) {
    return NextResponse.json({ error: "job_fetch_error", ref: clean, detail: String(e) }, { status: 502 })
  }
}
