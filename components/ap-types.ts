// รูปร่างข้อมูลที่ /api/ap-tracking ส่งกลับมา — แยกออกจาก component เพื่อให้ตาราง/แถบสรุป/โมดัล
// อ้างถึงชนิดเดียวกันได้โดยไม่ import วนกันเอง
import type { ApDocNos, ApDocs, ApPaySchedule, ApStage, ApStatus } from "@/lib/ap-tracking"

// กำหนดจ่ายที่บัญชียืนยันตอนกดผ่าน — basis คือตัวตั้งที่ใช้คิด เก็บไว้ย้อนตรวจ
export type ApPay = ApPaySchedule & {
  basis?: { passedAt: string; passedDate: string; creditTerm: string; requestedType: string }
  by?: string; at?: string
}

export type ApRow = {
  depositCode: string; depositId: number | null; warehouse: string
  purchaseOrder: string; supplier: string; supplierRefNo: string
  amount: number; receivedAt: string; createdAt: string
  creditTerm: string; dueDate: string; overdue: number
  docs: ApDocs; fileCount: number; review?: { status: string; note: string }
  sentType: string; sentDate: string; note: string
  // ตารางส่งมาเฉพาะช่องที่มีเลขจริง (ดู compactDocNos) — ช่องที่ไม่มีจะหายไปเลย ไม่ใช่ []
  docNos: Partial<ApDocNos>
  // เวลาที่จัดซื้อกดเปลี่ยนสถานะเป็น "ส่งบัญชีแล้ว" · sentMarkedDate = วันเดียวกันในเวลาไทย
  // (คนละตัวกับ sentDate ซึ่งคือวันที่เงินจะออก) · ใบที่ยังไม่เคยกดส่ง — และใบเก่าก่อนมีฟิลด์นี้
  // ที่ยังไม่ backfill — จะไม่มีคีย์นี้เลย ไม่ใช่ "" (API ตัดทิ้งเพื่อลดขนาด payload)
  sentMarkedAt?: string; sentMarkedDate?: string; sentMarkedBy?: string
  // มีเฉพาะใบที่บัญชีกดผ่านแล้ว (API ตัดคีย์ว่างทิ้งเพื่อลดขนาด payload)
  pay?: ApPay
  // ทะเบียนรถ (จาก PO) + หมายเหตุ (จาก PR — มีเลขใบแจ้งซ่อม/ทะเบียน/ชื่อช่าง)
  // มีเฉพาะแถวที่ข้อมูลต้นทางมีจริง
  vehicle?: string
  prNote?: string
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

// ผลจาก /api/ap-tracking/search — ค้นข้ามเดือนตอนเดือนที่เปิดอยู่หาไม่เจอ
export type ApCrossHit = {
  depositCode: string; purchaseOrder: string; supplier: string
  warehouse: string; amount: number; receivedAt: string; month: string
}

// แท็บของหน้า = ขั้นของงาน (ดู apStage ใน lib) · "" = ทุกใบ
export type ApTab = "" | ApStage
