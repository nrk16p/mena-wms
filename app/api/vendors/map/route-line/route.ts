// app/api/vendors/map/route-line/route.ts
// เส้นทางขับจริงจากจุดที่รถเสีย → อู่ที่เลือก (OSRM ฟรี ไม่ต้องใช้คีย์)
// แยกจาก /api/vendors/map เพราะดึงตอนกดเลือกอู่ทีละเจ้า ไม่ใช่ทุกครั้งที่ค้นหา
import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const n = (v: string | null) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const fromLat = n(sp.get("fromLat")), fromLng = n(sp.get("fromLng"))
  const toLat = n(sp.get("toLat")), toLng = n(sp.get("toLng"))
  if (fromLat === null || fromLng === null || toLat === null || toLng === null) {
    return NextResponse.json({ error: "ต้องมีพิกัดต้นทางและปลายทาง" }, { status: 400 })
  }
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`
    const r = await fetch(url, { signal: AbortSignal.timeout(9000) })
    const j = await r.json() as {
      code?: string
      routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[]
    }
    const route = j.routes?.[0]
    if (j.code !== "Ok" || !route) return NextResponse.json({ error: "หาเส้นทางไม่ได้" }, { status: 404 })
    return NextResponse.json({
      km: Math.round((route.distance / 1000) * 10) / 10,
      min: Math.round(route.duration / 60),
      // GeoJSON เป็น [lng, lat] ส่วน Leaflet ใช้ [lat, lng] — สลับให้ตรงนี้ทีเดียว ฝั่งจอจะได้ไม่ต้องรู้
      line: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    })
  } catch (e) {
    console.error("[vendors/map/route-line] ", e)
    return NextResponse.json({ error: "หาเส้นทางไม่สำเร็จ" }, { status: 502 })
  }
}
