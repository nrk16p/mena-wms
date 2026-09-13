// app/api/ap-tracking/paid-round/route.ts
// ยืนยัน "จ่ายเงินแล้ว" เป็นชุดจากไฟล์รอบโอนของการเงิน (ปุ่มนำเข้าในหน้า /ap-tracking)
//
// เบราว์เซอร์อ่านไฟล์เอง (lib/ap-round-import) แล้วส่งมาเฉพาะ "เลขใบ + ยอดในไฟล์ + เลขตั้งหนี้"
// ไฟล์ไม่ถูกอัปโหลดขึ้นเซิร์ฟเวอร์ · เซิร์ฟเวอร์ตรวจทุกใบกับฐานเองอีกชั้น ไม่เชื่อค่าที่ส่งมา
// dryRun=1 คืนผลตรวจอย่างเดียว ไม่เขียน — ไดอะล็อกใช้ตัวนี้ทำพรีวิว แล้วค่อยยิงซ้ำเพื่อเขียนจริง
// จึงไม่มีทางที่ "สิ่งที่พรีวิว" กับ "สิ่งที่เขียน" คิดคนละสูตร
//
// เขียนอะไร: ap_tracking.paid = { date: วันรอบโอน, amount, source: "round-file", by, at }
// ไฟล์รอบโอนไม่มีเลข PV (ผู้ใช้ยืนยัน 13/09/2026 ว่าไม่เป็นไร) — ขั้น "จ่ายแล้ว" จึงดูที่ apPaidConfirmed
// เลข PV จะถูกเติมทีหลังเมื่อนำเข้าทะเบียนจ่าย (scripts/import-ap-payment.ts) ด้วยคีย์เลข DD เดียวกัน
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import { apPaidConfirmed, parseAmount, thaiDate } from "@/lib/ap-tracking"
import { AP_ROUND_MAX } from "@/lib/ap-round-import"
import { canImportPayment } from "@/lib/roles"

export const dynamic = "force-dynamic"

const MD = process.env.MONGO_DB ?? "master_data"
const COLL = "ap_tracking"
const LOG_KEEP = 200
const DD_RE = /^[A-Z]{2,4}DD\d{4,}$/
const AMOUNT_TOLERANCE = 1        // บาท — ยอดในไฟล์เป็นผลรวมรายชิ้น ปัดเศษต่างกันได้เล็กน้อย
const s = (v: unknown) => (v == null ? "" : String(v)).trim()

function writeDb(client: Awaited<typeof clientPromise>) {
  if (MD === "atms") throw new Error("MONGO_DB ต้องไม่ใช่ 'atms' — ฐาน atms เป็น read-only ห้ามเขียนทับ")
  return client.db(MD)
}

function isValidYmd(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return false
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3])
  if (month < 1 || month > 12) return false
  return day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
}

type InItem = { depositCode?: unknown; amount?: unknown; vouchers?: unknown }
type Doc = Record<string, unknown>

