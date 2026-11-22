// lib/vendor-onboarding/db.ts — คอลเลกชัน + index + seed ค่าเริ่มต้น (ครั้งเดียวตอนว่าง) + เลขที่ใบ
import type { Collection, Db, ObjectId } from "mongodb"
import clientPromise from "../mongo"
import { onceUntilOk } from "../once"
import { DEFAULT_CRITERIA, DEFAULT_DOC_SLOTS, DEFAULT_SETTINGS } from "./defaults"
import {
  VO_COLL, VO_COUNTER_COLL, VO_CRITERIA_COLL, VO_DB, VO_DOC_SLOT_COLL, VO_LINK_COLL, VO_SETTINGS_COLL,
  type Criterion, type DocSlot,
} from "./types"
import type { OnboardingSettings } from "./validate"

export type CriterionRow = Criterion & { _id: string }
export type DocSlotRow = DocSlot & { _id: string }
export type SettingsRow = OnboardingSettings & { _id: string; updatedAt?: string; updatedBy?: { name: string; email: string } }
export type CounterRow = { _id: string; seq: number }
export type LinkRow = {
  _id?: ObjectId
  token: string
  appId: ObjectId
  ref: string
  requested: { slot: string; label: string; note: string }[]
  createdAt: string
  createdBy: { name: string; email: string }
  expiresAt: string
  usedAt: string | null
  revokedAt: string | null
}

export async function voDb(): Promise<Db> {
  return (await clientPromise).db(VO_DB)
}

/** ใบสมัคร (เอกสารเก่า + schemaVersion 2 อยู่คอลเลกชันเดียวกัน — จึงใช้ type หลวม ๆ แล้วแปลงตอนอ่าน) */
export async function appCol(): Promise<Collection> {
  const db = await voDb()
  await ensureIndexes(db)
  return db.collection(VO_COLL)
}
export async function linkCol(): Promise<Collection<LinkRow>> {
  const db = await voDb()
  await ensureIndexes(db)
  return db.collection<LinkRow>(VO_LINK_COLL)
}
export const criteriaCol = async () => (await voDb()).collection<CriterionRow>(VO_CRITERIA_COLL)
export const docSlotCol = async () => (await voDb()).collection<DocSlotRow>(VO_DOC_SLOT_COLL)
export const settingsCol = async () => (await voDb()).collection<SettingsRow>(VO_SETTINGS_COLL)
export const counterCol = async () => (await voDb()).collection<CounterRow>(VO_COUNTER_COLL)

const ensureIndexes = onceUntilOk(async (db: Db) => {
  const app = db.collection(VO_COLL)
  const link = db.collection(VO_LINK_COLL)
  await Promise.all([
    // index เดิมของ /form-vendor (createIndex ซ้ำได้ ไม่มีผล)
    app.createIndex({ taxId: 1 }),
    app.createIndex({ status: 1, createdAt: -1 }),
    // ใบแบบใหม่
    app.createIndex({ ref: 1 }, { unique: true, partialFilterExpression: { schemaVersion: 2 }, name: "vo_ref_unique" }),
    app.createIndex({ "profile.taxId": 1, status: 1 }, { partialFilterExpression: { schemaVersion: 2 }, name: "vo_taxid_status" }),
    link.createIndex({ token: 1 }, { unique: true }),
    link.createIndex({ appId: 1, createdAt: -1 }),
  ])
})

// ── seed ค่าเริ่มต้น — ใส่เฉพาะตอนคอลเลกชันว่าง ไม่ทับของเดิมเด็ดขาด ──────────────
export type SeedPlan = { criteria: number; docSlots: number; settings: boolean }

/** นับว่าต้อง seed อะไรบ้าง (อ่านอย่างเดียว) */
export async function seedPlan(db: Db): Promise<SeedPlan> {
  const [c, d, s] = await Promise.all([
    db.collection(VO_CRITERIA_COLL).estimatedDocumentCount(),
    db.collection(VO_DOC_SLOT_COLL).estimatedDocumentCount(),
    db.collection(VO_SETTINGS_COLL).countDocuments({ _id: "default" } as never, { limit: 1 }),
  ])
  return { criteria: c === 0 ? DEFAULT_CRITERIA.length : 0, docSlots: d === 0 ? DEFAULT_DOC_SLOTS.length : 0, settings: s === 0 }
}

const isDupKey = (e: unknown) => {
  const x = e as { code?: number; writeErrors?: { code?: number }[] }
  return x?.code === 11000 || (Array.isArray(x?.writeErrors) && x.writeErrors.every((w) => w.code === 11000))
}

