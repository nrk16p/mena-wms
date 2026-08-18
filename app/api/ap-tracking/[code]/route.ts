// app/api/ap-tracking/[code]/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import {
  AP_FILES_MAX, AP_NO_FIELDS, AP_REVIEW_NOTE_MAX, AP_REVIEW_STATUSES, AP_WRITABLE_DOC_KEYS, apDocLabel,
  apStatusOf, cleanDocNos, readDocNos, isDocSetComplete, missingDocLabels, reviewNeedsNote,
  type ApDocKey, type ApDocs, type ApFile, type ApReview, type ApReviewStatus,
} from "@/lib/ap-tracking"
import { normalizeImages } from "@/lib/media"
import { isAccounting } from "@/lib/roles"

export const dynamic = "force-dynamic"

const MD = process.env.MONGO_DB ?? "master_data"
const COLL = "ap_tracking"
const LOG_KEEP = 200            // เก็บ log ล่าสุดเท่านี้ต่อใบ — ไม่งั้น array โตไม่มีเพดาน
// รวมคีย์เก่า (billingNote) ไว้ด้วย — หน้าเว็บต้องล้างค่าที่ค้างจากยุคก่อนรวมช่องได้
const DOC_KEYS = new Set<string>(AP_WRITABLE_DOC_KEYS)
const SENT_TYPES = new Set(["", "นอกรอบ", "ตามรอบ"])
const s = (v: unknown) => (v == null ? "" : String(v)).trim()

// คีย์รายการสินค้า (มาจาก apItemKeys ฝั่งหน้าเว็บ) — ห้ามมี "." หรือ "$" เพราะเขียนแบบ items.<key>
// ถ้าปล่อยผ่าน จุดจะกลายเป็นการเจาะ sub-document ชั้นลึก และ $ จะถูกตีความเป็น operator
const ITEM_KEY_RE = /^[^.$\s]{1,80}$/

// ฐาน atms เป็นของ scraper อ่านอย่างเดียว · ถ้า MONGO_DB ถูกตั้งเป็น "atms" การเขียนของแอป
// จะไปทับฐานนั้นทั้งหมด — ตายตั้งแต่ตอนขอ handle ดีกว่าปล่อยให้เขียนพลาดแล้วค่อยรู้
function writeDb(client: Awaited<typeof clientPromise>) {
  if (MD === "atms") throw new Error("MONGO_DB ต้องไม่ใช่ 'atms' — ฐาน atms เป็น read-only ห้ามเขียนทับ")
  return client.db(MD)
}

// "YYYY-MM-DD" ที่เป็นวันที่จริง (ปฏิเสธ 2026-13-99 ฯลฯ) — ไม่ใช่แค่รูปแบบ
function isValidYmd(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return false
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3])
  if (month < 1 || month > 12) return false
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day >= 1 && day <= daysInMonth
}

// GET — รายละเอียดใบ DD: รายการสินค้า + PO + tracking (พร้อม log)
export async function GET(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params            // Next 16: params เป็น Promise
  const depositCode = decodeURIComponent(code).trim()
  if (!depositCode) return NextResponse.json({ error: "ไม่พบเลขที่ใบรับของ" }, { status: 400 })

  const client = await clientPromise
  const atms = client.db("atms"), md = writeDb(client)

  const head = await atms.collection("deposit_header").findOne(
    { deposit_code: depositCode },
    { projection: { _id: 0, deposit_id: 1, purchase_order: 1 } },
  )
  const [tracking, items, po] = await Promise.all([
    md.collection(COLL).findOne({ depositCode }, { projection: { _id: 0 } }),
    head?.deposit_id != null
      ? atms.collection("deposit_items").find({ deposit_id: head.deposit_id }, { projection: { _id: 0 } }).limit(300).toArray()
      : [],
    head?.purchase_order
      ? atms.collection("purchase_orders").findOne({ "รหัส": s(head.purchase_order) }, { projection: { _id: 0 } })
      : null,
  ])
  return NextResponse.json({ tracking: tracking ?? null, items, po })
}

