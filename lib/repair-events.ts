import { after } from "next/server"
import type { Db } from "mongodb"

// ── เหตุการณ์ของใบงานอู่นอก สำหรับระบบภายนอก (Mena-Next) ──
// ทุกเหตุการณ์ลง collection นี้ → GET /api/repair-external/sync/changes อ่านเป็น feed (ทางหลัก เชื่อถือได้)
// และถ้าตั้ง MENA_NEXT_WEBHOOK_URL ไว้ จะ POST ไปแจ้งทันทีหลังตอบ request (ทางเสริม ไม่ retry — พลาดให้ตามจาก feed)
export const REPAIR_EVENT_COLL = "repair_external_events"

export type RepairEventType =
  | "job.created"        // เปิดใบงานใหม่
  | "status.changed"     // เปลี่ยนสถานะ
  | "quotation.updated"  // แนบไฟล์ใบเสนอราคาเพิ่ม / แก้รายละเอียดใบเสนอราคา
  | "comment.created"    // ข้อความใหม่ (จากหน้าเว็บ หรือจาก API)

export type RepairEvent = {
  type:      RepairEventType
  repairId:  string
  nextJobId: string
  plate:     string
  fleetNo:   string
  status:    string
  by:        string
  source:    "wms" | "api"   // wms = คนกดในหน้าเว็บ · api = มาจากระบบภายนอกผ่าน /sync
  at:        Date
  data:      Record<string, unknown>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = Record<string, any>

// ข้อมูลร่วมของทุกเหตุการณ์จากใบงาน (ใช้ค่าใหม่ก่อน แล้วค่อยค่าเดิม)
export function eventBase(repairId: string, doc: AnyDoc, existing: AnyDoc | null, by: string, source: "wms" | "api", at: Date) {
  const pick = (k: string) => String(doc?.[k] ?? existing?.[k] ?? "")
  return { repairId, nextJobId: pick("nextJobId"), plate: pick("plate"), fleetNo: pick("fleetNo"), status: pick("status"), by, source, at }
}

// ไฟล์ใบเสนอราคาที่เพิ่มเข้ามาใหม่ (เทียบด้วยลิงก์) + รายละเอียดเปลี่ยนไหม → null ถ้าไม่มีอะไรเปลี่ยน
export function quotationChange(existing: AnyDoc | null, doc: AnyDoc): Record<string, unknown> | null {
  const urls = (arr: unknown) => new Set((Array.isArray(arr) ? arr : []).map((f: AnyDoc) => String(f?.webpUrl ?? "")))
  const had = urls(existing?.quotationImages)
  const newFiles = (Array.isArray(doc.quotationImages) ? doc.quotationImages : [])
    .filter((f: AnyDoc) => f?.webpUrl && !had.has(String(f.webpUrl)))
    .map((f: AnyDoc) => ({
      filename: String(f.filename ?? ""),
      url:      String(f.webpUrl),
      fileType: /\.pdf$/i.test(String(f.filename ?? "")) ? "pdf" : "image",
    }))
  const detailChanged = String(existing?.quotationDetail ?? "") !== String(doc.quotationDetail ?? "")
  if (!newFiles.length && !detailChanged) return null
  return { newFiles, quotationDetail: String(doc.quotationDetail ?? ""), fileCount: (doc.quotationImages ?? []).length }
}

// ลงเหตุการณ์ + นัดยิง webhook หลังตอบ request · ห้ามทำให้การบันทึกใบงานล้ม — error กลืนหมด
export async function emitRepairEvents(db: Db, events: (RepairEvent | null | undefined)[]) {
  const list = events.filter(Boolean) as RepairEvent[]
  if (!list.length) return
  try {
    const res = await db.collection(REPAIR_EVENT_COLL).insertMany(list.map((e) => ({ ...e })))
    const withIds = list.map((e, i) => ({ id: String(res.insertedIds[i]), ...e }))
    scheduleWebhook(withIds)
  } catch (e) {
    console.error("repair-events:", e)
  }
}

// รูปแบบที่ส่งออก (webhook + feed ใช้ตัวเดียวกัน) — เวลาเป็นเวลาไทย +07:00
export function eventForExport(e: AnyDoc) {
  const at = e.at instanceof Date ? e.at : new Date(e.at)
  const bkk = new Date(at.getTime() + 7 * 3600_000).toISOString().replace("Z", "+07:00")
  return {
    id: String(e.id ?? e._id), type: e.type, at: bkk,
    repairId: e.repairId, nextJobId: e.nextJobId || null,
    plate: e.plate, fleetNo: e.fleetNo, status: e.status,
    by: e.by, source: e.source, data: e.data ?? {},
  }
}

function scheduleWebhook(events: (RepairEvent & { id: string })[]) {
  const url = process.env.MENA_NEXT_WEBHOOK_URL
  if (!url) return
  const send = async () => {
    for (const e of events) {
      try {
        await fetch(url, {
          method:  "POST",
          headers: {
            "Content-Type": "application/json",
            ...(process.env.MENA_NEXT_WEBHOOK_SECRET ? { "x-webhook-secret": process.env.MENA_NEXT_WEBHOOK_SECRET } : {}),
          },
          body:   JSON.stringify(eventForExport(e)),
          signal: AbortSignal.timeout(5000),
        })
      } catch (err) {
        console.error("repair-events webhook:", e.type, e.repairId, err)
      }
    }
  }
  // after() = ยิงหลังตอบผู้ใช้แล้ว ไม่หน่วงหน้าเว็บ · นอก request scope (สคริปต์) ใช้ยิงตรง
  try { after(send) } catch { void send() }
}
