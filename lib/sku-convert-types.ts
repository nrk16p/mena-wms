// แปลงรหัส ATMS → SKU ใหม่ (/sku/convert) — shared shapes for the API, the pages and the loader.
// Dates are Date in Mongo and ISO strings over JSON; typed as string here (the JSON shape).
// Spec: docs/superpowers/specs/2026-10-06-sku-convert-design.md

export type Inv = "4" | "3" | "24"
export type Wh = "LK" | "SR"
export type Kind = "parts" | "svc"
export type RowStatus = "todo" | "draft" | "done"

export interface Lot {
  seq: number                 // 1 = newest
  date?: string               // missing = no receipt found (stock older than the ledger)
  dd?: string
  po?: string
  supplier?: string
  unitCost: number
  qtyReceived?: number
  qtyLeft: number
  value: number
  ageDays?: number
  note?: string
}

export interface SupplierRow {
  supplier: string
  n: number
  qty: number
  pMin: number
  pMed: number
  pMax: number
  last: string
}

/** Codes (not labels) suggested by the loader for card #1. */
export interface Suggest {
  type: string
  l1?: string
  l2?: string
  l3?: string
  unit?: string
  vehicle?: string
  partNo?: string
  price?: number
}

/** One new SKU — field names match the /sku/new POST body (minus images). */
export interface Entry {
  wh: string
  type: string
  l1: string
  l2: string
  l3: string
  nameTh: string
  nameEn: string
  partNo: string
  positions: string[]
  price: string
  unit: string
  brand: string
  grade: string
  oemRef: string
  compatRefs: string[]
  vehicles: string[]
  atmsCodes: string[]         // [0] = this row's code; more = merged old codes
  qty: number | null          // parts only: share of the old code's ATMS stock
  note: string
}

export interface Lock {
  email: string
  name: string
  at: string
}

export interface ConvertItem {
  _id: string                 // `${inv}:${code}`
  inv: Inv
  wh: Wh
  warehouse: string
  code: string
  kind: Kind
  name: string
  group: string
  brand?: string
  unit?: string
  location?: string
  asOf: string
  atmsQty: number
  atmsValue: number
  moves: number
  recv: number
  issue: number
  issueDocs: number
  issueAmt: number
  lastMove?: string
  use?: { lines: number; qty: number; amt: number }
  lastPrice?: number
  lastSupplier?: string
  nSup: number
  priceRatio?: number
  splitHint?: string
  haveSku?: string
  lots: Lot[]
  suppliers: SupplierRow[]
  suggest: Suggest
  entries: Entry[]
  status: RowStatus
  lock?: Lock | null
  updatedBy?: { email: string; name: string }
  updatedAt?: string
}

export type ConvertListRow = Omit<ConvertItem, "lots" | "suppliers" | "suggest" | "entries"> & {
  entryCount: number
}

/** หนึ่งแถวในไฟล์ Excel ของหน้ารายการ — คอลัมน์ตามที่ผู้ใช้สั่ง 13/10/2026 */
export type ConvertExportRow = Pick<ConvertItem,
  | "code" | "name" | "warehouse" | "wh" | "kind" | "group" | "atmsQty" | "atmsValue"
  | "lastPrice" | "lastSupplier" | "status" | "splitHint" | "haveSku" | "asOf" | "updatedAt"
> & {
  entryCount: number
  updatedByName: string
}

/** ต้นทางของชีต "SKU ใหม่" — รหัส ATMS หนึ่งรหัสพร้อม SKU ที่กรอกไว้ทั้งหมดของมัน */
export type ConvertEntrySource = Pick<ConvertItem, "code" | "name" | "warehouse" | "kind" | "status" | "entries">

/** หนึ่งแถวในชีต "SKU ใหม่" = หนึ่ง SKU ที่กรอกไว้ — รหัสคู่กับชื่อไทยทุกช่องที่เป็นรหัส
 *  เพราะคนรับไฟล์อ่านรหัส ENG/OIL/OFT ไม่ออก แต่คนที่เอาไปสร้าง SKU ต้องใช้รหัส */
export interface ConvertEntryExportRow {
  code: string                // รหัส ATMS ต้นทาง
  srcName: string             // ชื่อเดิมใน ATMS
  warehouse: string
  kind: Kind
  status: RowStatus
  seq: number                 // SKU ที่เท่าไหร่ของรหัสนี้ (1 = ใบแรก)
  sku: string                 // รหัส SKU ที่จะได้ (ยังไม่มีเลขท้าย)
  wh: string;    whTh: string
  type: string;  typeTh: string
  l1: string;    l1Th: string
  l2: string;    l2Th: string
  l3: string;    l3Th: string
  nameTh: string
  nameEn: string
  partNo: string
  oemRef: string
  unit: string;  unitTh: string
  price: number | null
  grade: string; gradeTh: string
  brand: string; brandTh: string
  positions: string           // ชื่อไทย คั่นด้วย ", "
  vehicles: string
  qty: number | null
  mergedCodes: string         // รหัส ATMS อื่นที่ยุบรวมมาอยู่ SKU นี้
  note: string
}

export interface ConvertCounts {
  all: number
  todo: number
  draft: number
  done: number
  hint: number
}

export interface ConvertListResponse {
  total: number
  page: number
  limit: number
  rows: ConvertListRow[]
  counts: ConvertCounts       // for the whole wh+kind tab, not the filtered rows
  groups: string[]
}

export interface ConvertDetailResponse {
  item: ConvertItem
  liveStock: { qty: number; syncedAt: string } | null
  next: string | null         // _id of the next todo row in list order
  me: { email: string; name: string }
}

export interface CodeOption {
  code: string
  th: string
}

/** Every dropdown list the convert pages need, built from master_data.master_codes. */
export interface CodeBook {
  wh: CodeOption[]
  type: CodeOption[]
  l1: CodeOption[]
  l1ByType: Record<string, string[]>     // allowed L1 codes per type (empty list = all)
  l2: Record<string, CodeOption[]>       // L1 → L2 (non-LAB)
  l2Lab: Record<string, CodeOption[]>    // L1 → L2 (LAB)
  l3: Record<string, CodeOption[]>       // "L1:L2" → L3 (non-LAB)
  l3Lab: Record<string, CodeOption[]>    // "L1:L2" → L3 (LAB)
  unit: CodeOption[]
  unitLab: string[]                      // LAB may only use these units
  grade: CodeOption[]
  gradeLab: CodeOption[]
  position: CodeOption[]
  vehicle: CodeOption[]
  brand: CodeOption[]
}

/** A master_codes document (fields the convert feature reads). */
export interface MasterCodeRow {
  dict: string
  code: string
  th: string
  en?: string
  parent?: string | null
  order?: number
  meta?: { expenseType?: string } & Record<string, unknown>
}
