// lib/sku-suggest-core.ts — ตัวช่วยแนะนำ L1/L2/L3 + ชื่อมาตรฐาน: ส่วนที่เป็นตรรกะล้วน
//
// ทำงานสองชั้น
//   ชั้นที่ 1 (ที่นี่, ฟรี, ไม่เรียกใคร): คัดผังสินค้าจาก 772 ชิ้นส่วนให้เหลือ ~40 ตัวเลือกที่เข้าเค้า
//     ด้วยการเทียบตัวอักษรซ้อน (character bigram) ของชื่อสินค้ากับชื่อในผัง + พจนานุกรมคำช่างไทย-อังกฤษ
//     ภาษาไทยไม่เว้นวรรค แยกคำไม่ได้ตรง ๆ — bigram ทนเรื่องนี้ได้ดีกว่าการตัดคำแบบเดา
//   ชั้นที่ 2 (lib/sku-suggest.ts): ส่งเฉพาะตัวเลือกที่คัดมาให้ LLM เลือก + ตั้งชื่อมาตรฐาน
//
// ทำไมต้องคัดก่อน: ส่งทั้งผัง (25 ระบบ · 223 ชุดประกอบ · 772 ชิ้นส่วน) ให้ LLM ทุกครั้ง = พรอมต์ใหญ่
// ช้า และตอบเพี้ยนง่าย · คัดก่อนแล้วค่อยให้เลือกจากรายการสั้น ตอบเร็วและตรวจคำตอบได้ว่าอยู่ในผังจริง
//
// ไม่มี import นอกจาก type — ใช้ได้ทั้งในเบราว์เซอร์และใน script ตรวจ
import { L1_FILTER, NO_L3_TYPES } from "./sku-convert-core"
import type { MasterCodeRow } from "./sku-convert-types"

export type TaxonomyLeaf = {
  l1: string; l2: string; l3: string
  /** "BRK:AIR:VLV" */
  path: string
  /** ชื่อไทยสามชั้นต่อกัน สำหรับให้คนและ LLM อ่าน */
  label: string
  /** ข้อความที่เอาไปเทียบคะแนน (ไทย+อังกฤษ ทั้งสามชั้น) */
  haystack: string
}

/** คำช่างที่คนคลังพิมพ์ ↔ คำในผังสินค้า/อังกฤษ — ขยายคำค้นก่อนให้คะแนน
 *  ใส่เฉพาะคู่ที่ "ชื่อสินค้าใน ATMS ใช้คำหนึ่ง แต่ผังใช้อีกคำ" ซึ่งทำให้เทียบตัวอักษรไม่เจอกันเลย */
export const PART_SYNONYMS: Record<string, string[]> = {
  "หม้อลม": ["booster", "หม้อลมเบรก", "clutch booster", "เพิ่มกำลัง"],
  "คลัทช์": ["clutch", "ครัช", "คลัช", "ระบบส่งกำลัง"],
  "ครัช": ["clutch", "คลัทช์"],
  "คลัช": ["clutch", "คลัทช์"],
  "เบรค": ["brake", "เบรก"],
  "เบรก": ["brake"],
  "ลูกสูบ": ["piston"],
  "ปั๊ม": ["pump"],
  "ซีล": ["seal", "ซีลยาง"],
  "โอริง": ["o-ring", "oring", "ซีล"],
  "ลูกปืน": ["bearing", "แบริ่ง"],
  "แบริ่ง": ["bearing", "ลูกปืน"],
  "สายพาน": ["belt"],
  "กรอง": ["filter", "ไส้กรอง"],
  "ไส้กรอง": ["filter", "กรอง"],
  "หัวฉีด": ["injector", "nozzle"],
  "เทอร์โบ": ["turbo", "turbocharger"],
  "หม้อน้ำ": ["radiator", "ระบายความร้อน"],
  "ไดสตาร์ท": ["starter", "มอเตอร์สตาร์ท"],
  "ไดชาร์จ": ["alternator", "ไดชาร์ท"],
  "คอมแอร์": ["compressor", "คอมเพรสเซอร์", "แอร์"],
  "แหนบ": ["leaf spring", "spring", "ช่วงล่าง"],
  "โชค": ["shock absorber", "โชคอัพ", "ช่วงล่าง"],
  "ลูกหมาก": ["ball joint", "tie rod"],
  "เพลา": ["shaft", "axle"],
  "เกียร์": ["gear", "transmission", "ส่งกำลัง"],
  "ยางใน": ["inner tube", "ยาง"],
  "ยางนอก": ["tyre", "tire", "ยาง"],
  "กระบอก": ["cylinder"],
  "วาล์ว": ["valve"],
  "โซลินอยด์": ["solenoid", "วาล์ว"],
  "ไฮดรอลิค": ["hydraulic", "ไฮดรอลิก"],
  "ไฮดรอลิก": ["hydraulic"],
  "โม่": ["mixer", "drum", "ถังโม่"],
  "ใบโม่": ["mixer blade", "โม่"],
  "ปูน": ["concrete", "คอนกรีต"],
  "หัวเก๋ง": ["cab", "cabin", "ตัวถัง"],
  "กระจก": ["glass", "mirror"],
  "ไฟหน้า": ["head lamp", "headlight", "ไฟ"],
  "แบตเตอรี่": ["battery", "แบต"],
  "น้ำมันเครื่อง": ["engine oil", "หล่อลื่น"],
  "จาระบี": ["grease", "หล่อลื่น"],
  "หาง": ["trailer", "พ่วง"],
  "ดั้มพ์": ["dump", "ดัมพ์"],
}

