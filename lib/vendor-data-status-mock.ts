// ข้อมูลตัวอย่างของหน้า "สถานะข้อมูล" (/vendors/data-status)
// UI อย่างเดียวตามที่ Bew เลือก 2026-10-27 — ยังไม่มี API/DB · ต่อแหล่งจริงแล้วลบไฟล์นี้ทิ้งได้ทั้งไฟล์
// สร้างแบบ deterministic (ไม่ใช้ Math.random / Date.now) ให้ server กับ client render ตรงกัน

export type DocStatus = "รอตรวจสอบ" | "ตรวจสอบแล้ว" | "ยกเลิก" | "รอแก้ไข"
/** ลำดับตามที่ Bew กำหนด — ใช้ทั้งปุ่มปรับสถานะใน Dialog และการเรียงคอลัมน์ */
export const DOC_STATUSES: DocStatus[] = ["รอตรวจสอบ", "ตรวจสอบแล้ว", "ยกเลิก", "รอแก้ไข"]

export type DocItem = { name: string; qty: number; price: number }
export type VendorDoc = {
  id: string
  supplier: string
  /** ISO เวลาไทย (+07:00) */
  at: string
  status: DocStatus
  /** ทะเบียนรถ / เบอร์รถ / เลข DD — ว่างได้ (บิลที่ไม่ผูกกับรถ) */
  plate: string
  truckNo: string
  ddNo: string
  /** ผู้ตรวจ — ว่างจนกว่าจะตรวจสอบ */
  inspectedBy: string
  /** เลข PO / PV — ออกหลังตรวจสอบแล้ว (PV ตามหลัง PO) */
  poNo: string
  pvNo: string
  items: DocItem[]
  /** URL รูปที่อัปโหลด (mock = SVG data URI) */
  images: string[]
}

export const docTotal = (d: { items: DocItem[] }) => d.items.reduce((s, i) => s + i.qty * i.price, 0)

const SUPPLIERS = [
  "อู่ช่างเอก การช่าง",
  "หจก. สมบูรณ์ยนต์ บริการ",
  "บจก. ไทยรุ่งเรือง ออโต้พาร์ท",
  "ร้านศรีสุข อะไหล่ยนต์",
  "บจก. เอ็นเอ็น ทรัค เซอร์วิส",
  "อู่โชคดี เซอร์วิส",
  "หจก. พัฒนาไดนาโม",
  "บจก. สยามแบตเตอรี่ ซัพพลาย",
]

const TRUCKS = [
  { plate: "70-4521 ชลบุรี", truckNo: "T-012" },
  { plate: "71-0388 ชลบุรี", truckNo: "T-027" },
  { plate: "70-9164 ระยอง", truckNo: "T-045" },
  { plate: "72-1130 กรุงเทพมหานคร", truckNo: "T-051" },
  { plate: "70-6602 ชลบุรี", truckNo: "T-063" },
  { plate: "71-2847 ฉะเชิงเทรา", truckNo: "T-078" },
]

const INSPECTORS = ["สมชาย ใจดี", "วรรณา ศรีสุข", "ธนกร แก้วมณี"]

export const ITEM_CATALOG: DocItem[] = [
  { name: "ผ้าเบรกหน้า", qty: 1, price: 1850 },
  { name: "น้ำมันเครื่อง 15W-40", qty: 1, price: 145 },
  { name: "ไส้กรองน้ำมันเครื่อง", qty: 1, price: 420 },
  { name: "ไส้กรองโซล่า", qty: 1, price: 380 },
  { name: "หลอดไฟหน้า H4 24V", qty: 1, price: 120 },
  { name: "แบตเตอรี่ 150Ah", qty: 1, price: 4900 },
  { name: "ค่าแรงเปลี่ยนผ้าเบรก", qty: 1, price: 800 },
  { name: "ลูกปืนล้อ", qty: 1, price: 1250 },
  { name: "สายพานไดชาร์จ", qty: 1, price: 560 },
  { name: "จาระบี", qty: 1, price: 350 },
  { name: "ค่าแรงตรวจเช็คระบบไฟ", qty: 1, price: 600 },
  { name: "ยางใน 11.00R20", qty: 1, price: 650 },
]

