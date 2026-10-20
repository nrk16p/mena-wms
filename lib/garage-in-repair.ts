// lib/garage-in-repair.ts
// รถที่ยังซ่อมไม่เสร็จในใบซ่อมนอกของ WMS แยกตามอู่ — ให้หน้าหาอู่โชว์ว่าตอนนี้รถเราอยู่อู่ไหนบ้าง (ผู้ใช้ขอ 20/10/2569)
// อ่านอย่างเดียว · repair_external มีไม่ถึง 500 ใบ ดึงเฉพาะใบอู่นอกที่ยังไม่ปิดก็ไม่กี่สิบใบ
import clientPromise from "@/lib/mongo"
import { getGarages } from "@/lib/garage-map"
import { garageKey } from "@/lib/atms-garage"
import { DONE_STATUSES, JOB_TYPE_PARTS, jobStartDate, normalizeStatus, sameGarage } from "@/lib/repair-external"

const DB = process.env.MONGO_DB ?? "master_data"
const REPAIR_NOPR_DONE = "รถเสร็จ(ไม่มี PR)"

export type InRepairCar = {
  plate: string
  fleetNo: string
  plant: string
  status: string
  symptom: string
  /** วันที่เริ่มนับ (รับแจ้งหรือรถเข้าอู่ อันที่เร็วกว่า) YYYY-MM-DD */
  since: string
  days: number | null
  /** ชื่อตามที่คีย์ในใบซ่อม */
  garage: string
  /** ชื่ออู่ในหน้าหาอู่ที่จับคู่ได้ — null = ไม่เจอในรายการอู่ หรือยังไม่ได้ระบุอู่ */
  matched: string | null
}

const compactKeys = (n: string) =>
  [n.replace(/\([^)]*\)/g, ""), n.match(/\(([^)]+)\)/)?.[1] ?? ""]
    .map((x) => x.replace(/[\s.()]/g, "").replace(/^อู่/, "").toLowerCase())
    .filter((x) => x.length >= 3)

const daysSince = (ymd: string) => {
  if (!/^\d{4}-\d{2}-\d{2}/.test(ymd)) return null
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
  return Math.max(0, Math.round((Date.parse(today) - Date.parse(ymd.slice(0, 10))) / 86400_000))
}

export async function getCarsInRepair(): Promise<InRepairCar[]> {
  const [garages, docs] = await Promise.all([
    getGarages(),
    (await clientPromise).db(DB).collection("repair_external")
      // "รถเสร็จ(ไม่มี PR)" = ซ่อมเสร็จแล้ว ค้างแค่เอกสาร รถออกจากอู่แล้ว ไม่นับ
      .find({ jobType: { $ne: JOB_TYPE_PARTS }, status: { $nin: [...DONE_STATUSES, REPAIR_NOPR_DONE] } },
        { projection: { _id: 0, plate: 1, fleetNo: 1, plant: 1, status: 1, symptom: 1, receivedDate: 1, garageInDate: 1, garage: 1 } })
      .toArray(),
  ])
  const byKey = new Map(garages.map((g) => [garageKey(g.name), g.name]))
  const matchName = (name: string) => {
    if (!name.trim()) return null
    // ชื่อตรงกันก่อน · ไม่ตรงค่อยเทียบชื่อย่อ (สะกดต่าง/ชื่อนิติบุคคล) และเอาเฉพาะที่เจอแค่อู่เดียว กันจับมั่ว
    const exact = byKey.get(garageKey(name))
    if (exact) return exact
    const near = garages.filter((g) => sameGarage(g.name, name))
    if (near.length === 1) return near[0].name
    // ชื่อสั้นที่ sameGarage ไม่จับ (ตัดคำแล้วเหลือไม่ถึง 3 ตัว) เช่น "นายณรงค์ (อู่ จ.การช่าง)" ↔ "จ.การช่าง"
    // ต้องเหมือนกันทั้งชื่อหลังตัดช่องว่าง/จุด/คำว่าอู่ และเจอแค่อู่เดียว
    const keys = compactKeys(name)
    const same = garages.filter((g) => compactKeys(g.name).some((k) => keys.includes(k)))
    return same.length === 1 ? same[0].name : null
  }
  return docs.map((d) => {
    const since = jobStartDate(d as { receivedDate?: string; garageInDate?: string })
    const garage = String(d.garage ?? "").trim()
    return {
      plate: String(d.plate ?? ""), fleetNo: String(d.fleetNo ?? ""), plant: String(d.plant ?? ""),
      status: normalizeStatus(String(d.status ?? "")), symptom: String(d.symptom ?? ""),
      since, days: daysSince(since), garage, matched: matchName(garage),
    }
  }).sort((a, b) => (b.days ?? -1) - (a.days ?? -1))
}
