// lib/repair-nopr-db.ts — ฝั่ง server: งานที่ยังไม่มี PR + วันที่ PR ถูกลบครั้งล่าสุด (noPrSince)
// ใช้ร่วมกันระหว่าง stats (ตัวเลขใน dropdown) และ /api/repair-external/no-pr (ข้อความคัดลอก)
// ให้สองที่นับวันตรงกันเสมอ · ทุกทางที่แก้ PR (PUT / อัพเดทงาน / sync API) ลง log field prCode ไว้
import type { Db, Document } from "mongodb"
import { REPAIR_LOG_COLL } from "@/lib/repair-log"
import type { NoPrRow } from "@/lib/repair-external"

const NO_PR = { $or: [{ prCode: "" }, { prCode: { $exists: false } }] }

export async function loadNoPrRows(db: Db, match: Record<string, unknown>): Promise<NoPrRow[]> {
  const docs = await db.collection("repair_external")
    .find({ ...match, ...NO_PR })
    .project<Document>({ createdBy: 1, createdAt: 1, fleetNo: 1, plate: 1, status: 1, prCode: 1, receivedDate: 1, garageInDate: 1 })
    .toArray()
  if (!docs.length) return []
  // เวลาล่าสุดที่ prCode ถูกเปลี่ยนเป็นค่าว่าง ต่อใบงาน (log เล็ก ~800 เอกสาร)
  const cleared = await db.collection(REPAIR_LOG_COLL).aggregate<{ _id: string; at: Date }>([
    { $match: { repairId: { $in: docs.map((d) => String(d._id)) }, "changes.field": "prCode" } },
    { $unwind: "$changes" },
    { $match: { "changes.field": "prCode", "changes.to": "" } },
    { $group: { _id: "$repairId", at: { $max: "$at" } } },
  ]).toArray()
  const clearedAt = new Map(cleared.map((c) => [c._id, c.at]))
  return docs.map((d) => ({ ...d, _id: String(d._id), noPrSince: clearedAt.get(String(d._id)) }) as NoPrRow)
}
