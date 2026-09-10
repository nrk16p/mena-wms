// lib/vendor.ts
// ชั้นคุย MongoDB ของ Vendor List — ตรรกะทั้งหมดอยู่ใน vendor-core.ts
import clientPromise from "@/lib/mongo"
import {
  DB_NAME, COLL_NAME, INVENTORY_IDS, MONTHS_BACK, ymBack, ymOf,
  buildVendorPayload, seedServiceTypeFromName, serviceTypeFromGroup, isRealVendor,
  autoApproveCandidates, codesByRule, AUTO_APPROVE_BY,
  type VendorRawRow, type LabourCode, type VendorApproval, type VendorPayload, type ServiceType, type VendorKind,
} from "@/lib/vendor-core"
import { VENDOR_LOG_COLL, type VendorLogEntry } from "@/lib/vendor-log"

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

/** อนุมัติอู่ที่เข้าเกณฑ์ AUTO_APPROVE_RULE เป็นชุด — **รันครั้งเดียวด้วยมือ** ผ่าน
 *  scripts/approve-vendors-once.ts ไม่ได้ผูกกับการเปิดหน้า (ผู้ใช้ย้ำ 10/09/2026: "not always auto,
 *  just one time") อู่ที่เข้าเกณฑ์ทีหลังต้องให้แอดมินกดเอง หรือรันสคริปต์ซ้ำเมื่อสั่ง
 *
 *  filter ซ้ำเงื่อนไขของ autoApproveCandidates จงใจ — กันเขียนทับสถานะที่คนเพิ่งเปลี่ยน
 *  ระหว่างที่ payload ถูกคำนวณ · เขียนสำเร็จเท่านั้นจึงลงประวัติ (E11000 = ไม่ match แล้ว
 *  upsert เลยชนดัชนี = มีคนตั้งสถานะไปก่อน ข้ามอย่างเงียบ ๆ) */
/** ติ๊กประเภทการซ่อมเป็นชุดตามเกณฑ์ codesByRule (ช่องที่มีประวัติ ≥20 ครั้ง) — **รันครั้งเดียวด้วยมือ**
 *  ผ่าน scripts/tick-vendor-codes-once.ts เช่นเดียวกับการอนุมัติ · $addToSet เพิ่มอย่างเดียว
 *  ไม่เคยเอาติ๊กของคนออก · ลงประวัติเป็น tick รายช่องด้วยชื่อ "ระบบอัตโนมัติ" เหมือนคนติ๊ก
 *  จะได้อ่านในลิ้นชักประวัติด้วยตัวแปลข้อความเดิม · คืนจำนวนช่องที่ติ๊กเพิ่มจริง */
export async function tickVendorCodesByRule(payload: VendorPayload): Promise<{ vendors: number; cells: number }> {
  const client = await clientPromise
  const col = client.db(MASTER_DB).collection<VendorApproval>(AP_COLL)
  await col.createIndex({ vendor: 1 }, { unique: true }).catch(() => {})
  const at = new Date()
  const atIso = at.toISOString()
  const log: VendorLogEntry[] = []
  let vendors = 0
  for (const v of payload.vendors) {
    const add = codesByRule(v)
    if (!add.length) continue
    // อ่านของจริงก่อนเขียน — payload อาจเก่ากว่าที่คนเพิ่งติ๊ก ลงประวัติเฉพาะช่องที่เพิ่มจริง
    const before = await col.findOneAndUpdate(
      { vendor: v.vendor },
      { $addToSet: { codes: { $each: add } }, $set: { codesBy: AUTO_APPROVE_BY, codesAt: atIso },
        $setOnInsert: { vendor: v.vendor, status: "pending" as const } },
      { upsert: true, returnDocument: "before" }
    )
    const had = new Set(before?.codes ?? [])
    const added = add.filter((c) => !had.has(c))
    if (!added.length) continue
    vendors += 1
    for (const code of added) log.push({ vendor: v.vendor, action: "tick", code, by: AUTO_APPROVE_BY, byEmail: "", at })
  }
  await writeVendorLog(log)
  return { vendors, cells: log.length }
}

