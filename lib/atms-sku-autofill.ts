// แปลงค่าจากทะเบียนสินค้า ATMS → ช่องในฟอร์ม /sku/new
// ตรรกะล้วน ไม่มี I/O — ใช้ได้ทั้งฝั่ง API และในเบราว์เซอร์
//
// ATMS เก็บหน่วย/คลัง/กลุ่มเป็น "ข้อความที่คนพิมพ์" ไม่ใช่รหัส (หน่วย 70 แบบ · คลัง 33 แห่ง · กลุ่ม 108 กลุ่ม)
// ที่นี่จึงเป็นตารางเทียบไปหารหัสของเราแบบตรงไปตรงมา · คำที่ไม่มีในตาราง = ไม่เติมช่องนั้น
// (ปล่อยว่างให้คนเลือกเอง ดีกว่าเดาผิดแล้วคนกดผ่านไปทั้งอย่างนั้น)

/** หน่วยใน ATMS → รหัสหน่วยของเรา (ดู master_codes dict UNIT) · นับจากของจริง 19/10/2026 */
export const UNIT_FROM_ATMS: Record<string, string> = {
  // นับมาก → น้อย
  "ตัว": "PC", "ชิ้น": "PC", "ชุด": "SET", "อัน": "PC", "เส้น": "TYR", "ลูก": "PC",
  "งาน": "JOB", "แผ่น": "SHT", "ตับ": "SET", "วง": "PC", "เมตร": "MTR", "กล่อง": "BOX",
  "ตลับ": "PC", "เครื่อง": "PC", "EACH": "PC", "ม้วน": "RLL", "ลิตร": "LTR", "หลอด": "PC",
  "ด้าม": "PC", "ถัง": "CAN", "กระป๋อง": "CAN", "คู่": "PRS", "คัน": "PC", "ขวด": "BTL",
  "แพค": "PKG", "แพ็ค": "PKG", "ใบ": "PC", "กิโลกรัม": "KG", "ฝา": "PC", "บาน": "PC",
  "เล่ม": "PC", "ก้อน": "PC", "ดวง": "PC", "ผืน": "PC", "ซอง": "PKG", "แกลลอน": "CAN",
  "แผง": "PKG", "หัว": "PC", "ถุง": "BAG", "กระปุก": "CAN", "รีม": "PKG", "ระบบ": "SET",
  "ท่อน": "PC", "เที่ยว": "JOB", "ก้าน": "PC", "ครั้ง": "JOB", "แท่ง": "PC", "ตู้": "PC",
  "ห่อ": "PKG", "ต้น": "PC", "ราง": "PC", "โหล": "PKG", "แท่น": "PC", "คืน": "DAY",
  "หน่วย": "PC", "ฉบับ": "PC", "ดุม": "PC", "ล้อ": "PC", "หลัง": "PC", "ลัง": "BOX",
  "วัน": "DAY", "ซม.": "MTR", "มิลลิลิตร": "ML", "กรัม": "GRM", "ชั่วโมง": "HR",
  // ที่ไม่เทียบ: คิว/ลบ.ม./ตัน/บาท/คน/license/เดือน/อย่าง/CC/เซนติเมตร — ไม่มีรหัสตรงกัน
}

/** ชื่อคลังใน ATMS → รหัสคลังของเรา · ATMS มีคลังย่อยเยอะ (HR/จป./DIST/ทรัพย์สิน) แต่ของเราแยกตามจังหวัด */
export function whFromAtms(warehouse: string): string {
  const w = warehouse || ""
  if (w.includes("ลาดกระบัง")) return "LK"
  if (w.includes("สระบุรี")) return "SR"
  if (w.includes("ขอนแก่น")) return "KK"
  if (w.includes("บางปะกง")) return "BK"
  return ""
}

/** กลุ่มสินค้าใน ATMS → ตัวช่วยเดา L1 และประเภทค่าใช้จ่าย
 *  l1 ใส่เฉพาะกลุ่มที่ตรงตัวเดียว · กลุ่มที่คร่อมหลายระบบใส่ l1Options ไว้ให้เลือก/ให้ AI ตัด */
export type GroupHint = { type?: string; l1?: string; l1Options?: string[] }

