// ความสดของข้อมูลยาง — หน้า "รถทุกคัน" และ "ยางถึงกำหนดเปลี่ยน" ต่างก็เป็นข้อมูลที่ถ่ายมาเป็นรอบ
// ไม่ใช่ข้อมูลสด คนดูต้องรู้ว่าเก่าแค่ไหนก่อนจะตัดสินใจสั่งยาง/นัดเข้าอู่
//
//   syncedAt   — ดึงประวัติเปลี่ยนยางจาก ATMS ล่าสุด (แยกรายสาขา: sync ทีละสาขา ล้างแล้วเขียนใหม่ทั้งสาขา)
//   computedAt — คำนวณระยะ GPS/ค่าเที่ยวลง tire_distance ล่าสุด (คำนวณทั้งฟลีตทีเดียว)
//   dataThrough — ระยะทางที่ใช้คำนวณครอบคลุมถึงวันไหน
import type { Db } from "mongodb"
import { BRANCHES } from "@/lib/branch-scope"

export type TireFreshness = {
  atms:        { branch: string; syncedAt: string | null }[]
  computedAt:  string | null
  dataThrough: string | null
}

const iso = (v: unknown): string | null => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  return isNaN(d.getTime()) ? null : d.toISOString()
}

export async function tireFreshness(db: Db, branch = ""): Promise<TireFreshness> {
  const branches = branch ? [branch] : BRANCHES.map((b) => b.value)
  const [atms, meta] = await Promise.all([
    // ทั้งสาขาเขียนด้วย syncedAt เดียวกัน — หยิบเอกสารไหนของสาขานั้นก็ได้ค่าเดียวกัน
    Promise.all(branches.map(async (b) => {
      const doc = await db.collection("tire_change").findOne({ branch: b }, { projection: { syncedAt: 1 } })
      return { branch: b, syncedAt: iso(doc?.syncedAt) }
    })),
    db.collection("tire_distance")
      .find({}).sort({ computedAt: -1 }).limit(1)
      .project({ computedAt: 1, dataThrough: 1 }).next(),
  ])
  return { atms, computedAt: iso(meta?.computedAt), dataThrough: iso(meta?.dataThrough) }
}
