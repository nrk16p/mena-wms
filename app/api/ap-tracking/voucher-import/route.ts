// app/api/ap-tracking/voucher-import/route.ts
// นำเข้าการตั้งเบิก (ฝ่ายบัญชี) — ปุ่มบนหัวหน้า /ap-tracking · เพิ่ม 02/10/2026
//
// เบราว์เซอร์แกะ "รายงานตั้งเจ้าหนี้อื่นๆ" เอง (lib/ap-voucher-import) แล้วส่งมาเฉพาะ เลข DD + เลข Voucher + วันตั้งหนี้
// ไฟล์ไม่ถูกอัปโหลด · dryRun (ค่าตั้งต้น) = พรีวิวอย่างเดียว · dryRun:false = เขียนจริง (คิดสูตรเดียวกับพรีวิวเสมอ)
//
// กติกาผู้ใช้ (01/10/2026):
//   - ใบ "ส่งบัญชีแล้ว" ที่พบในไฟล์ → ผ่าน + เติมเลขที่ Voucher/ตั้งหนี้ · ไม่คิดกำหนดจ่าย (บัญชีกำหนดทีหลังทีละใบ)
//   - ใบที่ผ่าน/จ่ายแล้ว ไม่ต้องโชว์และไม่แตะ
//   - ใบที่ส่งบัญชีแล้วแต่ไม่พบในไฟล์ → บัญชีตอบในเว็บ: ไม่ผ่าน (PATCH review) / รอรอบเครดิตถัดไป (PATCH nextRound)
// เพิ่ม 22/10/2026 (ผู้ใช้สั่ง): ใบที่ "ผ่าน" แล้ว (ยังไม่จ่าย) แต่เลข Voucher ในไฟล์ไม่ตรงกับในระบบ → กลุ่ม "update"
//   บันทึกทับด้วยเลขในไฟล์ล่าสุด (แทนที่ ไม่ต่อท้าย) · ยืนยันแยกจากการผ่าน (apply:"update")
//   ใบจ่ายแล้วไม่แตะ — กันเลขไม่ตรงกับไฟล์รอบโอนที่การเงินนำเข้าไปแล้ว
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { apNetOf, AP_NOS_MAX, apStage, cleanDocNos, ictDate, inApScope, parseDmy, type ApDocs, type ApStage } from "@/lib/ap-tracking"
import { AP_VOUCHER_MAX, sameDocNoSet, voucherNeedsUpdate } from "@/lib/ap-voucher-import"
import { isAccounting } from "@/lib/roles"
import { CACHE_TAGS, invalidateCache } from "@/lib/shared-cache"

export const dynamic = "force-dynamic"

const MD = process.env.MONGO_DB ?? "master_data"
const COLL = "ap_tracking"
const LOG_KEEP = 200
const DD_RE = /^(KK|LB|SB)DD\d{8}$/
const s = (v: unknown) => (v == null ? "" : String(v)).trim()
type Doc = Record<string, unknown>

function writeDb(client: Awaited<typeof clientPromise>) {
  if (MD === "atms") throw new Error("MONGO_DB ต้องไม่ใช่ 'atms' — ฐาน atms เป็น read-only ห้ามเขียนทับ")
  return client.db(MD)
}