export const GROUP_HINT: Record<string, GroupHint> = {
  "ระบบช่วงล่าง": { type: "PRT", l1: "SUS" },
  "ช่วงล่าง": { type: "PRT", l1: "SUS" },
  "ระบบเครื่องยนต์": { type: "PRT", l1: "ENG" },
  "เครื่องยนต์": { type: "PRT", l1: "ENG" },
  "ระบบแอร์&ระบบไฟ": { type: "PRT", l1Options: ["ACS", "ELC"] },
  "ระบบแอร์ - ไฟ": { type: "PRT", l1Options: ["ACS", "ELC"] },
  "ระบบเบรคคลัทช์": { type: "PRT", l1Options: ["BRK", "TRN"] },
  "ระบบเบรค -คลัทช์-เกียร์": { type: "PRT", l1Options: ["BRK", "TRN"] },
  "ระบบหัวเก๋ง": { type: "PRT", l1: "BOD" },
  "ระบบโม่": { type: "PRT", l1: "MXS" },
  "ปั๊มคอนกรีต": { type: "PRT", l1: "MXS" },
  "ระบบหาง": { type: "PRT", l1: "TRL" },
  "ยาง": { type: "PRT", l1: "TYR" },
  "วัสดุสิ้นเปลือง": { type: "PRT", l1: "CSM" },
  "ระบบวัสดุสิ้นเปลือง": { type: "PRT", l1: "CSM" },
  "อุปกรณ์เสริม": { type: "PRT", l1: "ACC" },
  "ระบบอุปกรณ์เสริม": { type: "PRT", l1: "ACC" },
  "อุปกรณ์เซฟตี้รถ": { type: "PRT", l1: "SAF" },
  "อุปกรณ์ความปลอดภัย": { type: "PRT", l1: "SAF" },
  "เครื่องมือช่าง": { type: "PRT", l1: "TOL" },
  "เครื่องมือช่าง (ประจำรถ)": { type: "PRT", l1: "TOL" },
  "เครื่องมือยาง": { type: "PRT", l1: "TOL" },
  "เครื่องมือเครื่องใช้": { type: "PRT", l1: "TOL" },
  "ระบบบำรุงรักษา": { type: "PM" },
  "บำรุงรักษา": { type: "PM" },
  "ซ่อมแซมและบำรุงรักษา": { type: "PM" },
  // ค่าแรง — ATMS แยกตามระบบมาให้แล้ว
  "ค่าแรง": { type: "LAB" },
  "ค่าแรง-ระบบโม่": { type: "LAB", l1: "MXS" },
  "ค่าแรง-ระบบเครื่องยนต์": { type: "LAB", l1: "ENG" },
  "ค่าแรง-ระบบเบรค ครัช เกียร์": { type: "LAB", l1Options: ["BRK", "TRN"] },
  "ค่าแรง-ระบบช่วงล่าง": { type: "LAB", l1: "SUS" },
  "ค่าแรง-ระบบแอร์ ไฟฟ้า": { type: "LAB", l1Options: ["ACS", "ELC"] },
  "ค่าแรง-หัวเก๋ง": { type: "LAB", l1: "BOD" },
  "ค่าแรง-ระบบหาง": { type: "LAB", l1: "TRL" },
  "ค่าแรง-ระบบยาง": { type: "LAB", l1: "TYR" },
  "ค่าแรง-ระบบบำรุงรักษา": { type: "LAB" },
  "ค่าแรง-อุปกรณ์เสริม": { type: "LAB", l1: "ACC" },
  // บริการ
  "ค่าบริการ": { type: "SVC", l1: "SVC" },
  "ค่าบริการอื่น": { type: "SVC", l1: "SVC" },
  "ค่าบริการและอื่นๆ": { type: "SVC", l1: "SVC" },
  "บริการเสริม": { type: "SVC", l1: "SVC" },
  "ค่าบริการและซ่อมแซมสินทรัพย์": { type: "SVC", l1: "SVC" },
}

/** ยี่ห้อที่คนพิมพ์มั่วใน ATMS → ค่าว่าง (ไม่ใช่ยี่ห้อ) */
const BRAND_BLANK = new Set(["", "-", "ไม่ระบุ", "ไม่มี", "อื่นๆ", "N/A", "NA"])

export function brandFromAtms(brand: string): string {
  const b = (brand || "").trim()
  return BRAND_BLANK.has(b) ? "" : b
}

