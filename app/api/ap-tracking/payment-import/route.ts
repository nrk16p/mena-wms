// app/api/ap-tracking/payment-import/route.ts
// นำเข้าการจ่าย (ฝ่ายการเงิน) จาก "รายงานจ่ายชำระเจ้าหนี้" — ปุ่มบนหัวหน้า /ap-tracking · เพิ่ม 02/10/2026
// (ไฟล์ใบปะหน้ารอบโอนแบบเดิมยังใช้ /api/ap-tracking/paid-round — หน้าเว็บเลือกเส้นทางจากหัวคอลัมน์)
//
// สะพาน LAPO → DD: ap_tracking.voucherNos (เติมโดยนำเข้าการตั้งเบิก) ∪ เลข DD ในช่อง InvNo
// dryRun (ค่าตั้งต้น) = พรีวิว · dryRun:false = เขียนจริง — คิดสูตรเดียวกันเสมอ
//
// กติกาผู้ใช้:
//   - 01/10/2026 ใบที่จ่ายแล้วแต่ยังไม่ผ่าน → บันทึกจ่ายแล้ว + ธง paid.beforePass ("จ่ายก่อนผ่าน")
//   - 21/08/2026 ใบไม่มี tracking สร้างให้ ยกเว้นคลังตระกูลสระบุรี · ใบก่อน ม.ค. 69 ข้าม · หลายงวด = วันล่าสุด
//   - เลขตั้งหนี้ใบเดียวครอบหลายใบ DD → เก็บ PV/วันจ่ายครบ แต่ไม่ใส่ยอด (เก็บ sharedWith แทน) ไม่เดาแบ่ง
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { apNetAmount, apStage, cleanDocNos, inApScope, parseAmount, parseDmy, type ApDocs, type ApStage } from "@/lib/ap-tracking"
import { getVatPoCodes } from "@/lib/ap-vat"
import { AP_PAYMENT_REPORT_MAX } from "@/lib/ap-payment-report-import"
import { canImportPayment } from "@/lib/roles"
import { CACHE_TAGS, invalidateCache } from "@/lib/shared-cache"

export const dynamic = "force-dynamic"

const MD = process.env.MONGO_DB ?? "master_data"
const COLL = "ap_tracking"
const LOG_KEEP = 200
const DD_RE = /^(KK|LB|SB)DD\d{8}$/
const s = (v: unknown) => (v == null ? "" : String(v)).trim()
// คลังตระกูลสระบุรี (ไม่ใช่สาย DIST) — กติกาเดียวกับ scripts/import-ap-payment.ts
const isSaraburi = (w: string) => w.includes("สระบุรี") && !w.includes("DIST")
type Doc = Record<string, unknown>

function writeDb(client: Awaited<typeof clientPromise>) {
  if (MD === "atms") throw new Error("MONGO_DB ต้องไม่ใช่ 'atms' — ฐาน atms เป็น read-only ห้ามเขียนทับ")
  return client.db(MD)
}

// matched = PV ตรงอยู่แล้ว ไม่ต้องโชว์ ส่งกลับแค่จำนวน
export type PaymentAction = "pay" | "early" | "fillPv" | "addPv" | "create" | "rejected" | "saraburi" | "old" | "matched"
export type PaymentResult = {
  depositCode: string
  action: PaymentAction
  stage: ApStage | ""
  supplier: string
  warehouse: string
  amount: number            // ยอดหัวใบ DD
  receivedAt: string
  pvs: string[]             // จากไฟล์
  newPvs: string[]          // ที่ยังไม่มีในระบบ
  payDate: string
  payAmount: number         // ยอดจ่ายตามเลขตั้งหนี้ (เลขเดียวครอบหลายใบ = ยอดรวม)
  lapos: string[]
  sharedWith: number        // เลขตั้งหนี้นี้ครอบใบ DD อื่นด้วยกี่ใบ
  reason?: string
}

