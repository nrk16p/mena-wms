import type { MongoClient } from "mongodb"
import { sharedCache } from "@/lib/shared-cache"

// ── แพล้นท์ล่าสุดรายคัน จาก atms.vehicle_daily_asia ───────────────────────────────
// ETL ลงวันละรอบ แยกเดือนด้วย t_date ("01/11/2026") — 1 แถว/คัน/วัน (วันที่ "11/11/2026")
// ใช้เฉพาะเดือนล่าสุด แล้วเอาวันล่าสุดของแต่ละคัน = แพล้นท์ที่รถวิ่งอยู่ตอนนี้
// vehicle_master.plant / truck_master_monthly เป็นค่าตอนลงทะเบียน ย้ายแพล้นท์แล้วไม่ตาม (พะเยา ↔ บ่อวิน)
// คันที่ไม่อยู่ในเดือนล่าสุด (รถนอกกลุ่ม asia / หาง) ไม่มีในแผนที่ → ผู้เรียกใช้ค่าเดิมของตัวเอง
export type LatestPlant = { plant: string; fleet: string; date: string }

export async function loadLatestPlants(client: MongoClient): Promise<Map<string, LatestPlant>> {
  const rows = await sharedCache.get({
    key: "vehicle-daily-asia-plants",
    freshMs: 30 * 60_000,
    maxStaleMs: 6 * 60 * 60_000,
    load: async () => {
      const col  = client.db("atms").collection("vehicle_daily_asia")
      const last = await col.find({}, { projection: { t_date: 1 } }).sort({ etl_run_at: -1 }).limit(1).next()
      if (!last?.t_date) return [] as string[][]
      // วันที่ในเดือนเดียวกันเป็น dd/MM/yyyy → เรียงสตริงได้ตรงวัน
      const latest = await col.aggregate<{ _id: string; plant: string; fleet: string; d: string }>([
        { $match: { t_date: last.t_date } },
        { $sort: { "วันที่": -1 } },
        { $group: { _id: "$ทะเบียน", plant: { $first: "$แพล้นท์" }, fleet: { $first: "$ฟลีท" }, d: { $first: "$วันที่" } } },
      ]).toArray()
      return latest
        .filter((r) => r._id && String(r.plant ?? "").trim())
        .map((r) => [String(r._id).trim(), String(r.plant).trim(), String(r.fleet ?? "").trim(), String(r.d ?? "")])
    },
  })
  return new Map(rows.map(([plate, plant, fleet, date]) => [plate, { plant, fleet, date }]))
}

// โหลดไม่ได้ (ATMS ล่ม) ก็ไม่ควรทำให้หน้าพัง — คืนแผนที่ว่าง ให้ใช้ค่าเดิมไปก่อน
export const loadLatestPlantsSafe = (client: MongoClient) =>
  loadLatestPlants(client).catch((e) => {
    console.error("[vehicle-plant] vehicle_daily_asia failed", e)
    return new Map<string, LatestPlant>()
  })