/** เลขที่ "หน้าตาเหมือนเบอร์อะไหล่" ที่ปนอยู่ในชื่อสินค้าของ ATMS
 *  คนคลังมักพิมพ์ไว้ในวงเล็บ เช่น "เบ้ากุญแจประตูขวา HINO500 (69005-E0570)" หรือวางลอยไว้ท้ายชื่อ
 *  **ดึงจากข้อความจริงเท่านั้น ไม่มีการเดา** — เบอร์อะไหล่ผิดหนึ่งตัวคือสั่งของผิดชิ้น
 *  กติกา: ต้องมีขีดคั่น และมีตัวเลขรวมกัน ≥4 ตัว เพื่อไม่ให้รุ่นรถ (FM1AK1M-SHT) หรือขนาดยาง
 *  (11R22.5) หลุดมาเป็นเบอร์อะไหล่ */
export function extractPartNo(name: string): string {
  const text = (name || "").trim()
  if (!text) return ""
  const digits = (v: string) => (v.match(/\d/g) ?? []).length
  const ok = (v: string) => v.includes("-") && digits(v) >= 4
  const inParens = [...text.matchAll(/\(([A-Za-z0-9][A-Za-z0-9\-/.]{4,})\)/g)].map((m) => m[1])
  for (const v of inParens) if (ok(v)) return v.toUpperCase()
  for (const tok of text.split(/[\s,()]+/)) {
    if (/^[A-Za-z0-9]{1,6}-[A-Za-z0-9-]{3,}$/.test(tok) && ok(tok)) return tok.toUpperCase()
  }
  return ""
}

/** เบอร์อะไหล่: ATMS เก็บรหัส Oracle ไว้ช่องเดียว ซึ่งบางคลังใส่เบอร์อะไหล่จริง บางคลังใส่เลขบัญชี
 *  เลข 6 หลักล้วน = รหัสผังบัญชี (เช่น 622104) ไม่ใช่เบอร์อะไหล่ — ไม่เติม */
export function partNoFromAtms(oracleCode: string): string {
  const v = (oracleCode || "").trim()
  if (!v || v === "-") return ""
  if (/^\d{6}$/.test(v)) return ""
  return v
}

export type AtmsSkuRow = {
  code: string
  /** ราคาซื้อล่าสุดของรหัสนี้จากประวัติ ATMS (ไม่ใช่ค่าที่ประมาณขึ้นมา) */
  lastPrice?: number | null
  lastSupplier?: string | null
  name?: string
  group?: string
  warehouse?: string
  warehouses?: string[]
  oracleCode?: string
  brand?: string
  unit?: string
  stockQty?: number
  minQty?: number
  maxQty?: number
}

/** ค่าที่จะเอาไปเติมในฟอร์ม — ช่องที่เทียบไม่ได้คืนค่าว่าง (ฝั่งหน้าเว็บจะไม่เขียนทับของที่คนกรอกไว้) */
export type AtmsPrefill = {
  nameTh: string
  brand: string
  partNo: string
  /** ที่มาของเบอร์อะไหล่ — เอาไปบอกผู้ใช้ว่าเลขนี้มาจากไหน */
  partNoFrom: "oracle" | "name" | ""
  price: string
  lastSupplier: string
  unit: string
  wh: string
  type: string
  l1: string
  l1Options: string[]
  group: string
  /** หน่วย/คลังที่เทียบรหัสไม่ได้ — เอาไปบอกผู้ใช้ว่าทำไมช่องนั้นไม่ถูกเติม */
  unmapped: { unit?: string; warehouse?: string }
}

export function prefillFromAtms(row: AtmsSkuRow): AtmsPrefill {
  const hint = GROUP_HINT[(row.group || "").trim()] ?? {}
  const unit = UNIT_FROM_ATMS[(row.unit || "").trim()] ?? ""
  const wh = whFromAtms(row.warehouse || "")
  const fromOracle = partNoFromAtms(row.oracleCode || "")
  const fromName = fromOracle ? "" : extractPartNo(row.name || "")
  const price = typeof row.lastPrice === "number" && row.lastPrice > 0
    ? String(Math.round(row.lastPrice * 100) / 100) : ""
  return {
    nameTh: (row.name || "").trim(),
    brand: brandFromAtms(row.brand || ""),
    partNo: fromOracle || fromName,
    partNoFrom: fromOracle ? "oracle" : fromName ? "name" : "",
    price,
    lastSupplier: (row.lastSupplier || "").trim(),
    unit,
    wh,
    type: hint.type ?? "",
    l1: hint.l1 ?? "",
    l1Options: hint.l1Options ?? (hint.l1 ? [hint.l1] : []),
    group: (row.group || "").trim(),
    unmapped: {
      ...(row.unit && !unit ? { unit: row.unit } : {}),
      ...(row.warehouse && !wh ? { warehouse: row.warehouse } : {}),
    },
  }
}
