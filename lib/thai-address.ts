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

export type AddressField = "province" | "district" | "subdistrict" | "postalCode"
/** ผลแนะนำของแต่ละช่อง: จังหวัด → จังหวัดอย่างเดียว · อำเภอ → อำเภอ+จังหวัด · ตำบล/รหัสไปรษณีย์ → ครบ 4 ช่อง */
export type AddressSuggestion = { province: string; district?: string; subdistrict?: string; postalCode?: string }

const PREFIX: Record<AddressField, RegExp> = {
  province: /^(จังหวัด|จ\.)\s*/, district: /^(อำเภอ|เขต|อ\.)\s*/, subdistrict: /^(ตำบล|แขวง|ต\.)\s*/, postalCode: /^\s*/,
}
/** ตรงเป๊ะ 0 · ขึ้นต้นด้วยคำค้น 1 · มีคำค้นอยู่ข้างใน 2 · ไม่ตรง -1 */
const matchRank = (name: string, q: string) => (name === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) ? 2 : -1)

/** autocomplete รายช่อง (ผู้ใช้ขอ 2026-09-18): พิมพ์ช่องไหนก็ได้ แล้วเลือก = เติมช่องที่เกี่ยวข้องให้เข้าชุดกันจริง
 *  ctx = ช่องที่กรอกไว้แล้ว ใช้ช่วยเรียง (จังหวัด/อำเภอเดียวกันมาก่อน) ไม่ตัดทิ้ง — เผื่อผู้ใช้กำลังจะเปลี่ยน */
export function suggestAddress(data: ProvinceNode[], field: AddressField, query: string, ctx: ThaiAddressParts, limit = 8): AddressSuggestion[] {
  const q = query.trim().replace(PREFIX[field], "")
  if (field === "postalCode" ? !/^\d{3,5}$/.test(q) : q.length < 2) return []
  const away = (p: string, a?: string) => (ctx.province && ctx.province !== p ? 20 : 0) + (a !== undefined && ctx.district && ctx.district !== a ? 10 : 0)
  const out: { s: AddressSuggestion; rank: number }[] = []
  for (const p of data) {
    if (field === "province") { const r = matchRank(p.p, q); if (r >= 0) out.push({ s: { province: p.p }, rank: r }); continue }
    for (const a of p.a) {
      if (field === "district") { const r = matchRank(a.n, q); if (r >= 0) out.push({ s: { province: p.p, district: a.n }, rank: away(p.p) + r }); continue }
      for (const t of a.t) {
        const zip = zipOf(t)
        const r = field === "postalCode" ? (zip === q ? 0 : zip.startsWith(q) ? 1 : -1) : matchRank(t.n, q)
        if (r >= 0) out.push({ s: { province: p.p, district: a.n, subdistrict: t.n, postalCode: zip }, rank: away(p.p, a.n) + r })
      }
    }
  }
  return out.sort((x, y) => x.rank - y.rank).slice(0, limit).map((o) => o.s)   // sort เสถียร: อันดับเท่ากันเรียงตามชุดข้อมูล
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
