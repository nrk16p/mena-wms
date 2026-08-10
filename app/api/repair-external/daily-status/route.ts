import { NextRequest, NextResponse } from "next/server"

// Proxy → mena-intelligence: สถานะรายวันล่าสุดของรถ (A/B/BA/... จาก performance_vehicle_daily)
// ใช้แสดง chip "สถานะรถวันนี้" ในตารางหน้า /repair-external
const INTEL_BASE = process.env.INTEL_BASE_URL || "https://mena-intelligence.vercel.app"

export async function GET(req: NextRequest) {
  const plates = req.nextUrl.searchParams.get("plates")?.trim() ?? ""
  if (!plates) return NextResponse.json({ error: "ต้องระบุ plates" }, { status: 400 })

  try {
    const res = await fetch(
      `${INTEL_BASE}/api/truck-utilize/status-latest?plates=${encodeURIComponent(plates)}`,
      { next: { revalidate: 300 } },
    )
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "เชื่อมต่อ mena-intelligence ไม่สำเร็จ" }, { status: 502 })
  }
}
