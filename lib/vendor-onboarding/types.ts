// New Vendor Onboarding — contract กลาง ใช้ทั้ง client และ server (ห้าม import ของ server ในไฟล์นี้)
// ต้นแบบ flow: hr-service /recruitment (ผู้สมัคร) · เงื่อนไขจากใบคัดเลือกผู้ส่งมอบ Rev1 TW28.11.68
//
// เก็บที่ datawarehouse.vendor_registration (คอลเลกชันเดียวกับ /form-vendor เดิม)
//   เอกสารเก่า (ไม่มี schemaVersion) = ใบลงทะเบียนแบบสั้น → แสดงในตารางเดียวกันเป็น "แบบเก่า"
//   เอกสารใหม่ schemaVersion: 2 = OnboardingDoc ด้านล่าง

export const VO_DB = "datawarehouse"
export const VO_COLL = "vendor_registration"
export const VO_CRITERIA_COLL = "vendor_onboarding_criteria"
export const VO_DOC_SLOT_COLL = "vendor_onboarding_doc_slot"
export const VO_SETTINGS_COLL = "vendor_onboarding_settings"
export const VO_COUNTER_COLL = "vendor_onboarding_counters"
export const VO_LINK_COLL = "vendor_onboarding_links"

/** ประเภทผู้ส่งมอบ — กำหนดว่าเอกสารไหนบังคับ */
export type EntityType = "company" | "individual" // นิติบุคคล | บุคคลธรรมดา
export const ENTITY_LABEL: Record<EntityType, string> = { company: "นิติบุคคล", individual: "บุคคลธรรมดา" }

// ───────────────────────── สถานะใบสมัคร ─────────────────────────
export type OnboardingStatus =
  | "submitted"     // vendor ส่งแล้ว
  | "checking"      // จัดซื้อกำลังตรวจเอกสาร + ให้คะแนน
  | "need_docs"     // ขอเอกสารเพิ่ม — vendor ส่งเพิ่มผ่านลิงก์ token แล้วกลับเป็น checking
  | "pending_review"   // รอรีวิว (ผู้ช่วยผู้จัดการ)
  | "pending_approval" // รออนุมัติ (ผู้จัดการจัดซื้อ)
  | "approved"
  | "rejected"      // ไม่ผ่านการคัดเลือก
  | "cancelled"

export const STATUS_LABEL: Record<OnboardingStatus, string> = {
  submitted: "ส่งแล้ว",
  checking: "กำลังตรวจ",
  need_docs: "ขอเอกสารเพิ่ม",
  pending_review: "รอรีวิว",
  pending_approval: "รออนุมัติ",
  approved: "อนุมัติ",
  rejected: "ไม่ผ่าน",
  cancelled: "ยกเลิก",
}

/** ลำดับใน KPI strip */
export const STATUS_ORDER: OnboardingStatus[] = [
  "submitted", "checking", "need_docs", "pending_review", "pending_approval", "approved", "rejected", "cancelled",
]
export const OPEN_STATUSES: OnboardingStatus[] = ["submitted", "checking", "need_docs", "pending_review", "pending_approval"]

/** ใครกดได้: officer = ฝ่ายจัดซื้อที่มีสิทธิ์ vendor:edit · reviewer = settings.reviewerEmails · approver = settings.approverEmails */
export type ActorRole = "officer" | "reviewer" | "approver"

export type OnboardingAction =
  | "start_check"      // submitted → checking
  | "request_docs"     // checking → need_docs (ต้องมี note + รายการเอกสารที่ขอ)
  | "send_review"      // checking → pending_review (เอกสารบังคับผ่านครบ + คะแนน ≥ เกณฑ์ + ให้คะแนนครบทุกข้อ)
  | "review_pass"      // pending_review → pending_approval
  | "review_return"    // pending_review → checking (ต้องมี note)
  | "approve"          // pending_approval → approved
  | "approve_return"   // pending_approval → checking (ต้องมี note)
  | "reject"           // pending_review | pending_approval → rejected (ต้องมี note)
  | "cancel"           // สถานะเปิดใดก็ได้ → cancelled (ต้องมี note)
  | "reissue_link"     // need_docs → need_docs ออกลิงก์ส่งเอกสารใหม่ (ลิงก์เดิมหมดอายุ/หาย) รายการที่ขอเหมือนเดิม

