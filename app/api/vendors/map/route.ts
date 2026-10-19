// app/api/vendors/map/route.ts
// ค้นอู่ใกล้จุดที่รถเสีย — รับพิกัดตรง ๆ หรือลิงก์ Google Maps (ย่อก็ได้) แล้วเรียงใกล้→ไกล
import { NextRequest, NextResponse } from "next/server"
import { getGarages, resolveShortLink } from "@/lib/garage-map"
import { parseLatLng, isShortMapLink, rankGarages } from "@/lib/garage-geo"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const raw = (sp.get("at") ?? "").trim()
    const codes = (sp.get("codes") ?? "").split(",").map((s) => s.trim()).filter(Boolean)

    let origin = parseLatLng(raw)
    let resolvedFrom = ""
    // ลิงก์ย่อไม่มีพิกัดในตัว ต้องยิงตามไปดู url ปลายทาง — ล้มเหลวก็ไม่พัง แค่ไม่มีจุดอ้างอิง
    if (!origin && isShortMapLink(raw)) {
      try {
        const finalUrl = await resolveShortLink(raw)
        origin = parseLatLng(finalUrl)
        if (origin) resolvedFrom = "ลิงก์ย่อ Google Maps"
      } catch {
        return NextResponse.json({ error: "เปิดลิงก์แผนที่ไม่สำเร็จ ลองวางพิกัดตัวเลขแทน (เช่น 13.72451, 100.78032)" }, { status: 422 })
      }
    }

    const all = await getGarages(sp.get("refresh") === "1")
    const items = rankGarages(all, origin, codes)
    return NextResponse.json({
      origin, resolvedFrom,
      total: all.length,
      withGeo: all.filter((g) => g.geo).length,
      items,
    })
  } catch (e) {
    console.error("[vendors/map] ", e)
    return NextResponse.json({ error: "ค้นหาอู่ไม่สำเร็จ", detail: String(e) }, { status: 500 })
  }
}
