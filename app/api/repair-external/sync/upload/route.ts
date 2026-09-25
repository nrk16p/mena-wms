import { NextRequest, NextResponse } from "next/server"
import { presignDocUpload } from "@/lib/spaces"
import { sanitizeMediaFilename, MEDIA_MAX_BYTES } from "@/lib/media"

// นามสกุลที่รับ → Content-Type ที่ผู้เรียกต้องส่งตอน PUT (presigned URL ผูก Content-Type ไว้)
const CONTENT_TYPES: Record<string, string> = {
  pdf:  "application/pdf",
  jpg:  "image/jpeg",
  jpeg: "image/jpeg",
  png:  "image/png",
  webp: "image/webp",
}

// POST /api/repair-external/sync/upload — ขอลิงก์อัปโหลดไฟล์แนบ/ใบเสนอราคาสำหรับทีมภายนอก (public เหมือน /sync)
// body { filename, file_size } → { upload_url, headers, file }
// ผู้เรียก PUT ไฟล์ไปที่ upload_url พร้อม headers ที่ให้ไป แล้วใส่ `file` ลงใน images / quotationImages ตอน POST/PATCH /sync
// ไฟล์เข้า Spaces ตรง (batchId "doc") ทั้งรูปและ PDF — หน้าเว็บแยกรูป/PDF จากนามสกุลชื่อไฟล์
export async function POST(req: NextRequest) {
  const body     = await req.json().catch(() => ({}))
  const filename = sanitizeMediaFilename(String(body.filename ?? "").trim())
  const size     = Number(body.file_size) || 0
  const ext      = filename.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? ""
  const contentType = CONTENT_TYPES[ext]

  if (!filename || !contentType) {
    return NextResponse.json({ ok: false, error: "รองรับเฉพาะไฟล์ .pdf .jpg .jpeg .png .webp (ระบุ filename พร้อมนามสกุล)" }, { status: 400 })
  }
  if (size <= 0 || size > MEDIA_MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "ระบุ file_size (ไบต์) และไฟล์ต้องไม่เกิน 25MB" }, { status: 400 })
  }

  try {
    const { uploadUrl, publicUrl } = await presignDocUpload(filename, contentType)
    return NextResponse.json({
      ok: true,
      upload_url: uploadUrl,
      method: "PUT",
      headers: { "Content-Type": contentType, "x-amz-acl": "public-read" },
      expires_in: 600,
      file: {
        mediaId: 0, batchId: "doc", filename,
        webpUrl: publicUrl, thumbnailUrl: "",
        fileType: ext === "pdf" ? "pdf" : "image",
      },
    })
  } catch (e) {
    console.error("sync-upload presign:", e)
    return NextResponse.json({ ok: false, error: "สร้าง upload URL ไม่สำเร็จ" }, { status: 500 })
  }
}