/** ยี่ห้อรถที่มักติดมาท้ายชื่อ — ไม่ใช่ตัวบอกชนิดชิ้นส่วน ตัดออกก่อนให้คะแนน (ยังเก็บไว้ใส่ในชื่อมาตรฐาน) */
export const VEHICLE_WORDS = [
  "hino", "ฮีโน่", "isuzu", "อีซูซุ", "ud", "nissan", "นิสสัน", "volvo", "วอลโว่",
  "mitsubishi", "มิตซู", "fuso", "ฟูโซ่", "scania", "สแกนเนีย", "man", "benz", "เบนซ์",
  "hyundai", "ฮุนได", "sinotruk", "howo", "dongfeng", "jac", "foton",
]

const normalize = (s: string) =>
  (s || "").toLowerCase().replace(/[()\[\]{}.,/\\|"'`~!@#$%^&*+=<>?:;_-]/g, " ").replace(/\s+/g, " ").trim()

/** character bigram ของข้อความ (ตัดช่องว่างออกก่อน) */
function bigrams(s: string): Set<string> {
  const t = normalize(s).replace(/\s/g, "")
  const out = new Set<string>()
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2))
  if (t.length === 1) out.add(t)
  return out
}

/** Dice coefficient — 0..1 ยิ่งสูงยิ่งคล้าย */
function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let hit = 0
  for (const g of a) if (b.has(g)) hit++
  return (2 * hit) / (a.size + b.size)
}

/** ชื่อสินค้า + กลุ่มใน ATMS → ข้อความค้นหาที่ขยายคำพ้องแล้ว */
export function expandQuery(name: string, group?: string): string {
  const base = normalize(`${name} ${group ?? ""}`)
  const extra: string[] = []
  for (const [word, syns] of Object.entries(PART_SYNONYMS)) {
    if (base.includes(normalize(word))) extra.push(...syns)
  }
  let q = `${base} ${extra.join(" ")}`
  for (const v of VEHICLE_WORDS) q = q.split(v).join(" ")   // ยี่ห้อรถไม่ช่วยบอกชนิดชิ้นส่วน
  return q.replace(/\s+/g, " ").trim()
}

/** ใบทั้งหมดของผังสินค้าที่ใช้ได้กับประเภทค่าใช้จ่ายนี้
 *  ประเภท LAB ใช้ L2/L3 ชุด meta.expenseType = "LAB" เท่านั้น ประเภทอื่นใช้ชุดที่ไม่ใช่ LAB
 *  ประเภทที่ไม่มี L3 (LAB/SVC/CLN/TRP) คืนใบระดับ L2 โดยให้ l3 = "" */
export function buildLeaves(rows: MasterCodeRow[], type: string): TaxonomyLeaf[] {
  const isLab = type === "LAB"
  const allowed = L1_FILTER[type] ?? null
  const th = new Map<string, string>()          // "dict:parent:code" → ชื่อไทย
  const en = new Map<string, string>()
  const l1s: MasterCodeRow[] = []
  const l2s: MasterCodeRow[] = []
  const l3s: MasterCodeRow[] = []
  for (const r of rows) {
    const labRow = r.meta?.expenseType === "LAB"
    if (r.dict === "SYSTEM_L1") { l1s.push(r); th.set(`1:${r.code}`, r.th); en.set(`1:${r.code}`, r.en ?? "") }
    else if (r.dict === "SUB_ASSEMBLY_L2" && labRow === isLab) { l2s.push(r); th.set(`2:${r.parent}:${r.code}`, r.th); en.set(`2:${r.parent}:${r.code}`, r.en ?? "") }
    else if (r.dict === "COMPONENT_L3" && labRow === isLab) { l3s.push(r); th.set(`3:${r.parent}:${r.code}`, r.th); en.set(`3:${r.parent}:${r.code}`, r.en ?? "") }
  }
  const okL1 = (code: string) => !allowed || allowed.includes(code)
  const out: TaxonomyLeaf[] = []
  const noL3 = NO_L3_TYPES.includes(type)
  for (const l2 of l2s) {
    const l1 = l2.parent ?? ""
    if (!l1 || !okL1(l1)) continue
    const l1Th = th.get(`1:${l1}`) ?? l1
    const l2Th = l2.th
    if (noL3) {
      out.push({
        l1, l2: l2.code, l3: "", path: `${l1}:${l2.code}`,
        label: `${l1Th} › ${l2Th}`,
        haystack: `${l1Th} ${en.get(`1:${l1}`) ?? ""} ${l2Th} ${l2.en ?? ""}`,
      })
      continue
    }
    const kids = l3s.filter((r) => r.parent === `${l1}:${l2.code}`)
    for (const l3 of kids) {
      out.push({
        l1, l2: l2.code, l3: l3.code, path: `${l1}:${l2.code}:${l3.code}`,
        label: `${l1Th} › ${l2Th} › ${l3.th}`,
        haystack: `${l1Th} ${en.get(`1:${l1}`) ?? ""} ${l2Th} ${l2.en ?? ""} ${l3.th} ${l3.en ?? ""}`,
      })
    }
  }
  return out
}

