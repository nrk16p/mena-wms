// lib/atms-garage.ts
// ชื่ออู่ "ชุดเดียว" ของ WMS = ซัพพลายเออร์ใน ATMS (atms.supplier_master, sync ทุกคืน)
// Mena-Next ก็ดึงชื่ออู่จาก ATMS ชุดเดียวกัน (vendor_name ตรง supplier_master.name 59/59 เมื่อ 07/10/2569)
// → ใบงานเก็บ garage = ชื่อตาม ATMS + garageAtmsId ไว้ผูกถาวร (ATMS เปลี่ยนชื่อ → ไล่ปรับตาม id ได้)
import clientPromise from "@/lib/mongo"

export type AtmsGarage = { atmsId: number; name: string; type: string; branch: string }

const ATMS_DB  = "atms"
const SUP_COLL = "supplier_master"
const TTL_MS   = 60 * 60 * 1000   // ต้นทางขยับวันละครั้ง (sync ตอนดึก) — cache 1 ชม. พอ

let cache: { at: number; items: AtmsGarage[] } | null = null

/** ช่องว่างซ้อน/ขึ้นบรรทัดใน ATMS มีจริง (เช่น "นาย ขะหนำ  รัตนวงค์") — เทียบชื่อด้วยตัวนี้เสมอ */
export const garageKey = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase()

/** รายชื่อซัพพลายเออร์ทั้งหมดใน ATMS — ประเภท "อู่" ขึ้นก่อน แล้วเรียงชื่อ */
export async function getAtmsGarages(): Promise<AtmsGarage[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.items
  const client = await clientPromise
  const docs = await client.db(ATMS_DB).collection(SUP_COLL)
    .find({}, { projection: { _id: 0, atmsId: 1, name: 1, type: 1, branch: 1 } })
    .toArray()
  const items = docs
    .map((d) => ({
      atmsId: Number(d.atmsId) || 0,
      name:   String(d.name ?? "").replace(/\s+/g, " ").trim(),
      type:   String(d.type ?? ""),
      branch: String(d.branch ?? ""),
    }))
    .filter((g) => g.atmsId && g.name)
    .sort((a, b) => (a.type === "อู่" ? 0 : 1) - (b.type === "อู่" ? 0 : 1) || a.name.localeCompare(b.name, "th"))
  cache = { at: Date.now(), items }
  return items
}

/** หาอู่ใน ATMS จากชื่อ (ตรงตัวหลังตัดช่องว่างซ้อน) — ไม่เดา ไม่จับชื่อคล้าย */
export async function findAtmsGarage(name: string): Promise<AtmsGarage | null> {
  const k = garageKey(name)
  if (!k) return null
  return (await getAtmsGarages()).find((g) => garageKey(g.name) === k) ?? null
}

/**
 * เติม garageAtmsId ให้ doc ก่อนบันทึก (ทุกทางเขียน: หน้าเว็บ / sync API / แผนซ่อม)
 * - ชื่อตรง ATMS → garage = ชื่อตาม ATMS (สะกด/ช่องว่างตามต้นทาง) + garageAtmsId
 * - ไม่ตรง (ชื่อเดิมที่ยังไม่จับคู่ หรือ Mena-Next ส่งชื่ออื่นมา) → เก็บชื่อตามที่ส่งมา + garageAtmsId = null
 *   (รับไว้ก่อน ไม่ตีกลับ — หน้าเว็บขึ้นป้าย "ยังไม่ผูก ATMS")
 * ATMS ล่ม/อ่านไม่ได้ → ไม่บล็อกการบันทึก แค่ไม่เติม id (คงค่าเดิมถ้ามี)
 */
export async function attachGarageId<T extends { garage: string }>(doc: T, existing?: Record<string, unknown> | null): Promise<T & { garageAtmsId: number | null }> {
  if (!doc.garage) return { ...doc, garageAtmsId: null }
  try {
    const g = await findAtmsGarage(doc.garage)
    return g ? { ...doc, garage: g.name, garageAtmsId: g.atmsId } : { ...doc, garageAtmsId: null }
  } catch (e) {
    console.error("[atms-garage] lookup failed", e)
    const keep = existing && garageKey(existing.garage) === garageKey(doc.garage) ? (Number(existing.garageAtmsId) || null) : null
    return { ...doc, garageAtmsId: keep }
  }
}