/** seed จริง — _id = key ทำให้รันพร้อมกันหลาย instance ก็ไม่ซ้ำ (ชน _id = ข้าม) */
export async function applySeed(db: Db): Promise<SeedPlan> {
  const plan = await seedPlan(db)
  if (plan.criteria) {
    await db.collection<CriterionRow>(VO_CRITERIA_COLL)
      .insertMany(DEFAULT_CRITERIA.map((c) => ({ _id: c.key, ...c })), { ordered: false })
      .catch((e) => { if (!isDupKey(e)) throw e })
  }
  if (plan.docSlots) {
    await db.collection<DocSlotRow>(VO_DOC_SLOT_COLL)
      .insertMany(DEFAULT_DOC_SLOTS.map((s) => ({ _id: s.key, ...s })), { ordered: false })
      .catch((e) => { if (!isDupKey(e)) throw e })
  }
  if (plan.settings) {
    const { _id, ...rest } = DEFAULT_SETTINGS
    await db.collection<SettingsRow>(VO_SETTINGS_COLL)
      .updateOne({ _id }, { $setOnInsert: { ...rest } }, { upsert: true })
      .catch((e) => { if (!isDupKey(e)) throw e })
  }
  return plan
}

export const ensureSeeded = onceUntilOk(async () => { await applySeed(await voDb()) })

const byCatOrder = (a: Criterion, b: Criterion) => a.category - b.category || a.order - b.order || a.key.localeCompare(b.key)

/** เกณฑ์ที่ใช้งาน เรียงตามหมวด/ลำดับ (ไม่มี _id) */
export async function activeCriteria(): Promise<Criterion[]> {
  await ensureSeeded()
  const rows = await (await criteriaCol()).find({ active: true }, { projection: { _id: 0 } }).toArray()
  return (rows as Criterion[]).sort(byCatOrder)
}

/** ช่องเอกสารที่ใช้งาน เรียงตามลำดับ (ไม่มี _id) */
export async function activeDocSlots(): Promise<DocSlot[]> {
  await ensureSeeded()
  const rows = await (await docSlotCol()).find({ active: true }, { projection: { _id: 0 } }).toArray()
  return (rows as DocSlot[]).sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))
}

export async function getSettings(): Promise<OnboardingSettings> {
  await ensureSeeded()
  const s = await (await settingsCol()).findOne({ _id: "default" })
  const lower = (a: unknown) => (Array.isArray(a) ? a.map((x) => String(x).trim().toLowerCase()).filter(Boolean) : [])
  return {
    passThreshold: Number.isInteger(s?.passThreshold) ? Number(s!.passThreshold) : DEFAULT_SETTINGS.passThreshold,
    reviewerEmails: s ? lower(s.reviewerEmails) : [...DEFAULT_SETTINGS.reviewerEmails],
    approverEmails: s ? lower(s.approverEmails) : [...DEFAULT_SETTINGS.approverEmails],
    linkDays: Number.isInteger(s?.linkDays) ? Number(s!.linkDays) : DEFAULT_SETTINGS.linkDays,
  }
}

export async function saveSettings(s: OnboardingSettings, by: { name: string; email: string }): Promise<void> {
  await (await settingsCol()).updateOne(
    { _id: "default" },
    { $set: { ...s, updatedAt: new Date().toISOString(), updatedBy: by } },
    { upsert: true },
  )
}

/** VEN{YYMM}-{0001} — ปี/เดือนตามเวลาไทย · นับต่อเดือนด้วย $inc แบบ atomic */
export async function nextRef(now = new Date()): Promise<string> {
  const bkk = new Date(now.getTime() + 7 * 3600_000)
  const yymm = `${String(bkk.getUTCFullYear() % 100).padStart(2, "0")}${String(bkk.getUTCMonth() + 1).padStart(2, "0")}`
  const id = `VEN${yymm}`
  const col = await counterCol()
  const bump = () => col.findOneAndUpdate({ _id: id }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" })
  // เดือนใหม่: สองคำขอ upsert พร้อมกัน ตัวหนึ่งจะชน E11000 → ลองซ้ำครั้งเดียว (ตอนนั้นเอกสารมีแล้ว)
  const r = await bump().catch((e) => { if (isDupKey(e)) return bump(); throw e })
  if (!r) throw new Error("ออกเลขที่ใบไม่สำเร็จ")
  const seq = r.seq
  return `${id}-${String(seq).padStart(4, "0")}`
}
