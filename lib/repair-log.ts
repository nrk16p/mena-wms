import type { Db } from "mongodb"

export const REPAIR_LOG_COLL = "repair_external_log"

// ป้ายชื่อฟิลด์ (ไทย) สำหรับแสดงใน log — ครอบคลุมฟิลด์ที่แก้ไขได้
export const REPAIR_FIELD_LABELS: Record<string, string> = {
  receivedDate:  "วันที่รับแจ้ง",
  garageInDate:  "วันที่รถเข้าอู่ซ่อม",
  dueDate:       "วันกำหนดเสร็จ",
  completedDate: "วันที่ซ่อมเสร็จ",
  mrNo:          "เลขใบแจ้งซ่อม MR",
  symptom:       "รายละเอียดอาการ",
  plate:         "ทะเบียนรถ",
  fleetNo:       "เบอร์รถ",
  garage:        "อู่",
  status:        "สถานะ",
  prCode:        "รหัส PR",
  poCode:        "รหัส PO",
  note:          "หมายเหตุ",
  repairPrice:   "ราคาซ่อม",
  warranty:      "รับประกัน",
}

export type RepairChange = { field: string; label: string; from: string; to: string }

// เทียบเอกสารเก่า/ใหม่ → รายการฟิลด์ที่เปลี่ยน (เทียบเป็น string เพื่อกันชนิดต่างกัน)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function diffRepair(oldDoc: Record<string, any>, newDoc: Record<string, any>): RepairChange[] {
  const out: RepairChange[] = []
  for (const f of Object.keys(REPAIR_FIELD_LABELS)) {
    const a = oldDoc?.[f] ?? ""
    const b = newDoc?.[f] ?? ""
    if (String(a) !== String(b)) {
      out.push({ field: f, label: REPAIR_FIELD_LABELS[f], from: String(a), to: String(b) })
    }
  }
  return out
}

export type RepairLogEntry = {
  repairId:     string
  plate:        string
  fleetNo:      string
  action:       "create" | "update" | "delete"
  by:           string
  byEmail:      string
  at:           Date
  statusChange?: { from: string; to: string }
  changes?:     RepairChange[]
}

export async function writeRepairLog(db: Db, entry: RepairLogEntry) {
  await db.collection(REPAIR_LOG_COLL).insertOne(entry)
}