// PATCH — บันทึกการติ๊ก/วันที่ส่งบัญชี/หมายเหตุ (สร้าง doc ครั้งแรกแบบ lazy) + ลง log ทุกครั้ง
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params
  const depositCode = decodeURIComponent(code).trim()
  if (!depositCode) return NextResponse.json({ error: "ไม่พบเลขที่ใบรับของ" }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const session = await getServerSession(authOptions)
  const by = session?.user?.name || session?.user?.email || ""
  const byEmail = session?.user?.email || ""
  const at = new Date().toISOString()

  const client = await clientPromise
  const col = writeDb(client).collection(COLL)
  const current = await col.findOne({ depositCode })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const set: Record<string, any> = { depositCode, updatedAt: at, updatedBy: by }
  const log: Record<string, string>[] = []

  // ติ๊กแต่ละช่องเขียนแบบ dotted path (docs.<key>) แทนการแทนที่ทั้ง object —
  // กัน race เวลาสองคนติ๊กคนละช่องพร้อมกันแล้วคนหลังทับคนแรก
  // สถานะ "หลัง" การติ๊กของคำขอนี้ — คำขอเดียวอาจติ๊กช่องสุดท้ายพร้อมลงวันส่งบัญชีมาด้วยกัน
  // จึงต้องตรวจความครบชุดกับ nextDocs ไม่ใช่ของเดิมใน DB
  const nextDocs: ApDocs = { ...((current?.docs ?? {}) as ApDocs) }

  if (body?.docs && typeof body.docs === "object") {
    for (const [k, v] of Object.entries(body.docs as Record<string, unknown>)) {
      if (!DOC_KEYS.has(k)) return NextResponse.json({ error: `ช่องเอกสารไม่ถูกต้อง: ${k}` }, { status: 400 })
      if (typeof v !== "boolean") return NextResponse.json({ error: `ค่าของ ${k} ต้องเป็นจริง/เท็จ` }, { status: 400 })
    }
    for (const [k, v] of Object.entries(body.docs as Record<string, boolean>)) {
      const checked = v
      const key = k as ApDocKey
      set[`docs.${key}`] = { checked, by, at }
      nextDocs[key] = { checked, by, at }
      log.push({ action: checked ? "ติ๊ก" : "ยกเลิกติ๊ก", field: k, by, byEmail, at })
    }
  }

  // เลขที่เอกสาร 4 ช่อง — ช่องหนึ่งมีได้หลายเลข ส่งมาทั้งลิสต์แล้วแทนที่ทั้งชุดของช่องนั้น
  // (ลิสต์สั้นและแก้จากหน้าจอเดียว การเขียนทีละ index จะยุ่งกว่าโดยไม่ได้อะไร)
  // แต่ละช่องเขียนแยกคีย์ — ส่งมาเฉพาะช่องที่แก้ ช่องที่ไม่ได้ส่งมาไม่ถูกแตะ
  for (const f of AP_NO_FIELDS) {
    const raw = body?.[f.key]
    if (raw === undefined) continue
    if (!Array.isArray(raw)) {
      return NextResponse.json({ error: `${f.key} ต้องเป็น array` }, { status: 400 })
    }
    if (raw.some((x: unknown) => typeof x !== "string")) {
      return NextResponse.json({ error: `${f.label}ต้องเป็นข้อความ` }, { status: 400 })
    }
    const nos = cleanDocNos(raw)
    const prev = cleanDocNos(current?.[f.key])
    if (nos.join("|") !== prev.join("|")) {   // ไม่เปลี่ยน = ไม่เขียน ไม่ลง log
      set[f.key] = nos
      log.push({ action: `แก้${f.label}`, field: f.key,
        detail: nos.length ? nos.join(", ") : "(ล้างค่า)", by, byEmail, at })
    }
  }

  // บัญชีตรวจเอกสาร — ผ่าน / ไม่ผ่าน (+ เหตุผลเมื่อไม่ผ่าน) · เฉพาะฝ่ายบัญชีเท่านั้น
  // ตรวจที่นี่ด้วย ไม่ใช่แค่ซ่อนปุ่มฝั่งหน้าเว็บ — ปุ่มที่ซ่อนไว้ไม่ได้กันการยิง API ตรง
  if (body?.review && typeof body.review === "object") {
    if (!isAccounting(session?.user?.email, session?.user?.employee?.department)) {
      return NextResponse.json({ error: "เฉพาะฝ่ายบัญชีเท่านั้นที่บันทึกผลตรวจเอกสารได้" }, { status: 403 })
    }
    const rv = body.review as { status?: unknown; note?: unknown }
    const status = s(rv.status)
    const note   = s(rv.note).slice(0, AP_REVIEW_NOTE_MAX)
    if (status && !AP_REVIEW_STATUSES.includes(status as ApReviewStatus)) {
      return NextResponse.json({ error: "สถานะตรวจเอกสารต้องเป็น ผ่าน หรือ ไม่ผ่าน" }, { status: 400 })
    }
    if (reviewNeedsNote(status, note)) {
      return NextResponse.json({ error: "ตีกลับต้องระบุเหตุผลว่าไม่ผ่านเพราะอะไร" }, { status: 400 })
    }
    const cur = (current?.review ?? {}) as ApReview
    if (status !== s(cur.status) || note !== s(cur.note)) {
      // เก็บคนตรวจ+เวลาไว้ในก้อนเดียวกัน — ล้างสถานะ (กลับไป "ยังไม่ตรวจ") ก็ล้างคนตรวจด้วย
      set.review = status ? { status, note, by, at } : { status: "", note: "", by: "", at: "" }
      log.push({
        action: status ? `บัญชีตรวจเอกสาร: ${status}` : "ล้างผลตรวจเอกสาร",
        field: "review", detail: note, by, byEmail, at,
      })
    }
  }

  // ติ๊ก "หลักฐาน/ออกบิลแล้ว" รายรายการสินค้า — dotted path items.<key> เหมือนช่องเอกสาร
  // (คนละคนเปิดคนละรายการพร้อมกันได้ ต้องไม่ทับกันทั้งก้อน)
  if (body?.items && typeof body.items === "object") {
    for (const [k, v] of Object.entries(body.items as Record<string, unknown>)) {
      if (!ITEM_KEY_RE.test(k)) return NextResponse.json({ error: `คีย์รายการสินค้าไม่ถูกต้อง: ${k}` }, { status: 400 })
      if (typeof v !== "boolean") return NextResponse.json({ error: `ค่าของรายการ ${k} ต้องเป็นจริง/เท็จ` }, { status: 400 })
    }
    for (const [k, v] of Object.entries(body.items as Record<string, boolean>)) {
      set[`items.${k}`] = { checked: v, by, at }
      log.push({ action: v ? "ติ๊กหลักฐานรายการ" : "ยกเลิกหลักฐานรายการ", field: `item:${k}`, by, byEmail, at })
    }
  }

  // ไฟล์แนบ — ส่งมาทั้งชุด (แทนที่ทั้ง array) ต่างจากช่องติ๊กที่เขียนทีละ path
  // เพราะการแนบ/ลบไฟล์เกิดนาน ๆ ครั้งและมาจากหน้าจอเดียว โอกาสชนกันต่ำกว่ามาก
  // normalizeImages ต้องเรียกฝั่งเซิร์ฟเวอร์เสมอ (ชื่อไฟล์ที่มี # เคยทำ URL พัง — กันที่ชั้นนี้ชั้นเดียว)
  if (body?.files !== undefined) {
    if (!Array.isArray(body.files)) return NextResponse.json({ error: "files ต้องเป็น array" }, { status: 400 })
    if (body.files.length > AP_FILES_MAX) {
      return NextResponse.json({ error: `แนบไฟล์ได้ไม่เกิน ${AP_FILES_MAX} ไฟล์ต่อใบ` }, { status: 400 })
    }
    const clean: ApFile[] = []
    for (const raw of normalizeImages(body.files)) {
      const url = s(raw?.webpUrl)
      const docType = s(raw?.docType)
      if (!url) return NextResponse.json({ error: "ไฟล์แนบไม่มี URL" }, { status: 400 })
      if (docType && !DOC_KEYS.has(docType)) {
        return NextResponse.json({ error: `ประเภทเอกสารไม่ถูกต้อง: ${docType}` }, { status: 400 })
      }
      clean.push({
        mediaId: typeof raw?.mediaId === "number" ? raw.mediaId : 0,
        batchId: s(raw?.batchId),
        filename: s(raw?.filename),
        webpUrl: url,
        thumbnailUrl: s(raw?.thumbnailUrl),
        docType: docType as ApDocKey | "",
        by: s(raw?.by) || by,
        at: s(raw?.at) || at,
      })
    }

    const before = new Map<string, ApFile>(
      ((current?.files ?? []) as ApFile[]).map((f) => [s(f.webpUrl), f] as [string, ApFile]),
    )
    const added  = clean.filter((f) => !before.has(f.webpUrl))
    for (const f of added) {
      log.push({ action: "แนบไฟล์", field: "file", detail: `${f.filename}${f.docType ? ` (${apDocLabel(f.docType)})` : ""}`, by, byEmail, at })
    }
    const afterUrls = new Set(clean.map((f) => f.webpUrl))
    for (const [url, f] of before) {
      if (!afterUrls.has(url)) log.push({ action: "ลบไฟล์", field: "file", detail: s(f.filename), by, byEmail, at })
    }
    for (const f of clean) {
      const old = before.get(f.webpUrl)
      if (old && s(old.docType) !== f.docType) {
        log.push({ action: "เปลี่ยนประเภทไฟล์", field: "file",
          detail: `${f.filename}: ${apDocLabel(s(old.docType)) || "ไม่ระบุ"} → ${f.docType ? apDocLabel(f.docType) : "ไม่ระบุ"}`,
          by, byEmail, at })
      }
    }
    set.files = clean

    // แนบไฟล์ประเภทไหนเข้ามาใหม่ = มีเอกสารตัวจริงแล้ว → ติ๊กช่องนั้นให้เลย (ถ้ายังไม่ติ๊ก)
    // ทำเฉพาะไฟล์ที่ "เพิ่งเพิ่มในคำขอนี้" — ไม่งั้นคนที่ตั้งใจเอาติ๊กออกจะโดนติ๊กกลับทุกครั้งที่บันทึก
    for (const f of added) {
      const k = f.docType as ApDocKey
      if (k && !nextDocs[k]?.checked) {
        set[`docs.${k}`] = { checked: true, by, at }
        nextDocs[k] = { checked: true, by, at }
        log.push({ action: "ติ๊กอัตโนมัติจากไฟล์แนบ", field: k, by, byEmail, at })
      }
    }
  }

  if (body?.sentType !== undefined || body?.sentDate !== undefined) {
    const bodySentType = body?.sentType !== undefined ? s(body.sentType) : undefined
    const sentType = s(bodySentType ?? current?.sentType)
    const sentDate = s(body?.sentDate ?? current?.sentDate)
    if (!SENT_TYPES.has(sentType)) return NextResponse.json({ error: "sentType ต้องเป็น นอกรอบ หรือ ตามรอบ" }, { status: 400 })
    if (sentDate && !isValidYmd(sentDate)) return NextResponse.json({ error: "sentDate ต้องเป็น YYYY-MM-DD" }, { status: 400 })
    if (sentDate && !sentType) return NextResponse.json({ error: "ต้องเลือกว่าเป็น นอกรอบ หรือ ตามรอบ" }, { status: 400 })
    // ระบุ sentType โดยไม่มี sentDate (ทั้งจาก body และของเดิม) = ค่าจะถูกทิ้งเงียบๆ ไม่ยอมให้ทำ
    if (bodySentType && !sentDate) return NextResponse.json({ error: "ต้องระบุ sentDate เมื่อเลือก sentType" }, { status: 400 })
    // หัวใจของฟีเจอร์: ส่งบัญชีได้ต่อเมื่อประกบเอกสารครบชุด (✓DD + ✓PO + การเงิน ≥1)
    // ถ้าปล่อยผ่าน ใบที่เอกสารยังไม่ครบจะถูกมาร์คว่าส่งแล้วและหลุดออกจากยอดเกินกำหนดไปด้วย
    // การล้างวันที่ (sentDate = "") ต้องทำได้เสมอ — ยกเลิก/แก้ที่ลงผิดไว้
    if (sentDate && !isDocSetComplete(nextDocs)) {
      return NextResponse.json(
        { error: `ส่งบัญชีไม่ได้ — เอกสารยังไม่ครบชุด ขาด: ${missingDocLabels(nextDocs).join(", ")}` },
        { status: 409 },
      )
    }

    const hadSentDate = Boolean(s(current?.sentDate))
    set.sentType = sentDate ? sentType : ""
    set.sentDate = sentDate
    // เวลาที่ "คนกดส่ง" — ต่างจาก sentDate ซึ่งคือวันที่เงินจะออก (พฤหัสนอกรอบ/วันครบกำหนด)
    // เก็บเป็นฟิลด์เพราะ API ตารางตัด log ทิ้ง (projection log:0) จึงอ่านจาก log ไม่ได้
    // แก้วันโอนของใบที่ส่งไปแล้วต้องไม่รีเซ็ตเวลากดส่งเดิม — ไม่งั้นใบเก่าจะเด้งมากองวันนี้ทั้งหมด
    if (sentDate) {
      if (!hadSentDate) set.sentMarkedAt = at
      log.push({ action: `ส่งบัญชี (${sentType})`, field: "sent", detail: sentDate, by, byEmail, at })
    } else if (hadSentDate) {
      set.sentMarkedAt = ""
      // ยกเลิกจริง (เคยมี sentDate มาก่อน) เท่านั้นถึงจะลง log — ล้างค่าที่ว่างอยู่แล้วไม่ควรลง log หลอกๆ
      log.push({ action: "ยกเลิกส่งบัญชี", field: "sent", detail: sentDate, by, byEmail, at })
    }
  }

  if (body?.note !== undefined) {
    set.note = s(body.note).slice(0, 500)
    log.push({ action: "แก้หมายเหตุ", field: "note", detail: set.note, by, byEmail, at })
  }

  if (!log.length) return NextResponse.json({ error: "ไม่มีข้อมูลให้บันทึก" }, { status: 400 })

  // findOneAndUpdate คืน state หลังเขียนจริง (ไม่ใช่ค่าที่ merge เองในหน่วยความจำ) กัน response
  // เพี้ยนจาก DB จริงเวลามีคนอื่นเขียนแทรกระหว่างนี้
  const doc = await col.findOneAndUpdate(
    { depositCode },
    // $slice: -LOG_KEEP → เก็บเฉพาะ log ล่าสุด กัน document โตชนเพดาน 16MB ของ BSON
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { $set: set, $push: { log: { $each: log, $slice: -LOG_KEEP } }, $setOnInsert: { createdAt: at, createdBy: by } } as any,
    { upsert: true, returnDocument: "after" },
  )

  if (!doc) return NextResponse.json({ error: "บันทึกไม่สำเร็จ" }, { status: 500 })

  const docsOut = (doc.docs ?? {}) as ApDocs
  const sentDateOut = s(doc.sentDate)
  return NextResponse.json({
    ok: true,
    docs: docsOut,
    ...readDocNos(doc),
    sentMarkedAt: s(doc.sentMarkedAt),
    review: (doc.review ?? { status: "", note: "" }) as ApReview,
    items: (doc.items ?? {}) as Record<string, unknown>,
    files: (doc.files ?? []) as ApFile[],
    sentType: s(doc.sentType),
    sentDate: sentDateOut,
    note: s(doc.note),
    status: apStatusOf(docsOut, sentDateOut),
  })
}
