// app/api/ap-tracking/route.ts
import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import {
  parseDmy, parseAmount, dueDateOf, overdueDays, apStatusOf, apStage, apUrgency, nextThursday, todayICT,
  AP_STAGES, compactDocNos, docNosText, ictDate,
  apSinceOf, inApScope, monthInApScope,
  type ApDocs, type ApStage, type ApStatus,
} from "@/lib/ap-tracking"

export const dynamic = "force-dynamic"

const MD = process.env.MONGO_DB ?? "master_data"
type Doc = Record<string, unknown>
const s = (v: unknown) => (v == null ? "" : String(v)).trim()

// เวลากดส่งบัญชีของแถวหนึ่ง — คืน object ว่างเมื่อยังไม่เคยกดส่ง เพื่อไม่ให้คีย์เปล่าไปกิน payload
// (ฝั่งหน้าเว็บอ่านเป็น optional อยู่แล้ว — ดู ApRow)
function sentMarkedOf(at: string, by: string) {
  return at ? { sentMarkedAt: at, sentMarkedBy: by, sentMarkedDate: ictDate(at) } : {}
}

// regex จับ received_at รูป "DD/MM/YYYY" หรือ "DD/MM/YYYY HH:mm" ของเดือนที่ต้องการ
// (ฟิลด์เป็น string ใน ATMS และแทบทุกแถวมีเวลาต่อท้ายวันที่ — ต้องยอมรับ suffix เวลาแบบมีขอบเขต
// ไม่ใช่เปิดโล่งท้าย pattern และต้องรองรับเดือน/วันแบบไม่เติมศูนย์ เช่น "1/6/2026 9:05")
// month มาจาก `month` ที่ผ่านการ validate เป็น ^\d{4}-(0[1-9]|1[0-2])$ แล้วเสมอ จึงไม่มีความเสี่ยง injection
const monthRe = (ym: string) => {
  const [y, m] = ym.split("-")
  const mm = String(Number(m)) // "06" -> "6" เพื่อจับได้ทั้งแบบเติมศูนย์และไม่เติมศูนย์
  return new RegExp(`^\\d{1,2}/0?${mm}/${y}(?:\\s.*)?$`)
}
const prevMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number)
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (i + 1), 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
  })
}

