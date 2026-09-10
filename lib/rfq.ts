// lib/rfq.ts — ชั้นคุย MongoDB ของ Vendor RFQ · ตรรกะอยู่ใน rfq-core
import { ObjectId, type WithId, type Document } from "mongodb"
import clientPromise from "@/lib/mongo"
import { bkkToday, toBkkIso } from "@/lib/bkk-time"
import {
  newToken, effectiveStatus, canTransition, canVendorWrite, progress, SVC_SHEET, SHEET_ORDER,
  type RfqInvite, type RfqJob, type RfqPart, type RfqAnswer, type RfqPartAnswer, type RfqContact,
  type RfqLogEntry, type RfqSection, type EffectiveStatus, type RfqProfile,
} from "@/lib/rfq-core"
import { VENDOR_LOG_COLL, type VendorLogEntry } from "@/lib/vendor-log"

const DB = process.env.MONGO_DB ?? "master_data"
export const INVITE_COLL = "rfq_invites"
export const LOG_COLL = "rfq_log"
const JOB_COLL = "rfq_job_catalog"
const PART_COLL = "rfq_part_catalog"
const META_COLL = "rfq_catalog_meta"

async function db() { return (await clientPromise).db(DB) }
async function invites() {
  const col = (await db()).collection<RfqInvite>(INVITE_COLL)
  await col.createIndex({ token: 1 }, { unique: true }).catch(() => {})
  await col.createIndex({ vendor: 1, createdAt: -1 }).catch(() => {})
  await col.createIndex({ status: 1, deadline: 1 }).catch(() => {})
  return col
}

export function serialize(inv: WithId<RfqInvite> | RfqInvite): RfqInvite {
  const { _id, ...rest } = inv as WithId<RfqInvite>
  return { ...rest, _id: _id ? String(_id) : undefined }
}

// ── แคตตาล็อก ────────────────────────────────────────────────────────────────
export async function getCatalog(version?: number) {
  const d = await db()
  const meta = await d.collection(META_COLL).findOne<{ version: number }>({ _id: "latest" as never })
  const v = version ?? meta?.version ?? 0
  // ใบเก่าต้องเห็นงานชุดเดียวกับตอนสร้าง: แถวที่ "มีอยู่แล้ว" ตอนรุ่น v (firstVersion ≤ v) และ
  // "ยังไม่ถูกถอด" ก่อนรุ่น v (version = รุ่นล่าสุดที่แถวโผล่ ≥ v) · แถวเก่าก่อนมี firstVersion ถือว่ามีมาตั้งแต่แรก
  const filter = version
    ? { version: { $gte: v }, $or: [{ firstVersion: { $lte: v } }, { firstVersion: { $exists: false } }] }
    : { active: true }
  const [jobs, parts] = await Promise.all([
    d.collection<RfqJob>(JOB_COLL).find(filter, { projection: { _id: 0 } }).sort({ sheet: 1, seq: 1 }).toArray(),
    d.collection<RfqPart>(PART_COLL).find(filter, { projection: { _id: 0 } }).sort({ sheet: 1, seq: 1 }).toArray(),
  ])
  const order = (s: string) => SHEET_ORDER.indexOf(s)
  jobs.sort((a, b) => order(a.sheet) - order(b.sheet) || a.seq - b.seq)
  parts.sort((a, b) => order(a.sheet) - order(b.sheet) || a.seq - b.seq)
  return { version: v, jobs, parts }
}

export async function catalogSummary() {
  const { version, jobs, parts } = await getCatalog()
  const m = new Map<string, { sheet: string; title: string; jobs: number; parts: number }>()
  for (const j of jobs) { const x = m.get(j.sheet) ?? { sheet: j.sheet, title: j.sheetTitle, jobs: 0, parts: 0 }; x.jobs++; m.set(j.sheet, x) }
  for (const p of parts) { const x = m.get(p.sheet) ?? { sheet: p.sheet, title: p.sheetTitle, jobs: 0, parts: 0 }; x.parts++; m.set(p.sheet, x) }
  return {
    version,
    sheets: SHEET_ORDER.filter((s) => m.has(s)).map((s) => m.get(s)!),
    // รายชื่องานช่างย่อ ๆ ให้ modal เลือกข้อย่อยได้ (99 แถว เบา)
    jobs: jobs.map((j) => ({ sheet: j.sheet, seq: j.seq, jobCode: j.jobCode, name: j.name })),
  }
}

