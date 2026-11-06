/**
 * ทะเบียนยางสระบุรี (แบบชีต) — งานที่ต้องแตะฐานข้อมูล: dropdown, รายงานรอบอนุมัติ, ดึงข้อมูล ATMS
 */
import { ObjectId, type Db } from "mongodb"
import clientPromise from "@/lib/mongo"
import { splitPosition } from "@/lib/tire"
import {
  SHEET_DB, ROWS_COLL, ROUNDS_COLL, OPTIONS_COLL, EMPTY_OPTIONS, computeRow, toLife, summarizeLives,
  serialKey, toNum, sizeFromText, parseDate, isoDate, fmtDate, SPARE_SYMPTOM,
  type AnyRow, type SheetOptions, type LifeSummary, type AtmsSnapshot,
} from "@/lib/tyre-sheet"

export async function sheetDb(): Promise<Db> {
  return (await clientPromise).db(SHEET_DB)
}

export const toObjectId = (id: string) => (ObjectId.isValid(id) ? new ObjectId(id) : null)

export async function getOptions(db?: Db): Promise<SheetOptions> {
  const d = db ?? (await sheetDb())
  const doc = await d.collection(OPTIONS_COLL).findOne({ _id: "saraburi" as unknown as ObjectId })
  if (!doc) return EMPTY_OPTIONS
  return {
    drivers: doc.drivers ?? [],
    plates: doc.plates ?? [],
    plateHeadTail: doc.plateHeadTail ?? {},
    positions: doc.positions ?? [],
    tyreTypes: doc.tyreTypes?.length ? doc.tyreTypes : EMPTY_OPTIONS.tyreTypes,
    storageTypes: doc.storageTypes?.length ? doc.storageTypes : EMPTY_OPTIONS.storageTypes,
    symptoms: doc.symptoms?.length ? doc.symptoms : EMPTY_OPTIONS.symptoms,
  }
}

// ── รายงานรอบอนุมัติ (แทน [template]อนุมัติจองยาง + getDataWithSummary_Two) ─────────────────

export type Round = {
  _id?: ObjectId | string
  fromDate: string
  toDate: string
  pr: string
  preparer: string
  approver1: string
  approver2: string
  note?: string
}

export type ReportItem = {
  id: string
  kindTire: string
  position: string
  brand: string
  tireCode: string
  changeDate: string
  ageText: string
  targetMileage: number
  actualMileage: number
  mileageDiff: number
  mileageStatus: string
  tireDepth: number
  depthDiff: number
  depthStatus: string
  price: number
  bpk: number
  bline: number
  status: string
  spare: string
  typeTruck: string
  lives: LifeSummary
}

export type ReportDoc = {
  header: { customer: string; employee: string; plate: string; docNo: string; bookingDate: string; changeDate: string }
  items: ReportItem[]
  summary: { totalPrice: number; totalBpk: number; count: number; statusnormal: number; statusdefect: number }
}

const THAI_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"]

/** "1 - 31 ตุลาคม 2569" แบบเดิม — ถ้าข้ามเดือนโชว์เดือนทั้งสองฝั่ง (ของเดิมโชว์แค่เดือนแรก) */
export function approvalRoundText(fromIso: string, toIso: string): string {
  const [y1, m1, d1] = fromIso.split("-").map(Number)
  const [y2, m2, d2] = toIso.split("-").map(Number)
  if (!y1 || !y2) return ""
  if (y1 === y2 && m1 === m2) return `${d1} - ${d2} ${THAI_MONTHS[m1 - 1]} ${y1 + 543}`
  return `${d1} ${THAI_MONTHS[m1 - 1]} ${y1 + 543} - ${d2} ${THAI_MONTHS[m2 - 1]} ${y2 + 543}`
}

const num = (v: unknown) => toNum(v) ?? 0

