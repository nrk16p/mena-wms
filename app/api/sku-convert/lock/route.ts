// POST /api/sku-convert/lock?id=…  body { action: "take" | "release" } — ล็อกแถวที่กำลังแก้
//   take    → 200 { lock } · 409 { error, holder } · 404   (เปิดหน้า + ต่ออายุทุก 2 นาที)
//   release → 204                                            (เฉพาะคนถือล็อก — คนอื่นส่งมาก็ไม่มีผล)
// release มาจาก navigator.sendBeacon ได้ → body เป็น text/plain จึงอ่านด้วย req.text() แล้ว JSON.parse เอง
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { releaseLock, takeLock } from "@/lib/sku-convert-db"

const DB = process.env.MONGO_DB ?? "master_data"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const me = { email, name: session.user?.name || email }
  const id = req.nextUrl.searchParams.get("id")
  if (!id) return NextResponse.json({ error: "ต้องระบุ id" }, { status: 400 })

  let action: unknown
  try {
    action = (JSON.parse(await req.text()) as { action?: unknown } | null)?.action
  } catch {
    return NextResponse.json({ error: "body ต้องเป็น JSON" }, { status: 400 })
  }

  const db = (await clientPromise).db(DB)
  if (action === "release") {
    await releaseLock(db, id, me.email)
    return new NextResponse(null, { status: 204 })
  }
  if (action !== "take") return NextResponse.json({ error: 'action ต้องเป็น "take" หรือ "release"' }, { status: 400 })

  const r = await takeLock(db, id, me)
  if (r.ok) return NextResponse.json({ lock: r.lock })
  if (r.notFound) return NextResponse.json({ error: "ไม่พบรหัสนี้" }, { status: 404 })
  return NextResponse.json(
    { error: `${r.holder?.name ?? "คนอื่น"} กำลังแก้รหัสนี้อยู่`, holder: r.holder ?? null },
    { status: 409 },
  )
}
