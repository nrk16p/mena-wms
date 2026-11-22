// scripts/seed-vendor-onboarding.ts — ค่าเริ่มต้นงานคัดเลือก vendor ใหม่ (เกณฑ์ 21 ข้อ · ช่องเอกสาร · ค่าตั้ง) + ใบตัวอย่าง
//
//   node -r dotenv/config node_modules/.bin/tsx scripts/seed-vendor-onboarding.ts                  ← ดูอย่างเดียว (อ่านจำนวน ไม่เขียน)
//   node -r dotenv/config node_modules/.bin/tsx scripts/seed-vendor-onboarding.ts --apply          ← ใส่ค่าเริ่มต้น เฉพาะคอลเลกชันที่ยังว่าง
//   node -r dotenv/config node_modules/.bin/tsx scripts/seed-vendor-onboarding.ts --apply --demo   ← + ใบตัวอย่าง VENDEMO-0001..4
//   node -r dotenv/config node_modules/.bin/tsx scripts/seed-vendor-onboarding.ts --remove-demo    ← ดูว่ามีใบตัวอย่างกี่ใบ
//   node -r dotenv/config node_modules/.bin/tsx scripts/seed-vendor-onboarding.ts --remove-demo --apply ← ลบใบตัวอย่าง (ref ขึ้นต้น VENDEMO)
//
// ไม่ทับของเดิมเด็ดขาด: เกณฑ์/ช่องเอกสาร ใส่เฉพาะตอนคอลเลกชันว่าง · ค่าตั้งใช้ $setOnInsert
// ใบตัวอย่างไม่มีไฟล์จริงใน Spaces (เปิดไฟล์จะขึ้น "ไม่พบไฟล์")
import { DEFAULT_CRITERIA, DEFAULT_DOC_SLOTS, DEFAULT_SETTINGS } from "../lib/vendor-onboarding/defaults"
import {
  CONSENT_ITEMS, CONSENT_VERSION, VO_COLL, VO_DB, isDocRequired,
  type Actor, type DocEntry, type OnboardingDoc, type OnboardingStatus, type ScoreItem, type TimelineEntry, type VendorProfile,
} from "../lib/vendor-onboarding/types"

const args = new Set(process.argv.slice(2))
const APPLY = args.has("--apply")
const DEMO = args.has("--demo")
const REMOVE_DEMO = args.has("--remove-demo")

/** เลข 13 หลักที่ผ่าน checksum จาก 12 หลักแรก */
function taxId(base12: string): string {
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(base12[i]) * (13 - i)
  return base12 + String((11 - (sum % 11)) % 10)
}

const OFFICER: Actor = { name: "ตัวอย่าง จัดซื้อ", email: "demo.officer@menatransport.co.th" }
const REVIEWER: Actor = { name: "ตัวอย่าง ผู้รีวิว", email: "demo.reviewer@menatransport.co.th" }
const APPROVER: Actor = { name: "ตัวอย่าง ผู้อนุมัติ", email: "demo.approver@menatransport.co.th" }

