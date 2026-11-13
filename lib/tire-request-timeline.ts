// ===========================================================================
// คำขอเปลี่ยนยาง "รายเส้น" พร้อมวันที่ของแต่ละขั้น — ใช้ใน Dashboard ยาง 2 ที่:
//   1) งานติดตามของยางแต่ละเส้น (รออนุมัติ / รอเปลี่ยน / เปลี่ยนแล้ว)
//   2) กราฟงานค้างรายวัน (ยางที่ค้างในคำขอ ณ สิ้นวัน)
// ===========================================================================
// คำขอรุ่นแรกตัดสิน "ทั้งใบ" (ไม่มี status รายเส้น) → ใช้สถานะ/วันที่ระดับใบแทน
// นัดหมายแล้วนับเป็น "รอเปลี่ยน" เหมือนอนุมัติแล้ว — ยางยังอยู่บนรถ รอช่างเปลี่ยน

import type { Db } from "mongodb"

export type ItemStage = "pending" | "waiting" | "done" | "rejected"

export type TimelineItem = {
  branch:     string
  plate:      string
  fleet:      string
  plant:      string
  serialNo:   string
  position:   string
  product:    string
  stage:      ItemStage
  createdAt:  Date
  approvedAt: Date | null
  closedAt:   Date | null
}

const toDate = (v: unknown): Date | null => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  return isNaN(d.getTime()) ? null : d
}

function stageOf(itemStatus: unknown, requestStatus: unknown): ItemStage {
  const s = String(itemStatus ?? requestStatus ?? "pending")
  if (s === "approved" || s === "appointment") return "waiting"
  if (s === "done") return "done"
  if (s === "rejected") return "rejected"
  return "pending"
}

export async function loadRequestTimeline(db: Db, branch = ""): Promise<TimelineItem[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const match: Record<string, any> = { "items.0": { $exists: true } }
  if (branch) match.branch = branch
  const reqs = await db.collection("tire_change_request").find(match).project({
    branch: 1, plate: 1, fleet: 1, plant: 1, status: 1, createdAt: 1, updatedAt: 1,
    approvedAt: 1, appointmentAt: 1, doneAt: 1, rejectedAt: 1,
    "items.serialNo": 1, "items.tirePosition": 1, "items.product": 1, "items.status": 1, "items.createdAt": 1,
    "items.approvedAt": 1, "items.appointmentAt": 1, "items.doneAt": 1, "items.rejectedAt": 1,
  }).toArray()

  const out: TimelineItem[] = []
  for (const r of reqs) {
    const rCreated = toDate(r.createdAt)
    if (!rCreated) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const it of (r.items ?? []) as any[]) {
      const stage = stageOf(it.status, it.status ? undefined : r.status)
      const createdAt = toDate(it.createdAt) ?? rCreated
      // วันที่ขาด (ข้อมูลเก่า) → ใช้ระดับใบ → updatedAt → วันแจ้ง — ดีกว่าทิ้งรายการไปทั้งเส้น
      const fallback = toDate(r.updatedAt) ?? createdAt
      const approvedAt = stage === "pending" ? null
        : toDate(it.approvedAt) ?? toDate(it.appointmentAt) ?? toDate(r.approvedAt) ?? toDate(r.appointmentAt)
          ?? (stage === "waiting" || stage === "done" ? fallback : null)
      const closedAt = stage === "done" ? toDate(it.doneAt) ?? toDate(r.doneAt) ?? fallback
        : stage === "rejected" ? toDate(it.rejectedAt) ?? toDate(r.rejectedAt) ?? fallback
        : null
      out.push({
        branch:   String(r.branch ?? ""),
        plate:    String(r.plate ?? "").trim(),
        fleet:    String(r.fleet ?? "").trim(),
        plant:    String(r.plant ?? "").trim(),
        serialNo: String(it.serialNo ?? "").trim(),
        position: String(it.tirePosition ?? "").trim(),
        product:  String(it.product ?? "").trim(),
        stage, createdAt, approvedAt, closedAt,
      })
    }
  }
  return out
}
