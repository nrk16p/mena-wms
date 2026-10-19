import { NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "master_codes"

// ชุดรหัสที่หน้าแสดงผลต้องใช้แปลงรหัส → ชื่อเต็ม
const DICTS = [
  "WAREHOUSE", "EXPENSE_TYPE", "SYSTEM_L1", "SUB_ASSEMBLY_L2", "COMPONENT_L3",
  "LAB_L2", "LAB_L3", "POSITION", "UNIT", "GRADE", "BRAND", "VEHICLE_TYPE",
]

type Label = { th: string; en: string }
export type CodeLabels = Record<string, Record<string, Label>>

// GET /api/codes/labels
// คืน map กระชับ (เฉพาะ th/en) ของทุกชุดรหัส เรียกครั้งเดียวต่อการโหลดหน้า
// L2/L3 มีรหัสซ้ำกันได้ภายใต้พ่อแม่ต่างกัน จึงคีย์ด้วย "parent:code" และใส่คีย์ "code" เปล่าไว้เป็นทางสำรอง
export async function GET() {
  const client = await clientPromise
  const rows   = await client.db(DB).collection(COLL)
    .find({ dict: { $in: DICTS } })
    .project({ _id: 0, dict: 1, code: 1, th: 1, en: 1, parent: 1 })
    .toArray()

  const out: CodeLabels = {}
  for (const r of rows) {
    const dict  = String(r.dict)
    const code  = String(r.code)
    const label = { th: String(r.th ?? ""), en: String(r.en ?? "") }
    out[dict] ??= {}
    if (r.parent) out[dict][`${r.parent}:${code}`] = label
    out[dict][code] ??= label
  }

  return NextResponse.json(out, {
    headers: { "Cache-Control": "private, max-age=300" },
  })
}
