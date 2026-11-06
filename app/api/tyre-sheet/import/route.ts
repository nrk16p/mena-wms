import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { sheetDb } from "@/lib/tyre-sheet-db"
import { parseTyreWorkbook } from "@/lib/tyre-sheet-import"
import { ROWS_COLL, STORAGE_COLL, SALES_COLL, OPTIONS_COLL, serialKey, type AnyRow } from "@/lib/tyre-sheet"

export const maxDuration = 60

/** แถวเดียวกันในชีต = ไซซ์ + MR + ตำแหน่ง + เบอร์ยาง (ใช้กันทับแถวที่แก้ใน WMS ไปแล้ว) */
const rowKey = (r: AnyRow) => [r.size, r.mrNo, r.position, r.oldSerial, r.bookingDate].map((x) => String(x ?? "").trim()).join("|")

// POST /api/tyre-sheet/import (multipart: file=.xlsx, mode=preview|apply)
// ช่วงทำคู่กับชีต: แทนที่ของที่นำเข้าครั้งก่อนทั้งหมด แต่ไม่แตะแถวที่สร้าง/แก้ใน WMS
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "ต้องเข้าสู่ระบบก่อน" }, { status: 401 })
  const form = await req.formData().catch(() => null)
  const file = form?.get("file")
  const mode = String(form?.get("mode") ?? "preview")
  if (!file || typeof file === "string") return NextResponse.json({ error: "เลือกไฟล์ .xlsx ก่อน" }, { status: 400 })
  if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: "ไฟล์ใหญ่เกิน 25 MB" }, { status: 400 })

  let parsed
  try {
    parsed = parseTyreWorkbook(await file.arrayBuffer())
  } catch (e) {
    return NextResponse.json({ error: `อ่านไฟล์ไม่ได้: ${String((e as Error).message ?? e)}` }, { status: 400 })
  }
  if (!parsed.rows.length && !parsed.storage.length) {
    return NextResponse.json({ error: "ไม่เจอแท็บ ยางนอก 11R22.5 / 1000-20 หรือบันทึกการจัดเก็บยาง ในไฟล์นี้" }, { status: 400 })
  }

  const db = await sheetDb()
  const rowsCol = db.collection(ROWS_COLL)
  const kept = await rowsCol.find({ source: "import", editedInWms: true }).project({ size: 1, mrNo: 1, position: 1, oldSerial: 1, bookingDate: 1 }).toArray()
  const keptKeys = new Set(kept.map(rowKey))
  const toInsert = parsed.rows.filter((r) => !keptKeys.has(rowKey(r)))
  const [prevImport, wmsRows] = await Promise.all([
    rowsCol.countDocuments({ source: "import" }),
    rowsCol.countDocuments({ source: "wms" }),
  ])

  const preview = {
    stats: parsed.stats,
    willInsertRows: toInsert.length,
    keptEditedRows: kept.length,
    replacesPreviousImport: prevImport,
    wmsRowsUntouched: wmsRows,
    storage: parsed.storage.length,
    sales: parsed.sales.length,
    options: parsed.options ? { drivers: parsed.options.drivers.length, plates: parsed.options.plates.length, positions: parsed.options.positions.length } : null,
  }
  if (mode !== "apply") return NextResponse.json({ ok: true, mode: "preview", ...preview })

  const user = session.user?.name ?? session.user?.email ?? ""
  const now = new Date()
  const meta = { source: "import", importedAt: now, importedBy: user, createdAt: now, createdBy: user, updatedAt: now, updatedBy: user }

  await rowsCol.deleteMany({ source: "import", editedInWms: { $ne: true } })
  if (toInsert.length) {
    await rowsCol.insertMany(toInsert.map((r) => ({ ...r, ...meta, serialKey: serialKey(r.oldSerial) })))
  }
  if (parsed.storage.length) {
    await db.collection(STORAGE_COLL).deleteMany({ source: "import" })
    await db.collection(STORAGE_COLL).insertMany(parsed.storage.map((r) => ({ ...r, ...meta })))
  }
  if (parsed.sales.length) {
    await db.collection(SALES_COLL).deleteMany({ source: "import" })
    await db.collection(SALES_COLL).insertMany(parsed.sales.map((r) => ({ ...r, ...meta })))
  }
  if (parsed.options) {
    await db.collection(OPTIONS_COLL).updateOne(
      { _id: "saraburi" as never },
      { $set: { ...parsed.options, updatedAt: now, updatedBy: user } },
      { upsert: true },
    )
  }
  return NextResponse.json({ ok: true, mode: "apply", ...preview })
}
