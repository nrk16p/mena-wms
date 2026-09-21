// lib/rfq-import.ts — ตรรกะล้วนของ "กรอกผ่าน Excel" (ผู้ใช้ขอ 2026-09-21)
// ไฟล์นี้ไม่แตะ exceljs/xlsx และไม่แตะ DB — รับตารางเซลล์ดิบ (unknown[][]) ที่ตัวอ่านไฟล์แปลงมาให้
// เลย์เอาต์เทมเพลตอยู่ที่นี่ที่เดียว ทั้งฝั่งสร้างไฟล์ (lib/rfq-template-xlsx) และฝั่งอ่านไฟล์ใช้ชุดเดียวกัน
import { MAX_HOURS, partKey, type RfqJob, type RfqPart } from "@/lib/rfq-core"

export const META_SHEET = "_meta"
export const SEC_LABOUR = "ส่วนที่ 1 · ค่าแรง"
export const SEC_PARTS = "ส่วนที่ 2 · อะไหล่"
export const RATE_LABEL = "อัตราค่าแรงปกติ (บาท/ชม.)"
export const RATE_ONSITE_LABEL = "ค่าแรงนอกสถานที่ (บาท/ชม.)"
export const HOW_TO = "วิธีกรอก: เติมเฉพาะช่องสีเหลือง · ห้ามแก้รหัสงาน/รหัสอะไหล่ · ช่องที่เว้นว่างจะไม่ถูกแก้ในเว็บ"

/** หัวตาราง — ลำดับคอลัมน์ตอนสร้างไฟล์ · ตอนอ่านหาตำแหน่งจากชื่อหัวคอลัมน์ ไม่ยึดตำแหน่งตายตัว */
export const JOB_COLS = ["ลำดับ", "รหัสงาน", "ชื่องาน", "ขอบเขตงานที่รวมในราคา", "ชม.อ้างอิง L", "ชม.อ้างอิง S", "ชม. Mixer L", "ชม. Mixer S", "รับประกัน (เดือน)", "ไม่รับงาน (x)", "หมายเหตุ"] as const
export const PART_COLS = ["ลำดับ", "รหัสอะไหล่", "รายการอะไหล่", "ใช้กับ", "หน่วย", "฿ Mixer L", "฿ Mixer S", "ยี่ห้อ/สเปกที่เสนอ", "รับประกัน (เดือน)", "ส่งมอบ (วัน)", "ไม่มีจำหน่าย (x)", "หมายเหตุ"] as const

export type ImportRate = { sheet: string; normal?: unknown; onsite?: unknown }
export type ImportResult = {
  rates: Record<string, { normal?: unknown; onsite?: unknown }>
  items: Record<string, unknown>
  parts: Record<string, unknown>
  problems: string[]
  /** จำนวนที่จะเขียนจริง — ใช้โชว์ให้อู่ตรวจก่อนยืนยัน */
  counts: { rates: number; items: number; parts: number; skipped: number }
}

const s = (v: unknown) => String(v ?? "").trim()
const has = (v: unknown) => s(v) !== ""
/** ช่องติ๊ก: x / X / ✓ / / / ใช่ / ไม่รับ — อะไรก็ได้ที่ไม่ว่างถือว่าติ๊ก ยกเว้น 0 กับ - */
const marked = (v: unknown) => { const t = s(v).toLowerCase(); return t !== "" && t !== "0" && t !== "-" }

/** หาแถวหัวตารางจากชื่อคอลัมน์แรก ๆ แล้วคืน map ชื่อหัว → index (ยอมให้อู่แทรก/สลับคอลัมน์) */
function headerMap(row: unknown[], cols: readonly string[]): Record<string, number> | null {
  const out: Record<string, number> = {}
  let hit = 0
  row.forEach((cell, i) => { const t = s(cell); if ((cols as readonly string[]).includes(t) && !(t in out)) { out[t] = i; hit++ } })
  return hit >= 3 ? out : null
}

