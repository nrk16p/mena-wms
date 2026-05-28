import { NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "master_codes"

// GET /api/codes/parts-tree
// Returns { l1: [...], l2: [...], l3: [...] } in one round-trip
export async function GET() {
  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  const [l1, l2, l3] = await Promise.all([
    col.find({ dict: "SYSTEM_L1"       }).sort({ order: 1, code: 1 }).toArray(),
    col.find({ dict: "SUB_ASSEMBLY_L2" }).sort({ order: 1, code: 1 }).toArray(),
    col.find({ dict: "COMPONENT_L3"   }).sort({ order: 1, code: 1 }).toArray(),
  ])

  return NextResponse.json({ l1, l2, l3 })
}
