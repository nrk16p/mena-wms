// app/api/vendors/map/route.ts
// ค้นอู่ใกล้จุดที่รถเสีย — รับพิกัดตรง ๆ หรือลิงก์ Google Maps (ย่อก็ได้) แล้วเรียงใกล้→ไกล
import { NextRequest, NextResponse } from "next/server"
import { getGarages, resolveShortLink, roadMatrix } from "@/lib/garage-map"
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

    // ระยะขับจริง + เวลาขับ เฉพาะอู่ชุดแรกที่ใกล้ที่สุด (เส้นตรงใช้คัดก่อน แล้วค่อยถามถนนจริง)
    // แล้วเรียงชุดนั้นใหม่ด้วยเวลาขับ เพราะใกล้แบบเส้นตรงไม่ได้แปลว่าไปถึงก่อน (แม่น้ำ/ทางด่วนคั่น)
    const TOP = 20
    if (origin) {
      const head = items.filter((g) => g.geo).slice(0, TOP)
      if (head.length) {
        const legs = await roadMatrix(origin, head.map((g) => g.geo!))
        head.forEach((g, i) => { g.roadKm = legs[i]?.km ?? null; g.roadMin = legs[i]?.min ?? null })
        const headSet = new Set(head)
        const reordered = [...head].sort((a, b) => {
          if (!!a.workUnknown !== !!b.workUnknown) return a.workUnknown ? 1 : -1
          if (a.matchesAll !== b.matchesAll) return a.matchesAll ? -1 : 1
          if (a.roadMin !== null && b.roadMin !== null) return a.roadMin - b.roadMin
          if (a.roadMin !== null) return -1
          if (b.roadMin !== null) return 1
          return (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9)
        })
        let k = 0
        for (let i = 0; i < items.length; i++) if (headSet.has(items[i])) items[i] = reordered[k++]
      }
    }
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
