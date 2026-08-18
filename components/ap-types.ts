// รูปร่างข้อมูลที่ /api/ap-tracking ส่งกลับมา — แยกออกจาก component เพื่อให้ตาราง/แถบสรุป/โมดัล
// อ้างถึงชนิดเดียวกันได้โดยไม่ import วนกันเอง
import type { ApDocNos, ApDocs, ApStage, ApStatus } from "@/lib/ap-tracking"

export type ApRow = {
  depositCode: string; depositId: number | null; warehouse: string
  purchaseOrder: string; supplier: string; supplierRefNo: string
  amount: number; receivedAt: string; createdAt: string
  creditTerm: string; dueDate: string; overdue: number
  docs: ApDocs; fileCount: number; review?: { status: string; note: string }
  sentType: string; sentDate: string; note: string
  docNos: ApDocNos
  // เวลาที่จัดซื้อกดเปลี่ยนสถานะเป็น "ส่งบัญชีแล้ว" · sentMarkedDate = วันเดียวกันในเวลาไทย
  // (คนละตัวกับ sentDate ซึ่งคือวันที่เงินจะออก) — ใบเก่าก่อนมีฟิลด์นี้จะเป็น ""
  sentMarkedAt: string; sentMarkedDate: string; sentMarkedBy: string
  status: ApStatus; carryover: boolean
  poTotal: number; poDue: string; poStatus: string
}

export type ApBucket = { n: number; amount: number }

export type ApSummary = {
  total: number
  counted: number
  truncated: boolean
  limit: number
  since: string          // เส้น go-live ที่เซิร์ฟเวอร์ใช้จริง (อาจถูก override ด้วย ?since=)
  byStatus: Record<ApStatus, ApBucket>
  byStage: Record<ApStage, ApBucket>
  overdue: ApBucket
  thisThursday: { date: string; n: number; amount: number }
  unsentAging: { notDue: ApBucket; due7: ApBucket; overdue: ApBucket; noTerm: ApBucket }
  dataAsOf: string
}

// แท็บของหน้า = ขั้นของงาน (ดู apStage ใน lib) · "" = ทุกใบ
export type ApTab = "" | ApStage
