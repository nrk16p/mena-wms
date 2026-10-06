import { NextRequest, NextResponse } from "next/server"
import { sharedCache } from "@/lib/shared-cache"
import { cachedIf } from "@/lib/cache-if"
import { isExactMrMatch } from "@/lib/atms-links"

export const dynamic = "force-dynamic"

// server-side เท่านั้น — api key ไม่หลุดถึง browser
const NCAC = process.env.NCAC_BASE ?? "https://api-ncac.onrender.com"
const KEY  = process.env.NCAC_API_KEY ?? "mena-pipeline-2026"
const DAY  = 24 * 3600_000

type Params = { params: Promise<{ code: string }> }
type Lookup = { ok: boolean; status: number; data: { code?: unknown; id?: unknown; view_url?: unknown } }

async function lookup(code: string): Promise<Lookup> {
  const res = await fetch(`${NCAC}/atms/maintenance-request/by-code/${encodeURIComponent(code)}`, {
    headers: { "x-api-key": KEY },
    cache: "no-store",
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

// GET /api/atms/maintenance-request/by-code/[code]
//   แปลงเลขที่ใบแจ้งซ่อม (เช่น BKMR26080001) → internal id ของ ATMS
//   คืน { code, id, view_url } — ใส่ ?go=1 เพื่อ redirect ไปหน้า ATMS เลย
//   เลขใบ → id ไม่เปลี่ยน จึงแคชผลที่เจอ "ตรงเลขเป๊ะ" ไว้ (สด 1 วัน / เก่าสุด 7 วัน) · ไม่พบ/error/ผลจาก prefix ไม่แคช
export async function GET(req: NextRequest, { params }: Params) {
  const { code } = await params
  const clean = decodeURIComponent(code).trim()
  if (!clean) return NextResponse.json({ error: "code is required" }, { status: 400 })

  const go = req.nextUrl.searchParams.get("go") === "1"

  try {
    const { ok, status, data } = await cachedIf(sharedCache, {
      key: `atms-mr-by-code:${clean}`,
      load: () => lookup(clean),
      keep: (r) => r.ok && !!r.data?.view_url && isExactMrMatch(r.data.code, clean),
      freshMs: DAY,
      maxStaleMs: 7 * DAY,
    })

    if (!ok || !data?.view_url) {
      // 404 = ไม่มีเลขเคสนี้ใน ATMS (พิมพ์ผิด / ยังไม่ sync)
      return NextResponse.json(
        { error: "lookup_failed", code: clean, detail: data },
        { status: status === 404 ? 404 : 502 },
      )
    }

    return go
      ? NextResponse.redirect(String(data.view_url))
      : NextResponse.json({ code: clean, id: data.id ?? null, view_url: String(data.view_url) })
  } catch (e) {
    return NextResponse.json({ error: "lookup_error", code: clean, detail: String(e) }, { status: 502 })
  }
}