/** ผลรายใบ — action บอกว่าจะเกิดอะไรขึ้น (หรือเกิดอะไรไปแล้ว) · warnings ไม่บล็อกการเขียน */
type Result = {
  depositCode: string
  action: "write" | "skip" | "same"
  reason?: string
  warnings?: string[]
  supplier?: string
  fileAmount: number
  headAmount?: number
  stage?: string
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  // ปุ่มถูกซ่อนฝั่งหน้าเว็บอยู่แล้ว แต่การซ่อนปุ่มไม่ใช่การกันสิทธิ์ — ต้องตรวจที่เซิร์ฟเวอร์ด้วย
  if (!canImportPayment(session?.user?.email, session?.user?.employee?.department)) {
    return NextResponse.json({ error: "เฉพาะฝ่ายการเงินหรือฝ่ายบัญชีเท่านั้นที่นำเข้าการจ่ายได้" }, { status: 403 })
  }
  const by = session?.user?.name || session?.user?.email || ""
  const byEmail = session?.user?.email ?? ""

  const body = await req.json().catch(() => ({}))
  const dryRun = body?.dryRun !== false          // ค่าตั้งต้น = พรีวิว ต้องส่ง dryRun:false ถึงจะเขียน
  const roundDate = s(body?.roundDate)
  const fileName = s(body?.fileName).slice(0, 200)
  if (!isValidYmd(roundDate)) {
    return NextResponse.json({ error: "วันรอบโอนไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)" }, { status: 400 })
  }
  if (!Array.isArray(body?.items) || !body.items.length) {
    return NextResponse.json({ error: "ไม่มีรายการในไฟล์" }, { status: 400 })
  }
  if (body.items.length > AP_ROUND_MAX) {
    return NextResponse.json({ error: `นำเข้าได้ครั้งละไม่เกิน ${AP_ROUND_MAX} ใบ (ส่งมา ${body.items.length} ใบ)` }, { status: 400 })
  }

  // รวมซ้ำที่ฝั่งเซิร์ฟเวอร์ด้วย — ไฟล์เป็นรายชิ้นสินค้า ถ้าหน้าเว็บส่งดิบมาก็ยังต้องได้ผลเดียวกัน
  const want = new Map<string, { amount: number; vouchers: string[] }>()
  for (const raw of body.items as InItem[]) {
    const code = s(raw?.depositCode).toUpperCase()
    if (!DD_RE.test(code)) {
      return NextResponse.json({ error: `เลขใบ DD ไม่ถูกรูปแบบ: ${code || "(ว่าง)"}` }, { status: 400 })
    }
    const amount = typeof raw?.amount === "number" ? raw.amount : parseAmount(raw?.amount)
    if (!Number.isFinite(amount) || amount < 0) {
      return NextResponse.json({ error: `ยอดเงินของ ${code} ไม่ถูกต้อง` }, { status: 400 })
    }
    const vouchers = Array.isArray(raw?.vouchers) ? raw.vouchers.map((v) => s(v)).filter(Boolean).slice(0, 20) : []
    const cur = want.get(code)
    if (cur) {
      cur.amount = Math.round((cur.amount + amount) * 100) / 100
      for (const v of vouchers) if (!cur.vouchers.includes(v)) cur.vouchers.push(v)
    } else {
      want.set(code, { amount, vouchers })
    }
  }
  const codes = [...want.keys()]

  const client = await clientPromise
  const atms = client.db("atms")
  const md = writeDb(client)
  const [heads, tracks] = await Promise.all([
    atms.collection("deposit_header").find({ deposit_code: { $in: codes } },
      { projection: { _id: 0, deposit_code: 1, supplier: 1, amount: 1, warehouse: 1, received_at: 1 } }).maxTimeMS(20_000).toArray() as Promise<Doc[]>,
    md.collection(COLL).find({ depositCode: { $in: codes } },
      { projection: { _id: 0, depositCode: 1, "review.status": 1, paid: 1, voucherNos: 1 } }).maxTimeMS(20_000).toArray() as Promise<Doc[]>,
  ])
  const headBy = new Map(heads.map((h) => [s(h.deposit_code), h]))
  const trackBy = new Map(tracks.map((t) => [s(t.depositCode), t]))

  const at = new Date().toISOString()
  const results: Result[] = []
  const ops: Parameters<ReturnType<typeof writeDb>["collection"]>[0] extends never ? never[] : Record<string, unknown>[] = []

  for (const code of codes) {
    const file = want.get(code)!
    const head = headBy.get(code)
    const track = trackBy.get(code)
    const base: Result = { depositCode: code, action: "skip", fileAmount: file.amount, supplier: s(head?.supplier) }
    if (!head) {
      results.push({ ...base, reason: "ไม่พบใบนี้ในระบบ ATMS" })
      continue
    }
    const headAmount = parseAmount(head.amount)
    base.headAmount = headAmount
    const review = s((track?.review as { status?: string } | undefined)?.status)
    const paid = track?.paid as { paymentNos?: string[]; date?: string; source?: string } | undefined

    if (apPaidConfirmed(paid)) {
      const same = s(paid?.date) === roundDate
      results.push({ ...base, action: same ? "same" : "skip", stage: "จ่ายแล้ว",
        reason: same ? `บันทึกรอบนี้ไปแล้ว (${thaiDate(roundDate)})` : `จ่ายแล้วด้วยข้อมูลอื่น (${thaiDate(s(paid?.date))}${paid?.paymentNos?.length ? ` · PV ${paid.paymentNos.join(", ")}` : ""})` })
      continue
    }
    if (!track) {
      results.push({ ...base, reason: "ยังไม่มีใบนี้ในระบบติดตามเจ้าหนี้ (บัญชียังไม่ได้ตรวจผ่าน)" })
      continue
    }
    if (review === "ไม่ผ่าน") {
      results.push({ ...base, stage: "ไม่ผ่าน", reason: "บัญชีตีกลับอยู่ — ต้องแก้เอกสารและผ่านก่อน" })
      continue
    }
    if (review !== "ผ่าน") {
      results.push({ ...base, stage: review || "ยังไม่ตรวจ", reason: "บัญชียังไม่ได้กดผ่าน" })
      continue
    }

    // เตือนแต่ไม่บล็อก — เงินโอนไปแล้ว การไม่บันทึกทำให้ระบบตามความจริงไม่ทัน
    const warnings: string[] = []
    if (Math.abs(headAmount - file.amount) > AMOUNT_TOLERANCE) {
      warnings.push(`ยอดในไฟล์ ${file.amount.toLocaleString("th-TH", { minimumFractionDigits: 2 })} ต่างจากยอดหัวใบ ${headAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}`)
    }
    const known = new Set((track.voucherNos as string[] | undefined) ?? [])
    const missing = file.vouchers.filter((v) => !known.has(v))
    if (file.vouchers.length && missing.length) {
      warnings.push(`เลขตั้งหนี้ในไฟล์ไม่ตรงกับในระบบ (${missing.join(", ")})`)
    }

    results.push({ ...base, action: "write", stage: "ผ่าน", warnings: warnings.length ? warnings : undefined })
    if (!dryRun) {
      ops.push({
        updateOne: {
          filter: { depositCode: code },
          update: {
            $set: {
              paid: { date: roundDate, amount: file.amount, source: "round-file", by, at },
              updatedAt: at, updatedBy: by,
            },
            $push: {
              log: {
                $each: [{
                  action: "ยืนยันจ่ายเงินแล้ว (ไฟล์รอบโอนจากการเงิน)", field: "paid",
                  detail: `รอบโอน ${thaiDate(roundDate)} · ยอด ${file.amount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}`
                    + (file.vouchers.length ? ` · เลขตั้งหนี้ ${file.vouchers.join(", ")}` : "")
                    + (fileName ? ` · ไฟล์ ${fileName}` : ""),
                  by, byEmail, at,
                }],
                $slice: -LOG_KEEP,
              },
            },
          },
        },
      })
    }
  }

  let written = 0
  if (!dryRun && ops.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await md.collection(COLL).bulkWrite(ops as any, { ordered: false })
    written = res.modifiedCount ?? 0
  }

  const count = (a: Result["action"]) => results.filter((r) => r.action === a).length
  return NextResponse.json({
    dryRun, roundDate, written,
    summary: {
      total: results.length,
      willWrite: count("write"),
      already: count("same"),
      skipped: count("skip"),
      warnings: results.filter((r) => r.warnings?.length).length,
      amount: Math.round(results.filter((r) => r.action === "write").reduce((n, r) => n + r.fileAmount, 0) * 100) / 100,
    },
    results,
  })
}
