// app/api/vendors/map/location/route.ts
// บันทึกพิกัดอู่ที่คนยืนยันเอง — ทับพิกัดจากทะเบียนนิติบุคคล (ซึ่งแม่นแค่ระดับตำบล)
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { canApproveVendor } from "@/lib/roles"
import clientPromise from "@/lib/mongo"
import { parseLatLng, isShortMapLink, inThailand } from "@/lib/garage-geo"
import { resolveShortLink, clearGarageCache } from "@/lib/garage-map"

export const dynamic = "force-dynamic"

const DB = process.env.MONGO_DB ?? "master_data"

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    const email = session?.user?.email ?? ""
    const name  = session?.user?.name ?? email
    // พิกัดอู่เป็นข้อมูลหลักที่คนอื่นใช้ตัดสินใจส่งรถ — ให้สิทธิ์ชุดเดียวกับคนอนุมัติอู่
    if (!canApproveVendor(email)) {
      return NextResponse.json({ error: "ต้องเป็นแอดมินหรือผู้อนุมัติอู่จึงจะแก้พิกัดได้" }, { status: 403 })
    }

    const body   = await req.json().catch(() => ({}))
    const vendor = String(body.vendor ?? "").trim()
    const input  = String(body.at ?? "").trim()
    if (!vendor) return NextResponse.json({ error: "ไม่พบชื่ออู่" }, { status: 400 })

    let p = parseLatLng(input)
    if (!p && isShortMapLink(input)) {
      try { p = parseLatLng(await resolveShortLink(input)) } catch { /* ตกไปที่ข้อความแจ้งด้านล่าง */ }
    }
    if (!p || !inThailand(p)) {
      return NextResponse.json({ error: "อ่านพิกัดไม่ออก — วางลิงก์ Google Maps หรือตัวเลขพิกัด เช่น 13.72451, 100.78032" }, { status: 422 })
    }

    const at = new Date().toISOString()
    await (await clientPromise).db(DB).collection("vendor_approval").updateOne(
      { vendor },
      { $set: { location: { lat: p.lat, lng: p.lng, mapUrl: isShortMapLink(input) ? input : "", address: "", by: name, at } } },
      { upsert: false },
    )
    clearGarageCache()
    return NextResponse.json({ ok: true, location: p })
  } catch (e) {
    console.error("[vendors/map/location] ", e)
    return NextResponse.json({ error: "บันทึกพิกัดไม่สำเร็จ", detail: String(e) }, { status: 500 })
  }
}
