import { NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "master_codes"

const DICT_META: Record<string, { label: string; hasParent: boolean; parentLabel?: string }> = {
  WAREHOUSE:       { label: "คลังสินค้า",               hasParent: false },
  EXPENSE_TYPE:    { label: "ประเภทค่าใช้จ่าย",        hasParent: false },
  SYSTEM_L1:       { label: "ระบบ L1",                 hasParent: false },
  SUB_ASSEMBLY_L2: { label: "ชุดประกอบ L2",            hasParent: true, parentLabel: "L1 Code" },
  COMPONENT_L3:    { label: "ชิ้นส่วน L3",             hasParent: true, parentLabel: "L1:L2 Code" },
  POSITION:        { label: "ตำแหน่ง",                 hasParent: false },
  UNIT:            { label: "หน่วย",                   hasParent: false },
  GRADE:           { label: "Grade",                   hasParent: false },
  VEHICLE_TYPE:    { label: "รุ่น/ประเภทรถ",           hasParent: false },
}

// GET /api/codes — summary of all dicts
export async function GET() {
  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  const pipeline = [
    { $group: { _id: "$dict", count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]
  const raw = await col.aggregate(pipeline).toArray()

  const result = raw.map((r) => ({
    dict:        r._id,
    count:       r.count,
    ...DICT_META[r._id as string] ?? { label: r._id, hasParent: false },
  }))

  return NextResponse.json(result)
}
