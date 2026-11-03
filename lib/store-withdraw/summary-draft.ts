// lib/store-withdraw/summary-draft.ts — ตรรกะล้วนของหน้าสรุปการใช้รายคัน (/store-withdraw/{no}/summary)
// ใช้ได้ทั้งเบราว์เซอร์และเทสต์ (ไม่แตะ DB/env/DOM) · ร่างเก็บใน localStorage ตาม draftKey(no)
import { MAX_SUMMARY_ATTACH, issuedOf, normPlate } from "./pending"
import type { SwLine } from "./types"

const EPS = 1e-9
const round = (n: number) => Math.round(n * 1e6) / 1e6

/** ไฟล์ที่อัปโหลดเสร็จแล้ว (เก็บในร่างได้ · ไฟล์ที่ยังอัปโหลดไม่เสร็จไม่เก็บ) */
export type DraftFile = { id: string; name: string; type: string }
export type DraftPart = { key: string; lineIndex: number; qty: number; files: DraftFile[] }
export type DraftVehicle = {
  key: string
  plate: string
  mrCode: string
  mrItems: { id: number; label: string }[]
  mrItemId: number | null
  files: DraftFile[]   // รูปหลักฐานของทั้งคัน ครอบทุกอะไหล่ในบล็อก
  parts: DraftPart[]
}
export type Draft = { v: 1; no: string; vehicles: DraftVehicle[]; note: string; savedAt: number }

export const DRAFT_VERSION = 1
export const draftKey = (no: string) => `sw-summary-draft:${no}`
export const emptyVehicle = (key: string, plate = ""): DraftVehicle => ({ key, plate, mrCode: "", mrItems: [], mrItemId: null, files: [], parts: [] })

/** ใช้ไปแล้วรวมต่อบรรทัด (ทุกคัน) · ยกเว้นแถว skip ({vKey, pKey}) ใช้ตอนหาเพดานของแถวที่กำลังแก้ */
export function usedByLine(vehicles: DraftVehicle[], skip?: { vKey: string; pKey: string }): Map<number, number> {
  const m = new Map<number, number>()
  for (const v of vehicles) for (const p of v.parts) {
    if (skip && v.key === skip.vKey && p.key === skip.pKey) continue
    if (p.qty > 0) m.set(p.lineIndex, round((m.get(p.lineIndex) ?? 0) + p.qty))
  }
  return m
}

/** ต่อบรรทัดที่จ่ายจริง > 0: เบิก · ใช้ไปแล้ว · เหลือคืน (= เบิก − ใช้ · ติดลบ = ใช้เกิน) */
export function partCounters(lines: Pick<SwLine, "issuedQty" | "requestedQty">[], vehicles: DraftVehicle[]) {
  const used = usedByLine(vehicles)
  return lines
    .map((l, i) => ({ lineIndex: i, issued: issuedOf(l) }))
    .filter((x) => x.issued > 0)
    .map((x) => {
      const u = used.get(x.lineIndex) ?? 0
      return { ...x, used: u, left: round(x.issued - u) }
    })
}

/** จำนวนสูงสุดที่แถวนี้ใส่ได้ = เบิก − ที่แถวอื่นใช้ไปแล้ว (ไม่ต่ำกว่า 0) */
export function maxForPart(lines: Pick<SwLine, "issuedQty" | "requestedQty">[], vehicles: DraftVehicle[], vKey: string, pKey: string, lineIndex: number): number {
  const l = lines[lineIndex]
  if (!l) return 0
  const others = usedByLine(vehicles, { vKey, pKey }).get(lineIndex) ?? 0
  return Math.max(0, round(issuedOf(l) - others))
}

/** ปุ่ม +/− และช่องพิมพ์: ตัดให้อยู่ใน [0, max] ทศนิยมไม่เกิน 6 ตำแหน่ง · อ่านไม่ออก = 0 */
export function clampQty(raw: unknown, max: number): number {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(",", "."))
  if (!Number.isFinite(n) || n <= 0) return 0
  return round(Math.min(n, Math.max(0, max)))
}