const WRITE_ACTIONS = new Set<PaymentAction>(["pay", "early", "create", "fillPv", "addPv"])

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!canImportPayment(session?.user?.email, session?.user?.employee?.department)) {
    return NextResponse.json({ error: "เฉพาะฝ่ายการเงินหรือฝ่ายบัญชีเท่านั้นที่นำเข้าการจ่ายได้" }, { status: 403 })
  }
  const by = session?.user?.name || session?.user?.email || ""
  const byEmail = session?.user?.email ?? ""

  const body = await req.json().catch(() => ({}))
  const dryRun = body?.dryRun !== false
  const fileName = s(body?.fileName).slice(0, 200)
  const items = Array.isArray(body?.items) ? body.items as { lapo?: unknown; pvs?: unknown; date?: unknown; amount?: unknown; dds?: unknown }[] : []
  if (!items.length) return NextResponse.json({ error: "ไม่มีรายการ" }, { status: 400 })
  if (items.length > AP_PAYMENT_REPORT_MAX) return NextResponse.json({ error: `เกินเพดาน ${AP_PAYMENT_REPORT_MAX} รายการ` }, { status: 400 })

  const client = await clientPromise
  const md = writeDb(client)
  const atms = client.db("atms")
  const trackProj = { _id: 0, depositCode: 1, docs: 1, sentDate: 1, review: 1, paid: 1, voucherNos: 1 }

  // ── สะพาน LAPO → DD จากเลข Voucher ที่บันทึกไว้แล้ว (voucherNos ไม่มี index — ap_tracking ~9k ใบ สแกนครั้งเดียว)
  const lapos = [...new Set(items.map((i) => s(i.lapo).toUpperCase()).filter(Boolean))]
  const byVoucher = await md.collection(COLL).find({ voucherNos: { $in: lapos } }, { projection: trackProj })
    .maxTimeMS(20_000).toArray() as Doc[]
  const lapoToDd = new Map<string, Set<string>>()
  for (const t of byVoucher) for (const v of cleanDocNos(t.voucherNos)) {
    const set = lapoToDd.get(v.toUpperCase()) ?? new Set<string>()
    set.add(s(t.depositCode)); lapoToDd.set(v.toUpperCase(), set)
  }

  // ── รวมเป็นรายใบ DD
  type Acc = { pvs: Set<string>; date: string; payAmount: number; lapos: Set<string>; shared: Set<string> }
  const perDd = new Map<string, Acc>()
  const unmapped: Record<string, number> = {}
  for (const it of items) {
    const lapo = s(it.lapo).toUpperCase()
    const dds = new Set<string>([...(lapoToDd.get(lapo) ?? []), ...cleanDocNos(it.dds).map((d) => d.toUpperCase()).filter((d) => DD_RE.test(d))])
    if (!dds.size) {
      const pre = lapo.replace(/\d+$/, "") || "(ไม่มีเลขตั้งหนี้)"
      unmapped[pre] = (unmapped[pre] ?? 0) + 1
      continue
    }
    for (const dd of dds) {
      const a = perDd.get(dd) ?? { pvs: new Set<string>(), date: "", payAmount: 0, lapos: new Set<string>(), shared: new Set<string>() }
      for (const p of cleanDocNos(it.pvs)) a.pvs.add(p.toUpperCase())
      if (s(it.date) > a.date) a.date = s(it.date)
      a.payAmount = Math.round((a.payAmount + (Number(it.amount) || 0)) * 100) / 100
      if (lapo) a.lapos.add(lapo)
      for (const other of dds) if (other !== dd) a.shared.add(other)
      perDd.set(dd, a)
    }
  }
  const codes = [...perDd.keys()]

  // ── tracking ของใบที่มาทาง InvNo (ยังไม่อยู่ในชุด byVoucher) + หัวใบจาก ATMS
  const have = new Map(byVoucher.map((t) => [s(t.depositCode), t]))
  const missing = codes.filter((c) => !have.has(c))
  const more = missing.length
    ? await md.collection(COLL).find({ depositCode: { $in: missing } }, { projection: trackProj }).maxTimeMS(20_000).toArray() as Doc[]
    : []
  for (const t of more) have.set(s(t.depositCode), t)
  const heads = await atms.collection("deposit_header").find({ deposit_code: { $in: codes } },
    { projection: { _id: 0, deposit_code: 1, supplier: 1, amount: 1, warehouse: 1, received_at: 1, purchase_order: 1 } }).maxTimeMS(20_000).toArray() as Doc[]
  const headBy = new Map(heads.map((h) => [s(h.deposit_code), h]))
  // ยอดหัวใบที่เอาไปเทียบกับยอดในไฟล์การเงิน ต้องเป็นรวมสุทธิ — การเงินโอนรวม VAT (ดู lib/ap-vat.ts)
  const vatPos = await getVatPoCodes()

  const results: PaymentResult[] = codes.map((code) => {
    const a = perDd.get(code)!
    const head = headBy.get(code)
    const track = have.get(code)
    const paid = track?.paid as { paymentNos?: string[]; date?: string } | undefined
    const known = new Set(cleanDocNos(paid?.paymentNos))
    const pvs = [...a.pvs].sort()
    const base = {
      depositCode: code, supplier: s(head?.supplier), warehouse: s(head?.warehouse),
      amount: apNetAmount(parseAmount(head?.amount), vatPos.has(s(head?.purchase_order))),
      receivedAt: parseDmy(head?.received_at), pvs, newPvs: pvs.filter((p) => !known.has(p)),
      payDate: a.date, payAmount: a.payAmount, lapos: [...a.lapos].sort(), sharedWith: a.shared.size,
    }
    if (!head) return { ...base, action: "old" as const, stage: "" as const, reason: "ไม่พบใน ATMS (ข้อมูล ATMS เริ่มปี 69)" }
    if (!inApScope(base.receivedAt)) return { ...base, action: "old" as const, stage: "" as const, reason: "รับของก่อนช่วงที่ระบบติดตาม" }
    if (!track) {
      return isSaraburi(base.warehouse)
        ? { ...base, action: "saraburi" as const, stage: "" as const, reason: "คลังสระบุรีไม่ได้ติดตามในระบบนี้ — ข้าม" }
        : { ...base, action: "create" as const, stage: "wait" as const, reason: "ยังไม่มีข้อมูลติดตาม — สร้างใหม่แล้วบันทึกจ่ายแล้ว" }
    }
    const stage = apStage({ docs: (track.docs ?? {}) as ApDocs, sentDate: s(track.sentDate), review: track.review as { status?: string }, paid })
    if (stage === "rejected") return { ...base, action: "rejected" as const, stage, reason: "บัญชีตีกลับอยู่ — ข้าม" }
    if (stage === "paid") {
      if (!known.size) return { ...base, action: "fillPv" as const, stage, reason: `จ่ายแล้วจากไฟล์รอบโอน (${s(paid?.date)}) — เติมเลข PV` }
      return base.newPvs.length ? { ...base, action: "addPv" as const, stage, reason: "มีเลข PV งวดใหม่" } : { ...base, action: "matched" as const, stage }
    }
    if (stage === "passed") return { ...base, action: "pay" as const, stage }
    return { ...base, action: "early" as const, stage, reason: "จ่ายก่อนบัญชีกดผ่าน — บันทึกจ่ายแล้ว + ติดธง" }
  })

  // ── เขียนจริง ──
  let written = 0
  const doneCodes = new Set<string>()
  if (!dryRun) {
    const at = new Date().toISOString()
    const ops = results.filter((r) => WRITE_ACTIONS.has(r.action)).map((r) => {
      const a = perDd.get(r.depositCode)!
      const track = have.get(r.depositCode)
      const old = track?.paid as { paymentNos?: string[]; date?: string } | undefined
      const paymentNos = [...new Set([...cleanDocNos(old?.paymentNos), ...r.pvs])].sort()
      const date = [s(old?.date), r.payDate].sort().at(-1) ?? r.payDate
      const shared = [...a.shared].sort()
      const detail = `PV ${paymentNos.join(", ")} · จ่าย ${date}${shared.length ? ` · ตั้งหนี้รวมกับ ${shared.length} ใบ` : ""}`
        + `${r.action === "early" ? " · จ่ายก่อนบัญชีผ่าน" : ""}${fileName ? ` · ${fileName}` : ""}`
      const log = { action: "บันทึกการจ่ายเงิน (นำเข้ารายงานจ่ายชำระ)", field: "paid", detail, by, byEmail, at }

      // ใบที่จ่ายแล้วอยู่ก่อน (จากไฟล์รอบโอน) — เติมเฉพาะ PV/วันจ่าย ด้วย dotted path ไม่ทับยอด/ข้อมูลรอบเดิม
      if (r.action === "fillPv" || r.action === "addPv") {
        return {
          updateOne: {
            filter: { depositCode: r.depositCode },
            update: {
              $set: { "paid.paymentNos": paymentNos, "paid.date": date, "paid.pvSource": "payment-report", "paid.pvBy": by, "paid.pvAt": at, updatedAt: at, updatedBy: by },
              $push: { log: { $each: [log], $slice: -LOG_KEEP } },
            },
          },
        }
      }
      const paid: Record<string, unknown> = { paymentNos, date, source: "payment-report", by, at }
      if (!shared.length && a.payAmount) paid.amount = a.payAmount
      if (shared.length) paid.sharedWith = shared
      if (r.action === "early") paid.beforePass = true
      // กันทับของที่เปลี่ยนระหว่างพรีวิว: ผ่าน→ต้องยังผ่าน · จ่ายก่อนผ่าน→ต้องยังไม่ถูกตีกลับ · สร้างใหม่→upsert
      const filter: Record<string, unknown> = { depositCode: r.depositCode }
      if (r.action === "pay") filter["review.status"] = "ผ่าน"
      if (r.action === "early") filter["review.status"] = { $ne: "ไม่ผ่าน" }
      if (r.action !== "create") filter["paid.paymentNos.0"] = { $exists: false }
      return {
        updateOne: {
          filter,
          update: {
            $set: { depositCode: r.depositCode, paid, updatedAt: at, updatedBy: by },
            $push: { log: { $each: [log], $slice: -LOG_KEEP } },
            ...(r.action === "create" ? { $setOnInsert: { createdAt: at, createdBy: by } } : {}),
          },
          ...(r.action === "create" ? { upsert: true } : {}),
        },
      }
    })
    if (ops.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await md.collection(COLL).bulkWrite(ops as any, { ordered: false })
        // ล้างแคชหน้า AP — ordered:false พังกลางทางก็อาจเขียนไปบางใบแล้ว จึงล้างทั้งกรณีสำเร็จและพัง
        .finally(() => invalidateCache([CACHE_TAGS.ap]))
      written = res.modifiedCount + res.upsertedCount
      // อ่านกลับว่าใบไหนได้ PV ครบจริง — ใบที่โดน filter กันไว้จะยังอยู่กลุ่มเดิมให้เห็น
      const want = results.filter((r) => WRITE_ACTIONS.has(r.action))
      const after = await md.collection(COLL).find({ depositCode: { $in: want.map((r) => r.depositCode) } },
        { projection: { _id: 0, depositCode: 1, "paid.paymentNos": 1 } }).toArray()
      const pvBy = new Map(after.map((d) => [s(d.depositCode), new Set(cleanDocNos((d.paid as { paymentNos?: string[] } | undefined)?.paymentNos))]))
      for (const r of want) if (r.pvs.every((p) => pvBy.get(r.depositCode)?.has(p))) doneCodes.add(r.depositCode)
    }
  }
  for (const r of results) if (doneCodes.has(r.depositCode)) { r.action = "matched"; r.stage = "paid"; r.newPvs = [] }

  const count = (k: PaymentAction) => results.filter((r) => r.action === k).length
  return NextResponse.json({
    dryRun, written,
    summary: {
      dds: results.length, pay: count("pay"), early: count("early"), fillPv: count("fillPv"), addPv: count("addPv"),
      create: count("create"), rejected: count("rejected"), saraburi: count("saraburi"), old: count("old"), matched: count("matched"),
      unmappedRows: Object.values(unmapped).reduce((t, n) => t + n, 0), unmapped,
      payAmount: results.filter((r) => r.action === "pay").reduce((t, r) => t + r.amount, 0),
    },
    // ใบที่ตรงอยู่แล้ว (หลายพันใบ) ไม่ต้องโชว์ — ส่งแค่จำนวน
    results: results.filter((r) => r.action !== "matched"),
  })
}
