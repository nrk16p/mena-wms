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

/**
 * แหล่งที่มาของอู่ — บอกผู้ใช้ว่าเชื่อได้แค่ไหน (ผู้ใช้สั่ง 19/10/2569: โชว์ทุกอย่างที่มีก่อน ค่อยคลีนทีหลัง)
 *   avl   = อยู่ในทะเบียน AVL ผ่านการอนุมัติ มีประวัติซ่อม
 *   fleet = อยู่ในชีตทะเบียนอู่ของฝ่ายยานยนต์ (มีประเภทงาน 9 หมวด) แต่ยังไม่อยู่ใน AVL
 *   pin   = หมุดร้านซ่อมใน My Map ของยานยนต์ มีแค่ชื่อกับเบอร์
 *   manual = คนเพิ่มเองจากปุ่ม "เพิ่มอู่" ในหน้าแผนที่ (10/11/2569) — ยังไม่ผ่าน AVL เก็บที่ garage_manual
 */
export type GarageSource = "avl" | "fleet" | "pin" | "manual"

/** อู่ 1 รายที่ส่งให้หน้าจอ */
export type GarageHit = {
  /** แหล่งหลักที่ใช้จัดป้าย (avl > fleet > pin) */
  source: GarageSource
  /** _id ใน garage_manual — มีเฉพาะอู่ที่เพิ่มเอง ใช้ตอนลบ */
  manualId?: string
  /** ทุกแหล่งที่เจออู่นี้ — ใช้บอกว่าข้อมูลยืนยันกันหลายทาง */
  sources: GarageSource[]
  /** หมวดงานตามชีตยานยนต์ (ภาษาที่ช่างใช้) — ว่าง = ไม่มีข้อมูลจากชีต */
  fleetWorks: string[]
  /** ชีตยานยนต์ติ๊กว่า "นอกสถานที่" = ออกไปซ่อมหน้างานได้ */
  onsite: boolean
  /** โซนที่ยานยนต์จัดไว้ในชีต เช่น "ลาดกระบัง/มีนบุรี/กิ่งแก้ว/หนองจอก" */
  zone: string
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
  /** ผู้ใช้เลือกประเภทงานแต่อู่นี้ไม่มีข้อมูลงานเลย → ไม่ตัดทิ้ง ไปอยู่กลุ่ม "โทรถาม" ท้ายรายการ */
  workUnknown?: boolean
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
  const dms = parseDms(s)
  if (dms) return dms
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

/**
 * พิกัดแบบองศา-ลิปดา-ฟิลิปดา ที่ Google Maps โชว์ตอนแตะหมุด เช่น
 *   16°51'08.4"N 102°49'58.1"E      (ตัวอักษรทิศอยู่ท้าย)
 *   N16°51'08.4" E102°49'58.1"      (ตัวอักษรทิศอยู่หน้า)
 *   16°51.14'N, 102°49.968'E        (ไม่มีฟิลิปดา)
 * รับเครื่องหมาย ′ ″ ’ ” ที่มาจากการคัดลอกบนมือถือด้วย ไม่มีตัวอักษรทิศ = ตัวแรกเป็น lat
 */
function parseDms(s: string): { lat: number; lng: number } | null {
  if (!/[°º˚]/.test(s)) return null
  const t = s.toUpperCase().replace(/[′’‘`´]/g, "'").replace(/[″”“]|''/g, '"')
  const num = String.raw`(\d{1,3}(?:\.\d+)?)\s*[°º˚]\s*(?:(\d{1,2}(?:\.\d+)?)\s*'\s*)?(?:(\d{1,2}(?:\.\d+)?)\s*"\s*)?`
  const leading = /^[NSEW]/.test(t)
  const re = leading ? new RegExp(String.raw`([NSEW])\s*` + num, "g") : new RegExp(num + String.raw`([NSEW])?`, "g")
  const parts: { v: number; h: string }[] = []
  for (const m of t.matchAll(re)) {
    const [d, mi, se, h] = leading ? [m[2], m[3], m[4], m[1]] : [m[1], m[2], m[3], m[4]]
    const v = Number(d) + Number(mi || 0) / 60 + Number(se || 0) / 3600
    if (Number(mi || 0) >= 60 || Number(se || 0) >= 60) return null
    parts.push({ v: h === "S" || h === "W" ? -v : v, h: h || "" })
  }
  if (parts.length !== 2) return null
  const latPart = parts.find((p) => p.h === "N" || p.h === "S") ?? parts[0]
  const lngPart = parts.find((p) => p !== latPart)!
  const p = { lat: +latPart.v.toFixed(6), lng: +lngPart.v.toFixed(6) }
  return inThailand(p) ? p : null
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
    // อู่ที่ไม่มีข้อมูลประเภทงานเลย ไม่ตัดทิ้งตอนผู้ใช้เลือกงาน (BA 19/10/2569: ตัดทิ้งแล้วผู้ใช้นึกว่าไม่มีอู่)
    // ไปรวมเป็นกลุ่มท้ายรายการแทน — อู่ที่มีข้อมูลแต่ไม่ทำงานนั้นยังตัดออกเหมือนเดิม
    .map((g) => ({ ...g, workUnknown: want.length > 0 && g.codes.length === 0 && !g.fleetWorks.length }))
    .filter((g) => (want.length ? g._hits > 0 || g.workUnknown : true))

  rows.sort((a, b) => {
    if (a.workUnknown !== b.workUnknown) return a.workUnknown ? 1 : -1
    if (a.matchesAll !== b.matchesAll) return a.matchesAll ? -1 : 1
    const ad = a.distanceKm, bd = b.distanceKm
    if (ad === null && bd === null) return b.jobs - a.jobs
    if (ad === null) return 1
    if (bd === null) return -1
    return ad - bd
  })
  return rows.map(({ _hits, ...r }) => r)
}
