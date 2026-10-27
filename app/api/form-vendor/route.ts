// POST /api/form-vendor — ฟอร์มลงทะเบียน Vendor (public ไม่ต้อง login) → datawarehouse.vendor_registration
// schema อยู่หัวไฟล์ lib/vendor-register.ts
import { NextRequest, NextResponse } from "next/server"
import type { Collection } from "mongodb"
import clientPromise from "@/lib/mongo"
import { onceUntilOk } from "@/lib/once"
import { VR_DB, VR_COLL, normalizeVendorRegister, validateVendorRegister } from "@/lib/vendor-register"

export const dynamic = "force-dynamic"

/** ลิงก์สาธารณะ — ไอพีเดียวส่งได้ไม่เกินเท่านี้ใน 10 นาที */
const RATE_LIMIT = 5
const RATE_WINDOW_MS = 10 * 60 * 1000

async function collection() {
  const col = (await clientPromise).db(VR_DB).collection(VR_COLL)
  await ensureIndexes(col)
  return col
}

const ensureIndexes = onceUntilOk(async (col: Collection) => {
  await Promise.all([
    col.createIndex({ taxId: 1 }),
    col.createIndex({ status: 1, createdAt: -1 }),
    col.createIndex({ createdAt: -1 }),
    col.createIndex({ "meta.ip": 1, createdAt: -1 }),
  ])
})

export async function POST(req: NextRequest) {
  const input = normalizeVendorRegister(await req.json().catch(() => null))
  const errors = validateVendorRegister(input)
  if (Object.keys(errors).length) return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง", errors }, { status: 400 })

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || null
  const userAgent = req.headers.get("user-agent")?.slice(0, 300) ?? null

  try {
    const col = await collection()
    const now = new Date()
    if (ip) {
      const recent = await col.countDocuments({ "meta.ip": ip, createdAt: { $gte: new Date(now.getTime() - RATE_WINDOW_MS) } })
      if (recent >= RATE_LIMIT) return NextResponse.json({ error: "ส่งข้อมูลบ่อยเกินไป — ลองใหม่อีกครั้งในภายหลัง" }, { status: 429 })
    }
    const { insertedId } = await col.insertOne({
      firstName: input.firstName,
      lastName: input.lastName,
      fullName: `${input.firstName} ${input.lastName}`,
      onBehalf: input.onBehalf || null,
      address: input.address,
      phone: input.phone,
      taxId: input.taxId,
      status: "pending",
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      vendorCode: null,
      source: "form-vendor",
      meta: { ip, userAgent },
      createdAt: now,
      updatedAt: now,
    })
    return NextResponse.json({ ok: true, id: insertedId.toString(), createdAt: now.toISOString() }, { status: 201 })
  } catch (e) {
    console.error("[form-vendor] insert", e)
    return NextResponse.json({ error: "บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง" }, { status: 500 })
  }
}
