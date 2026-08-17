import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// server-side เท่านั้น — api key ไม่หลุดถึง browser
const NCAC = process.env.NCAC_BASE ?? "https://api-ncac.onrender.com"
const KEY  = process.env.NCAC_API_KEY ?? "mena-pipeline-2026"

type Params = { params: Promise<{ code: string }> }

// GET /api/atms/maintenance-request/by-code/[code]
//   แปลงเลขที่ใบแจ้งซ่อม (เช่น BKMR26080001) → internal id ของ ATMS
//   คืน { code, id, view_url } — ใส่ ?go=1 เพื่อ redirect ไปหน้า ATMS เลย
export async function GET(req: NextRequest, { params }: Params) {
  const { code } = await params
  const clean = decodeURIComponent(code).trim()
  if (!clean) return NextResponse.json({ error: "code is required" }, { status: 400 })

  const go = req.nextUrl.searchParams.get("go") === "1"

  try {
    const res = await fetch(`${NCAC}/atms/maintenance-request/by-code/${encodeURIComponent(clean)}`, {
      headers: { "x-api-key": KEY },
      cache: "no-store",
    })
    const data = await res.json().catch(() => ({}))

    if (!res.ok || !data?.view_url) {
      // 404 = ไม่มีเลขเคสนี้ใน ATMS (พิมพ์ผิด / ยังไม่ sync)
      return NextResponse.json(
        { error: "lookup_failed", code: clean, detail: data },
        { status: res.status === 404 ? 404 : 502 },
      )
    }

    return go
      ? NextResponse.redirect(String(data.view_url))
      : NextResponse.json({ code: clean, id: data.id ?? null, view_url: String(data.view_url) })
  } catch (e) {
    return NextResponse.json({ error: "lookup_error", code: clean, detail: String(e) }, { status: 502 })
  }
}
