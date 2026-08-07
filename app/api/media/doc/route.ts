import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { deleteDoc } from "@/lib/spaces"

// DELETE /api/media/doc?key=media-docs/... — ลบเอกสาร PDF ที่อัปโหลดไว้
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const key = req.nextUrl.searchParams.get("key")?.trim() ?? ""
  if (!key.startsWith("media-docs/")) return NextResponse.json({ error: "key ไม่ถูกต้อง" }, { status: 400 })

  try {
    await deleteDoc(decodeURIComponent(key))
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("doc-delete:", e)
    return NextResponse.json({ error: "ลบไม่สำเร็จ" }, { status: 500 })
  }
}
