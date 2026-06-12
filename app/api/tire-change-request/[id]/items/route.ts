import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import clientPromise from "@/lib/mongo"
import { uploadImage } from "@/lib/spaces"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "tire_change_request"
type Params = { params: Promise<{ id: string }> }

// base64 ~8MB → กันรูปใหญ่เกิน (client ย่อรูปเหลือ ~1280px แล้ว)
const MAX_PHOTO_LENGTH = 8 * 1024 * 1024

// POST /api/tire-change-request/[id]/items — add a per-tire change request item
// photo: base64 data URL → uploaded to DigitalOcean Spaces, stored as public URL
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const body = await req.json()
  const reason = String(body.reason ?? "").trim()
  // accepts photos: string[] (max 2) — single `photo` still works for backward compat
  const photos: string[] = (Array.isArray(body.photos) ? body.photos : body.photo ? [body.photo] : [])
    .map(String)
    .filter(Boolean)

  if (!reason) return NextResponse.json({ error: "กรุณาระบุสาเหตุ" }, { status: 400 })
  if (photos.length > 2) return NextResponse.json({ error: "รูปถ่ายได้สูงสุด 2 รูป" }, { status: 400 })
  for (const p of photos) {
    if (!p.startsWith("data:image/")) {
      return NextResponse.json({ error: "รูปถ่ายต้องเป็น data URL (data:image/...)" }, { status: 400 })
    }
    if (p.length > MAX_PHOTO_LENGTH) {
      return NextResponse.json({ error: "รูปถ่ายใหญ่เกินไป กรุณาย่อรูปก่อนส่ง" }, { status: 400 })
    }
  }

  const client = await clientPromise
  const col = client.db(DB).collection(COLL)

  // ensure the parent request exists before uploading the photo
  const parent = await col.findOne({ _id: new ObjectId(id) }, { projection: { _id: 1 } })
  if (!parent) {
    return NextResponse.json({ error: "ไม่พบคำขอ — กรุณาส่งฟอร์มใหม่อีกครั้ง" }, { status: 404 })
  }

  const photoUrls: string[] = []
  for (const p of photos) {
    try {
      photoUrls.push(await uploadImage(p, id))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: `อัปโหลดรูปไม่สำเร็จ: ${msg}` }, { status: 502 })
    }
  }

  const item = {
    _id:          new ObjectId(),
    tirePosition: String(body.tirePosition ?? ""),
    positionCode: String(body.positionCode ?? ""),
    positionName: String(body.positionName ?? ""),
    serialNo:     String(body.serialNo ?? ""),
    product:      String(body.product ?? ""),
    reason,
    note: String(body.note ?? "").trim(),
    photoUrl: photoUrls[0] ?? "",
    photoUrls,
    currentTreadMm: Number(body.currentTreadMm) || 0,
    mileageStart: Number(body.mileageStart) || 0,
    usedDistance: Number(body.usedDistance) || 0,
    createdAt:    new Date(),
  }

  await col.updateOne(
    { _id: new ObjectId(id) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { $push: { items: item } } as any
  )

  return NextResponse.json({ ok: true, itemId: item._id, photoUrls }, { status: 201 })
}