/** แถวก่อนหน้าอยู่ "ที่เดิม" ไหม (ทะเบียนเดียวกัน + รหัสตำแหน่งเดียวกัน) */
function samePlacePrev(h: AnyRow, cur: AnyRow): boolean {
  const plate = (x: AnyRow) => String(x.plate ?? "").replace(/\s+/g, "")
  const pos = (x: AnyRow) => splitPosition(String(x.position ?? "")).code || String(x.position ?? "").replace(/\s+/g, "")
  return plate(h) === plate(cur) && pos(h) === pos(cur)
}

export async function buildRoundReport(round: Round) {
  const db = await sheetDb()
  const opts = await getOptions(db)
  const pr = round.pr.trim()
  const rows = await db.collection(ROWS_COLL)
    .find({ stage: "sent", bookingDate: { $gte: round.fromDate, $lte: round.toDate }, pr })
    .sort({ size: 1, seq: 1 })
    .limit(2000)
    .toArray()

  // ชีวิตก่อนหน้าของยางทุกเส้นในรอบ — ดึงทีเดียวด้วยกุญแจเบอร์ยาง (ไม่สนรอบ/PR/ไซซ์)
  const keys = [...new Set(rows.map((r) => serialKey(r.oldSerial)).filter((k) => k.length >= 5))]
  const history = keys.length
    ? await db.collection(ROWS_COLL)
        .find({ stage: "sent", serialKey: { $in: keys } })
        .project({ _id: 1, serialKey: 1, bookingDate: 1, seq: 1, plate: 1, position: 1, mrNo: 1, oldSerial: 1, mileagePrev: 1, mileageBooking: 1, mileageDiff: 1, fullDepth: 1, depthBooking: 1, symptom: 1, storageType: 1, price: 1, ratedKm: 1 })
        .limit(5000)
        .toArray()
    : []
  const byKey = new Map<string, AnyRow[]>()
  for (const h of history) {
    const k = String(h.serialKey)
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k)!.push(h)
  }

  const docs = new Map<string, ReportDoc>()
  const tireOverall = {
    head: { typeI: { countTire: 0, cost: 0, totalBpk: 0, avgBpk: 0 }, typeII: { countTire: 0, cost: 0, totalBpk: 0, avgBpk: 0 } },
    tail: { typeI: { countTire: 0, cost: 0, totalBpk: 0, avgBpk: 0 }, typeII: { countTire: 0, cost: 0, totalBpk: 0, avgBpk: 0 } },
  }

  for (const raw of rows) {
    const r = computeRow(raw, opts)
    const docNo = String(r.mrNo ?? "").trim() || "(ไม่มีเลขใบแจ้งซ่อม)"
    if (!docs.has(docNo)) {
      docs.set(docNo, {
        header: {
          customer: r.customer ?? "", employee: r.driver ?? "", plate: r.plate ?? "", docNo,
          bookingDate: fmtDate(r.bookingDate), changeDate: fmtDate(r.installDate),
        },
        items: [],
        summary: { totalPrice: 0, totalBpk: 0, count: 0, statusnormal: 0, statusdefect: 0 },
      })
    }
    const doc = docs.get(docNo)!
    const price = num(r.price), bpk = num(r.bpk), target = num(r.ratedKm), actual = num(r.mileageDiff)
    const depth = num(r.depthBooking)
    const mileageDiff = actual - target
    const depthDiff = depth - 3
    const symptom = String(r.symptom ?? "").trim()

    // ชีวิตทั้งหมดของเส้นนี้ เรียงเก่า → ใหม่ (ชีวิตสุดท้าย = แถวในรอบนี้)
    const key = serialKey(r.oldSerial)
    const others = (key.length >= 5 ? byKey.get(key) ?? [] : [])
      .filter((h) => String(h._id) !== String(raw._id))
      .filter((h) => (h.bookingDate ?? "") < (raw.bookingDate ?? "") || ((h.bookingDate ?? "") === (raw.bookingDate ?? "") && num(h.seq) < num(raw.seq)))
      // รถคันเดิม ตำแหน่งเดิม เบอร์เดิม = ชีตไม่มีช่องจดยางเส้นใหม่ คนกรอกเลยใช้เบอร์เก่าซ้ำ (240 จาก 280 เบอร์ที่ซ้ำ)
      // ไม่ใช่ยางเส้นเดียวกันจริง → ไม่นับเป็นชีวิตก่อนหน้า นับเฉพาะเส้นที่ย้ายรถหรือย้ายตำแหน่ง (เช่น L4212A3094)
      .filter((h) => samePlacePrev(h, raw) === false)
      .sort((a, b) => String(a.bookingDate ?? "").localeCompare(String(b.bookingDate ?? "")) || num(a.seq) - num(b.seq))
    // ชีวิตที่ติดกันแล้วอยู่ที่เดิม (ทะเบียน+ตำแหน่งเดียวกัน) = เบอร์ถูกกรอกซ้ำ เก็บแค่อันหลังสุด
    const chain: AnyRow[] = [...others, raw]
    const kept = chain.filter((h, i) => i === chain.length - 1 || !samePlacePrev(h, chain[i + 1]))
    const lives = summarizeLives(kept.map((h) => toLife(h, h === raw)))

    doc.items.push({
      id: String(raw._id),
      kindTire: r.tyreType ?? "",
      position: r.position ?? "",
      brand: r.brand ?? "",
      tireCode: r.oldSerial ?? "",
      changeDate: fmtDate(r.installDate),
      ageText: r.installDate && r.bookingDate ? `${r.ageY} ปี ${r.ageM} เดือน ${r.ageD} วัน` : (r.ageY !== null && r.ageY !== undefined ? `${num(r.ageY)} ปี ${num(r.ageM)} เดือน ${num(r.ageD)} วัน` : "-"),
      targetMileage: target,
      actualMileage: actual,
      mileageDiff,
      mileageStatus: mileageDiff === 0 ? "ตรงตามกำหนด" : mileageDiff > 0 ? "ดีกว่ากำหนด" : "ต่ำกว่ากำหนด",
      tireDepth: depth,
      depthDiff,
      depthStatus: depthDiff === 0 ? "เท่ากับ 3" : depthDiff > 0 ? "มากกว่า 3" : "น้อยกว่า 3",
      price,
      bpk,
      bline: target ? price / target : 0,
      status: symptom === SPARE_SYMPTOM ? "" : symptom,
      spare: symptom === SPARE_SYMPTOM ? "ใช้เป็นยางสำรอง" : "",
      typeTruck: r.headTail ?? "",
      lives,
    })
    doc.summary.totalPrice += price
    doc.summary.totalBpk += bpk
    doc.summary.count++
    // "ยางสำรอง" ไม่นับเป็นอาการผิดปกติ (คุยในกลุ่ม 06/11/2026)
    if (symptom === "ปกติ" || symptom === SPARE_SYMPTOM) doc.summary.statusnormal++
    else doc.summary.statusdefect++

    const part = r.headTail === "หัว" ? tireOverall.head : r.headTail === "หาง" ? tireOverall.tail : null
    const size = sizeFromText(r.tyreType) ?? raw.size
    if (part) {
      const t = size === "11R22.5" ? part.typeI : size === "1000-20" ? part.typeII : null
      if (t) { t.countTire++; t.cost += price; t.totalBpk += bpk }
    }
  }

  for (const part of [tireOverall.head, tireOverall.tail]) {
    for (const t of [part.typeI, part.typeII]) t.avgBpk = t.countTire ? t.totalBpk / t.countTire : 0
  }

  const documents = [...docs.values()]
  const overall = {
    totalDocs: documents.length,
    totalTires: 0,
    totalPrice: 0,
    totalBpk: 0,
    avgBpk: 0,
    multiLifeTires: 0,
    vehicles: [] as AnyRow[],
    tire: tireOverall,
  }
  for (const d of documents) {
    overall.totalTires += d.summary.count
    overall.totalPrice += d.summary.totalPrice
    overall.totalBpk += d.summary.totalBpk
    overall.multiLifeTires += d.items.filter((i) => i.lives.lives.length > 1).length
    overall.vehicles.push({
      customer: d.header.customer, employee: d.header.employee, plate: d.header.plate, docNo: d.header.docNo,
      bookingDate: d.header.bookingDate, count: d.summary.count,
      tiregood: d.summary.statusnormal, tiredefect: d.summary.statusdefect, totalPrice: d.summary.totalPrice,
      avgBpk: d.summary.count ? d.summary.totalBpk / d.summary.count : 0,
    })
  }
  overall.avgBpk = overall.totalTires ? overall.totalBpk / overall.totalTires : 0

  return {
    documents,
    overallSummary: overall,
    approvalRound: approvalRoundText(round.fromDate, round.toDate),
    docPR: pr,
    approver1: round.preparer,
    approver2: round.approver1,
    approver3: round.approver2,
    generatedAt: new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }),
  }
}

