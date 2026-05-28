import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import clientPromise from "@/lib/mongo"
import { buildSku } from "@/lib/codes"
import { authOptions } from "@/lib/auth"
import { isAdmin } from "@/lib/roles"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "master_sku"

// GET /api/sku  — list with optional filters
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const wh        = searchParams.get("wh")        ?? ""
  const type      = searchParams.get("type")      ?? ""
  const l1        = searchParams.get("l1")        ?? ""
  const l2        = searchParams.get("l2")        ?? ""
  const l3        = searchParams.get("l3")        ?? ""
  const brand     = searchParams.get("brand")     ?? ""
  const grade     = searchParams.get("grade")     ?? ""
  const vehicle   = searchParams.get("vehicle")   ?? ""
  const status    = searchParams.get("status")    ?? ""
  const createdBy = searchParams.get("createdBy") ?? ""
  const q         = searchParams.get("q")         ?? ""
  const page    = Math.max(1, parseInt(searchParams.get("page") ?? "1"))
  const limit   = Math.min(200, parseInt(searchParams.get("limit") ?? "50"))

  const filter: Record<string, unknown> = {}
  if (wh)      filter["คลังสินค้า"]        = wh
  if (type)    filter["ประเภทค่าใช้จ่าย"] = type
  if (l1)      filter["ระบบ_L1"]           = l1
  if (l2)      filter["ชุดประกอบ_L2"]      = l2
  if (l3)      filter["ชิ้นส่วน_L3"]       = l3
  if (brand)   filter["ยี่ห้อ"]            = { $regex: brand, $options: "i" }
  if (grade)   filter["Grade"]             = grade
  if (status)    filter["status"]            = status
  if (createdBy) filter["createdBy"]         = createdBy
  if (q) {
    filter["$or"] = [
      { "ชื่ออะไหล่_TH": { $regex: q, $options: "i" } },
      { "Part_Name_EN":   { $regex: q, $options: "i" } },
      { "เบอร์อะไหล่":   { $regex: q, $options: "i" } },
      { "รหัสATMS":       { $elemMatch: { $regex: q, $options: "i" } } },
      { SKU:              { $regex: q, $options: "i" } },
    ]
  }

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  // Vehicle filter: cross-lookup vehicle_master so searching by plate also
  // returns SKUs tagged with that plate's type-group (@type:X), and vice versa.
  if (vehicle) {
    const vcol = client.db(DB).collection("vehicle_master")
    const matches = await vcol
      .find({
        $or: [
          { plate:       { $regex: vehicle, $options: "i" } },
          { vehicleType: { $regex: vehicle, $options: "i" } },
          { engineNo:    { $regex: vehicle, $options: "i" } },
          { chassisNo:   { $regex: vehicle, $options: "i" } },
        ],
      } as never)
      .project({ plate: 1, vehicleType: 1 })
      .limit(500)
      .toArray()

    const relatedPlates = [...new Set(matches.map((v) => (v as { plate: string }).plate).filter(Boolean))]
    const relatedTypes  = [...new Set(matches.map((v) => (v as { vehicleType: string }).vehicleType).filter(Boolean))]
      .map((t) => `@type:${t}`)

    const vehicleConds: object[] = [
      { "ทะเบียนหรือรุ่นรถ": { $elemMatch: { $regex: vehicle, $options: "i" } } },
    ]
    if (relatedPlates.length > 0) vehicleConds.push({ "ทะเบียนหรือรุ่นรถ": { $in: relatedPlates } })
    if (relatedTypes.length  > 0) vehicleConds.push({ "ทะเบียนหรือรุ่นรถ": { $in: relatedTypes  } })

    filter["$and"] = [{ $or: vehicleConds }]
  }

  // Distinct facet request
  const distinct = searchParams.get("distinct")
  if (distinct === "brand") {
    const brands = await col.distinct("ยี่ห้อ", filter)
    return NextResponse.json(brands.filter(Boolean).sort())
  }
  if (distinct === "grade") {
    const grades = await col.distinct("Grade", filter)
    return NextResponse.json(grades.filter(Boolean).sort())
  }

  const total  = await col.countDocuments(filter)
  const items  = await col
    .find(filter)
    .sort({ SKU: 1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray()

  return NextResponse.json({ total, page, limit, items })
}

// POST /api/sku  — create new SKU
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { wh, type, l1, l2, l3, ...rest } = body

  if (!wh || !type || !l1 || !l2 || !l3) {
    return NextResponse.json({ error: "Missing required fields: wh, type, l1, l2, l3" }, { status: 400 })
  }

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  // Auto-increment SEQ per wh+type+l1+l2+l3 (include pending in count so SKU is reserved)
  const prefix = `${wh}-${type}-${l1}-${l2}-${l3}-`
  const last   = await col
    .find({ SKU: { $regex: `^${prefix}` } })
    .sort({ SKU: -1 })
    .limit(1)
    .toArray()

  const seq = last.length > 0
    ? parseInt(last[0].SKU.split("-").pop() ?? "0") + 1
    : 1

  const sku      = buildSku(wh, type, l1, l2, l3, seq)
  const noPrice  = ["LAB", "SVC", "CLN", "TRP", "ACC"].includes(type)
  const price    = noPrice ? 0 : (parseFloat(rest.price) || 0)
  const userIsAdmin = isAdmin(session.user.email)

  const doc = {
    SKU:               sku,
    status:            userIsAdmin ? "approved" : "pending",
    createdBy:         session.user.email,
    createdByName:     session.user.name ?? "",
    คลังสินค้า:        wh,
    ประเภทค่าใช้จ่าย: type,
    ชื่ออะไหล่_TH:    rest.nameTh    ?? "",
    Part_Name_EN:      rest.nameEn    ?? "",
    เบอร์อะไหล่:       rest.partNo    ?? "",
    ระบบ_L1:           l1,
    ชุดประกอบ_L2:      l2,
    ชิ้นส่วน_L3:       l3,
    ตำแหน่ง:           rest.position  ?? "GN",
    ราคาต่อหน่วย:      price,
    หน่วย:             rest.unit      ?? "PC",
    ยี่ห้อ:            rest.brand     ?? "",
    เบอร์แท้อ้างอิง:   rest.oemRef    ?? "",
    เบอร์เทียบอ้างอิง: Array.isArray(rest.compatRefs) ? rest.compatRefs : (rest.compatRef ? [rest.compatRef] : []),
    ทะเบียนหรือรุ่นรถ: Array.isArray(rest.vehicles) ? rest.vehicles : (rest.vehicle ? [rest.vehicle] : []),
    Grade:             rest.grade     ?? "NA",
    รหัสATMS:          Array.isArray(rest.atmsCodes) ? rest.atmsCodes : (rest.atmsCode ? [rest.atmsCode] : []),
    createdAt:         new Date(),
    updatedAt:         new Date(),
  }

  await col.insertOne(doc)
  return NextResponse.json({ sku, status: doc.status, doc }, { status: 201 })
}
