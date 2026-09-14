import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { normalizeProductKey } from "@/lib/tire-due"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "tire_spec_master"

// GET /api/tire-spec-master?withUsage=1
//   withUsage = แนบจำนวนยางที่ "ใช้อยู่จริง" ของสเปคนั้นมาด้วย
//   ระยะกำหนดที่ตั้งผิดจะไปโผล่เป็นการเตือนผิดๆ ในแท็บ "ยางถึงกำหนดเปลี่ยน"
//   คนตั้งค่าจึงต้องเห็นว่าตัวเลขแต่ละแถวกระทบยางกี่เส้น ก่อนกดแก้
export async function GET(req: NextRequest) {
  const client = await clientPromise
  const db = client.db(DB)
  const docs = await db.collection(COLL)
    .find({})
    .sort({ brand: 1, tireSize: 1, tireModel: 1 })
    .toArray()

  if (req.nextUrl.searchParams.get("withUsage") !== "1") return NextResponse.json(docs)

  // นับแยกสาขาด้วย — แถวสเปคของสาขาหนึ่งไม่ควรโชว์จำนวนยางของอีกสาขา
  const used = await db.collection("tire_distance")
    .aggregate([{ $group: { _id: { p: "$product", b: "$branch" }, n: { $sum: 1 } } }])
    .toArray()
  const byProduct = new Map<string, number>()
  const byBranchProduct = new Map<string, number>()
  for (const u of used) {
    const pk = normalizeProductKey(u._id?.p)
    byProduct.set(pk, (byProduct.get(pk) ?? 0) + (u.n as number))
    byBranchProduct.set(`${u._id?.b}|${pk}`, u.n as number)
  }

  return NextResponse.json(docs.map((d) => {
    const pk = normalizeProductKey(d.productName)
    const branch = String(d.branch ?? "").trim()
    return { ...d, tires: (branch ? byBranchProduct.get(`${branch}|${pk}`) : byProduct.get(pk)) ?? 0 }
  }))
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const brand     = String(body.brand     ?? "").trim()
  const tireSize  = String(body.tireSize  ?? "").trim()
  const tireModel = String(body.tireModel ?? "").trim()
  const distance  = Number(body.distance) || 0
  // ระยะกำหนดแยกล้อหน้า/หลังได้ (ล้อหน้าสึกเร็วกว่า) — ไม่กรอกแยก = ใช้ค่าเดียวทั้งคัน
  const distanceFront = Number(body.distanceFront) || 0
  const distanceRear  = Number(body.distanceRear)  || 0
  const branch = String(body.branch ?? "").trim()   // ว่าง = สเปคกลางใช้ได้ทุกสาขา

  if (!brand)        return NextResponse.json({ error: "กรุณาระบุยี่ห้อ" },    { status: 400 })
  if (!tireSize)     return NextResponse.json({ error: "กรุณาระบุขนาดยาง" }, { status: 400 })
  if (!tireModel)    return NextResponse.json({ error: "กรุณาระบุรุ่นยาง" },  { status: 400 })
  if (distance <= 0 && distanceFront <= 0 && distanceRear <= 0)
    return NextResponse.json({ error: "กรุณาระบุระยะทาง" }, { status: 400 })

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await col.findOne({ brand, tireSize, tireModel } as any)
  if (existing) return NextResponse.json({ error: `สเปค ${brand} ${tireSize} ${tireModel} มีอยู่แล้ว` }, { status: 409 })

  const doc = {
    brand, tireSize, tireModel, branch,
    distance: distance || distanceRear || distanceFront,
    distanceFront, distanceRear,
    productCode: String(body.productCode ?? "").trim(),
    productName: String(body.productName ?? "").trim(),
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await col.insertOne(doc as any)
  return NextResponse.json({ ...doc, _id: result.insertedId }, { status: 201 })
}
