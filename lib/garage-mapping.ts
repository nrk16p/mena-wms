// lib/garage-mapping.ts
// จับคู่ "ชื่ออู่ที่ตั้งเอง" (ใบงานเก่าก่อน 07/10/2569) → ซัพพลายเออร์ใน ATMS
// คนยืนยันทีละชื่อที่หน้า /garages — ไม่มีการเขียนทับใบงานก่อนกดยืนยัน · ทุกการจับคู่ย้อนกลับได้
// ผลจับคู่ทั้งชื่อเก็บใน garage_name_map → ใช้ต่อเป็น alias ให้ attachGarageId (ถ้ามีคนส่งชื่อเดิมมาอีก)
import type { Db } from "mongodb"
import { ObjectId } from "mongodb"
import { getAtmsGarages, garageKey, type AtmsGarage } from "@/lib/atms-garage"
import { likelySameGarage, sameGarage } from "@/lib/repair-external"
import { REPAIR_LOG_COLL } from "@/lib/repair-log"

export const NAME_MAP_COLL = "garage_name_map"
const COLLS = { repair: "repair_external", plan: "repair_plans" } as const
type CollKey = keyof typeof COLLS

/** ใบงานที่ยังไม่ผูก ATMS (มีชื่ออู่ แต่ไม่มี garageAtmsId) */
const UNLINKED = { garage: { $nin: ["", null] }, $or: [{ garageAtmsId: null }, { garageAtmsId: { $exists: false } }] }

export type MapRecord = {
  coll: CollKey; id: string; plate: string; fleetNo: string; mrNo: string; status: string; date: string
}
export type MapSuggestion = { atmsId: number; name: string; type: string; why: "exact" | "alias" | "next" | "similar"; votes?: number }
export type MapRow = {
  name: string
  count: number
  open: number
  records: MapRecord[]
  suggestions: MapSuggestion[]
}

/** แถวละ 1 ชื่อเดิม + คู่ที่ระบบเดา (เรียงความน่าเชื่อ: ตรงตัว > เคยยืนยัน > Mena-Next ของคันเดียวกัน > ชื่อคล้าย) */
export async function buildMappingRows(db: Db, nextVendorByMr: Map<string, string>): Promise<MapRow[]> {
  const [atms, maps, ...lists] = await Promise.all([
    getAtmsGarages(),
    db.collection(NAME_MAP_COLL).find({ undoneAt: null, scope: "name" }).toArray(),
    ...(Object.keys(COLLS) as CollKey[]).map((k) =>
      db.collection(COLLS[k]).find(UNLINKED, {
        projection: { garage: 1, plate: 1, fleetNo: 1, mrNo: 1, status: 1, planStatus: 1, receivedDate: 1, plannedInDate: 1 },
      }).toArray().then((docs) => docs.map((d) => ({ k, d })))),
  ])
  const byId = new Map(atms.map((g) => [g.atmsId, g]))
  const byKey = new Map(atms.map((g) => [garageKey(g.name), g]))
  const aliasOf = new Map(maps.map((m) => [garageKey(m.name), Number(m.atmsId)]))

  const groups = new Map<string, MapRow>()
  for (const { k, d } of lists.flat()) {
    const name = String(d.garage ?? "").trim()
    const key = garageKey(name)
    let row = groups.get(key)
    if (!row) { row = { name, count: 0, open: 0, records: [], suggestions: [] }; groups.set(key, row) }
    const status = String(d.status ?? d.planStatus ?? "")
    row.count++
    if (!/เสร็จ|ยกเลิก/.test(status)) row.open++
    row.records.push({
      coll: k, id: String(d._id), plate: String(d.plate ?? ""), fleetNo: String(d.fleetNo ?? ""),
      mrNo: String(d.mrNo ?? ""), status, date: String(d.receivedDate ?? d.plannedInDate ?? ""),
    })
  }

  const normMr = (s: string) => s.replace(/[\s.]/g, "").toUpperCase()
  for (const [key, row] of groups) {
    const out: MapSuggestion[] = []
    const add = (g: AtmsGarage | undefined, why: MapSuggestion["why"], votes?: number) => {
      if (g && !out.some((s) => s.atmsId === g.atmsId)) out.push({ atmsId: g.atmsId, name: g.name, type: g.type, why, ...(votes ? { votes } : {}) })
    }
    add(byKey.get(key), "exact")
    const a = aliasOf.get(key)
    if (a) add(byId.get(a), "alias")
    // Mena-Next ของงานเดียวกัน — จับด้วย MR เท่านั้น (ทะเบียนเดียวกันอาจเป็นรอบซ่อมใหม่คนละอู่กับใบเก่า)
    const votes = new Map<string, number>()
    for (const r of row.records) {
      const v = r.mrNo ? nextVendorByMr.get(normMr(r.mrNo)) : undefined
      if (v) votes.set(v, (votes.get(v) ?? 0) + 1)
    }
    for (const [v, n] of [...votes].sort((x, y) => y[1] - x[1])) add(byKey.get(garageKey(v)), "next", n)
    // ชื่อคล้าย: แบบเข้มก่อน แล้วค่อยแบบหลวม · ประเภท "อู่" ขึ้นก่อน (getAtmsGarages เรียงไว้แล้ว)
    const strict = atms.filter((g) => sameGarage(row.name, g.name))
    const loose = atms.filter((g) => !strict.includes(g) && likelySameGarage(row.name, g.name))
    for (const g of [...strict, ...loose].slice(0, 6)) add(g, "similar")
    row.suggestions = out.slice(0, 6)
    row.records.sort((x, y) => y.date.localeCompare(x.date))
  }
  return [...groups.values()].sort((x, y) => y.open - x.open || y.count - x.count || x.name.localeCompare(y.name, "th"))
}

