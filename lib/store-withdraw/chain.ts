// lib/store-withdraw/chain.ts — โซ่แฮชของ log ต่อใบ (ล้วน ไม่แตะ DB) · แต่ละรายการ: seq ต่อใบ + hash = sha256(prevHash + canonicalJSON(รายการไม่รวม hash))
import { createHash } from "node:crypto"

/** JSON แบบเรียงคีย์ตายตัว · Date → ISO · ข้าม undefined */
export function canonicalJson(v: unknown): string {
  if (v instanceof Date) return JSON.stringify(v.toISOString())
  if (Array.isArray(v)) return "[" + v.map((x) => (x === undefined ? "null" : canonicalJson(x))).join(",") + "]"
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>
    return "{" + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(o[k])).join(",") + "}"
  }
  return JSON.stringify(v ?? null)
}

export type ChainEntry = { no: string; seq?: number; hash?: string; [k: string]: unknown }

export function entryHash(prevHash: string, entry: Record<string, unknown>): string {
  const { hash: _h, _id: _i, ...rest } = entry
  void _h; void _i
  return createHash("sha256").update(prevHash + canonicalJson(rest)).digest("hex")
}

export type ChainResult = { ok: boolean; checked: number; brokenAt?: number }

/**
 * ตรวจโซ่จากรายการของใบเดียว (ลำดับใดก็ได้) · รายการเก่าที่ไม่มี hash = ส่วนหน้าที่ไม่ได้ตรวจ
 * เริ่มตรวจที่รายการแรกที่มี hash (ต้องเป็น seq 1) · seq ขาด/ซ้ำ/hash ไม่ตรง = brokenAt ที่ลำดับนั้น
 */
export function verifyEntries(all: ChainEntry[]): ChainResult {
  const hashed = all.filter((e) => e.hash !== undefined || e.seq !== undefined).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  let prev = ""
  let expect = 1
  let checked = 0
  for (const e of hashed) {
    if (typeof e.seq !== "number" || typeof e.hash !== "string" || e.seq !== expect || entryHash(prev, e) !== e.hash) {
      return { ok: false, checked, brokenAt: typeof e.seq === "number" && e.seq === expect ? e.seq : expect }
    }
    prev = e.hash
    expect++
    checked++
  }
  return { ok: true, checked }
}
