// lib/garage-geo.ts
// ตรรกะล้วนของหน้า "หาอู่ใกล้ที่สุด" — ไม่มี import จึงทดสอบตรง ๆ ด้วย tsx ได้
//
// ที่มาของพิกัดอู่มี 2 ชั้น (ชั้นบนชนะเสมอ):
//   1) vendor_approval.location — พิกัดที่คนกรอกเอง/อู่ปักหมุดเอง = แม่นระดับหน้าอู่
//   2) data/garage-geo.json     — ที่อยู่จดทะเบียนนิติบุคคล แปลงเป็นพิกัดระดับตำบล/เขต
//      (ดึงมา 19/10/2569 · ที่อยู่จดทะเบียนบางรายเป็นสำนักงานหรือบ้านเจ้าของ ไม่ใช่ตัวอู่
//       จึงต้องขึ้นป้ายบอกผู้ใช้ทุกครั้ง ห้ามแสดงปนกับพิกัดที่ยืนยันแล้ว)

export type GeoPrecision = "หน้าอู่" | "ตำบล" | "อำเภอ"

export type GarageGeo = {
  lat: number
  lng: number
  precision: GeoPrecision
  /** ที่มาของพิกัด เอาไว้ขึ้นป้ายในใบรายการ */
  source: string
}

export type GarageAddress = {
  full: string
  subdistrict: string
  district: string
  province: string
}

/** อู่ 1 รายที่ส่งให้หน้าจอ */
export type GarageHit = {
  name: string
  atmsId: number | null
  phone: string
  branch: string
  /** รหัสประเภทงานที่ติ๊กไว้ใน AVL */
  codes: string[]
  /** ชื่องานที่อ่านออก เช่น ["ระบบโม่", "ระบบเบรกและคลัตช์"] */
  works: string[]
  status: string
  geo: GarageGeo | null
  address: GarageAddress | null
  /** ระยะเส้นตรงจากจุดที่ค้นหา (กม.) — null เมื่ออู่ยังไม่มีพิกัด */
  distanceKm: number | null
  /** ระยะขับจริงตามถนน (กม.) — เติมให้เฉพาะอู่ชุดแรกที่ใกล้ที่สุด · null = ยังไม่ได้คำนวณ */
  roadKm: number | null
  /** เวลาขับโดยประมาณ (นาที) — จากความเร็วปกติของถนนเส้นนั้น ไม่รวมสภาพจราจรตอนนั้น */
  roadMin: number | null
  /** ทำได้ครบทุกประเภทงานที่ผู้ใช้ติ๊กไว้ */
  matchesAll: boolean
  jobs: number
  lastJob: string
  poCount: number
  poBaht: number
}

/** ระยะเส้นตรงบนผิวโลก (กม.) — พอสำหรับจัดอันดับใกล้-ไกล ไม่ใช่ระยะขับจริง */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** กรอบคร่าว ๆ ของประเทศไทย — กันพิกัดที่วางผิด (สลับ lat/lng เป็นกรณีที่เจอบ่อยสุด) */
export function inThailand(p: { lat: number; lng: number }): boolean {
  return p.lat >= 5 && p.lat <= 21 && p.lng >= 96 && p.lng <= 106
}

/**
 * แกะพิกัดจากสิ่งที่ผู้ใช้วางลงช่องค้นหา รองรับ:
 *   "13.72451, 100.78032"              พิกัดตรง ๆ (คัดลอกจาก Google Maps)
 *   ".../@13.72451,100.78032,17z/..."  ลิงก์แผนที่แบบเต็ม
 *   "...?q=13.72451,100.78032"         ลิงก์แบบแชร์พิกัด
 *   "...!3d13.72451!4d100.78032"       ลิงก์ที่ฝังพิกัดไว้ท้าย url
 * ลิงก์ย่อ maps.app.goo.gl ไม่มีพิกัดอยู่ในตัว ต้องให้ฝั่งเซิร์ฟเวอร์ยิงตามไปก่อน (ดู resolveShortLink)
 */
export function parseLatLng(input: string): { lat: number; lng: number } | null {
  const s = (input || "").trim()
  if (!s) return null
  const pats = [
    /[@!](-?\d{1,2}\.\d{3,}),(-?\d{2,3}\.\d{3,})/,
    /[?&]q=(-?\d{1,2}\.\d+),(-?\d{2,3}\.\d+)/,
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{2,3}\.\d+)/,
    /^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{2,3}\.\d+)$/,
    /(-?\d{1,2}\.\d{4,})\s*,\s*(-?\d{2,3}\.\d{4,})/,
  ]
  for (const re of pats) {
    const m = s.match(re)
    if (m) {
      const p = { lat: Number(m[1]), lng: Number(m[2]) }
      if (Number.isFinite(p.lat) && Number.isFinite(p.lng) && inThailand(p)) return p
    }
  }
  return null
}

/** true = เป็นลิงก์ย่อที่ต้องยิงตามไปหาพิกัด */
export function isShortMapLink(s: string): boolean {
  return /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test((s || "").trim())
}

/**
 * จัดอันดับอู่ให้หน้าจอ
 * - ติ๊กประเภทงานไว้ → เอาเฉพาะอู่ที่ทำได้อย่างน้อย 1 อย่าง (ผู้ใช้ขอ 19/10/2569)
 *   อู่ที่ทำได้ "ครบทุกข้อที่ติ๊ก" ขึ้นก่อนเสมอ แม้จะไกลกว่า เพราะโทรเจ้าเดียวจบ
 * - อู่ที่ยังไม่มีพิกัดไม่ถูกตัดทิ้ง แต่ไปอยู่ท้ายรายการ (วันแรกที่เปิดใช้ ส่วนใหญ่ยังไม่มีพิกัด)
 */
export function rankGarages(
  all: GarageHit[],
  origin: { lat: number; lng: number } | null,
  codes: string[],
): GarageHit[] {
  const want = codes.filter(Boolean)
  const rows = all
    .map((g) => {
      const hitCount = want.length ? want.filter((c) => g.codes.includes(c)).length : 0
      return {
        ...g,
        matchesAll: want.length > 0 && hitCount === want.length,
        _hits: hitCount,
        distanceKm: origin && g.geo ? Math.round(haversineKm(origin, g.geo) * 10) / 10 : null,
        roadKm: null as number | null,
        roadMin: null as number | null,
      }
    })
    .filter((g) => (want.length ? g._hits > 0 : true))

  rows.sort((a, b) => {
    if (a.matchesAll !== b.matchesAll) return a.matchesAll ? -1 : 1
    const ad = a.distanceKm, bd = b.distanceKm
    if (ad === null && bd === null) return b.jobs - a.jobs
    if (ad === null) return 1
    if (bd === null) return -1
    return ad - bd
  })
  return rows.map(({ _hits, ...r }) => r)
}