function demoDoc(n: number, status: OnboardingStatus, profile: VendorProfile, daysAgo: number): OnboardingDoc {
  const ref = `VENDEMO-${String(n).padStart(4, "0")}`
  const t = (h: number) => new Date(Date.now() - daysAgo * 86_400_000 + h * 3_600_000).toISOString()
  const criteria = DEFAULT_CRITERIA.filter((c) => c.active)
  const slots = DEFAULT_DOC_SLOTS.filter((s) => s.active)
  const later = status !== "submitted"
  const checked = status === "pending_review" || status === "approved"

  const documents: DocEntry[] = slots.filter((s) => s.requirement !== "system").map((s, i) => {
    const has = isDocRequired(s, profile.entityType) || i % 4 === 0
    if (!has) return { slot: s.key, files: [], status: "missing" }
    const files = [{ key: `vendor-onboarding/${ref}/${s.key}/demo-${s.key}.pdf`, name: `${s.label}.pdf`, size: 120_000 + i * 1000, contentType: "application/pdf", uploadedAt: t(0) }]
    if (checked) return { slot: s.key, files, status: "passed", checkedBy: OFFICER, checkedAt: t(26) }
    if (status === "checking" && i % 2 === 0) return { slot: s.key, files, status: "passed", checkedBy: OFFICER, checkedAt: t(25) }
    return { slot: s.key, files, status: "waiting" }
  })

  const scores: ScoreItem[] = !later ? [] : criteria
    .filter((_, i) => checked || i < 10)
    .map((c, i) => ({ key: c.key, value: i % 7 === 6 ? "fail" : "pass" }))

  const timeline: TimelineEntry[] = [{ at: t(0), from: null, to: "submitted", action: "submit", by: null }]
  if (later) timeline.push({ at: t(24), from: "submitted", to: "checking", action: "start_check", by: OFFICER })
  if (checked) timeline.push({ at: t(27), from: "checking", to: "pending_review", action: "send_review", by: OFFICER })
  if (status === "approved") {
    timeline.push({ at: t(30), from: "pending_review", to: "pending_approval", action: "review_pass", by: REVIEWER })
    timeline.push({ at: t(33), from: "pending_approval", to: "approved", action: "approve", by: APPROVER })
  }

  return {
    schemaVersion: 2, ref, status, profile,
    answers: { "1.1": true, "1.3": 5 + n, "1.4": "บริษัทตัวอย่าง A", "1.5": "รายได้ 10 ล้าน", "2.1": n % 2 ? "ISO 9001" : "", "2.2": true, "2.3": true, "2.4": n % 2 === 0, "3.2": 30, "3.3": true, "4.2": 3, "4.3": true, "4.4": false, "5.1": true, "5.2": "โทร, LINE", "6.1": true, "6.2": n % 2 === 1 },
    criteriaSnapshot: criteria,
    docSlotSnapshot: slots,
    documents, scores,
    passThreshold: DEFAULT_SETTINGS.passThreshold,
    evaluatedBy: checked ? { by: OFFICER, at: t(27) } : null,
    reviewedBy: status === "approved" ? { by: REVIEWER, at: t(30) } : null,
    approvedBy: status === "approved" ? { by: APPROVER, at: t(33) } : null,
    vendorCode: null,
    consent: { version: CONSENT_VERSION, acceptedAt: t(0), ip: null, userAgent: "seed-demo", items: CONSENT_ITEMS.map((c) => ({ id: c.id, granted: true })) },
    timeline,
    lineId: null, lineDisplayName: null,
    source: "form-vendor",
    createdAt: t(0),
    updatedAt: timeline[timeline.length - 1].at,
  }
}

const contact = (name: string, phone: string) => ({ name, phone, email: "", position: "ผู้จัดการฝ่ายขาย" })
const DEMOS: OnboardingDoc[] = [
  demoDoc(1, "submitted", { entityType: "company", companyName: "บริษัท ตัวอย่างอะไหล่ จำกัด (ข้อมูลตัวอย่าง)", taxId: taxId("010555900001"), branch: "สำนักงานใหญ่", address: "99 ถนนตัวอย่าง เขตลาดกระบัง กรุงเทพฯ 10520", phone: "021234567", email: "demo1@example.com", productType: "อะไหล่รถบรรทุก", contact: contact("สมชาย ตัวอย่าง", "0812345671") }, 1),
  demoDoc(2, "checking", { entityType: "company", companyName: "บริษัท ตัวอย่างยางรถ จำกัด (ข้อมูลตัวอย่าง)", taxId: taxId("010555900002"), branch: "สำนักงานใหญ่", address: "12 หมู่ 3 ตำบลตัวอย่าง อำเภอเมือง สระบุรี 18000", phone: "036123456", email: "demo2@example.com", productType: "ยางรถบรรทุก", contact: contact("สมหญิง ตัวอย่าง", "0812345672") }, 3),
  demoDoc(3, "pending_review", { entityType: "individual", companyName: "นายตัวอย่าง ช่างแอร์ (ข้อมูลตัวอย่าง)", taxId: taxId("310990000003"), branch: "สำนักงานใหญ่", address: "45 ซอยตัวอย่าง บางปะกง ฉะเชิงเทรา 24130", phone: "0891234567", email: "demo3@example.com", productType: "ซ่อมแอร์รถยนต์", contact: contact("ตัวอย่าง ช่างแอร์", "0891234567") }, 6),
  demoDoc(4, "approved", { entityType: "company", companyName: "บริษัท ตัวอย่างน้ำมันหล่อลื่น จำกัด (ข้อมูลตัวอย่าง)", taxId: taxId("010555900004"), branch: "00001", address: "8 ถนนตัวอย่าง เมือง ชลบุรี 20000", phone: "038123456", email: "demo4@example.com", productType: "น้ำมันเครื่องและจาระบี", contact: contact("สมศักดิ์ ตัวอย่าง", "0812345674") }, 10),
]

