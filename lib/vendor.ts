// lib/vendor.ts
// ชั้นคุย MongoDB ของ Vendor List — ตรรกะทั้งหมดอยู่ใน vendor-core.ts
import clientPromise from "@/lib/mongo"
import {
  DB_NAME, COLL_NAME, INVENTORY_IDS, MONTHS_BACK, ymBack, ymOf,
  buildVendorPayload, seedServiceTypeFromName, serviceTypeFromGroup, isRealVendor,
  type VendorRawRow, type LabourCode, type VendorApproval, type VendorPayload, type ServiceType,
} from "@/lib/vendor-core"

const MASTER_DB = process.env.MONGO_DB ?? "master_data"
const CODE_COLL = "labour_code_master"
const AP_COLL   = "vendor_approval"

type RawDoc = {
  _id: { v: string | null; g: string | null; c: string | null }
  rows: number | null
  baht: number | null
  jobs: number | null
  lastYm: string | null
  name: string | null
  wh: (string | null)[] | null
}

/** ยุบฝั่ง Mongo ก่อนเสมอ — 16k แถวดิบยุบเหลือหลักพัน ส่งข้ามเน็ตน้อยลงมาก
 *  index (year_month, inventory_id) รองรับ $match อยู่แล้ว (ดู deadstock-core) */
async function fetchRaw(fromYm: string): Promise<VendorRawRow[]> {
  const client = await clientPromise
  const col = client.db(DB_NAME).collection(COLL_NAME)
  const docs = await col.aggregate<RawDoc>([
    {
      $match: {
        year_month: { $gte: fromYm },
        inventory_id: { $in: INVENTORY_IDS },
        "กลุ่มสินค้า": { $regex: "^ค่าแรง" },
        "รับ": { $gt: 0 },
        "ซัพพลายเออร์": { $nin: [null, ""] },
      },
    },
    {
      $group: {
        _id: { v: "$ซัพพลายเออร์", g: "$กลุ่มสินค้า", c: "$รหัสสินค้า" },
        rows: { $sum: 1 },
        baht: { $sum: "$ยอดเงิน" },
        // จำนวน "ครั้ง" ที่ใช้บริการ = ใบรับไม่ซ้ำ ไม่ใช่จำนวนบรรทัด
        // (ใบเดียวมีค่าแรงหลายบรรทัดได้ นับบรรทัดจะเป่าตัวเลขให้อู่ที่แตกบิลละเอียด)
        dd: { $addToSet: "$DD" },
        lastYm: { $max: "$year_month" },
        name: { $last: "$ชื่อสินค้า" },
        wh: { $addToSet: "$คลังสินค้า" },
      },
    },
    { $project: { rows: 1, baht: 1, lastYm: 1, name: 1, wh: 1, jobs: { $size: "$dd" } } },
  ], { maxTimeMS: 60_000, allowDiskUse: true }).toArray()

  return docs.map((d) => ({
    vendor: (d._id.v ?? "").trim(),
    group: (d._id.g ?? "").trim(),
    code: (d._id.c ?? "").trim(),
    itemName: (d.name ?? "").trim(),
    rows: d.rows ?? 0,
    jobs: d.jobs ?? 0,
    baht: d.baht ?? 0,
    lastYm: d.lastYm ?? "",
    warehouses: (d.wh ?? []).map((w) => (w ?? "").trim()).filter(Boolean),
  }))
}

async function readCodes(): Promise<LabourCode[]> {
  const client = await clientPromise
  return (await client.db(MASTER_DB).collection<LabourCode>(CODE_COLL)
    .find({}, { projection: { _id: 0 } }).toArray()) as LabourCode[]
}

async function readApprovals(): Promise<VendorApproval[]> {
  const client = await clientPromise
  return (await client.db(MASTER_DB).collection<VendorApproval>(AP_COLL)
    .find({}, { projection: { _id: 0 } }).toArray()) as VendorApproval[]
}

// ข้อมูลต้นทางขยับวันละครั้งจาก pipeline ATMS — ไม่มีเหตุให้ยิง DB ทุก request
// เก็บบน globalThis ให้รอดข้าม hot-reload ตอน dev และ warm invocation บน Vercel
// (แพตเทิร์นเดียวกับ lib/deadstock.ts)
const TTL_MS = 60 * 60 * 1000

declare global {
  var _vendorRawCache: { at: number; fromYm: string; rows: VendorRawRow[] } | undefined
}

async function cachedRaw(force: boolean, fromYm: string): Promise<VendorRawRow[]> {
  const hit = globalThis._vendorRawCache
  if (!force && hit && hit.fromYm === fromYm && Date.now() - hit.at < TTL_MS) return hit.rows
  const rows = await fetchRaw(fromYm)
  globalThis._vendorRawCache = { at: Date.now(), fromYm, rows }
  return rows
}

/** ข้อมูลทั้งหน้า — cache เฉพาะส่วนที่หนัก (aggregation) ส่วน master ที่คนแก้
 *  อ่านสดทุกครั้ง จะได้เห็นผลทันทีหลังกดอนุมัติ ไม่ต้องรอ cache หมดอายุ */
