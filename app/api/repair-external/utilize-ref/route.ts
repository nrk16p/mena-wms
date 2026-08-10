import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "repair_external"

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// GET /api/repair-external/utilize-ref?plates=สบ.71-1256,70-8001
// Public read-only — reference data งานซ่อมอู่นอก/อะไหล่ลงคัน แบบ batch หลายทะเบียน
// ใช้โดย mena-intelligence /truck_utilize_analysis (โยงแถว Group Status "ซ่อม" กับงานซ่อมจริง)
// ตอบ: { refs: { "<ทะเบียนที่ส่งมา>": [งานล่าสุดก่อน, ...] } } สูงสุด 5 งาน/ทะเบียน
export async function GET(req: NextRequest) {
  const platesParam = req.nextUrl.searchParams.get("plates")?.trim() ?? ""
  const inputs = [...new Set(platesParam.split(",").map((p) => p.trim()).filter(Boolean))].slice(0, 100)
  if (!inputs.length) return NextResponse.json({ error: "ต้องระบุ plates" }, { status: 400 })

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  // ทะเบียนสองระบบอาจเขียนต่างกันเล็กน้อย (เว้นวรรค/จุด/จังหวัด) → match แบบ contains สองทาง
  const ors = inputs.flatMap((p) => {
    const rx = { $regex: escapeRegex(p), $options: "i" }
    return [{ plate: rx }, { fleetNo: rx }]
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docs = await col.find({ $or: ors } as any)
    .project({
      plate: 1, fleetNo: 1, jobType: 1, symptom: 1, garage: 1, status: 1,
      receivedDate: 1, garageInDate: 1, dueDate: 1, completedDate: 1, mrNo: 1,
    })
    .sort({ receivedDate: -1, _id: -1 })
    .limit(1000)
    .toArray()

  const refs: Record<string, unknown[]> = {}
  for (const input of inputs) {
    const low = input.toLowerCase()
    refs[input] = docs
      .filter((d) => {
        const plate = String(d.plate ?? "").toLowerCase()
        const fleet = String(d.fleetNo ?? "").toLowerCase()
        const match = (v: string) => v !== "" && (v.includes(low) || low.includes(v))
        return match(plate) || match(fleet)
      })
      .slice(0, 5)
      .map(({ _id, ...rest }) => ({ id: String(_id), ...rest }))
  }

  return NextResponse.json({ refs })
}
