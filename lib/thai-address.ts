// lib/thai-address.ts
// ชุดข้อมูลที่อยู่ไทย (จังหวัด → อำเภอ → ตำบล + รหัสไปรษณีย์) — ยกมาจาก mena-partner-driver
// data/thai-address.json: [{ p, a:[{ n, t:[{ n, z }] }] }] (77 จังหวัด · 927 อำเภอ · 7,470 ตำบล)
// z เป็น "null" ใน 43 ตำบล (ส่วนใหญ่เป็นเกาะ) ที่ต้นทางไม่มีรหัส → ให้พิมพ์รหัสเอง
// ไฟล์นี้ไม่มี import (ตรรกะล้วน) — rfq-core ใช้ร่วมได้ทั้งฝั่งจอ/API/สคริปต์ทดสอบ

export interface TambonEntry { n: string; z: string }
interface AmphoeNode { n: string; t: TambonEntry[] }
export interface ProvinceNode { p: string; a: AmphoeNode[] }

let cache: ProvinceNode[] | null = null

/** โหลดชุดข้อมูลแบบ dynamic — code-split ให้โหลดเฉพาะหน้าที่เรียกใช้ (ราว 350KB) */
export async function loadThaiAddress(): Promise<ProvinceNode[]> {
  if (cache) return cache
  const mod = await import("@/data/thai-address.json")
  cache = (mod.default ?? mod) as unknown as ProvinceNode[]
  return cache
}

export function listProvinces(data: ProvinceNode[]): string[] {
  return data.map((p) => p.p)
}

export function listDistricts(data: ProvinceNode[], province?: string): string[] {
  if (!province) return []
  return data.find((p) => p.p === province)?.a.map((a) => a.n) ?? []
}

export function listSubdistricts(data: ProvinceNode[], province?: string, district?: string): TambonEntry[] {
  if (!province || !district) return []
  return data.find((p) => p.p === province)?.a.find((a) => a.n === district)?.t ?? []
}

/** รหัสไปรษณีย์ของตำบล ("" ถ้าต้นทางไม่มี) */
export function zipOf(t?: TambonEntry | null): string {
  return t && /^\d{5}$/.test(t.z) ? t.z : ""
}

export interface ThaiAddressParts {
  addressDetail?: string
  subdistrict?:   string
  district?:      string
  province?:      string
  postalCode?:    string
}

/** ประกอบที่อยู่เต็มจาก field ย่อย — กทม. ใช้ แขวง/เขต, จังหวัดอื่นใช้ ต./อ./จ. */
export function composeThaiAddress(a: ThaiAddressParts): string {
  const isBkk = a.province === "กรุงเทพมหานคร"
  const tPre  = isBkk ? "แขวง" : "ต."
  const dPre  = isBkk ? "เขต" : "อ."
  return [
    a.addressDetail?.trim(),
    a.subdistrict ? `${tPre}${a.subdistrict}` : "",
    a.district    ? `${dPre}${a.district}`    : "",
    a.province    ? (isBkk ? a.province : `จ.${a.province}`) : "",
    a.postalCode?.trim(),
  ].filter(Boolean).join(" ")
}

export type AddressHit = { province: string; district: string; subdistrict: string; postalCode: string }

/** ค้นหาเร็ว: พิมพ์ชื่อตำบล (ขึ้นต้น ต./แขวง ได้) หรือรหัสไปรษณีย์ → คู่ ตำบล›อำเภอ›จังหวัด ที่เข้าชุดกันจริง
 *  เรียง: ชื่อตรงเป๊ะ → ขึ้นต้นด้วยคำค้น → มีคำค้นอยู่ข้างใน */
export function searchThaiAddress(data: ProvinceNode[], query: string, limit = 8): AddressHit[] {
  const q = query.trim().replace(/^(ตำบล|แขวง|ต\.)\s*/, "")
  const isZip = /^\d+$/.test(q)
  if (isZip ? q.length < 3 : q.length < 2) return []
  const ranked: { hit: AddressHit; rank: number }[] = []
  for (const p of data) for (const a of p.a) for (const t of a.t) {
    const zip = zipOf(t)
    let rank = -1
    if (isZip) { if (zip.startsWith(q)) rank = zip === q ? 0 : 1 }
    else if (t.n === q) rank = 0
    else if (t.n.startsWith(q)) rank = 1
    else if (t.n.includes(q)) rank = 2
    if (rank >= 0) ranked.push({ hit: { province: p.p, district: a.n, subdistrict: t.n, postalCode: zip }, rank })
  }
  return ranked.sort((x, y) => x.rank - y.rank).slice(0, limit).map((r) => r.hit)
}

/** ตรวจว่า จังหวัด/อำเภอ/ตำบล เข้าชุดกันจริง และรหัสไปรษณีย์ตรงกับตำบล
 *  ไม่เลือกเลยสักช่อง = ผ่าน (ที่อยู่ไม่บังคับ) · คืน postalCode ที่ถูกต้อง (เติมให้ถ้าเว้นว่าง) หรือข้อความผิดพลาด */
export function checkThaiAddress(data: ProvinceNode[], a: ThaiAddressParts): { postalCode: string } | string {
  const postal = (a.postalCode ?? "").trim()
  if (!a.province && !a.district && !a.subdistrict) {
    return postal && !/^\d{5}$/.test(postal) ? "รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก" : { postalCode: postal }
  }
  const prov = data.find((p) => p.p === a.province)
  if (!prov) return "ไม่พบจังหวัดที่เลือก"
  const amp = prov.a.find((x) => x.n === a.district)
  if (!amp) return a.district ? `อำเภอ "${a.district}" ไม่อยู่ในจังหวัด${prov.p}` : "กรุณาเลือกอำเภอ"
  const tam = amp.t.find((x) => x.n === a.subdistrict)
  if (!tam) return a.subdistrict ? `ตำบล "${a.subdistrict}" ไม่อยู่ในอำเภอ${amp.n}` : "กรุณาเลือกตำบล"
  const zip = zipOf(tam)
  if (zip) {
    if (postal && postal !== zip) return `รหัสไปรษณีย์ของตำบล${tam.n} คือ ${zip}`
    return { postalCode: zip }
  }
  return postal && !/^\d{5}$/.test(postal) ? "รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก" : { postalCode: postal }
}