export async function getVendors(force = false): Promise<VendorPayload> {
  const asOf = new Date()
  const fromYm = ymBack(asOf, MONTHS_BACK - 1)
  const [raw, codes, approvals] = await Promise.all([
    cachedRaw(force, fromYm),
    readCodes(),
    readApprovals(),
  ])
  return buildVendorPayload(raw, codes, approvals, ymOf(asOf), fromYm)
}

/** รายการรหัสค่าแรงสำหรับหน้าตั้งค่า — sync รหัสที่โผล่ในข้อมูลจริงเข้ามาก่อน
 *  seed ค่าเดาให้ครั้งแรก แต่ไม่เคยทับ serviceType ที่คนตั้งไว้
 *  เฉพาะรหัสในกลุ่ม "ค่าแรง" เปล่า ๆ — กลุ่มที่บอกประเภทมาแล้วไม่ต้องให้คนมานั่งตั้ง */
export async function listLabourCodes(): Promise<LabourCode[]> {
  const asOf = new Date()
  const fromYm = ymBack(asOf, MONTHS_BACK - 1)
  const raw = await cachedRaw(false, fromYm)

  const stat = new Map<string, { name: string; jobs: number; baht: number }>()
  for (const r of raw) {
    if (!isRealVendor(r.vendor)) continue
    if (serviceTypeFromGroup(r.group)) continue // กลุ่มบอกประเภทเองได้ ไม่ต้องตั้ง
    const s = stat.get(r.code) ?? { name: r.itemName, jobs: 0, baht: 0 }
    s.jobs += r.jobs
    s.baht = Math.round((s.baht + r.baht) * 100) / 100
    if (!s.name) s.name = r.itemName
    stat.set(r.code, s)
  }
  if (!stat.size) return []

  const client = await clientPromise
  const col = client.db(MASTER_DB).collection<LabourCode>(CODE_COLL)
  await col.createIndex({ code: 1 }, { unique: true }).catch(() => {})
  await col.bulkWrite([...stat.entries()].map(([code, s]) => ({
    updateOne: {
      filter: { code },
      update: {
        // สถิติรีเฟรชได้ทุกครั้ง แต่ serviceType เป็นของคน ห้ามทับ
        $set: { itemName: s.name, jobs: s.jobs, baht: s.baht },
        $setOnInsert: { code, serviceType: "", seeded: seedServiceTypeFromName(s.name) },
      },
      upsert: true,
    },
  })), { ordered: false })

  const fresh = await readCodes()
  const byCode = new Map(fresh.map((c) => [c.code, c]))
  return [...stat.entries()]
    .map(([code, s]) => byCode.get(code) ?? {
      code, itemName: s.name, serviceType: "" as const,
      seeded: seedServiceTypeFromName(s.name), jobs: s.jobs, baht: s.baht,
    })
    .sort((a, b) => b.baht - a.baht)
}

export async function setLabourCode(
  code: string, serviceType: ServiceType | "", by: string
): Promise<void> {
  const client = await clientPromise
  await client.db(MASTER_DB).collection<LabourCode>(CODE_COLL).updateOne(
    { code },
    { $set: { serviceType, by, at: new Date().toISOString() }, $setOnInsert: { code, itemName: "", seeded: null, jobs: 0, baht: 0 } },
    { upsert: true }
  )
}

/** ติ๊ก/เอาติ๊กออก ของคู่ (อู่ × รหัสประเภทการซ่อม) — บันทึกทีละช่อง
 *  ใช้ $addToSet/$pull แทนการเขียนทั้ง array กัน 2 คนติ๊กพร้อมกันแล้วทับกันหาย */
export async function setVendorCapability(
  vendor: string, code: string, on: boolean, by: string
): Promise<void> {
  const client = await clientPromise
  const col = client.db(MASTER_DB).collection<VendorApproval>(AP_COLL)
  await col.createIndex({ vendor: 1 }, { unique: true }).catch(() => {})
  const at = new Date().toISOString()
  await col.updateOne(
    { vendor },
    {
      ...(on ? { $addToSet: { codes: code } } : { $pull: { codes: code } }),
      $set: { by, at },
      $setOnInsert: { vendor, status: "pending" as const },
    },
    { upsert: true }
  )
}

export async function setVendorApproval(
  vendor: string,
  patch: { status?: VendorApproval["status"]; codes?: string[]; note?: string },
  by: string
): Promise<void> {
  const client = await clientPromise
  const col = client.db(MASTER_DB).collection<VendorApproval>(AP_COLL)
  await col.createIndex({ vendor: 1 }, { unique: true }).catch(() => {})
  const $set: Record<string, unknown> = { by, at: new Date().toISOString() }
  if (patch.status !== undefined) $set.status = patch.status
  if (patch.codes  !== undefined) $set.codes  = patch.codes
  if (patch.note   !== undefined) $set.note   = patch.note
  await col.updateOne(
    { vendor },
    { $set, $setOnInsert: {
        vendor,
        ...(patch.status === undefined ? { status: "pending" as const } : {}),
        ...(patch.codes  === undefined ? { codes: [] } : {}),
    } },
    { upsert: true }
  )
}