/** อ่าน 1 ชีตของไฟล์เทมเพลต · jobs/parts = รายการที่ใบนี้ให้เสนอ (ใช้ตรวจว่ารหัสมีจริง) */
export function parseSheet(sheet: string, rows: unknown[][], jobs: RfqJob[], parts: RfqPart[], out: ImportResult): void {
  const jobOk = new Map(jobs.filter((j) => j.sheet === sheet).map((j) => [j.jobCode, j]))
  const partOk = new Map(parts.filter((p) => p.sheet === sheet).map((p) => [p.sku, p]))
  let section: "" | "labour" | "parts" = ""
  let head: Record<string, number> | null = null
  for (const row of rows) {
    const a = s(row[0])
    if (a.startsWith(SEC_LABOUR)) { section = "labour"; head = null; continue }
    if (a.startsWith(SEC_PARTS)) { section = "parts"; head = null; continue }
    if (a.startsWith(RATE_LABEL)) {
      // แถวอัตรา: [ป้าย, ค่าปกติ, ป้ายนอกสถานที่, ค่านอกสถานที่]
      const normal = row[1], onsite = row.findIndex((c) => s(c).startsWith(RATE_ONSITE_LABEL)) >= 0 ? row[row.findIndex((c) => s(c).startsWith(RATE_ONSITE_LABEL)) + 1] : undefined
      if (has(normal) || has(onsite)) {
        out.rates[sheet] = { ...(has(normal) ? { normal } : {}), ...(has(onsite) ? { onsite } : {}) }
        out.counts.rates++
      }
      continue
    }
    if (!section) continue
    const cols = section === "labour" ? JOB_COLS : PART_COLS
    const h = headerMap(row, cols)
    if (h) { head = h; continue }
    if (!head) continue
    const code = s(row[head[section === "labour" ? "รหัสงาน" : "รหัสอะไหล่"]])
    if (!code) continue
    if (section === "labour") {
      if (!jobOk.has(code)) { out.problems.push(`${sheet}: ไม่มีรหัสงาน ${code} ในใบนี้ (ข้าม)`); continue }
      const skip = marked(row[head["ไม่รับงาน (x)"]])
      const hL = row[head["ชม. Mixer L"]], hS = row[head["ชม. Mixer S"]]
      if (!skip && !has(hL) && !has(hS)) { out.counts.skipped++; continue }   // เว้นว่าง = ไม่แตะของเดิม
      for (const [label, v] of [["ชม. Mixer L", hL], ["ชม. Mixer S", hS]] as const) {
        const n = Number(s(v).replace(/,/g, ""))
        if (has(v) && (!Number.isFinite(n) || n < 0)) out.problems.push(`${sheet} ${code}: ${label} ไม่ใช่ตัวเลข (${s(v)})`)
        else if (has(v) && n > MAX_HOURS) out.problems.push(`${sheet} ${code}: ${label} = ${n} เกิน ${MAX_HOURS} ชม. (ช่องนี้กรอกชั่วโมง ไม่ใช่ราคา)`)
      }
      out.items[code] = skip
        ? { mode: "skip", L: {}, S: {}, sameAsL: true, note: s(row[head["หมายเหตุ"]]) }
        : { mode: "hours", L: { hours: has(hL) ? hL : undefined }, S: { hours: has(hS) ? hS : hL }, sameAsL: !has(hS) || s(hS) === s(hL),
            warrantyMonths: has(row[head["รับประกัน (เดือน)"]]) ? row[head["รับประกัน (เดือน)"]] : undefined, note: s(row[head["หมายเหตุ"]]) }
      out.counts.items++
    } else {
      if (!partOk.has(code)) { out.problems.push(`${sheet}: ไม่มีรหัสอะไหล่ ${code} ในใบนี้ (ข้าม)`); continue }
      const skip = marked(row[head["ไม่มีจำหน่าย (x)"]])
      const pL = row[head["฿ Mixer L"]], pS = row[head["฿ Mixer S"]]
      if (!skip && !has(pL) && !has(pS)) { out.counts.skipped++; continue }
      for (const [label, v] of [["฿ Mixer L", pL], ["฿ Mixer S", pS]] as const) {
        const n = Number(s(v).replace(/,/g, ""))
        if (has(v) && (!Number.isFinite(n) || n < 0)) out.problems.push(`${sheet} ${code}: ${label} ไม่ใช่ตัวเลข (${s(v)})`)
      }
      out.parts[partKey(sheet, code)] = {
        skip, sameAsL: !has(pS) || s(pS) === s(pL),
        priceL: has(pL) ? pL : undefined, priceS: has(pS) ? pS : pL,
        brand: s(row[head["ยี่ห้อ/สเปกที่เสนอ"]]),
        warrantyMonths: has(row[head["รับประกัน (เดือน)"]]) ? row[head["รับประกัน (เดือน)"]] : undefined,
        leadDays: has(row[head["ส่งมอบ (วัน)"]]) ? row[head["ส่งมอบ (วัน)"]] : undefined,
        note: s(row[head["หมายเหตุ"]]),
      }
      out.counts.parts++
    }
  }
}

/** ตรวจชีต _meta ว่าไฟล์นี้เป็นของใบนี้จริง — คืนข้อความผิดพลาด หรือ null ถ้าผ่าน */
export function checkMeta(rows: unknown[][] | undefined, token: string): string | null {
  if (!rows?.length) return "ไฟล์นี้ไม่ใช่เทมเพลตของระบบ (ไม่พบชีต _meta) — กรุณาดาวน์โหลดเทมเพลตใหม่"
  const map = new Map(rows.map((r) => [s(r[0]), s(r[1])]))
  const t = map.get("token")
  if (!t) return "ไฟล์นี้ไม่ใช่เทมเพลตของระบบ (ไม่พบรหัสใบ) — กรุณาดาวน์โหลดเทมเพลตใหม่"
  if (t !== token) return "ไฟล์นี้เป็นเทมเพลตของใบขอราคาใบอื่น — กรุณาดาวน์โหลดเทมเพลตของใบนี้"
  return null
}

/** อ่านทั้งไฟล์: sheets = ชื่อชีต → ตารางเซลล์ · คืนค่าที่ยังไม่ผ่าน validator (ฝั่ง API จะ validate ต่อ) */
export function parseTemplate(
  sheets: Record<string, unknown[][]>, token: string, allowed: string[], jobs: RfqJob[], parts: RfqPart[]
): ImportResult | string {
  const meta = checkMeta(sheets[META_SHEET], token)
  if (meta) return meta
  const out: ImportResult = { rates: {}, items: {}, parts: {}, problems: [], counts: { rates: 0, items: 0, parts: 0, skipped: 0 } }
  for (const [name, rows] of Object.entries(sheets)) {
    if (name === META_SHEET) continue
    const sheet = name.split(" ")[0]   // ชื่อชีต "S45 ระบบโม่ผสม (Mixer)" → รหัสชีต
    if (!allowed.includes(sheet)) { out.problems.push(`ชีต "${name}" ไม่อยู่ในใบนี้ (ข้าม)`); continue }
    parseSheet(sheet, rows, jobs, parts, out)
  }
  if (!out.counts.rates && !out.counts.items && !out.counts.parts) return "ไม่พบข้อมูลที่กรอกในไฟล์ — ตรวจว่ากรอกในช่องสีเหลืองแล้วบันทึกไฟล์"
  return out
}