export async function getRound(id: string): Promise<Round | null> {
  const _id = toObjectId(id)
  if (!_id) return null
  const db = await sheetDb()
  return (await db.collection(ROUNDS_COLL).findOne({ _id })) as Round | null
}

// ── ดึงข้อมูลจาก ATMS (ปุ่ม "ดึงจาก ATMS" — ไม่บังคับ) ──────────────────────────────────

export type AtmsLookup = {
  found: boolean
  mrNo: string
  snapshot: AtmsSnapshot | null
  tyres: { serial: string; price: number | null; product: string; wd: string; size: string | null }[]
  step?: string
  /** ยางที่ติดอยู่ตำแหน่งนี้ก่อนเปลี่ยน (จากประวัติยางของ ATMS ที่ WMS ซิงก์ไว้ใน tire_change) */
  oldTyre?: { serial: string; installDate: string | null; mileageStart: number | null; treadMm: number | null } | null
  /** ยางที่ ATMS บันทึกว่าใส่เข้าไปด้วยใบนี้ ที่ตำแหน่งนี้ */
  newTyre?: { serial: string; installDate: string | null } | null
}

const isoFromThaiDateTime = (s: unknown) => parseDate(String(s ?? "").split(" ")[0])

/**
 * MR → หัวใบ + ไมล์ + ยางที่เบิก (atms.maint_*) และยางเก่าที่ตำแหน่งนั้น (master_data.tire_change)
 * maint_header.request_code ไม่มี index → กรอบด้วย request_id ช่วงท้าย (ใบในราว 1 ปีล่าสุด) + maxTimeMS
 */
