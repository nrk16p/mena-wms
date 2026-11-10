// app/api/vendors/map/manual/route.ts
// เพิ่ม/ลบอู่ที่คนเพิ่มเองจากหน้าแผนที่ (ปุ่ม "เพิ่มอู่") — ไม่แตะ AVL หรือ ATMS
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { ObjectId } from "mongodb"
import { authOptions } from "@/lib/auth"
import { canApproveVendor } from "@/lib/roles"
import clientPromise from "@/lib/mongo"
import { parseLatLng, isShortMapLink, inThailand } from "@/lib/garage-geo"
import { resolveShortLink, clearGarageCache, getGarages, reverseArea, MANUAL_COLL, type ManualGarageDoc } from "@/lib/garage-map"
import { garageKey } from "@/lib/atms-garage"
import { BY_CODE } from "@/lib/repair-type-master"

export const dynamic = "force-dynamic"

const DB = process.env.MONGO_DB ?? "master_data"

async function who() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email ?? ""
  return { email, name: session?.user?.name ?? email }
}

export async function POST(req: NextRequest) {
  try {
    const { email, name: by } = await who()
    // สิทธิ์ชุดเดียวกับการแก้พิกัดอู่ — ข้อมูลนี้คนอื่นใช้ตัดสินใจส่งรถ
    if (!canApproveVendor(email)) {
      return NextResponse.json({ error: "ต้องเป็นแอดมินหรือผู้อนุมัติอู่จึงจะเพิ่มอู่ได้" }, { status: 403 })
    }
    const b = await req.json().catch(() => ({}))
    const name = String(b.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120)
    const phone = String(b.phone ?? "").trim().slice(0, 60)
    const note = String(b.note ?? "").trim().slice(0, 500)
    const input = String(b.at ?? "").trim()
    const codes = (Array.isArray(b.codes) ? b.codes : []).map(String).filter((c: string) => BY_CODE.has(c))
    if (!name) return NextResponse.json({ error: "ใส่ชื่ออู่ก่อน" }, { status: 400 })

    let p = parseLatLng(input)
    if (!p && isShortMapLink(input)) {
      try { p = parseLatLng(await resolveShortLink(input)) } catch { /* แจ้งด้านล่าง */ }
    }
    if (!p || !inThailand(p)) {
      return NextResponse.json({ error: "อ่านตำแหน่งอู่ไม่ออก วางลิงก์ Google Maps หรือพิกัด เช่น 13.72451, 100.78032" }, { status: 422 })
    }

    // ชื่อซ้ำกับอู่ที่มีอยู่แล้ว (ทุกแหล่ง) = ไม่เพิ่มซ้ำ ให้ไปแก้ที่อู่เดิมแทน
    const k = garageKey(name)
    const dup = (await getGarages(true)).find((g) => garageKey(g.name) === k)
    if (dup) return NextResponse.json({ error: `มีอู่ชื่อ "${dup.name}" ในแผนที่แล้ว` }, { status: 409 })

    const doc: ManualGarageDoc = {
      name, phone, lat: p.lat, lng: p.lng, mapUrl: isShortMapLink(input) || /^https?:/.test(input) ? input : "",
      codes: [...new Set(codes)] as string[], onsite: !!b.onsite, note,
      address: await reverseArea(p.lat, p.lng),
      createdBy: by, createdByEmail: email, createdAt: new Date().toISOString(),
    }
    const r = await (await clientPromise).db(DB).collection<ManualGarageDoc>(MANUAL_COLL).insertOne(doc)
    clearGarageCache()
    return NextResponse.json({ ok: true, id: String(r.insertedId), location: p })
  } catch (e) {
    console.error("[vendors/map/manual POST] ", e)
    return NextResponse.json({ error: "เพิ่มอู่ไม่สำเร็จ", detail: String(e) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { email } = await who()
    if (!canApproveVendor(email)) {
      return NextResponse.json({ error: "ต้องเป็นแอดมินหรือผู้อนุมัติอู่จึงจะลบอู่ได้" }, { status: 403 })
    }
    const id = req.nextUrl.searchParams.get("id") ?? ""
    if (!ObjectId.isValid(id)) return NextResponse.json({ error: "ไม่พบอู่นี้" }, { status: 400 })
    const r = await (await clientPromise).db(DB).collection(MANUAL_COLL).deleteOne({ _id: new ObjectId(id) })
    if (!r.deletedCount) return NextResponse.json({ error: "ไม่พบอู่นี้ อาจถูกลบไปแล้ว" }, { status: 404 })
    clearGarageCache()
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("[vendors/map/manual DELETE] ", e)
    return NextResponse.json({ error: "ลบอู่ไม่สำเร็จ", detail: String(e) }, { status: 500 })
  }
}