// GET /api/ap-tracking?month=YYYY-MM&carryover=1&carryoverMonths=6&warehouse=&supplier=&status=&q=&limit=&includeInternal=
//
// carryover ปิดเป็นค่าตั้งต้นตั้งแต่ 18/08/2026 — หน้าโหลด "ทีละเดือน" ตามที่ผู้ใช้สั่ง
// เหตุผล: พอย้าย go-live มา 01/01/2026 ทุกเดือนเข้าสโคปหมด การลากใบค้างยกมา 6 เดือนทำให้
// เปิดเดือน ก.ค. ได้ 12,018 แถว = response ~7.2MB ซึ่งเกินเพดาน 4.5MB ของ Vercel Function
// (วัดจริง: แถวละ 628 bytes) → หน้าพังทั้งหน้า ไม่ใช่แค่ช้า
// ทีละเดือนแล้วเดือนใหญ่สุด (มิ.ย. 1,827 แถว) เหลือ ~1.1MB · ข้อมูลยังมีครบทุกเดือน เปิดดูได้ทุกเดือน
// แลกกับ: ใบค้างของเดือนก่อนไม่โผล่ในเดือนที่เปิดอยู่ ต้องเปิดเดือนของมันเอง
// ขอแบบเดิมได้ด้วย ?carryover=1 (ระวังขนาด response ถ้าช่วงกว้าง)
export async function GET(req: NextRequest) {
  try {
    const sp        = req.nextUrl.searchParams
    const today     = todayICT()
    const rawMonth  = sp.get("month")?.trim() || today.slice(0, 7)
    const month     = /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth) ? rawMonth : today.slice(0, 7)
    const carryover = sp.get("carryover") === "1"
    const warehouse = sp.get("warehouse")?.trim() ?? ""
    const supplier  = sp.get("supplier")?.trim()  ?? ""
    const status    = sp.get("status")?.trim()    ?? ""
    const q         = sp.get("q")?.trim()         ?? ""
    const includeInternal = sp.get("includeInternal") === "1"
    const limitRaw  = parseInt(sp.get("limit") || "", 10)
    // เพดานแถว — วัดจริง 18/08/2026: deposit_header มี 16,099 ใบ (ตัดคืนสต๊อกภายในแล้ว 13,017)
    // และเป็นเดือน ม.ค.–ส.ค. 69 ทั้งหมด · โหลดทีละเดือนแล้วเดือนใหญ่สุดคือ มิ.ย. 1,827 แถว
    // เพดานนี้จึงเหลือเฟือมากสำหรับการใช้งานปกติ และยังกันไว้เผื่อ ?carryover=1 ที่ช่วงกว้างกว่า
    // ยังเป็นเพดานจริง ไม่ใช่ unbounded — และแถบเตือน truncated ยังทำงานถ้าวันหนึ่งชนขึ้นมา
    const limit     = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 25000) : 20000
    // ใบค้างที่เก่ากว่าหน้าต่างนี้จะไม่โผล่ในทุก view (UI ไม่มีทางเปิดเดือนของมันเอง) — ให้ปรับได้ 1–12 เดือน
    const cmRaw     = parseInt(sp.get("carryoverMonths") || "", 10)
    const carryoverMonths = Number.isInteger(cmRaw) && cmRaw >= 1 && cmRaw <= 12 ? cmRaw : 6
    // เส้น go-live — ใบก่อนวันนี้เป็นของกระบวนการ Excel เดิม (ดูเหตุผลเต็มที่ AP_GO_LIVE)
    // เปิดย้อนหลังได้ด้วย ?since=YYYY-MM-DD (ต้องเป็นวันที่จริง ไม่งั้นถอยไปใช้ค่า go-live)
    const since     = apSinceOf(sp.get("since"))

    const client = await clientPromise
    const atms   = client.db("atms")
    // atms = ฐาน scraper อ่านอย่างเดียว · ถ้า MONGO_DB ถูกตั้งเป็น "atms" เมื่อไหร่ route เขียนของแอป
    // จะไปเขียนทับฐานนั้น — ตายตั้งแต่ตอนขอ handle ดีกว่าปล่อยให้เขียนพลาด
    if (MD === "atms") {
      console.error("[ap-tracking] MONGO_DB ถูกตั้งเป็น 'atms' — ฐานเขียนต้องแยกจากฐานอ่าน")
      return NextResponse.json({ error: "ตั้งค่าผิดพลาด: MONGO_DB ต้องไม่ใช่ 'atms' (ฐานอ่านอย่างเดียว)" }, { status: 500 })
    }
    const md     = client.db(MD)

    // 1) แถว DD ของเดือนที่เลือก (+ ย้อนหลัง carryoverMonths เดือนสำหรับใบค้าง) — bounded เสมอ
    // เดือนที่จบไปทั้งเดือนก่อน go-live ตัดทิ้งตั้งแต่ตอนประกอบ $or — ไม่ต้องให้ Mongo สแกนหาเลย
    // (นี่คือตัวที่ทำให้เปิดหน้าแล้วได้ 11,203 แถว/8.4 วิ และเดือน ก.ค. ชนเพดานจนข้อมูลถูกตัด)
    const months  = (carryover ? [month, ...prevMonths(month, carryoverMonths)] : [month])
      .filter((m) => monthInApScope(m, since))

    // ทุกเดือนในหน้าต่างอยู่ก่อน go-live หมด = ไม่มีอะไรให้ดูจริง ๆ — คืนผลว่างโดยไม่ยิงคิวรี
    // ($or: [] เป็น error ของ Mongo ด้วย ห้ามปล่อยให้หลุดไปถึงฐานข้อมูล)
    if (!months.length) {
      return NextResponse.json({ rows: [], summary: emptySummary(limit, since, todayICT()) })
    }

    const match: Record<string, unknown> = { $or: months.map((m) => ({ received_at: { $regex: monthRe(m) } })) }
    if (warehouse) match.warehouse = warehouse
    if (supplier)  match.supplier  = supplier
    // แถวคืนสต๊อกภายใน (supplier ว่างและ purchase_order ว่างทั้งคู่ ใช้ withdraw_ref แทน) ไม่ใช่ใบเจ้าหนี้ค้างจ่าย
    // — ตัดออกจากผลลัพธ์เริ่มต้นตั้งแต่ชั้น query กัน flood หน้าติดตามเจ้าหนี้ ขอดูได้ด้วย includeInternal=1
    if (!includeInternal) match.$nor = [{ supplier: "", purchase_order: "" }]

    // เรียง "ล่าสุดก่อน" ต้องแปลง received_at (string "DD/MM/YYYY HH:mm") เป็น date จริงก่อน —
    // sort ตรง ๆ บน string จะเรียงตามวันของเดือน (31/07 มาก่อน 04/08) และถ้าไม่ sort เลย Mongo
    // คืนตาม natural order = เดือนเก่าสุดกินโควตา limit จนเดือนปัจจุบันหายทั้งเดือน (pattern เดียวกับ /api/pr)
    // onError/onNull: null → แถวที่แปลงไม่ได้กลายเป็น null (BSON เรียง null < date) จึงไปอยู่ท้ายสุดของ
    // sort แบบ -1 และถูก limit ตัดก่อน ไม่ทำให้ทั้ง query พังหรือหน้าว่าง
    const heads = await atms.collection("deposit_header").aggregate([
      { $match: match },
      { $addFields: { _sortDate: { $dateFromString: { dateString: "$received_at", format: "%d/%m/%Y %H:%M", onError: null, onNull: null } } } },
      { $sort: { _sortDate: -1, _id: -1 } },
      { $limit: limit },
      { $unset: "_sortDate" },
      { $project: {
        _id: 0, deposit_id: 1, deposit_code: 1, warehouse: 1, purchase_order: 1,
        supplier: 1, supplier_ref_no: 1, amount: 1, created_at: 1, received_at: 1,
      } },
    ]).toArray() as Doc[]

    const codes    = heads.map((h) => s(h.deposit_code)).filter(Boolean)
    const poCodes  = [...new Set(heads.map((h) => s(h.purchase_order)).filter(Boolean))]
    const supNames = [...new Set(heads.map((h) => s(h.supplier)).filter(Boolean))]

    // 2) overlay: tracking + เครดิตเทอม + ข้อมูล PO (ทุกอันจำกัดด้วย $in จากชุดข้างบน)
    const [tracks, sups, pos] = await Promise.all([
      codes.length ? md.collection("ap_tracking").find({ depositCode: { $in: codes } }, { projection: { _id: 0, log: 0 } }).toArray() as Promise<Doc[]> : [],
      supNames.length ? md.collection("ap_supplier").find({ name: { $in: supNames } }, { projection: { _id: 0, name: 1, creditTerm: 1 } }).toArray() as Promise<Doc[]> : [],
      poCodes.length ? atms.collection("purchase_orders").find({ "รหัส": { $in: poCodes } }, { projection: { _id: 0, "รหัส": 1, "รวม": 1, "กำหนดส่งสินค้า": 1, "สถานะการรับสินค้า": 1 } }).toArray() as Promise<Doc[]> : [],
    ])
    const trackBy = new Map(tracks.map((t) => [s(t.depositCode), t]))
    const termBy  = new Map(sups.map((x) => [s(x.name), s(x.creditTerm)]))
    const poBy    = new Map(pos.map((p) => [s(p["รหัส"]), p]))

    // 3) ประกอบแถว + คำนวณสถานะ
    const monthPrefix = month
    let rows = heads.map((h) => {
      const code       = s(h.deposit_code)
      const t          = trackBy.get(code)
      const docs       = (t?.docs ?? {}) as ApDocs
      const sentDate   = s(t?.sentDate)
      const receivedAt = parseDmy(h.received_at)
      const creditTerm = termBy.get(s(h.supplier)) ?? ""
      const dueDate    = dueDateOf(receivedAt, creditTerm)
      const po         = poBy.get(s(h.purchase_order))
      return {
        depositCode: code,
        depositId:   typeof h.deposit_id === "number" ? h.deposit_id : null,
        warehouse:   s(h.warehouse),
        purchaseOrder: s(h.purchase_order),
        supplier:    s(h.supplier),
        supplierRefNo: s(h.supplier_ref_no),
        amount:      parseAmount(h.amount),
        receivedAt,
        createdAt:   parseDmy(h.created_at),
        creditTerm, dueDate,
        overdue:     sentDate ? 0 : overdueDays(dueDate, today),
        docs,
        // ส่งแค่ "จำนวน" ไฟล์แนบ ไม่ส่งตัว object (ตารางใช้แค่ตัวเลข · โมดัลค่อยดึงของจริงรายใบ)
        fileCount:   Array.isArray(t?.files) ? (t!.files as unknown[]).length : 0,
        // ผลตรวจของบัญชี — ตารางโชว์เป็นป้าย (เหตุผลอยู่ใน tooltip) จึงส่งไปทั้งสถานะและหมายเหตุ
        review:      (t?.review ?? { status: "", note: "" }) as { status: string; note: string },
        sentType:    s(t?.sentType),
        sentDate,
        // เลขที่เอกสารทั้ง 4 ช่อง — อยู่ใน doc ที่ดึงมาแล้ว (projection ตัดแค่ log) ไม่มีคิวรีเพิ่ม
        // ส่งมาด้วยเพื่อให้ค้นหาด้วยเลขบิล/ใบกำกับเจอโดยไม่ต้องเปิดโมดัลทีละใบ
        // ตัดช่องที่ว่างทิ้ง — payload ระดับหมื่นแถวไม่ควรแบกคีย์เปล่า 4 ตัวต่อแถว
        docNos:      compactDocNos(t),
        // เวลาที่จัดซื้อกดเปลี่ยนสถานะเป็น "ส่งบัญชีแล้ว" (คนละตัวกับ sentDate = วันเงินออก)
        // sentMarkedDate คือวันเดียวกันในเวลาไทย — ใช้เป็นคีย์จัดกลุ่ม/กรองฝั่งหน้าเว็บ
        // ใส่เฉพาะใบที่กดส่งแล้ว (ส่วนน้อยของทั้งชุด) — 3 คีย์ว่างคูณหมื่นแถวคือ payload เปล่า ๆ ~0.7MB
        ...sentMarkedOf(s(t?.sentMarkedAt), s(t?.sentMarkedBy)),
        // กำหนดจ่ายที่บัญชียืนยันตอนกดผ่าน — ส่งเฉพาะใบที่มี (ส่วนน้อย) ไม่แบกคีย์ว่างทั้งตาราง
        ...(t?.pay ? { pay: t.pay } : {}),
        note:        s(t?.note),
        status:      apStatusOf(docs, sentDate),
        carryover:   receivedAt.slice(0, 7) !== monthPrefix,
        poTotal:     parseAmount(po?.["รวม"]),
        poDue:       parseDmy(po?.["กำหนดส่งสินค้า"]),
        poStatus:    s(po?.["สถานะการรับสินค้า"]),
      }
    })

    // เดือนที่ "คร่อม" เส้น go-live จะมีทั้งใบในสโคปและนอกสโคปปนกัน — ตัดรายแถวอีกชั้น
    // (ค่า default 2026-08-01 ตรงต้นเดือนพอดี เดือนอื่นจึงไม่โดน แต่ ?since= กลางเดือนจะได้ผลถูกต้อง)
    rows = rows.filter((r) => inApScope(r.receivedAt, since))

    // คำค้นกรองทั้งยอดสรุปและตาราง (คลัง/ซัพพลายเออร์ถูกกรองไปแล้วตั้งแต่ $match)
    // — ยอดสรุปต้องคิดจาก "ชุดเดียวกับที่ผู้ใช้กำลังมอง" ไม่งั้นตัวเลขบนแถบสรุปขัดกับตารางข้างล่าง
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      rows = rows.filter((r) => rx.test(r.depositCode) || rx.test(r.purchaseOrder) || rx.test(r.supplier)
        || rx.test(r.supplierRefNo) || rx.test(docNosText(r.docNos)))
    }
    rows.sort((a, b) => (b.receivedAt || "").localeCompare(a.receivedAt || "") || b.depositCode.localeCompare(a.depositCode))

    // "แถวที่คืนไปแสดงในตาราง" กับ "แถวที่เอาไปคิดยอดสรุป" ไม่ใช่ชุดเดียวกัน — ตั้งใจให้ต่างกัน:
    //   ตาราง  = ตัดใบค้างยกมาที่ส่งบัญชีแล้วทิ้ง (จบแล้ว ไม่ต้องรก)
    //   สรุป    = ยังนับใบค้างยกมาที่ "ส่งบัญชีในเดือนที่กำลังดูอยู่" ด้วย
    // ถ้าตัดออกก่อนคิดสรุป ยอด "เข้าโอนพฤหัสนี้" จะขาดไปทั้งใบ เช่น ใบวันที่ 25/07 ที่ติ๊กครบแล้ว
    // ตั้งนอกรอบ 14/08 — เปิดหน้าเดือน 08 เพื่อรวมยอดโอนวันพฤหัส แล้วโอนขาดไปเท่ายอดใบนั้น
    const sentInView  = (r: typeof rows[number]) => r.sentDate.slice(0, 7) === month
    const showInTable = (r: typeof rows[number]) => !r.carryover || r.status !== "ส่งบัญชีแล้ว"
    const countRows   = rows.filter((r) => showInTable(r) || sentInView(r))
    rows = rows.filter(showInTable)

    // 4) summary — คิดจาก countRows (ซูเปอร์เซ็ตของ rows) ไม่ใช่ rows
    const blank = () => ({ n: 0, amount: 0 })
    const byStatus: Record<string, { n: number; amount: number }> = {
      "รอประกบ": blank(), "ครบชุด": blank(), "ส่งบัญชีแล้ว": blank(),
    }
    // noTerm = ยังไม่ส่งบัญชีและ "ไม่รู้กำหนดชำระ" เพราะซัพพลายเออร์ยังไม่มีเครดิตเทอมใน master
    // (วัดจริงเดือน ก.ค. 2026: ~35% ของชื่อไม่มีใน master) — เอาไปกองรวมกับ notDue จะกลายเป็นรายงานลวง
    const overdue = blank(), unsentAging = { notDue: blank(), due7: blank(), overdue: blank(), noTerm: blank() }
    // นับต่อ "ขั้นของงาน" — แกนหลักของหน้า (แท็บ) · 1 ใบนับที่เดียว จึงบวกกันได้เท่ายอดรวม
    const byStage = Object.fromEntries(AP_STAGES.map((s) => [s.key, blank()])) as Record<ApStage, { n: number; amount: number }>
    const thu = nextThursday(today)
    const thisThursday = { date: thu, n: 0, amount: 0 }
    for (const r of countRows) {
      const b = byStatus[r.status]; b.n++; b.amount += r.amount
      const sb = byStage[apStage(r)]; sb.n++; sb.amount += r.amount
      if (r.status !== "ส่งบัญชีแล้ว") {
        // จัดกลุ่มด้วย apUrgency ตัวเดียวกับที่ตารางใช้ระบายสีแถบซ้าย — ไม่งั้นแถบสัดส่วนกับสีในตาราง
        // จะเล่าคนละเรื่องเวลาเกณฑ์ถูกแก้ที่ใดที่หนึ่ง
        const u = apUrgency(r.dueDate, r.sentDate, today)
        if (u === "overdue") { overdue.n++; overdue.amount += r.amount; unsentAging.overdue.n++; unsentAging.overdue.amount += r.amount }
        else if (u === "noTerm") { unsentAging.noTerm.n++; unsentAging.noTerm.amount += r.amount }
        else if (u === "due7") { unsentAging.due7.n++; unsentAging.due7.amount += r.amount }
        else { unsentAging.notDue.n++; unsentAging.notDue.amount += r.amount }
      }
      if (r.sentType === "นอกรอบ" && r.sentDate === thu) { thisThursday.n++; thisThursday.amount += r.amount }
    }

    // กรองสถานะเป็น "ขั้นสุดท้าย" หลังคิดยอดสรุปเสร็จแล้ว และมีผลเฉพาะแถวที่ส่งกลับไปแสดงในตาราง
    // — ชิปสถานะบนแถบสรุปคือตัวกรองสถานะเอง ถ้ากรองก่อนนับ ชิปอื่นจะกลายเป็น 0 หมดจนกดสลับไม่ได้
    if (status) rows = rows.filter((r) => r.status === status)

    const dataAsOf = heads.reduce((mx, h) => {
      const c = parseDmy(h.created_at)
      return c > mx ? c : mx
    }, "")

    // truncated ต้องเป็นจริงเฉพาะตอน "ข้อมูลที่ต้องใช้จริงหายไป" เท่านั้น
    // ผลลัพธ์เรียงใหม่→เก่า ดังนั้นที่ถูก limit ตัดทิ้งคือแถวที่เก่ากว่าแถวสุดท้ายที่ได้มาเสมอ
    // ถ้าแถวเก่าสุดที่ได้มายังอยู่ก่อน go-live อยู่แล้ว ของที่ถูกตัดยิ่งเก่ากว่า = นอกสโคปทั้งหมด ไม่ได้หาย
    const oldestHead = heads[heads.length - 1]
    const truncated  = heads.length >= limit && inApScope(parseDmy(oldestHead?.received_at), since)
    return NextResponse.json({
      rows,
      summary: {
        total: rows.length,             // จำนวนแถวในตาราง (หลังกรองสถานะ)
        counted: countRows.length,      // จำนวนแถวที่เอาไปคิดยอดสรุป (>= total)
        truncated,                      // ผลลัพธ์ถูกตัดจริง = ตัวเลขสรุปยังไม่ครบทั้งช่วง
        limit,                          // เพดานแถวที่ใช้จริง — เอาไปบอกผู้ใช้ตอน truncated
        since,                          // เส้น go-live ที่ใช้จริง (ใบก่อนวันนี้ไม่อยู่ในระบบนี้)
        byStatus: byStatus as Record<ApStatus, { n: number; amount: number }>,
        byStage,
        overdue, thisThursday, unsentAging, dataAsOf,
      },
    })
  } catch (e) {
    console.error("[ap-tracking] GET failed", e)
    return NextResponse.json({ error: "โหลดข้อมูลไม่สำเร็จ" }, { status: 500 })
  }
}

// ยอดสรุปเปล่า — ใช้ตอนไม่มีเดือนไหนอยู่ในสโคปเลย (ไม่ยิงคิวรี) · รูปร่างต้องตรงกับ path ปกติเป๊ะ
// ไม่งั้นหน้าเว็บที่อ่าน summary.* ตรง ๆ จะพังตอน field หาย
function emptySummary(limit: number, since: string, today: string) {
  const blank = () => ({ n: 0, amount: 0 })
  return {
    total: 0, counted: 0, truncated: false, limit, since,
    byStatus: { "รอประกบ": blank(), "ครบชุด": blank(), "ส่งบัญชีแล้ว": blank() } as Record<ApStatus, { n: number; amount: number }>,
    byStage: Object.fromEntries(AP_STAGES.map((s) => [s.key, blank()])) as Record<ApStage, { n: number; amount: number }>,
    overdue: blank(),
    thisThursday: { date: nextThursday(today), n: 0, amount: 0 },
    unsentAging: { notDue: blank(), due7: blank(), overdue: blank(), noTerm: blank() },
    dataAsOf: "",
  }
}