async function main() {
  const { default: clientPromise } = await import("../lib/mongo")
  const { applySeed, seedPlan } = await import("../lib/vendor-onboarding/db")
  const client = await clientPromise
  const db = client.db(VO_DB)
  const apps = db.collection(VO_COLL)

  if (REMOVE_DEMO) {
    const n = await apps.countDocuments({ schemaVersion: 2, ref: /^VENDEMO-/ })
    console.log(`ใบตัวอย่าง (ref ขึ้นต้น VENDEMO) ${n} ใบ`)
    if (!APPLY) { console.log("(ดูอย่างเดียว — ใส่ --apply เพื่อลบจริง)"); return }
    const r = await apps.deleteMany({ schemaVersion: 2, ref: /^VENDEMO-/ })
    const l = await db.collection("vendor_onboarding_links").deleteMany({ ref: /^VENDEMO-/ })
    console.log(`ลบใบตัวอย่างแล้ว ${r.deletedCount} ใบ · ลิงก์ ${l.deletedCount} รายการ`)
    return
  }

  const plan = await seedPlan(db)
  console.log(`เกณฑ์ประเมิน: ${plan.criteria ? `จะใส่ ${plan.criteria} ข้อ` : "มีอยู่แล้ว ข้าม"}`)
  console.log(`ช่องเอกสาร:  ${plan.docSlots ? `จะใส่ ${plan.docSlots} รายการ` : "มีอยู่แล้ว ข้าม"}`)
  console.log(`ค่าตั้ง:      ${plan.settings ? `จะใส่ (เกณฑ์ผ่าน ${DEFAULT_SETTINGS.passThreshold} · ผู้รีวิว ${DEFAULT_SETTINGS.reviewerEmails.join(", ") || "-"} · ลิงก์ ${DEFAULT_SETTINGS.linkDays} วัน)` : "มีอยู่แล้ว ข้าม"}`)

  let demoTodo: OnboardingDoc[] = []
  if (DEMO) {
    const have = new Set((await apps.find({ schemaVersion: 2, ref: /^VENDEMO-/ }, { projection: { ref: 1 } }).toArray()).map((d) => d.ref as string))
    demoTodo = DEMOS.filter((d) => !have.has(d.ref))
    console.log(`ใบตัวอย่าง:   จะใส่ ${demoTodo.length} ใบ${have.size ? ` (มีอยู่แล้ว ${have.size} ใบ ข้าม)` : ""}`)
    for (const d of demoTodo) console.log(`  ${d.ref} · ${d.status} · ${d.profile.companyName}`)
  }

  if (!APPLY) { console.log("\n(ดูอย่างเดียว — ใส่ --apply เพื่อเขียนจริง)"); return }
  const done = await applySeed(db)
  console.log(`\nใส่แล้ว: เกณฑ์ ${done.criteria} · ช่องเอกสาร ${done.docSlots} · ค่าตั้ง ${done.settings ? "1" : "0"}`)
  if (demoTodo.length) {
    await apps.insertMany(demoTodo.map((d) => ({ ...d }) as Record<string, unknown>))
    console.log(`ใส่ใบตัวอย่าง ${demoTodo.length} ใบ`)
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