/** บรรทัดที่ยังเพิ่มเข้าคันนี้ได้: ยังเหลือให้แบ่ง และยังไม่อยู่ในบล็อกนี้ */
export function addableLines(lines: Pick<SwLine, "issuedQty" | "requestedQty">[], vehicles: DraftVehicle[], vKey: string): number[] {
  const v = vehicles.find((x) => x.key === vKey)
  const inBlock = new Set((v?.parts ?? []).map((p) => p.lineIndex))
  return partCounters(lines, vehicles).filter((c) => c.left > EPS && !inBlock.has(c.lineIndex)).map((c) => c.lineIndex)
}

/** id หลักฐานของแถวอะไหล่ = รูปของทั้งคัน + รูปเพิ่มของแถวนั้น (ไม่ซ้ำ) */
export const rowAttachIds = (v: DraftVehicle, p: DraftPart) => [...new Set([...v.files.map((f) => f.id), ...p.files.map((f) => f.id)])]

/** สิ่งที่ยังขาดของบล็อกรถ (null = พร้อมส่ง) — ข้อความสั้นไว้โชว์ใต้บล็อก */
export function vehicleProblem(v: DraftVehicle): string | null {
  if (!v.plate.trim()) return "ใส่ทะเบียนหรือเบอร์รถ"
  if (!v.mrCode) return "เลือก MR ของรถคันนี้"
  if (!v.mrItemId || !v.mrItems.some((m) => m.id === v.mrItemId)) return v.mrItems.length ? "เลือกประเภทการซ่อม" : "เลือก MR จากรายการที่ค้นเจอ จะได้เลือกประเภทการซ่อม"
  if (v.parts.length === 0) return "เพิ่มอะไหล่ที่ใช้กับคันนี้"
  if (v.parts.some((p) => !(p.qty > 0))) return "ใส่จำนวนที่ใช้ให้ครบทุกรายการ (หรือเอารายการที่ไม่ได้ใช้ออก)"
  if (v.parts.some((p) => rowAttachIds(v, p).length === 0)) return "แนบรูปหลักฐานของคันนี้อย่างน้อย 1 รูป"
  return null
}

/** ปัญหาทั้งร่าง: บล็อกที่ยังไม่ครบ · ใช้เกินที่เบิก · ไฟล์เกินเพดาน (ว่าง = ส่งได้) */
export function draftProblems(lines: (Pick<SwLine, "issuedQty" | "requestedQty"> & { skuName?: string })[], d: Pick<Draft, "vehicles">): string[] {
  const out: string[] = []
  d.vehicles.forEach((v, i) => {
    const p = vehicleProblem(v)
    if (p) out.push(`คันที่ ${i + 1}: ${p}`)
  })
  for (const c of partCounters(lines, d.vehicles)) {
    if (c.left < -EPS) out.push(`${lines[c.lineIndex]?.skuName ?? `รายการที่ ${c.lineIndex + 1}`}: ใช้เกินที่เบิกไป ${round(-c.left)}`)
  }
  const ids = new Set(d.vehicles.flatMap((v) => [...v.files, ...v.parts.flatMap((p) => p.files)].map((f) => f.id)))
  if (ids.size > MAX_SUMMARY_ATTACH) out.push(`แนบรูปได้ไม่เกิน ${MAX_SUMMARY_ATTACH} ไฟล์ต่อใบ`)
  return out
}

/** แปลงร่างเป็น usages ที่ส่ง POST /summary · ทุกแถวได้ id รูปของทั้งคัน + รูปเพิ่มของแถว */
export function toUsages(d: Pick<Draft, "vehicles">) {
  const rows: { lineIndex: number; plate: string; mrCode: string; mrItemId: number; mrItemLabel: string; qty: number; attachmentIds: string[] }[] = []
  for (const v of d.vehicles) {
    const it = v.mrItems.find((m) => m.id === v.mrItemId)
    if (!it) continue
    for (const p of v.parts) {
      if (!(p.qty > 0)) continue
      rows.push({ lineIndex: p.lineIndex, plate: v.plate.trim(), mrCode: v.mrCode, mrItemId: it.id, mrItemLabel: it.label, qty: p.qty, attachmentIds: rowAttachIds(v, p) })
    }
  }
  return rows
}