type Target = { coll: CollKey; id: string }

/**
 * ยืนยันจับคู่: ตั้ง garage = ชื่อ ATMS + garageAtmsId ให้ใบงานที่ยังไม่ผูก
 * - ไม่ส่ง targets = ทุกใบที่ใช้ชื่อนี้ (scope "name" → เก็บเป็น alias ด้วย)
 * - ส่ง targets = เฉพาะใบที่เลือก (เช่นชื่อรวมสองอู่) — ไม่เก็บ alias
 */
export async function applyMapping(db: Db, p: { name: string; atmsId: number; targets?: Target[]; by: string; byEmail: string }) {
  const g = (await getAtmsGarages()).find((x) => x.atmsId === p.atmsId)
  if (!g) throw new Error("ไม่พบอู่นี้ใน ATMS")
  const key = garageKey(p.name)
  const now = new Date()
  const touched: (Target & { plate: string; fleetNo: string; from: string })[] = []
  for (const k of Object.keys(COLLS) as CollKey[]) {
    const ids = p.targets?.filter((t) => t.coll === k).map((t) => t.id).filter((x) => ObjectId.isValid(x))
    if (p.targets && !ids?.length) continue
    const docs = await db.collection(COLLS[k]).find({
      ...UNLINKED,
      ...(ids ? { _id: { $in: ids.map((x) => new ObjectId(x)) } } : {}),
    }, { projection: { garage: 1, plate: 1, fleetNo: 1 } }).toArray()
    // ชื่อเทียบหลังตัดช่องว่างซ้อน (Mongo เทียบตรงตัว จึงกรองใน JS)
    const hit = docs.filter((d) => garageKey(d.garage) === key)
    if (!hit.length) continue
    await db.collection(COLLS[k]).updateMany(
      { _id: { $in: hit.map((d) => d._id) } },
      { $set: { garage: g.name, garageAtmsId: g.atmsId, editedBy: p.by, updatedAt: now } },
    )
    for (const d of hit) touched.push({ coll: k, id: String(d._id), plate: String(d.plate ?? ""), fleetNo: String(d.fleetNo ?? ""), from: String(d.garage ?? "") })
  }
  if (!touched.length) throw new Error("ไม่มีใบงานที่ยังใช้ชื่อนี้แล้ว (อาจมีคนจับคู่ไปก่อน) — รีเฟรชหน้า")

  const logs = touched.filter((t) => t.coll === "repair").map((t) => ({
    repairId: t.id, plate: t.plate, fleetNo: t.fleetNo, action: "update" as const,
    by: p.by, byEmail: p.byEmail, at: now,
    changes: [{ field: "garage", label: "อู่ (จับคู่กับ ATMS)", from: t.from, to: g.name }],
  }))
  if (logs.length) await db.collection(REPAIR_LOG_COLL).insertMany(logs)

  const scope = p.targets ? "records" : "name"
  const ins = await db.collection(NAME_MAP_COLL).insertOne({
    name: p.name, key, atmsId: g.atmsId, atmsName: g.name, scope,
    targets: touched.map(({ coll, id, from }) => ({ coll, id, from })),
    by: p.by, byEmail: p.byEmail, at: now, undoneAt: null,
  })
  return { mapId: String(ins.insertedId), updated: touched.length, atmsName: g.name }
}

