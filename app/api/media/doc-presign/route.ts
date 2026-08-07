import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { presignDocUpload } from "@/lib/spaces"
import { sanitizeMediaFilename, MEDIA_MAX_BYTES } from "@/lib/media"

// POST /api/media/doc-presign — presign อัปโหลดเอกสาร PDF ตรงเข้า Spaces
// (presign-api ภายนอกรับเฉพาะรูป — PDF ใช้เส้นทางนี้แทน)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const filename = String(body.filename ?? "").trim()
  const size     = Number(body.file_size) || 0

  if (!/\.pdf$/i.test(filename)) return NextResponse.json({ error: "รองรับเฉพาะไฟล์ .pdf" }, { status: 400 })
  if (size <= 0 || size > MEDIA_MAX_BYTES) return NextResponse.json({ error: "ไฟล์ต้องไม่เกิน 25MB" }, { status: 400 })

  try {
    const { uploadUrl, publicUrl, key } = await presignDocUpload(sanitizeMediaFilename(filename))
    return NextResponse.json({ upload_url: uploadUrl, public_url: publicUrl, key })
  } catch (e) {
    console.error("doc-presign:", e)
    return NextResponse.json({ error: "สร้าง upload URL ไม่สำเร็จ" }, { status: 500 })
  }
}