export async function approveVendorsByRule(payload: VendorPayload): Promise<string[]> {
  const cands = autoApproveCandidates(payload.vendors)
  if (!cands.length) return []
  const client = await clientPromise
  const col = client.db(MASTER_DB).collection<VendorApproval>(AP_COLL)
  await col.createIndex({ vendor: 1 }, { unique: true }).catch(() => {})
  const at = new Date()
  const atIso = at.toISOString()
  const log: VendorLogEntry[] = []
  const done: string[] = []
  for (const v of cands) {
    try {
      const r = await col.updateOne(
        { vendor: v.vendor, status: "pending", autoApproved: { $ne: false } },
        { $set: { status: "approved", autoApproved: true, by: AUTO_APPROVE_BY, at: atIso },
          $setOnInsert: { vendor: v.vendor, codes: [] } },
        { upsert: true }
      )
      if (!r.modifiedCount && !r.upsertedCount) continue
      done.push(v.vendor)
      log.push({ vendor: v.vendor, action: "status", from: "pending", to: "approved", by: AUTO_APPROVE_BY, byEmail: "", at })
    } catch (e) {
      if (!(e instanceof Error && /E11000/.test(e.message))) console.error("[vendor] approve-by-rule", v.vendor, e)
    }
  }
  await writeVendorLog(log)
  return done
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

/** เขียนสมุดบันทึกทีละบรรทัด — append อย่างเดียว ไม่มีการแก้ของเดิม
 *  ไม่ throw ออกไป: ประวัติหายดีกว่าคนติ๊กแล้วเด้ง error ทั้งที่ค่าถูกบันทึกไปแล้ว
 *  (ถ้าเขียนไม่ผ่านจะเห็นใน log ของ Vercel) */
async function writeVendorLog(entries: VendorLogEntry[]): Promise<void> {
  if (!entries.length) return
  try {
    const client = await clientPromise
    const col = client.db(MASTER_DB).collection<VendorLogEntry>(VENDOR_LOG_COLL)
    await col.createIndex({ vendor: 1, at: -1 }).catch(() => {})
    await col.insertMany(entries, { ordered: false })
  } catch (e) {
    console.error("[vendor-log] write failed", e)
  }
}

/** ประวัติการแก้ของอู่รายนี้ — ใหม่ไปเก่า */
export async function listVendorLog(vendor: string, limit = 300): Promise<VendorLogEntry[]> {
  const client = await clientPromise
  return (await client.db(MASTER_DB).collection<VendorLogEntry>(VENDOR_LOG_COLL)
    .find({ vendor }, { projection: { _id: 0 } })
    .sort({ at: -1 })
    .limit(limit)
    .toArray()) as VendorLogEntry[]
}

/** ติ๊ก/เอาติ๊กออก ของคู่ (อู่ × รหัสประเภทการซ่อม) — บันทึกทีละช่อง
 *  ใช้ $addToSet/$pull แทนการเขียนทั้ง array กัน 2 คนติ๊กพร้อมกันแล้วทับกันหาย
 *
 *  by/at ของการติ๊กแยกเป็น codesBy/codesAt ไม่ปนกับ by/at ของการอนุมัติ —
 *  เดิมสองเรื่องเขียนทับช่องเดียวกัน คนอนุมัติจึงกลบชื่อคนติ๊กไปเงียบ ๆ */
export async function setVendorCapability(
  vendor: string, code: string, on: boolean, by: string, byEmail = ""
): Promise<void> {
  const client = await clientPromise
  const col = client.db(MASTER_DB).collection<VendorApproval>(AP_COLL)
  await col.createIndex({ vendor: 1 }, { unique: true }).catch(() => {})
  const at = new Date()
  // เอาเอกสารก่อนแก้มาด้วย จะได้รู้ว่าคลิกนี้เปลี่ยนค่าจริงไหม — ติ๊กซ้ำของเดิม
  // ไม่ควรมีบรรทัดในประวัติ ไม่งั้นสมุดจะเต็มไปด้วยการกดที่ไม่ได้เปลี่ยนอะไร
  const before = await col.findOneAndUpdate(
    { vendor },
    {
      ...(on ? { $addToSet: { codes: code } } : { $pull: { codes: code } }),
      $set: { codesBy: by, codesAt: at.toISOString() },
      $setOnInsert: { vendor, status: "pending" as const },
    },
    { upsert: true, returnDocument: "before" }
  )
  const had = (before?.codes ?? []).includes(code)
  if (had === on) return
  await writeVendorLog([{
    vendor, action: on ? "tick" : "untick", code, by, byEmail, at,
  }])
}

/** ตั้งประเภทคู่ค้า (อู่ / ร้านอะไหล่ / ว่าง) — ทุกคนที่ล็อกอินตั้งได้เหมือนการติ๊ก มีประวัติทุกครั้ง
 *  ไม่แตะ by/at ของการอนุมัติ และไม่แตะ codesBy/codesAt */
export async function setVendorKind(vendor: string, kind: VendorKind | "", by: string, byEmail = ""): Promise<void> {
  const client = await clientPromise
  const col = client.db(MASTER_DB).collection<VendorApproval>(AP_COLL)
  await col.createIndex({ vendor: 1 }, { unique: true }).catch(() => {})
  const at = new Date()
  const before = await col.findOneAndUpdate(
    { vendor },
    { ...(kind ? { $set: { kind } } : { $unset: { kind: "" } }), $setOnInsert: { vendor, status: "pending" as const, codes: [] } },
    { upsert: true, returnDocument: "before" }
  )
  const prev = before?.kind ?? ""
  if (prev === kind) return
  await writeVendorLog([{ vendor, action: "kind", from: prev, to: kind, by, byEmail, at }])
}

export async function setVendorApproval(
  vendor: string,
  patch: { status?: VendorApproval["status"]; codes?: string[]; note?: string },
  by: string,
  byEmail = ""
): Promise<void> {
  const client = await clientPromise
  const col = client.db(MASTER_DB).collection<VendorApproval>(AP_COLL)
  await col.createIndex({ vendor: 1 }, { unique: true }).catch(() => {})
  const at = new Date()
  const $set: Record<string, unknown> = { by, at: at.toISOString() }
  // คนตั้งสถานะเอง = ปิดประตูอัตโนมัติสำหรับอู่รายนี้ถาวร (ดึงกลับมา "รอพิจารณา" ก็ต้องไม่ถูกอนุมัติซ้ำ)
  if (patch.status !== undefined) { $set.status = patch.status; $set.autoApproved = false }
  if (patch.codes  !== undefined) { $set.codes = patch.codes; $set.codesBy = by; $set.codesAt = at.toISOString() }
  if (patch.note   !== undefined) $set.note   = patch.note
  const before = await col.findOneAndUpdate(
    { vendor },
    { $set, $setOnInsert: {
        vendor,
        ...(patch.status === undefined ? { status: "pending" as const } : {}),
        ...(patch.codes  === undefined ? { codes: [] } : {}),
    } },
    { upsert: true, returnDocument: "before" }
  )

  const log: VendorLogEntry[] = []
  const prevStatus = before?.status ?? "pending"
  if (patch.status !== undefined && patch.status !== prevStatus) {
    log.push({ vendor, action: "status", from: prevStatus, to: patch.status, by, byEmail, at })
  }
  if (patch.note !== undefined && patch.note !== (before?.note ?? "")) {
    log.push({ vendor, action: "note", from: before?.note ?? "", to: patch.note, by, byEmail, at })
  }
  if (patch.codes !== undefined) {
    const prev = [...(before?.codes ?? [])].sort().join(" ")
    const next = [...patch.codes].sort().join(" ")
    if (prev !== next) log.push({ vendor, action: "codes", from: prev, to: next, by, byEmail, at })
  }
  await writeVendorLog(log)
}