export async function lookupAtms(mrNo: string, plate?: string, position?: string): Promise<AtmsLookup> {
  const client = await clientPromise
  const atms = client.db("atms")
  const code = mrNo.trim().toUpperCase()
  const empty: AtmsLookup = { found: false, mrNo: code, snapshot: null, tyres: [] }
  if (!/^[A-Z]{2,4}MR\d{6,10}$/.test(code)) return empty

  const top = await atms.collection("maint_header").find({}, { projection: { request_id: 1 } })
    .sort({ request_id: -1 }).limit(1).maxTimeMS(5000).toArray()
  const maxId = Number(top[0]?.request_id ?? 0)
  const hdr = await atms.collection("maint_header").findOne(
    { request_id: { $gte: Math.max(0, maxId - 25000) }, request_code: code },
    { projection: { _id: 0 }, maxTimeMS: 8000 },
  )
  if (!hdr) return empty
  const rid = hdr.request_id
  const [timing, parts] = await Promise.all([
    atms.collection("maint_timing").findOne({ request_id: rid }, { projection: { _id: 0 }, maxTimeMS: 5000 }),
    atms.collection("maint_parts").find({ request_id: rid, parts_group: "ยาง" }, { projection: { _id: 0 } })
      .limit(40).maxTimeMS(5000).toArray(),
  ])

  const tyres = parts.map((p) => {
    const product = String(p.part ?? "").split(":").slice(1).join(":").trim() || String(p.part ?? "")
    return {
      serial: String(p.serial_no ?? "").trim(),
      price: toNum(p.unit_price),
      product,
      wd: String(p.requisition_no ?? ""),
      size: sizeFromText(product),
    }
  })
  const prices = tyres.map((t) => t.price).filter((x): x is number => !!x)
  const mileageBooking = toNum(hdr.mileage_at_report)
  const mileageChange = toNum(timing?.mileage_at_entry)

  const snapshot: AtmsSnapshot = {
    at: new Date().toISOString(),
    mrNo: code,
    bookingDate: isoFromThaiDateTime(hdr.reported_at) ?? undefined,
    driver: String(hdr.driver ?? "").trim() || undefined,
    plate: String(hdr.plate_no ?? "").trim() || undefined,
    mileageBooking: mileageBooking || undefined,
    changeDate: isoFromThaiDateTime(timing?.garage_entry_at) ?? undefined,
    mileageChange: mileageChange || undefined,
    price: prices.length ? prices[0] : undefined,
    tyreType: tyres.find((t) => t.product)?.product,
    newSerials: tyres.map((t) => t.serial).filter(Boolean),
  }

  const out: AtmsLookup = { found: true, mrNo: code, snapshot, tyres, step: String(hdr.step ?? "") }

  // ยางเก่าที่ตำแหน่งนี้ — ประวัติยาง ATMS (tire_change) ของทะเบียนนี้ ตำแหน่งรหัสเดียวกัน
  const vehicle = (plate || snapshot.plate || "").trim()
  const posCode = splitPosition(position ?? "").code
  if (vehicle && posCode) {
    const db = client.db(SHEET_DB)
    const hist = await db.collection("tire_change")
      .find({ branch: "saraburi", vehicle }, { projection: { _id: 0, tirePosition: 1, serialNo: 1, changeIn: 1, changeOut: 1, mileageStart: 1, treadMm: 1, maintenanceRequest: 1 } })
      .limit(300).maxTimeMS(5000).toArray()
    const atPos = hist
      .filter((h) => splitPosition(String(h.tirePosition ?? "")).code === posCode)
      .sort((a, b) => new Date(b.changeIn ?? 0).getTime() - new Date(a.changeIn ?? 0).getTime())
    const installedByThis = atPos.find((h) => String(h.maintenanceRequest ?? "").includes(code))
    const before = installedByThis
      ? atPos.find((h) => new Date(h.changeIn ?? 0).getTime() < new Date(installedByThis.changeIn ?? 0).getTime())
      : atPos[0]
    // changeIn เก็บเป็นเที่ยงคืนเวลาไทย — เลื่อน +7 ชม. ก่อนอ่านวันที่ ไม่งั้นบน server (UTC) ได้วันก่อนหน้า
    const d = (v: unknown) => {
      if (!v) return null
      const t = new Date(v as string).getTime()
      if (!Number.isFinite(t)) return null
      const b = new Date(t + 7 * 3600_000)
      return isoDate(b.getUTCFullYear(), b.getUTCMonth() + 1, b.getUTCDate())
    }
    out.newTyre = installedByThis ? { serial: String(installedByThis.serialNo ?? ""), installDate: d(installedByThis.changeIn) } : null
    out.oldTyre = before
      ? { serial: String(before.serialNo ?? ""), installDate: d(before.changeIn), mileageStart: toNum(before.mileageStart), treadMm: toNum(before.treadMm) }
      : null
    if (out.oldTyre?.serial) snapshot.oldSerial = out.oldTyre.serial
    if (out.oldTyre?.installDate) snapshot.installDate = out.oldTyre.installDate
    if (out.oldTyre?.mileageStart) snapshot.mileagePrev = out.oldTyre.mileageStart
    if (out.newTyre?.serial) snapshot.newSerial = out.newTyre.serial
  }
  return out
}