export type ScoredLeaf = TaxonomyLeaf & { score: number }

/** คัดใบที่เข้าเค้าที่สุด — l1Boost คือ L1 ที่กลุ่มสินค้าของ ATMS ชี้มา (ดู GROUP_HINT) ให้แต้มพิเศษ */
export function retrieveLeaves(
  leaves: TaxonomyLeaf[],
  query: string,
  opts: { limit?: number; l1Boost?: string[] } = {},
): ScoredLeaf[] {
  const qg = bigrams(query)
  const boost = new Set(opts.l1Boost ?? [])
  const scored = leaves.map((leaf) => {
    const base = dice(qg, bigrams(leaf.haystack))
    // กลุ่มใน ATMS บอกระบบมาแล้ว (เช่น "ระบบโม่" → MXS) — ดันใบในระบบนั้นขึ้นมา แต่ไม่ล็อก
    // เพราะกลุ่มใน ATMS ก็ผิดได้ (เคสจริง: หม้อลมคลัทช์ ถูกใส่กลุ่มเบรค)
    return { ...leaf, score: base * (boost.has(leaf.l1) ? 1.35 : 1) }
  })
  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
  const limit = opts.limit ?? 40
  const top = scored.slice(0, limit)
  // ระบบที่กลุ่มชี้มาต้องมีตัวเลือกติดไปด้วยอย่างน้อยระบบละ 3 ใบ แม้คะแนนตัวอักษรจะต่ำ
  // (ชื่อสินค้าบางชิ้นไม่มีคำไหนตรงกับชื่อในผังเลย แต่ระบบถูก — ให้ LLM เห็นตัวเลือกไว้ก่อน)
  for (const l1 of boost) {
    if (top.some((t) => t.l1 === l1)) continue
    top.push(...scored.filter((s) => s.l1 === l1).slice(0, 3))
  }
  return top
}

/** คำที่สะกดได้หลายแบบในงานช่างไทย — ยุบให้เหลือรูปเดียวก่อนเทียบว่า "เป็นชิ้นเดียวกันไหม" */
const SPELL_VARIANTS: [RegExp, string][] = [
  [/คลั[ทต]ช์?|ครัช|คลัช/g, "คลัช"],
  [/เบร[คก]/g, "เบรก"],
  [/ไฮดรอลิ[คก]/g, "ไฮดรอลิก"],
  [/มิล(ลิเมตร)?|มม\./g, "มม"],
]

const spell = (v: string) => {
  let t = normalize(v).replace(/\s/g, "")
  for (const [re, to] of SPELL_VARIANTS) t = t.replace(re, to)
  return t
}

/** ชื่อใหม่ยังเป็น "ชิ้นส่วนเดียวกัน" กับชื่อเดิมไหม — ดูจากคำแรกของชื่อเดิม (คำที่บอกชนิดชิ้นส่วน)
 *  ยอมให้สะกดต่างกันได้ (คลัทช์/คลัตช์) และยอมให้คล้ายกันเกินครึ่ง (ตัดคำท้ายอย่าง "ล่าง" ออกได้)
 *  ใช้เตือนเคสที่ LLM เปลี่ยนชนิดชิ้นส่วนให้ตรงกับหมวดที่มันเลือก เช่น หม้อลมคลัตช์ → แม่ปั๊มคลัตช์ */
export function headPreserved(original: string, proposed: string): boolean {
  const head = original.trim().split(/[\s\d(/,.-]/)[0]
  if (head.length < 3 || !proposed.trim()) return true
  const h = spell(head)
  const p = spell(proposed)
  // ชื่อใหม่ต้องมีคำเดิมอยู่ หรืออย่างน้อยพยางค์แรกของคำเดิม (ชื่อใหม่สลับลำดับคำได้ จึงดูทั้งสตริง)
  // ไม่ใช้คะแนนความคล้ายทั้งชื่อ เพราะ "กากบาทเพลาปั่นโม่" กับ "เพลาปั่นโม่" คล้ายกัน 77% แต่คนละชิ้น
  return p.includes(h) || p.includes(h.slice(0, 3))
}