export const ACTIONS: Record<OnboardingAction, { from: OnboardingStatus[]; to: OnboardingStatus; role: ActorRole; label: string; needsNote: boolean }> = {
  start_check:    { from: ["submitted"], to: "checking", role: "officer", label: "เริ่มตรวจ", needsNote: false },
  request_docs:   { from: ["checking"], to: "need_docs", role: "officer", label: "ขอเอกสารเพิ่ม", needsNote: true },
  send_review:    { from: ["checking"], to: "pending_review", role: "officer", label: "ส่งรีวิว", needsNote: false },
  review_pass:    { from: ["pending_review"], to: "pending_approval", role: "reviewer", label: "รีวิวผ่าน ส่งอนุมัติ", needsNote: false },
  review_return:  { from: ["pending_review"], to: "checking", role: "reviewer", label: "ตีกลับให้ตรวจใหม่", needsNote: true },
  approve:        { from: ["pending_approval"], to: "approved", role: "approver", label: "อนุมัติ", needsNote: false },
  approve_return: { from: ["pending_approval"], to: "checking", role: "approver", label: "ตีกลับให้ตรวจใหม่", needsNote: true },
  reject:         { from: ["pending_review", "pending_approval"], to: "rejected", role: "reviewer", label: "ไม่ผ่านการคัดเลือก", needsNote: true },
  cancel:         { from: ["submitted", "checking", "need_docs", "pending_review", "pending_approval"], to: "cancelled", role: "officer", label: "ยกเลิก", needsNote: true },
  reissue_link:   { from: ["need_docs"], to: "need_docs", role: "officer", label: "ออกลิงก์ใหม่", needsNote: false },
}
// หมายเหตุ reject: reviewer หรือ approver กดได้ทั้งคู่ (approver ถือว่าสูงกว่า reviewer)

// ───────────────────────── เกณฑ์ประเมิน 21 ข้อ ─────────────────────────
export type CriterionInput =
  | { kind: "yesno" }                         // vendor ตอบ มี/ไม่มี
  | { kind: "number"; unit: string }          // เช่น อายุกิจการ (ปี), เครดิต (วัน)
  | { kind: "text"; placeholder?: string }    // เช่น ระบุ ISO ที่มี
  | { kind: "none" }                          // vendor ไม่ต้องตอบ จัดซื้อประเมินเอง

export type Criterion = {
  key: string            // "1.1" … "6.2" — คงที่ ห้ามเปลี่ยนหลังมีข้อมูล
  category: number       // 1–6
  order: number
  label: string          // ข้อความในใบคัดเลือก
  vendorQuestion: string | null // คำถามที่ vendor เห็น (null = ไม่ถาม vendor)
  input: CriterionInput
  /** ตัวช่วยเติมผลให้จัดซื้อ (ไม่ใช่ผลสุดท้าย) เช่น ปี ≥ 3 → แนะนำ "ผ่าน" */
  suggestMin?: number
  active: boolean
}

export const CATEGORY_LABEL: Record<number, string> = {
  1: "ความน่าเชื่อถือของบริษัท",
  2: "การบริหารคุณภาพ",
  3: "ด้านราคาและเงื่อนไขการค้า",
  4: "ความสามารถในการส่งมอบ",
  5: "การบริการและการดูแลลูกค้า",
  6: "ความปลอดภัย กฎหมาย และสิ่งแวดล้อม",
}

export type ScoreValue = "pass" | "fail"
export type ScoreItem = { key: string; value: ScoreValue; note?: string }

// ───────────────────────── Checklist เอกสาร ─────────────────────────
export type DocRequirement = "required" | "required_company" | "optional" | "system"
// system = ทำผ่านระบบ (ใบคัดเลือก / ใบขอเปิดเจ้าหนี้ / PDPA) ไม่ต้องอัปโหลด

export type DocSlot = {
  key: string
  group: string
  label: string
  requirement: DocRequirement
  hint?: string
  order: number
  active: boolean
}

export type DocStatus = "missing" | "waiting" | "passed" | "redo"
export const DOC_STATUS_LABEL: Record<DocStatus, string> = { missing: "ยังไม่ส่ง", waiting: "รอตรวจ", passed: "ผ่าน", redo: "ขอใหม่" }

export type DocFile = { key: string; name: string; size: number; contentType: string; uploadedAt: string }
export type DocEntry = { slot: string; files: DocFile[]; status: DocStatus; note?: string; checkedBy?: Actor; checkedAt?: string }

export function isDocRequired(slot: Pick<DocSlot, "requirement">, entity: EntityType): boolean {
  return slot.requirement === "required" || (slot.requirement === "required_company" && entity === "company")
}

// ───────────────────────── ใบสมัคร ─────────────────────────
export type Actor = { name: string; email: string }
export type TimelineEntry = { at: string; from: OnboardingStatus | null; to: OnboardingStatus; action: OnboardingAction | "submit" | "resubmit"; by: Actor | null; note?: string }

export type ContactPerson = { name: string; phone: string; email: string; position: string }

export type VendorProfile = {
  entityType: EntityType
  companyName: string    // ชื่อบริษัท/ร้าน (บุคคลธรรมดา = ชื่อ-นามสกุล)
  taxId: string          // 13 หลัก ผ่าน checksum
  branch: string         // "สำนักงานใหญ่" หรือเลขสาขา
  address: string
  phone: string
  email: string
  productType: string    // ประเภทสินค้า/บริการ (ช่อง "ประเภท" ในใบคัดเลือก)
  contact: ContactPerson
}

