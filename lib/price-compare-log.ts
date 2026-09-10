// lib/price-compare-log.ts — audit log ของใบเทียบราคา (รูปแบบเดียวกับ lib/repair-log.ts)
import type { Db } from "mongodb"
import type { PriceCompare } from "./price-compare"

export const PC_LOG_COLL = "price_compare_log"

export type PcChange = { field: string; label: string; from: string; to: string }
export type PcLogEntry = {
  docId: string; docNo: string
  action: "create" | "update" | "delete" | "status"
  by: string; byEmail: string; at: Date
  statusChange?: { from: string; to: string }
  changes?: PcChange[]
}

const TOP_LABELS: Record<string, string> = {
  title: "ชื่อสินค้า/งานซ่อม",
  requestDept: "หน่วยงานที่ร้องขอ",
  status: "สถานะ",
  selectedSupplier: "ผู้ได้รับเลือก",
  selectionReason: "เหตุผลที่เลือก",
  fewerQuotesReason: "เหตุผลที่มีใบเสนอราคาน้อยกว่า 3 ราย",
  "links.prCode": "PR",
  "links.plate": "ทะเบียนรถ",
  "links.fleetNo": "เบอร์รถ",
  "links.repairExternalId": "งานซ่อมอู่นอก",
}

const supplierLabel = (doc: PriceCompare, n: number | null): string =>
  n == null ? "" : `Supplier ${n}${doc.suppliers[n - 1]?.name ? ` (${doc.suppliers[n - 1].name})` : ""}`

// diff เฉพาะฟิลด์ระดับบน + สรุปจำนวนแถว/ราย — ไม่ diff ราคารายช่องเพื่อไม่ให้ log รก
export function diffPriceCompare(a: PriceCompare, b: PriceCompare): PcChange[] {
  const out: PcChange[] = []
  const get = (d: PriceCompare, f: string): string => {
    if (f === "selectedSupplier") return supplierLabel(d, d.selectedSupplier)
    if (f.startsWith("links.")) return String(d.links[f.slice(6) as keyof PriceCompare["links"]] ?? "")
    return String((d as unknown as Record<string, unknown>)[f] ?? "")
  }
  for (const f of Object.keys(TOP_LABELS)) {
    const from = get(a, f), to = get(b, f)
    if (from !== to) out.push({ field: f, label: TOP_LABELS[f], from, to })
  }
  if (a.items.length !== b.items.length) out.push({ field: "items", label: "รายการ", from: `${a.items.length} แถว`, to: `${b.items.length} แถว` })
  // โหมดผสม: สรุปเป็น "เลือกแล้วกี่แถวจากทั้งหมด" — ยังไม่ diff ว่าแถวไหนเปลี่ยนเจ้า (เจตนาเดียวกับที่ไม่ diff ราคารายช่อง)
  const picked = (d: PriceCompare) => (d.lineSupplier ?? []).filter((v) => v != null).length
  const pa = picked(a), pb = picked(b)
  if (pa !== pb || a.items.length !== b.items.length) {
    out.push({ field: "lineSupplier", label: "เลือกรายบรรทัด", from: `${pa}/${a.items.length} แถว`, to: `${pb}/${b.items.length} แถว` })
  }
  if (a.suppliers.length !== b.suppliers.length) out.push({ field: "suppliers", label: "Supplier", from: `${a.suppliers.length} ราย`, to: `${b.suppliers.length} ราย` })
  return out
}

export async function writePcLog(db: Db, entry: PcLogEntry): Promise<void> {
  await db.collection(PC_LOG_COLL).insertOne(entry)
}