// "passed"/"paid" = ผ่านแล้ว/จ่ายแล้ว — ไม่โชว์ ไม่แตะ ส่งกลับแค่จำนวน
// "update" = ผ่านแล้ว ยังไม่จ่าย แต่เลข Voucher ในไฟล์ไม่ตรงกับในระบบ
export type VoucherAction = "pass" | "update" | "notSent" | "rejected" | "notFound" | "passed" | "paid"
export type VoucherResult = {
  depositCode: string
  action: VoucherAction
  stage: ApStage | ""
  supplier: string
  warehouse: string
  amount: number
  receivedAt: string
  vouchers: string[]        // จากไฟล์
  newVouchers: string[]     // ที่ยังไม่มีในระบบ — ตัวที่จะถูกเติม
  oldVouchers?: string[]    // กลุ่ม update: เลขที่อยู่ในระบบตอนนี้ (จะถูกแทนที่ด้วย vouchers)
  docDate: string
  reason?: string
}
export type VoucherUnmatched = {
  depositCode: string
  supplier: string
  warehouse: string
  amount: number
  receivedAt: string
  sentMarkedDate: string
  sentType: string
  afterFile: boolean        // กดส่งบัญชีหลังวันตั้งหนี้ล่าสุดในไฟล์ — ปกติยังไม่ถึงรอบ
  nextRound?: { note: string; by: string; at: string }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!isAccounting(session?.user?.email, session?.user?.employee?.department)) {
    return NextResponse.json({ error: "เฉพาะฝ่ายบัญชีเท่านั้นที่นำเข้าการตั้งเบิกได้" }, { status: 403 })
  }
  const by = session?.user?.name || session?.user?.email || ""
  const byEmail = session?.user?.email ?? ""

  const body = await req.json().catch(() => ({}))
  const dryRun = body?.dryRun !== false          // ค่าตั้งต้น = พรีวิว ต้องส่ง dryRun:false ถึงจะเขียน
  // เขียนจริงทีละเรื่อง: "pass" (ค่าตั้งต้น เดิม) หรือ "update" (แทนที่เลข Voucher ของใบที่ผ่านแล้ว)
  const apply = body?.apply === "update" ? "update" : "pass"
  // apply:"update" ต้องส่งเลขเดิมที่เห็นตอนพรีวิวมาด้วย — ถ้าในระบบเปลี่ยนไปแล้ว (มีคนแก้ในหน้าเว็บ) ข้ามใบนั้น
  const seen = new Map<string, string[]>()
  if (Array.isArray(body?.updates)) {
    for (const u of (body.updates as { depositCode?: unknown; oldVouchers?: unknown }[]).slice(0, AP_VOUCHER_MAX)) {
      const code = s(u?.depositCode).toUpperCase()
      if (DD_RE.test(code)) seen.set(code, cleanDocNos(u?.oldVouchers))
    }
  }
  const fileTo = s(body?.fileTo)
  const fileName = s(body?.fileName).slice(0, 200)
  if (!Array.isArray(body?.items) || !body.items.length) return NextResponse.json({ error: "ไม่มีรายการ" }, { status: 400 })
  if (body.items.length > AP_VOUCHER_MAX) return NextResponse.json({ error: `เกินเพดาน ${AP_VOUCHER_MAX} ใบ` }, { status: 400 })

  const want = new Map<string, { vouchers: string[]; docDate: string }>()
  for (const raw of body.items as { depositCode?: unknown; vouchers?: unknown; docDate?: unknown }[]) {
    const code = s(raw?.depositCode).toUpperCase()
    if (!DD_RE.test(code)) return NextResponse.json({ error: `เลขใบ DD ไม่ถูกรูปแบบ: ${code || "(ว่าง)"}` }, { status: 400 })
    want.set(code, { vouchers: cleanDocNos(raw?.vouchers).map((v) => v.toUpperCase()), docDate: s(raw?.docDate) })
  }
  const codes = [...want.keys()]

  const client = await clientPromise
  const md = writeDb(client)
  const atms = client.db("atms")
  const trackProj = { _id: 0, depositCode: 1, docs: 1, sentDate: 1, sentType: 1, sentMarkedAt: 1, review: 1, paid: 1, voucherNos: 1, nextRound: 1, updatedAt: 1 }
  // ใบค้าง "ส่งบัญชีแล้ว" ทั้งระบบ (หลักร้อย) — ตัวตั้งของรายการ "ไม่พบในไฟล์"
  const [tracks, pending] = await Promise.all([
    md.collection(COLL).find({ depositCode: { $in: codes } }, { projection: trackProj }).maxTimeMS(20_000).toArray() as Promise<Doc[]>,
    md.collection(COLL).find({ sentDate: { $nin: [null, ""] }, "review.status": { $nin: ["ผ่าน", "ไม่ผ่าน"] } }, { projection: trackProj })
      .maxTimeMS(20_000).toArray() as Promise<Doc[]>,
  ])
  const stageOf = (t: Doc | undefined): ApStage => apStage({
    docs: ((t?.docs ?? {}) as ApDocs), sentDate: s(t?.sentDate),
    review: t?.review as { status?: string } | undefined, paid: t?.paid as { paymentNos?: string[]; date?: string } | undefined,
  })

  // หัวใบจาก ATMS — ทุกใบในไฟล์ + ใบค้าง (deposit_header ไม่มี index ที่ deposit_code: สแกนครั้งเดียว ~19k)
  const pendingCodes = pending.filter((t) => stageOf(t) === "sent").map((t) => s(t.depositCode))
  const heads = await atms.collection("deposit_header").find({ deposit_code: { $in: [...new Set([...codes, ...pendingCodes])] } },
    { projection: { _id: 0, deposit_code: 1, supplier: 1, amount: 1, amount_net: 1, grand_total: 1, vat_amount: 1, vat_rate: 1, warehouse: 1, received_at: 1, purchase_order: 1 } }).maxTimeMS(20_000).toArray() as Doc[]
  // ยอดที่โชว์เทียบกับไฟล์ตั้งเบิก = รวมสุทธิ ชุดเดียวกับหน้าหลัก (ATMS คิดไว้รายใบ)
  const netOf = (h: Doc | undefined) => apNetOf(h)
  const headBy = new Map(heads.map((h) => [s(h.deposit_code), h]))
  const trackBy = new Map(tracks.map((t) => [s(t.depositCode), t]))

  const results: VoucherResult[] = codes.map((code) => {
    const file = want.get(code)!
    const head = headBy.get(code)
    const track = trackBy.get(code)
    const known = new Set(cleanDocNos(track?.voucherNos))
    const base = {
      depositCode: code, supplier: s(head?.supplier), warehouse: s(head?.warehouse), amount: netOf(head),
      receivedAt: parseDmy(head?.received_at), vouchers: file.vouchers, newVouchers: file.vouchers.filter((v) => !known.has(v)),
      docDate: file.docDate,
    }
    if (!head) return { ...base, action: "notFound" as const, stage: "" as const, reason: "ไม่พบใน ATMS (ข้อมูล ATMS เริ่มปี 69)" }
    if (!inApScope(base.receivedAt)) return { ...base, action: "notFound" as const, stage: "" as const, reason: "รับของก่อนช่วงที่ระบบติดตาม" }
    const stage = stageOf(track)
    if (stage === "sent") return { ...base, action: "pass" as const, stage }
    if (stage === "paid") return { ...base, action: "paid" as const, stage }
    if (stage === "passed") {
      const old = cleanDocNos(track?.voucherNos)
      return voucherNeedsUpdate(old, file.vouchers)
        ? { ...base, action: "update" as const, stage, oldVouchers: old }
        : { ...base, action: "passed" as const, stage }
    }
    if (stage === "rejected") return { ...base, action: "rejected" as const, stage, reason: "บัญชีตีกลับอยู่ — ต้องแก้แล้วส่งใหม่ก่อน" }
    return { ...base, action: "notSent" as const, stage, reason: "บัญชีตั้งหนี้แล้ว แต่จัดซื้อยังไม่กดส่งบัญชี" }
  })

  // ── เขียนจริง (ทีละเรื่องตาม apply) ──
  //   update = แทนที่เลข Voucher ของใบที่ผ่านแล้ว · pass = ส่งบัญชีแล้ว → ผ่าน + เติมเลข Voucher
  // pass: filter ซ้ำเงื่อนไข "ส่งบัญชีแล้ว ยังไม่ตรวจ" ตอนเขียน — กันทับผลตรวจที่บัญชีเพิ่งกดในหน้าเว็บระหว่างพรีวิว
  let written = 0
  let updateSkipped = 0
  const passedNow = new Set<string>()
  if (!dryRun && apply === "update") {
    // แทนที่เลข Voucher ด้วยเลขในไฟล์ — เฉพาะใบที่พรีวิวเห็นเลขเดิมเดียวกับที่ระบบมีตอนนี้
    // filter ซ้ำ "ผ่าน + ยังไม่จ่าย + updatedAt เดิม" กันทับงานที่เพิ่งเกิดระหว่างคำขอนี้
    const at = new Date().toISOString()
    const toUpdate = results.filter((r) => r.action === "update")
    const ops = toUpdate.flatMap((r) => {
      const expect = seen.get(r.depositCode)
      if (!expect || !sameDocNoSet(r.oldVouchers ?? [], expect)) {
        updateSkipped++
        return []
      }
      const voucherNos = r.vouchers.slice(0, AP_NOS_MAX)
      const t = trackBy.get(r.depositCode)
      const detail = `${(r.oldVouchers ?? []).join(", ") || "(ว่าง)"} → ${voucherNos.join(", ")} · นำเข้าการตั้งเบิก${fileName ? ` (${fileName})` : ""}${r.docDate ? ` · ตั้งหนี้ ${r.docDate}` : ""}`
      return [{
        updateOne: {
          filter: {
            depositCode: r.depositCode, "review.status": "ผ่าน",
            updatedAt: t?.updatedAt ?? { $exists: false },
            $nor: [{ "paid.paymentNos.0": { $exists: true } }, { "paid.date": { $nin: [null, ""] } }],
          },
          update: {
            $set: { voucherNos, updatedAt: at, updatedBy: by },
            $push: { log: { $each: [{ action: "แก้เลขที่ Voucher/ตั้งหนี้", field: "voucherNos", detail, by, byEmail, at }], $slice: -LOG_KEEP } },
          },
        },
      }]
    })
    if (ops.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await md.collection(COLL).bulkWrite(ops as any, { ordered: false })
        .finally(() => invalidateCache([CACHE_TAGS.ap]))
      written = res.modifiedCount
      updateSkipped += ops.length - res.modifiedCount
      // อ่านกลับ: ใบที่เลขในระบบตรงกับไฟล์แล้ว ย้ายไปกลุ่ม "ผ่านแล้ว" (ซ่อน)
      const after = await md.collection(COLL).find({ depositCode: { $in: toUpdate.map((r) => r.depositCode) } },
        { projection: { _id: 0, depositCode: 1, voucherNos: 1 } }).toArray()
      const fileBy = new Map(toUpdate.map((r) => [r.depositCode, r.vouchers]))
      for (const d of after) {
        const code = s(d.depositCode)
        if (sameDocNoSet(cleanDocNos(d.voucherNos), fileBy.get(code) ?? [])) passedNow.add(code)
      }
    }
  } else if (!dryRun) {
    const at = new Date().toISOString()
    const toPass = results.filter((r) => r.action === "pass")
    const ops = toPass.map((r) => {
      const prev = cleanDocNos(trackBy.get(r.depositCode)?.voucherNos)
      const voucherNos = [...prev, ...r.newVouchers].slice(0, AP_NOS_MAX)
      const log: Record<string, string>[] = [{
        action: "บัญชีตรวจเอกสาร: ผ่าน", field: "review",
        detail: `นำเข้าการตั้งเบิก${fileName ? ` (${fileName})` : ""}${r.docDate ? ` · ตั้งหนี้ ${r.docDate}` : ""} · ยังไม่กำหนดวันจ่าย`,
        by, byEmail, at,
      }]
      if (r.newVouchers.length) {
        log.push({ action: "แก้เลขที่ Voucher/ตั้งหนี้", field: "voucherNos", detail: voucherNos.join(", "), by, byEmail, at })
      }
      return {
        updateOne: {
          filter: { depositCode: r.depositCode, sentDate: { $nin: [null, ""] }, "review.status": { $nin: ["ผ่าน", "ไม่ผ่าน"] } },
          update: {
            $set: { review: { status: "ผ่าน", note: "", by, at }, voucherNos, nextRound: null, updatedAt: at, updatedBy: by },
            $push: { log: { $each: log, $slice: -LOG_KEEP } },
          },
        },
      }
    })
    if (ops.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await md.collection(COLL).bulkWrite(ops as any, { ordered: false })
        // ล้างแคชหน้า AP — ordered:false พังกลางทางก็อาจเขียนไปบางใบแล้ว จึงล้างทั้งกรณีสำเร็จและพัง
        .finally(() => invalidateCache([CACHE_TAGS.ap]))
      written = res.modifiedCount
      // ใบที่เขียนสำเร็จหลุดจาก "ส่งบัญชีแล้ว" แล้ว — อ่านกลับสถานะจริงแทนการเดา (บางใบอาจโดน filter กันไว้)
      const after = await md.collection(COLL).find({ depositCode: { $in: toPass.map((r) => r.depositCode) }, "review.status": "ผ่าน" },
        { projection: { _id: 0, depositCode: 1 } }).toArray()
      for (const d of after) passedNow.add(s(d.depositCode))
    }
  }

  // หลังเขียน: ใบที่เพิ่งผ่านย้ายไปกลุ่ม "ผ่านแล้ว" (ไม่โชว์) · ใบค้างที่ยังไม่ผ่านคือ "ไม่พบในไฟล์"
  for (const r of results) if (passedNow.has(r.depositCode)) { r.action = "passed"; r.stage = "passed" }
  const unmatched: VoucherUnmatched[] = pending
    .filter((t) => stageOf(t) === "sent" && !want.has(s(t.depositCode)))
    .map((t) => {
      const code = s(t.depositCode)
      const head = headBy.get(code)
      const sentMarkedDate = s(t.sentMarkedAt) ? ictDate(s(t.sentMarkedAt)) : s(t.sentDate)
      return {
        depositCode: code, supplier: s(head?.supplier), warehouse: s(head?.warehouse), amount: netOf(head),
        receivedAt: parseDmy(head?.received_at), sentMarkedDate, sentType: s(t.sentType),
        afterFile: Boolean(fileTo && sentMarkedDate > fileTo),
        ...(t.nextRound ? { nextRound: t.nextRound as VoucherUnmatched["nextRound"] } : {}),
      }
    }).sort((a, b) => a.sentMarkedDate.localeCompare(b.sentMarkedDate))

  const count = (a: VoucherAction) => results.filter((r) => r.action === a).length
  return NextResponse.json({
    dryRun, written,
    summary: {
      total: results.length, pass: count("pass"), update: count("update"), updateSkipped,
      notSent: count("notSent"), rejected: count("rejected"), notFound: count("notFound"), passed: count("passed"), paid: count("paid"),
      unmatched: unmatched.length, unmatchedAfterFile: unmatched.filter((u) => u.afterFile).length,
      passAmount: results.filter((r) => r.action === "pass").reduce((t, r) => t + r.amount, 0),
    },
    results: results.filter((r) => r.action !== "paid" && r.action !== "passed"),
    unmatched,
  })
}
