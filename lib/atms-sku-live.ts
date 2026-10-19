// lib/atms-sku-live.ts — อ่านทะเบียนสินค้า ATMS รายรหัสสดผ่าน api-ncac
//
// ทำไม: สำเนาทะเบียนสินค้าในฐานเรา (atms_sku_master) ซิงก์คืนละครั้งด้วย /api/cron/atms-sku-sync
// รหัสที่คลังเพิ่งเปิดวันนี้ หรือรหัสที่มีคนแก้ชื่อ/หน่วย/ยี่ห้อวันนี้ จะยังไม่มีหรือยังค้างค่าเดิม
// คนที่กรอก /sku/new จึงได้ข้อมูลผิดหรือหารหัสไม่เจอ — จุดนี้ต้องอ่านของสด ณ วินาทีที่เลือกรหัส
//
// ทำไมผ่าน api-ncac ไม่ยิง ATMS ตรง: ที่นั่น login ใหม่เองได้เมื่อ session หลุด ส่วนที่นี่ถือแค่
// คุกกี้ PHPSESSID ที่ฝังไว้ (ATMS_SKU_SESSION) ซึ่งหมดอายุเงียบ ๆ — ตรวจ 19/10/2026 ค่า fallback
// ในรีโปหมดอายุไปแล้ว ของสดที่ขึ้นกับคุกกี้ตัวนั้นจึงเชื่อถือไม่ได้
//
// กติกา
//   · fail-open: NCAC/ATMS ล่ม = คืน Map ว่าง ให้ผู้เรียกใช้สำเนาในฐานต่อ ห้ามบล็อกการกรอกฟอร์ม
//   · ยิงเฉพาะ "ตอนเลือกรหัส" ไม่ใช่ตอนพิมพ์ทีละตัวอักษร (ATMS login เดียวทั้งระบบ เคยยิงรัวจนทรุด)
const NCAC = process.env.NCAC_BASE ?? "https://api-ncac.onrender.com"
const KEY  = process.env.NCAC_API_KEY ?? "mena-pipeline-2026"

/** เพดานฝั่ง api-ncac ต่อคำขอ */
export const ATMS_SKU_LIVE_MAX = 20

export type AtmsSkuLiveRow = {
  code: string
  name: string
  group: string
  warehouse: string
  warehouses: string[]
  oracleCode: string
  brand: string
  unit: string
  stockQty: number
  minQty: number
  maxQty: number
  skuPk: number | null
}

const str = (v: unknown) => (v == null ? "" : String(v).trim())
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)

/** ข้อมูลรหัสสินค้าสดจาก ATMS · คืน Map ว่างเมื่อเรียกไม่ได้ (ผู้เรียกใช้สำเนาในฐานต่อ) */
export async function fetchLiveSku(
  codes: string[],
  opts: { timeoutMs?: number } = {},
): Promise<Map<string, AtmsSkuLiveRow>> {
  const list = [...new Set(codes.map((c) => c.trim()).filter(Boolean))].slice(0, ATMS_SKU_LIVE_MAX)
  const out = new Map<string, AtmsSkuLiveRow>()
  if (!list.length) return out
  // คนกำลังรออยู่หน้าฟอร์ม — วัดจริง 19/10/2026 รหัสเดียว ~2 วิ · เกิน 10 วิถือว่าเรียกไม่ได้
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 10_000)
  try {
    const url = `${NCAC}/atms/sku/lookup?codes=${encodeURIComponent(list.join(","))}`
    const res = await fetch(url, { headers: { "x-api-key": KEY }, cache: "no-store", signal: ctl.signal })
    if (!res.ok) {
      console.warn(`[atms-sku-live] NCAC ${res.status} — ใช้สำเนาในฐานต่อ (${list.length} รหัส)`)
      return out
    }
    const data = await res.json().catch(() => null) as { rows?: Record<string, unknown>[] } | null
    for (const r of data?.rows ?? []) {
      if (!r?.found) continue
      const code = str(r.code)
      if (!code) continue
      out.set(code, {
        code,
        name: str(r.name),
        group: str(r.group),
        warehouse: str(r.warehouse),
        warehouses: Array.isArray(r.warehouses) ? r.warehouses.map(str).filter(Boolean) : [],
        oracleCode: str(r.oracle_code),
        brand: str(r.brand),
        unit: str(r.unit),
        stockQty: num(r.stock_qty),
        minQty: num(r.min_qty),
        maxQty: num(r.max_qty),
        skuPk: typeof r.sku_pk === "number" ? r.sku_pk : null,
      })
    }
  } catch (e) {
    console.warn(`[atms-sku-live] เรียก NCAC ไม่สำเร็จ: ${e instanceof Error ? e.message : e}`)
    return out
  } finally {
    clearTimeout(timer)
  }
  return out
}
