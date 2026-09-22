// app/api/ap-doc-templates/route.ts
// แม่แบบเอกสารประกบชุดส่งบัญชีตามผู้ขาย — นำเข้าครั้งแรกจาก Excel (scripts/import-ap-doc-templates.ts)
// หลังจากนั้นจัดซื้อแก้ต่อในหน้า /ap-tracking/suppliers · ค่าที่แก้ในเว็บ = source "manual" สคริปต์นำเข้าไม่ทับ
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { cleanTemplateDocs } from "@/lib/ap-doc-template"
import { AP_DOC_TEMPLATE_COLL, toTemplate } from "@/lib/ap-doc-template-db"

export const dynamic = "force-dynamic"

const MD = process.env.MONGO_DB ?? "master_data"
const LOG_KEEP = 50
const s = (v: unknown) => (v == null ? "" : String(v)).trim()

function writeDb(client: Awaited<typeof clientPromise>) {
  if (MD === "atms") throw new Error("MONGO_DB ต้องไม่ใช่ 'atms' — ฐาน atms เป็น read-only ห้ามเขียนทับ")
  return client.db(MD)
}

// GET — แม่แบบทั้งหมด (หลักร้อยแถว ไม่มี log) · หน้า suppliers เอาไปจับคู่กับแถวด้วยรหัส/ชื่อ
export async function GET() {
  const client = await clientPromise
  const docs = await client.db(MD).collection(AP_DOC_TEMPLATE_COLL)
    .find({}, { projection: { _id: 0, log: 0 } })
    .limit(10000)
    .toArray()
  return NextResponse.json({ items: docs.map(toTemplate) })
}

// PUT — ตั้ง/แก้แม่แบบของผู้ขายหนึ่งราย · docs [] = ตั้งใจว่าไม่มีแม่แบบ (เก็บไว้ กันนำเข้าทับ)
// คีย์ = code (รหัส ATMS) · ไม่มีรหัส (เจ้าที่เพิ่มเอง) ใช้ชื่อแทน
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const code = s(body?.code)
  const name = s(body?.name)
  if (!name) return NextResponse.json({ error: "ต้องระบุชื่อผู้ขาย" }, { status: 400 })
  if (!Array.isArray(body?.docs)) return NextResponse.json({ error: "docs ต้องเป็นลิสต์ชนิดเอกสาร" }, { status: 400 })
  const docs = cleanTemplateDocs(body.docs)

  const session = await getServerSession(authOptions)
  const by = session?.user?.name || session?.user?.email || ""
  const at = new Date().toISOString()

  const client = await clientPromise
  const col = writeDb(client).collection(AP_DOC_TEMPLATE_COLL)
  const filter = code ? { code } : { code: "", name }
  const cur = await col.findOne(filter, { projection: { _id: 0, docs: 1 } })

  await col.updateOne(
    filter,
    {
      $set: { code, name, docs, source: "manual", updatedBy: by, updatedAt: at },
      $push: { log: { $each: [{ action: cur ? "แก้แม่แบบ" : "ตั้งแม่แบบ", from: cleanTemplateDocs(cur?.docs), docs, by, at }], $slice: -LOG_KEEP } },
    } as Record<string, unknown>,
    { upsert: true },
  )
  return NextResponse.json({ ok: true, template: { code, name, docs, source: "manual", updatedBy: by, updatedAt: at } })
}
