// แปลงรหัส ATMS → SKU ใหม่ — pure rules shared by the API (authoritative) and the pages (live feedback).
// No imports besides types: safe in the browser and in tsx check scripts.
// Required fields mirror app/sku/new/page.tsx minus images (user 2026-10-06: ไม่บังคับรูปในหน้านี้).
import type {
  CodeBook, CodeOption, ConvertItem, Entry, Kind, Lock, MasterCodeRow, RowStatus,
} from "./sku-convert-types"

/** Types whose SKU has no L3 (same list as /sku/new l3Required). */
export const NO_L3_TYPES = ["LAB", "SVC", "CLN", "TRP"]
/** Types entered with price 0 (same list as lib/codes.ts EXPENSE_TYPES_NO_PRICE). */
export const NO_PRICE_TYPES = ["LAB", "SVC", "CLN", "TRP", "ACC"]
/** Allowed L1 per type — copied from app/sku/new/page.tsx L1_FILTER. */
export const L1_FILTER: Record<string, string[]> = {
  PRT: ["ENG", "COL", "FUL", "TRN", "SUS", "BRK", "STR", "ELC", "EXH", "TYR", "LUB", "MXS", "REF", "PTO", "TRL", "BOD", "SAF", "CSM", "ACS"],
  PM: ["ENG", "COL", "FUL", "TRN", "SUS", "BRK", "STR", "ELC", "TYR", "LUB", "MXS", "PTO", "ACS"],
  LAB: ["ENG", "TRN", "BRK", "SUS", "STR", "ELC", "MXS", "TRL", "BOD", "TYR", "PTO", "ACS", "ACC"],
  SVC: ["SVC"],
  CLN: ["CLN"],
  TRP: ["TRP"],
  ACC: ["BOD", "ENG", "TRN", "BRK", "SUS", "ACC"],
}
export const LAB_UNITS = ["DAY", "HR"]
/** A lock older than this is free (refreshed every 2 min while the page is open). */
export const LOCK_MS = 30 * 60 * 1000
export const MAX_ENTRIES = 20
const EPS = 1e-6

export function emptyEntry(): Entry {
  return {
    wh: "", type: "", l1: "", l2: "", l3: "", nameTh: "", nameEn: "", partNo: "", positions: [],
    price: "", unit: "", brand: "", grade: "", oemRef: "", compatRefs: [], vehicles: [], atmsCodes: [],
    qty: null, note: "",
  }
}

/** Card #1 for a row nobody has worked on yet, from the loader's suggestions. */
export function entryFromSuggest(
  item: Pick<ConvertItem, "wh" | "code" | "name" | "kind" | "atmsQty" | "suggest">,
): Entry {
  const s = item.suggest
  return {
    ...emptyEntry(),
    wh: item.wh, type: s.type || "", l1: s.l1 || "", l2: s.l2 || "", l3: s.l3 || "",
    nameTh: item.name, partNo: s.partNo || "", positions: ["GN"],
    price: s.price != null && !NO_PRICE_TYPES.includes(s.type) ? String(Math.round(s.price * 100) / 100) : "",
    unit: s.unit || "", vehicles: s.vehicle ? [s.vehicle] : [], atmsCodes: [item.code],
    qty: item.kind === "parts" && item.atmsQty > EPS ? item.atmsQty : null,
  }
}

/** "+ แยกอีกรหัส" — copy of a card without its qty and note. */
export function splitFrom(e: Entry): Entry {
  return { ...e, positions: [...e.positions], compatRefs: [...e.compatRefs], vehicles: [...e.vehicles],
           atmsCodes: [...e.atmsCodes], qty: null, note: "" }
}

export function entryMissing(e: Entry): string[] {
  const out: string[] = []
  const blank = (v: string) => !v || !v.trim()
  if (blank(e.wh)) out.push("คลัง")
  if (blank(e.type)) out.push("ประเภท")
  if (blank(e.l1)) out.push("L1")
  if (blank(e.l2)) out.push("L2")
  if (blank(e.l3) && !NO_L3_TYPES.includes(e.type)) out.push("L3")
  if (blank(e.nameTh)) out.push("ชื่อ TH")
  if (blank(e.unit)) out.push("หน่วย")
  if (!e.atmsCodes.some((c) => c && c.trim())) out.push("รหัส ATMS")
  return out
}

const has = (list: CodeOption[] | undefined, code: string) => !!list?.some((o) => o.code === code)

/** Values filled in but not allowed where they are (blank values are entryMissing's job). */
export function entryWrong(e: Entry, book: CodeBook): string[] {
  const out: string[] = []
  const lab = e.type === "LAB"
  if (e.l1 && e.type) {
    const allowed = book.l1ByType[e.type]
    if (!has(book.l1, e.l1) || (allowed && allowed.length && !allowed.includes(e.l1))) out.push("L1 ไม่ตรงประเภท")
  }
  if (e.l2 && e.l1 && !has((lab ? book.l2Lab : book.l2)[e.l1], e.l2)) out.push("L2 ไม่อยู่ใต้ L1")
  if (e.l3 && e.l2 && !has((lab ? book.l3Lab : book.l3)[`${e.l1}:${e.l2}`], e.l3)) out.push("L3 ไม่อยู่ใต้ L2")
  if (e.unit && e.type) {
    const ok = lab ? book.unitLab.includes(e.unit) : has(book.unit, e.unit)
    if (!ok) out.push("หน่วยไม่ตรงประเภท")
  }
  if (e.grade && e.type && !has(lab ? book.gradeLab : book.grade, e.grade)) out.push("Grade ไม่ตรงประเภท")
  return out
}