/** ย้อนการจับคู่ — คืนชื่อเดิมเฉพาะใบที่ยังเป็นค่าจากการจับคู่นี้อยู่ (ใบที่มีคนแก้ต่อแล้วไม่แตะ) */
export async function undoMapping(db: Db, p: { mapId: string; by: string; byEmail: string }) {
  if (!ObjectId.isValid(p.mapId)) throw new Error("Invalid id")
  const m = await db.collection(NAME_MAP_COLL).findOne({ _id: new ObjectId(p.mapId), undoneAt: null })
  if (!m) throw new Error("ไม่พบการจับคู่นี้ หรือย้อนไปแล้ว")
  const now = new Date()
  let reverted = 0
  const logs = []
  for (const t of (m.targets ?? []) as (Target & { from: string })[]) {
    const r = await db.collection(COLLS[t.coll]).findOneAndUpdate(
      { _id: new ObjectId(t.id), garageAtmsId: m.atmsId, garage: m.atmsName },
      { $set: { garage: t.from, garageAtmsId: null, editedBy: p.by, updatedAt: now } },
      { projection: { plate: 1, fleetNo: 1 } },
    )
    if (!r) continue
    reverted++
    if (t.coll === "repair") logs.push({
      repairId: t.id, plate: String(r.plate ?? ""), fleetNo: String(r.fleetNo ?? ""), action: "update" as const,
      by: p.by, byEmail: p.byEmail, at: now,
      changes: [{ field: "garage", label: "อู่ (ย้อนการจับคู่ ATMS)", from: String(m.atmsName), to: t.from }],
    })
  }
  if (logs.length) await db.collection(REPAIR_LOG_COLL).insertMany(logs)
  await db.collection(NAME_MAP_COLL).updateOne({ _id: m._id }, { $set: { undoneAt: now, undoneBy: p.by, reverted } })
  return { reverted }
}

/** ประวัติการจับคู่ล่าสุด (สำหรับปุ่มย้อนกลับ) */
export async function recentMappings(db: Db, limit = 30) {
  return (await db.collection(NAME_MAP_COLL).find({}).sort({ at: -1 }).limit(limit).toArray()).map((m) => ({
    id: String(m._id), name: String(m.name), atmsName: String(m.atmsName), scope: String(m.scope),
    count: (m.targets ?? []).length, by: String(m.by ?? ""), at: m.at, undoneAt: m.undoneAt ?? null,
  }))
}

/**
 * ATMS เปลี่ยนชื่อซัพพลายเออร์ → ไล่ปรับชื่อในใบงานตาม garageAtmsId (เรียกจาก cron รายวัน)
 * ไม่ลง log รายใบ — ไม่ใช่การแก้ของคน แค่ชื่อต้นทางเปลี่ยน
 */
export async function followAtmsRenames(db: Db): Promise<number> {
  const byId = new Map((await getAtmsGarages()).map((g) => [g.atmsId, g.name]))
  let n = 0
  for (const coll of Object.values(COLLS)) {
    const pairs = await db.collection(coll).aggregate<{ _id: { id: number; name: string } }>([
      { $match: { garageAtmsId: { $type: "number" } } },
      { $group: { _id: { id: "$garageAtmsId", name: "$garage" } } },
    ]).toArray()
    for (const { _id } of pairs) {
      const now = byId.get(_id.id)
      if (now && now !== _id.name) {
        const r = await db.collection(coll).updateMany({ garageAtmsId: _id.id, garage: _id.name }, { $set: { garage: now } })
        n += r.modifiedCount
      }
    }
  }
  return n
}