/** สรุปยอดสำหรับแถบล่าง/หน้ายืนยัน */
export function draftTotals(lines: Pick<SwLine, "issuedQty" | "requestedQty">[], d: Pick<Draft, "vehicles">) {
  const c = partCounters(lines, d.vehicles)
  const plates = new Set(d.vehicles.map((v) => normPlate(v.plate)).filter(Boolean))
  return {
    used: round(c.reduce((a, x) => a + x.used, 0)),
    left: round(c.reduce((a, x) => a + Math.max(0, x.left), 0)),
    vehicles: plates.size,
    leftover: c.filter((x) => x.left > EPS).map((x) => ({ lineIndex: x.lineIndex, qty: x.left })),
  }
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)
const sStr = (x: unknown, max: number) => (typeof x === "string" ? x.slice(0, max) : "")

function cleanFiles(raw: unknown): DraftFile[] {
  if (!Array.isArray(raw)) return []
  const out: DraftFile[] = []
  for (const f of raw) {
    if (!isObj(f) || typeof f.id !== "string" || !f.id || f.id.length > 64) continue
    if (out.some((x) => x.id === f.id)) continue
    out.push({ id: f.id, name: sStr(f.name, 200) || "ไฟล์", type: sStr(f.type, 60) })
  }
  return out
}

/**
 * กู้ร่างจาก localStorage: อ่านไม่ออก / คนละใบ / คนละรุ่น = null · บรรทัดที่ไม่มีในใบหรือจ่าย 0 ถูกตัดทิ้ง
 * จำนวนถูกตัดให้ไม่เกินที่เบิก (เรียงตามลำดับในร่าง) กันร่างเก่าที่จำนวนจ่ายเปลี่ยนไปแล้ว
 */
export function parseDraft(raw: string | null | undefined, no: string, lines: Pick<SwLine, "issuedQty" | "requestedQty">[]): Draft | null {
  if (!raw) return null
  let j: unknown
  try { j = JSON.parse(raw) } catch { return null }
  if (!isObj(j) || j.v !== DRAFT_VERSION || j.no !== no || !Array.isArray(j.vehicles)) return null
  const left = lines.map((l) => issuedOf(l))
  const vehicles: DraftVehicle[] = []
  const keys = new Set<string>()
  for (const [i, rv] of j.vehicles.entries()) {
    if (!isObj(rv)) continue
    let key = sStr(rv.key, 40) || `v${i}`
    while (keys.has(key)) key += "_"
    keys.add(key)
    const mrItems = Array.isArray(rv.mrItems)
      ? rv.mrItems.filter((m): m is { id: number; label: string } => isObj(m) && Number.isInteger(m.id) && (m.id as number) > 0 && typeof m.label === "string").map((m) => ({ id: m.id, label: m.label.slice(0, 200) }))
      : []
    const mrItemId = Number.isInteger(rv.mrItemId) && mrItems.some((m) => m.id === rv.mrItemId) ? (rv.mrItemId as number) : null
    const parts: DraftPart[] = []
    const pkeys = new Set<string>()
    if (Array.isArray(rv.parts)) for (const [k, rp] of rv.parts.entries()) {
      if (!isObj(rp)) continue
      const li = Number(rp.lineIndex)
      if (!Number.isInteger(li) || li < 0 || li >= lines.length || !(issuedOf(lines[li]) > EPS)) continue
      if (parts.some((p) => p.lineIndex === li)) continue
      const qty = clampQty(rp.qty, left[li])
      left[li] = round(left[li] - qty)
      let pk = sStr(rp.key, 40) || `p${k}`
      while (pkeys.has(pk)) pk += "_"
      pkeys.add(pk)
      parts.push({ key: pk, lineIndex: li, qty, files: cleanFiles(rp.files) })
    }
    vehicles.push({ key, plate: sStr(rv.plate, 20), mrCode: sStr(rv.mrCode, 40), mrItems, mrItemId, files: cleanFiles(rv.files), parts })
  }
  return { v: 1, no, vehicles, note: sStr(j.note, 500), savedAt: typeof j.savedAt === "number" ? j.savedAt : 0 }
}

/** ร่างว่าง (ไม่มีอะไรให้เก็บ) — ไม่ต้องเขียนลง localStorage */
export const draftIsEmpty = (d: Pick<Draft, "vehicles" | "note">) =>
  !d.note.trim() && d.vehicles.every((v) => !v.mrCode && v.parts.length === 0 && v.files.length === 0)