export type QtyState = "ok" | "short" | "over" | "none"

/** Σ qty of the cards vs the old code's ATMS stock (parts rows). */
export function qtyCheck(atmsQty: number, entries: Entry[]): { state: QtyState; total: number; diff: number } {
  const total = round(entries.reduce((s, e) => s + (e.qty && e.qty > 0 ? e.qty : 0), 0))
  const stock = round(atmsQty > 0 ? atmsQty : 0)
  if (stock <= EPS && total <= EPS) return { state: "none", total: 0, diff: 0 }
  const diff = round(Math.abs(total - stock))
  if (diff <= EPS) return { state: "ok", total, diff: 0 }
  return { state: total < stock ? "short" : "over", total, diff }
}

export function rowStatus(kind: Kind, atmsQty: number, entries: Entry[], book: CodeBook): RowStatus {
  if (!entries.length) return "todo"
  const cardsOk = entries.every((e) => !entryMissing(e).length && !entryWrong(e, book).length)
  const qtyOk = kind === "svc" || ["ok", "none"].includes(qtyCheck(atmsQty, entries).state)
  return cardsOk && qtyOk ? "done" : "draft"
}

export function skuPreview(e: Entry): string {
  if (!e.wh || !e.type || !e.l1 || !e.l2) return ""
  return [e.wh, e.type, e.l1, e.l2, ...(e.l3 ? [e.l3] : [])].join("-") + "-####"
}

export function isLockLive(lock: Lock | null | undefined, nowMs: number): boolean {
  if (!lock?.at) return false
  return nowMs - Date.parse(lock.at) < LOCK_MS
}

// ---------------------------------------------------------------- server-side input cleaning

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "")
const strList = (v: unknown, max = 20) =>
  Array.isArray(v) ? [...new Set(v.map((x) => str(x, 60)).filter(Boolean))].slice(0, max) : []

/** Untrusted request body → at most MAX_ENTRIES well-typed entries. */
export function sanitizeEntries(raw: unknown): Entry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r))
    .slice(0, MAX_ENTRIES)
    .map((r) => {
      const q = typeof r.qty === "number" ? r.qty : typeof r.qty === "string" && r.qty.trim() ? Number(r.qty) : NaN
      return {
        wh: str(r.wh, 10), type: str(r.type, 10), l1: str(r.l1, 10), l2: str(r.l2, 10), l3: str(r.l3, 10),
        nameTh: str(r.nameTh), nameEn: str(r.nameEn), partNo: str(r.partNo, 80), positions: strList(r.positions),
        price: str(r.price, 20), unit: str(r.unit, 10), brand: str(r.brand, 60), grade: str(r.grade, 10),
        oemRef: str(r.oemRef, 80), compatRefs: strList(r.compatRefs), vehicles: strList(r.vehicles),
        atmsCodes: strList(r.atmsCodes), qty: Number.isFinite(q) && q >= 0 ? q : null, note: str(r.note, 500),
      }
    })
}

// ---------------------------------------------------------------- code book

/** master_codes rows → every list the pages need. Sorting = order, then code (same as /api/codes). */
export function buildCodeBook(rows: MasterCodeRow[]): CodeBook {
  const sorted = [...rows].sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.code.localeCompare(b.code))
  const opt = (r: MasterCodeRow): CodeOption => ({ code: r.code, th: r.th })
  const of = (dict: string) => sorted.filter((r) => r.dict === dict)
  const isLab = (r: MasterCodeRow) => r.meta?.expenseType === "LAB"
  const group = (list: MasterCodeRow[]) => {
    const m: Record<string, CodeOption[]> = {}
    for (const r of list) if (r.parent) (m[r.parent] ??= []).push(opt(r))
    return m
  }
  const l2 = of("SUB_ASSEMBLY_L2")
  const l3 = of("COMPONENT_L3")
  const types = of("EXPENSE_TYPE").map(opt)
  return {
    wh: of("WAREHOUSE").map(opt),
    type: types,
    l1: of("SYSTEM_L1").map(opt),
    l1ByType: Object.fromEntries(types.map((t) => [t.code, L1_FILTER[t.code] ?? []])),
    l2: group(l2.filter((r) => !isLab(r))),
    l2Lab: group(l2.filter(isLab)),
    l3: group(l3.filter((r) => !isLab(r))),
    l3Lab: group(l3.filter(isLab)),
    unit: of("UNIT").map(opt),
    unitLab: LAB_UNITS,
    grade: of("GRADE").filter((r) => !isLab(r)).map(opt),
    gradeLab: of("GRADE").filter(isLab).map(opt),
    position: of("POSITION").map(opt),
    vehicle: of("VEHICLE_TYPE").map(opt),
    brand: of("BRAND").map(opt),
  }
}

function round(n: number) {
  return Math.round(n * 1e6) / 1e6
}