// ── log ──────────────────────────────────────────────────────────────────────
async function writeLog(entries: RfqLogEntry[]) {
  if (!entries.length) return
  try {
    const col = (await db()).collection<RfqLogEntry>(LOG_COLL)
    await col.createIndex({ inviteId: 1, at: -1 }).catch(() => {})
    await col.insertMany(entries, { ordered: false })
  } catch (e) { console.error("[rfq-log] write failed", e) }
}
export async function listLog(id: string): Promise<RfqLogEntry[]> {
  return (await db()).collection<RfqLogEntry>(LOG_COLL).find({ inviteId: id }, { projection: { _id: 0 } }).sort({ at: -1 }).limit(300).toArray()
}

// ── สร้าง / รายการ / อ่าน ────────────────────────────────────────────────────
export async function createInvites(
  input: { title: string; deadline: string; invites: { vendor: string; sheets: string[]; sections: RfqSection[]; jobCodes?: string[] }[] },
  by: { name: string; email: string }
): Promise<RfqInvite[]> {
  const col = await invites()
  const { version } = await getCatalog()
  const now = toBkkIso(new Date())
  const docs: RfqInvite[] = input.invites.map((i) => ({
    token: newToken(), vendor: i.vendor,
    sheets: SHEET_ORDER.filter((s) => i.sheets.includes(s) || s === SVC_SHEET),
    sections: i.sections.length ? i.sections : ["labour", "parts"],
    ...(i.jobCodes?.length ? { jobCodes: i.jobCodes } : {}),
    catalogVersion: version, title: input.title, deadline: input.deadline, status: "สร้างแล้ว",
    contact: null, openedAt: null, items: {}, parts: {}, submittedAt: null, submitNote: "",
    confirm: null, returnNote: "", createdBy: by, createdAt: now, updatedAt: now,
  }))
  const r = await col.insertMany(docs)
  const out = docs.map((d, i) => ({ ...d, _id: String(r.insertedIds[i]) }))
  await writeLog(out.map((d) => ({ inviteId: d._id!, action: "create" as const, to: "สร้างแล้ว", by: by.name, byEmail: by.email, at: new Date(), note: `${d.sheets.join(" ")} · ${d.sections.join("+")}${d.jobCodes?.length ? ` · เลือกข้อย่อย ${d.jobCodes.length} งาน` : ""}` })))
  return out
}