/** คำตอบของ vendor ต่อ criterion: yesno → boolean · number → number · text → string */
export type VendorAnswers = Record<string, boolean | number | string>

export type Signoff = { by: Actor; at: string; note?: string }

export type OnboardingDoc = {
  _id?: unknown
  schemaVersion: 2
  ref: string                     // VEN2611-0001
  status: OnboardingStatus
  profile: VendorProfile
  answers: VendorAnswers
  criteriaSnapshot: Criterion[]   // เกณฑ์ ณ วันที่ส่ง
  docSlotSnapshot: DocSlot[]
  documents: DocEntry[]
  scores: ScoreItem[]             // จัดซื้อให้คะแนน
  passThreshold: number           // เกณฑ์ ณ วันที่ส่ง
  evaluatedBy: Signoff | null     // ผู้ประเมิน (ตอน send_review)
  reviewedBy: Signoff | null      // ผู้ตรวจสอบ
  approvedBy: Signoff | null      // ผู้อนุมัติ
  vendorCode: string | null       // รหัส vendor ใน ATMS — จัดซื้อกรอกหลังอนุมัติ
  consent: { version: string; acceptedAt: string; ip: string | null; userAgent: string | null; items: { id: string; granted: boolean }[] }
  timeline: TimelineEntry[]
  lineId: string | null
  lineDisplayName: string | null
  source: "form-vendor"
  createdAt: string
  updatedAt: string
}

/** แถวในตาราง admin — รวมเอกสารแบบเก่าด้วย (legacy: true) */
export type OnboardingSummary = {
  id: string
  ref: string | null
  legacy: boolean
  status: OnboardingStatus | "legacy_pending" | "legacy_approved" | "legacy_rejected"
  companyName: string
  entityType: EntityType | null
  taxId: string
  productType: string | null
  contactName: string | null
  contactPhone: string | null
  score: { pass: number; fail: number; blank: number; threshold: number } | null
  docs: { requiredTotal: number; requiredPassed: number; waiting: number; redo: number } | null
  vendorCode: string | null
  createdAt: string
  updatedAt: string
}

export function scoreSummary(d: Pick<OnboardingDoc, "criteriaSnapshot" | "scores" | "passThreshold">) {
  const active = d.criteriaSnapshot.filter(c => c.active)
  const byKey = new Map(d.scores.map(s => [s.key, s.value]))
  let pass = 0, fail = 0, blank = 0
  for (const c of active) {
    const v = byKey.get(c.key)
    if (v === "pass") pass++
    else if (v === "fail") fail++
    else blank++
  }
  return { pass, fail, blank, threshold: d.passThreshold, total: active.length, meets: blank === 0 && pass >= d.passThreshold }
}

/** เงื่อนไขส่งรีวิว — ใช้ทั้งปุ่มใน UI และ server */
export function canSendReview(d: Pick<OnboardingDoc, "criteriaSnapshot" | "scores" | "passThreshold" | "docSlotSnapshot" | "documents" | "profile">): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  const s = scoreSummary(d)
  if (s.blank > 0) reasons.push(`ยังไม่ได้ให้คะแนน ${s.blank} ข้อ`)
  else if (s.pass < s.threshold) reasons.push(`คะแนน ${s.pass}/${s.total} ไม่ถึงเกณฑ์ ${s.threshold}`)
  const docBy = new Map(d.documents.map(x => [x.slot, x]))
  const notPassed = d.docSlotSnapshot
    .filter(sl => sl.active && isDocRequired(sl, d.profile.entityType))
    .filter(sl => docBy.get(sl.key)?.status !== "passed")
  if (notPassed.length) reasons.push(`เอกสารบังคับยังไม่ผ่าน ${notPassed.length} รายการ`)
  return { ok: reasons.length === 0, reasons }
}

export const CONSENT_VERSION = "vendor-2026-11-22"
export const CONSENT_ITEMS = [
  { id: "core", required: true, label: "ยินยอมให้บริษัทเก็บและใช้ข้อมูลที่กรอกและเอกสารที่แนบ เพื่อพิจารณาคัดเลือกและขึ้นทะเบียนผู้ส่งมอบ" },
  { id: "contact", required: true, label: "ยินยอมให้ติดต่อผู้ประสานงานตามเบอร์โทรและอีเมลที่ให้ไว้ เรื่องการคัดเลือกและการสั่งซื้อ" },
] as const

/** ไฟล์ที่รับ — รูปและ PDF ไม่เกิน 10 MB ต่อไฟล์ สูงสุด 5 ไฟล์ต่อรายการ */
export const DOC_MAX_BYTES = 10 * 1024 * 1024
export const DOC_MAX_FILES = 5
export const DOC_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"]
