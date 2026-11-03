// /api/dev-storage?key=... — ที่เก็บไฟล์แนบในเครื่องสำหรับเดโม (PUT อัปโหลด · GET ดู) · ตอบ 404 ทุกกรณีถ้าไม่ใช่ dev + แฟลก
import { NextResponse, type NextRequest } from "next/server"
import { devLocalStorageEnabled, devPutFile, devReadFile } from "@/lib/store-withdraw/storage-local"

export const dynamic = "force-dynamic"
const off = () => new NextResponse("not found", { status: 404 })
const keyOf = (req: NextRequest) => {
  const k = req.nextUrl.searchParams.get("key") ?? ""
  return /^(core-return|store-withdraw)\//.test(k) && k.length < 400 ? k : null
}

export async function PUT(req: NextRequest) {
  if (!devLocalStorageEnabled()) return off()
  const key = keyOf(req)
  if (!key) return new NextResponse("bad key", { status: 400 })
  const buf = Buffer.from(await req.arrayBuffer())
  if (buf.length > 10 * 1024 * 1024) return new NextResponse("too large", { status: 413 })
  devPutFile(key, req.headers.get("content-type") || "application/octet-stream", buf)
  return new NextResponse(null, { status: 200 })
}

export function GET(req: NextRequest) {
  if (!devLocalStorageEnabled()) return off()
  const key = keyOf(req)
  const f = key ? devReadFile(key) : null
  if (!f) return off()
  return new NextResponse(new Uint8Array(f.body), { headers: { "Content-Type": f.contentType, "Cache-Control": "private, max-age=60", "X-Content-Type-Options": "nosniff" } })
}