export async function listInvites(f: { status?: string; title?: string; q?: string }): Promise<(Omit<RfqInvite, "items" | "parts"> & { answered: { labour: number; parts: number }; total: { labour: number; parts: number }; effective: EffectiveStatus })[]> {
  const col = await invites()
  const filter: Document = {}
  if (f.title) filter.title = f.title
  if (f.q) { const rx = { $regex: f.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" }; filter.$or = [{ vendor: rx }, { title: rx }, { "contact.name": rx }] }
  const rows = await col.find(filter).sort({ createdAt: -1 }).limit(2000).toArray()
  const today = bkkToday()
  const cat = new Map<number, Awaited<ReturnType<typeof getCatalog>>>()
  const out = []
  for (const r of rows) {
    const eff = effectiveStatus(r, today)
    if (f.status && f.status !== eff) continue
    if (!cat.has(r.catalogVersion)) cat.set(r.catalogVersion, await getCatalog(r.catalogVersion))
    const c = cat.get(r.catalogVersion)!
    const pg = progress(r, c.jobs, c.parts)
    const { items: _i, parts: _p, ...rest } = serialize(r)
    void _i; void _p
    out.push({ ...rest, answered: { labour: pg.labour.done, parts: pg.parts.done }, total: { labour: pg.labour.total, parts: pg.parts.total }, effective: eff })
  }
  return out
}

export async function getInvite(id: string): Promise<RfqInvite | null> {
  if (!ObjectId.isValid(id)) return null
  const r = await (await invites()).findOne({ _id: new ObjectId(id) } as Document)
  return r ? serialize(r) : null
}
export async function getInviteByToken(token: string): Promise<RfqInvite | null> {
  if (!/^[A-Za-z0-9_-]{24}$/.test(token)) return null
  const r = await (await invites()).findOne({ token })
  return r ? serialize(r) : null
}

// ── ฝั่งอู่ ──────────────────────────────────────────────────────────────────
export async function markOpened(token: string) {
  const col = await invites()
  const r = await col.findOneAndUpdate({ token, openedAt: null }, { $set: { openedAt: toBkkIso(new Date()) } })
  if (r) await writeLog([{ inviteId: String(r._id), action: "open", by: "อู่ (ลิงก์)", byEmail: "", at: new Date() }])
}

export async function saveContact(token: string, c: Omit<RfqContact, "at">): Promise<RfqInvite> {
  const col = await invites()
  const before = await col.findOne({ token })
  if (!before) throw new Error("404:ไม่พบลิงก์")
  if (!canVendorWrite(before, bkkToday())) throw new Error("409:ลิงก์นี้ปิดรับแล้ว")
  const now = toBkkIso(new Date())
  const status = before.status === "สร้างแล้ว" ? "กำลังกรอก" : before.status
  await col.updateOne({ token }, { $set: { contact: { ...c, at: now }, status, updatedAt: now } })
  const log: RfqLogEntry[] = [{ inviteId: String(before._id), action: "contact", by: c.name, byEmail: c.email, at: new Date(), note: c.phone || c.email }]
  if (status !== before.status) log.push({ inviteId: String(before._id), action: "contact", from: before.status, to: status, by: c.name, byEmail: c.email, at: new Date() })
  await writeLog(log)
  return serialize({ ...before, contact: { ...c, at: now }, status, updatedAt: now })
}

export async function saveAnswers(token: string, items: Record<string, RfqAnswer>, parts: Record<string, RfqPartAnswer>) {
  const col = await invites()
  const before = await col.findOne({ token })
  if (!before) throw new Error("404:ไม่พบลิงก์")
  if (!canVendorWrite(before, bkkToday())) throw new Error("409:ลิงก์นี้ปิดรับแล้ว")
  if (!before.contact) throw new Error("409:กรุณากรอกข้อมูลผู้ติดต่อก่อน")
  const $set: Document = { updatedAt: toBkkIso(new Date()) }
  for (const [k, v] of Object.entries(items)) $set[`items.${k}`] = v
  for (const [k, v] of Object.entries(parts)) $set[`parts.${k}`] = v   // key มี "|" ใช้เป็นชื่อฟิลด์ได้ (ห้ามมี "." และ "$")
  await col.updateOne({ token }, { $set })
}

export async function saveProfile(token: string, p: Omit<RfqProfile, "at">): Promise<RfqProfile> {
  const col = await invites()
  const before = await col.findOne({ token })
  if (!before) throw new Error("404:ไม่พบลิงก์")
  if (!canVendorWrite(before, bkkToday())) throw new Error("409:ลิงก์นี้ปิดรับแล้ว")
  if (!before.contact) throw new Error("409:กรุณากรอกข้อมูลผู้ติดต่อก่อน")
  const now = toBkkIso(new Date())
  const profile: RfqProfile = { ...p, at: now }
  await col.updateOne({ token }, { $set: { profile, updatedAt: now } })
  return profile
}

/** ตอนอู่กดส่ง: คัดลอกข้อมูลอู่ (พิกัด + กำลังการซ่อม) ไปที่ทะเบียน AVL (vendor_approval)
 *  ไม่แตะ codes/สถานะที่จัดซื้อดูแล · ลง vendor_capability_log ด้วย */
async function copyProfileToVendor(inv: RfqInvite, by: string, byEmail: string): Promise<void> {
  const p = inv.profile
  if (!p) return
  try {
    const d = await db()
    const at = new Date()
    const $set: Document = { capacity: { ...p.capacity, by, at: at.toISOString() } }
    if (p.lat !== undefined && p.lng !== undefined) $set.location = { lat: p.lat, lng: p.lng, mapUrl: p.mapUrl, address: p.address, by, at: at.toISOString() }
    await d.collection("vendor_approval").updateOne(
      { vendor: inv.vendor },
      { $set, $setOnInsert: { vendor: inv.vendor, status: "pending", codes: [] } },
      { upsert: true }
    )
    const c = p.capacity
    const note = `ช่องซ่อม ${c.bays} (หนัก ${c.heavy} / กลาง ${c.mid} / เบา ${c.light})${p.lat !== undefined ? ` · พิกัด ${p.lat},${p.lng}` : ""}${p.address ? ` · ${p.address}` : ""}`
    const log: VendorLogEntry = { vendor: inv.vendor, action: "profile", to: note, by, byEmail, at }
    await d.collection<VendorLogEntry>(VENDOR_LOG_COLL).insertOne(log)
  } catch (e) { console.error("[rfq] copyProfileToVendor", e) }
}

export async function submitInvite(token: string, submitNote: string): Promise<RfqInvite> {
  const col = await invites()
  const before = await col.findOne({ token })
  if (!before) throw new Error("404:ไม่พบลิงก์")
  if (!canVendorWrite(before, bkkToday())) throw new Error("409:ลิงก์นี้ปิดรับแล้ว")
  if (!before.contact || !canTransition(before.status, "submit")) throw new Error("409:ยังส่งไม่ได้ในสถานะนี้")
  const now = toBkkIso(new Date())
  await col.updateOne({ token }, { $set: { status: "ส่งแล้ว", submittedAt: now, submitNote: submitNote.slice(0, 500), updatedAt: now } })
  await writeLog([{ inviteId: String(before._id), action: "submit", from: before.status, to: "ส่งแล้ว", by: before.contact.name, byEmail: before.contact.email, note: submitNote.slice(0, 500), at: new Date() }])
  await copyProfileToVendor(serialize(before), `${before.contact.name} (อู่ ผ่านลิงก์)`, before.contact.email)
  return serialize({ ...before, status: "ส่งแล้ว", submittedAt: now, submitNote, updatedAt: now })
}

// ── ฝั่งจัดซื้อ ───────────────────────────────────────────────────────────────
export async function actOnInvite(
  id: string, action: "confirm" | "return" | "cancel" | "extend",
  payload: { validFrom?: string; validTo?: string; note?: string; deadline?: string },
  by: { name: string; email: string }
): Promise<RfqInvite> {
  const col = await invites()
  if (!ObjectId.isValid(id)) throw new Error("404:ไม่พบใบ")
  const before = await col.findOne({ _id: new ObjectId(id) } as Document)
  if (!before) throw new Error("404:ไม่พบใบ")
  if (!canTransition(before.status, action)) throw new Error(`409:ทำ "${action}" จากสถานะ ${before.status} ไม่ได้`)
  const now = toBkkIso(new Date())
  const $set: Document = { updatedAt: now }
  let to = before.status
  const note = (payload.note ?? "").trim().slice(0, 500)
  if (action === "confirm") {
    if (!payload.validFrom || !payload.validTo || payload.validTo < payload.validFrom) throw new Error("400:ช่วงวันที่ราคามีผลไม่ถูกต้อง")
    to = "ยืนยันแล้ว"; $set.status = to
    $set.confirm = { by: by.name, email: by.email, at: now, validFrom: payload.validFrom, validTo: payload.validTo, note }
  } else if (action === "return") {
    if (!note) throw new Error("400:กรุณาระบุเหตุผลที่ส่งกลับ")
    to = "ส่งกลับแก้"; $set.status = to; $set.returnNote = note; $set.submittedAt = null
  } else if (action === "cancel") {
    to = "ยกเลิก"; $set.status = to
  } else {
    if (!payload.deadline || !/^\d{4}-\d{2}-\d{2}$/.test(payload.deadline)) throw new Error("400:วันปิดรับไม่ถูกต้อง")
    $set.deadline = payload.deadline
  }
  await col.updateOne({ _id: before._id }, { $set })
  await writeLog([{ inviteId: String(before._id), action, from: before.status, to, by: by.name, byEmail: by.email, note: action === "extend" ? `ปิดรับ ${before.deadline} → ${payload.deadline}` : note || undefined, at: new Date() }])
  return serialize({ ...before, ...$set } as WithId<RfqInvite>)
}

/** "409:ข้อความ" → { status: 409, error: "ข้อความ" } · อย่างอื่น = 500 */
export function httpError(e: unknown): { status: number; error: string } {
  const m = /^(\d{3}):(.*)$/.exec(e instanceof Error ? e.message : String(e))
  return m ? { status: +m[1], error: m[2] } : { status: 500, error: "บันทึกไม่สำเร็จ" }
}
