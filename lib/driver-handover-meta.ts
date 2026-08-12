// ส่งมอบรถ พจส.ใหม่ — types + status meta ที่ปลอดภัยสำหรับ client component
// (ห้ามใส่ env secret / mongo ในไฟล์นี้ — ของ server อยู่ใน lib/driver-handover.ts)

export type HandoverDriver = {
  row: number            // เลขแถวจริงในชีต (ใช้เขียนกลับ)
  code: string           // รหัสพจส.
  name: string
  phone: string
  position: string       // Mixer L / Mixer S / Spare Driver
  customer: string       // ตามชีต เช่น Asia, Cpac MS
  site: string
  status: string
  zone: string
  trainer: string
  trainStart: string     // dd/mm/yyyy ตามชีต
  trainDue: string
  truckNum: string       // เบอร์รถที่จองไว้ (ถ้ามี)
  plate: string
  readiness: string      // ความพร้อมรับรถ
  examScore: string
  receivedDate: string
  fleetKey: string       // เช่น "ASIA ML" — ใช้จับคู่กับรถ · "❓ ไม่ระบุ" = ลูกค้าว่างในชีต (data quality)
  readyDate: string | null // YYYY-MM-DD วันที่คนพร้อมรับรถ
  readyEstimated: boolean // true = readyDate ประมาณจากวันเริ่มฝึก+10 (ชีตไม่มีวันครบกำหนดจริง)
  waitDays: number       // รอมาแล้วกี่วันนับจากพร้อม
  /** สถานะล่าสุดของรถที่จองจาก Mena-Next (null = ยังไม่ได้จองรถ) */
  truckStatus: null | {
    step: string          // ขั้นตอนซ่อมปัจจุบัน หรือ "พร้อมใช้/วิ่งงาน" ถ้าไม่มีงานซ่อมและไม่จอดอู่
    expectedDone: string  // YYYY-MM-DD ("" = ไม่มี)
    parked: boolean       // ยังอยู่ในรายการรถจอด branch 2/5 ไหม
    parkedDays: number
  }
}

export type HandoverTruck = {
  trucknum: string
  plate: string
  customer: string       // จาก fleet API เช่น ASIA
  type: string           // ML / MS
  fleetKey: string       // "ASIA ML"
  plant: string
  statusName: string     // รถซ่อม / รถจอดอุบัติเหตุ
  subStatus: string
  parkedDays: number
  since: string
  forSale: boolean       // รถรอขาย — ไม่ควรเลือกส่งมอบ
  job: null | {
    mrCode: string
    mrId: number
    step: string
    stepNote: string
    stepAt: string
    repairMode: string
    vendor: string
    expectedDone: string  // YYYY-MM-DD ("" = ไม่มี ETA)
    severity: string
    prAmount: number
    partsInfo: string     // สรุปสถานะ PR/PO
  }
  readyBucket: string    // "พร้อมแล้ว" | ISO วันจันทร์ของสัปดาห์ | "เกินกำหนด" | "ไม่มี ETA"
  reservedBy: string     // ชื่อ พจส.ที่จองรถคันนี้ ("ชื่อ +1" ถ้าจองซ้ำ, "" = ว่าง)
  reservedDup: boolean   // true = มีคนจองเบอร์รถนี้มากกว่า 1 คนในชีต (data quality)
}

export type HandoverData = {
  drivers: HandoverDriver[]
  trucks: HandoverTruck[]
  fetchedAt: string
}

export const ACTIVE_STATUSES = ["รอฝึกงาน", "ฝึกงาน", "ฝึกงาน 1-2 วัน", "รอรับรถ"] as const

export const EDITABLE_STATUSES = [
  "รอฝึกงาน", "ฝึกงาน", "รอรับรถ", "รับรถแล้ว", "ลาออก", "ยกเลิกฝึกงาน", "สละสิทธิ์", "ปลด",
] as const

// chip สถานะคน — cls รวม light+dark ตาม pattern repair-external
export const DRIVER_STATUS_META: { value: string; emoji: string; cls: string }[] = [
  { value: "รอฝึกงาน", emoji: "🕐", cls: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300" },
  { value: "ฝึกงาน", emoji: "🎓", cls: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" },
  { value: "ฝึกงาน 1-2 วัน", emoji: "⏸️", cls: "bg-zinc-100 text-zinc-500 dark:bg-zinc-500/15 dark:text-zinc-400" },
  { value: "รอรับรถ", emoji: "🚛", cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
  { value: "รับรถแล้ว", emoji: "✅", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  { value: "ลาออก", emoji: "🚪", cls: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300" },
  { value: "ยกเลิกฝึกงาน", emoji: "❌", cls: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300" },
  { value: "สละสิทธิ์", emoji: "🙅", cls: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300" },
  { value: "ปลด", emoji: "⛔", cls: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300" },
]

export function driverStatusMeta(value: string) {
  return (
    DRIVER_STATUS_META.find((s) => s.value === value) ??
    { value, emoji: "•", cls: "bg-gray-100 text-gray-500 dark:bg-gray-500/15 dark:text-gray-400" }
  )
}

// chip จากชื่อขั้นตอนซ่อม — ใช้ได้ทั้งรถในลิสต์จอดและรถที่จองแล้ว
export function stepMetaFromLabel(step: string) {
  if (/รอขาย/.test(step))
    return { label: step, emoji: "🏷️", cls: "bg-zinc-100 text-zinc-500 dark:bg-zinc-500/15 dark:text-zinc-400" }
  if (!step || step === "รถซ่อมเสร็จสิ้น" || step === "ไม่มีงานซ่อมเปิด" || /พร้อมใช้/.test(step))
    return { label: step || "ไม่มีงานซ่อมเปิด", emoji: "✅", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" }
  if (/รออะไหล่/.test(step))
    return { label: step, emoji: "🔩", cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" }
  if (/รออนุมัติ|รอราคา|รอประเมิน/.test(step))
    return { label: step, emoji: "📋", cls: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" }
  return { label: step, emoji: "🔧", cls: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" }
}

// chip ขั้นตอนซ่อมของรถ
export function truckStepMeta(truck: Pick<HandoverTruck, "job" | "readyBucket" | "forSale">) {
  if (truck.forSale)
    return { label: "รถรอขาย", emoji: "🏷️", cls: "bg-zinc-100 text-zinc-500 dark:bg-zinc-500/15 dark:text-zinc-400" }
  return stepMetaFromLabel(truck.job?.step ?? "")
}

/** label คอลัมน์ของ Fleet Balance matrix */
export function bucketLabel(bucket: string): string {
  if (bucket === "พร้อมแล้ว" || bucket === "เกินกำหนด" || bucket === "ไม่มี ETA") return bucket
  const d = new Date(bucket)
  if (isNaN(d.getTime())) return bucket
  return `สัปดาห์ ${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}