// LCG เล็ก ๆ — ได้ลำดับเดิมทุกครั้ง
function rng(seed: number) {
  let s = seed
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const svgUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
const money = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** รูปบิลจำลองจากรายการจริงของใบ — ให้ Dialog มีรูปที่ "ตรง" กับตารางรายการ */
export function receiptSvg(supplier: string, id: string, items: DocItem[]): string {
  const rowH = 30, top = 150, h = top + items.length * rowH + 110
  const lines = items.map((it, i) => {
    const y = top + i * rowH
    return `<text x="32" y="${y}">${i + 1}. ${esc(it.name)}</text>` +
      `<text x="360" y="${y}" text-anchor="end">${it.qty}</text>` +
      `<text x="568" y="${y}" text-anchor="end">${money(it.qty * it.price)}</text>`
  }).join("")
  const sumY = top + items.length * rowH + 20
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="${h}" viewBox="0 0 600 ${h}" font-family="sans-serif" font-size="16" fill="#333">` +
    `<rect width="600" height="${h}" fill="#FFFDF7"/>` +
    `<text x="300" y="48" text-anchor="middle" font-size="22" font-weight="bold">${esc(supplier)}</text>` +
    `<text x="300" y="78" text-anchor="middle" fill="#777">ใบเสร็จรับเงิน / ใบกำกับภาษี</text>` +
    `<text x="32" y="112" fill="#777">เลขที่ ${esc(id)}</text>` +
    `<line x1="32" y1="124" x2="568" y2="124" stroke="#ccc" stroke-dasharray="4 4"/>` +
    lines +
    `<line x1="32" y1="${sumY - 4}" x2="568" y2="${sumY - 4}" stroke="#ccc" stroke-dasharray="4 4"/>` +
    `<text x="32" y="${sumY + 28}" font-weight="bold">รวมทั้งสิ้น</text>` +
    `<text x="568" y="${sumY + 28}" text-anchor="end" font-weight="bold">${money(docTotal({ items }))} บาท</text>` +
    `</svg>`
  )
}

function photoSvg(label: string, hue: number): string {
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="450" viewBox="0 0 600 450" font-family="sans-serif">` +
    `<rect width="600" height="450" fill="hsl(${hue} 25% 82%)"/>` +
    `<circle cx="470" cy="110" r="46" fill="hsl(${hue} 30% 92%)"/>` +
    `<path d="M0 450 L170 230 L300 360 L400 270 L600 450 Z" fill="hsl(${hue} 22% 62%)"/>` +
    `<text x="300" y="420" text-anchor="middle" font-size="20" fill="#fff">${esc(label)}</text>` +
    `</svg>`
  )
}

function build(): VendorDoc[] {
  const r = rng(2610)
  const out: VendorDoc[] = []
  // เริ่ม 27 ต.ค. 2569 09:12 แล้วถอยหลังทีละ ~3–14 ชม.
  let t = Date.UTC(2026, 9, 27, 2, 12)
  for (let i = 0; i < 28; i++) {
    const id = `VD-2610-${String(28 - i).padStart(3, "0")}`
    const supplier = SUPPLIERS[Math.floor(r() * SUPPLIERS.length)]
    const n = 1 + Math.floor(r() * 5)
    const picked = new Set<number>()
    while (picked.size < n) picked.add(Math.floor(r() * ITEM_CATALOG.length))
    const items = [...picked].map((k) => ({ ...ITEM_CATALOG[k], qty: 1 + Math.floor(r() * 6) }))
    // ใบใหม่ ๆ ยังรอตรวจ · ใบเก่าส่วนใหญ่ตรวจสอบแล้ว
    const status: DocStatus = i < 5 ? "รอตรวจสอบ" : i < 9 ? (r() < 0.6 ? "รอแก้ไข" : "รอตรวจสอบ") : r() < 0.82 ? "ตรวจสอบแล้ว" : "ยกเลิก"
    const images = i % 7 === 3 ? [] : [receiptSvg(supplier, id, items)]
    const extra = Math.floor(r() * 3)
    for (let k = 0; k < extra && images.length; k++) images.push(photoSvg(`รูปหน้างาน ${k + 1}`, Math.floor(r() * 360)))
    const at = new Date(t + 7 * 3600_000).toISOString().slice(0, 19) + "+07:00"
    const seq = String(28 - i).padStart(3, "0")
    const truck = i % 9 === 6 ? { plate: "", truckNo: "" } : TRUCKS[Math.floor(r() * TRUCKS.length)]
    const checked = status === "ตรวจสอบแล้ว"
    const poNo = checked || status === "รอแก้ไข" ? `PO6910-${seq}` : ""
    out.push({
      id, supplier, at, status, ...truck,
      ddNo: truck.plate ? `DD6910-${seq}` : "",
      inspectedBy: status === "รอตรวจสอบ" ? "" : INSPECTORS[Math.floor(r() * INSPECTORS.length)],
      poNo,
      pvNo: checked && i % 4 !== 1 ? `PV6910-${seq}` : "",
      items, images,
    })
    t -= (3 + Math.floor(r() * 12)) * 3600_000 + Math.floor(r() * 60) * 60_000
  }
  return out
}

export const MOCK_VENDOR_DOCS: VendorDoc[] = build()
