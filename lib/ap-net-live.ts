// lib/ap-net-live.ts — ดึง "รวมสุทธิ" ของใบ DD สดจาก ATMS ผ่าน api-ncac
//
// ทำไม: `atms.deposit_header.amount_net` ถูกเติมโดยไปป์ไลน์เป็นรอบ ใบที่ถูกแก้ VAT ใน ATMS
// หลังรอบนั้นจะค้างยอดเดิม (เคส KKDD26090025 — ATMS 3,959 แต่ WMS โชว์ 3,700 อยู่ 6 วัน
// จนผู้ใช้แจ้ง 19/10/2026) จึงต้องดึงสด ณ จุดที่คนอ่านยอดและจุดที่คนตัดสินใจเรื่องเงิน
//
// กติกา
//   · ห้ามคำนวณ VAT เอง — ยอดสุทธิมาจากหน้าใบ DD ของ ATMS เท่านั้น (ดู lib/ap-tracking.ts)
//   · fail-open: ATMS/NCAC ล่ม = คืน null แล้วให้ผู้เรียกใช้ค่าในฐานต่อ **ห้ามบล็อกงานบัญชี**
//     เพราะยอดเก่ากว่าหลายชั่วโมงยังทำงานต่อได้ แต่หน้าจอค้างทั้งหน้าทำงานไม่ได้เลย
//   · เรียกเฉพาะใบที่ผู้ใช้เห็น/แตะ ไม่เคยยิงทั้งเดือน (ต้นทุน = 1 request/ใบ ที่ฝั่ง ATMS)
const NCAC = process.env.NCAC_BASE ?? "https://api-ncac.onrender.com"
const KEY  = process.env.NCAC_API_KEY ?? "mena-pipeline-2026"

/** เพดานฝั่ง api-ncac ต่อคำขอ — มากกว่านี้ต้องแบ่งก้อน */
export const AP_NET_LIVE_MAX = 100

export type ApNetLiveRow = {
  depositCode: string
  /** "รวมสุทธิ" ที่ ATMS โชว์ (string ตามหน้าเว็บ เช่น "3,959.00") — null = อ่านไม่ได้ */
  amountNet: string | null
  grandTotal: string | null
  vatRate: string | null
  vatAmount: string | null
  /** atms = ดึงสดรอบนี้ · cache = เพิ่งดึงไปไม่ถึงนาที · error/not_found = ใช้ค่าในฐานต่อ */
  source: "atms" | "cache" | "error" | "not_found"
  /** ยอดสุทธิต่างจากที่เก็บไว้ก่อนรอบนี้ (เฉพาะ source=atms) */
  changed: boolean
}

type RawRow = {
  deposit_code?: unknown; amount_net?: unknown; grand_total?: unknown
  vat_rate?: unknown; vat_amount?: unknown; source?: unknown; changed?: unknown
}

const str = (v: unknown) => (v == null ? null : String(v).trim() || null)

/** ยอดสุทธิล่าสุดของใบที่ระบุ · คืน Map ว่างเมื่อเรียก NCAC ไม่ได้ (ผู้เรียกใช้ค่าในฐานต่อ) */
export async function fetchLiveNet(
  codes: string[],
  opts: { force?: boolean; timeoutMs?: number } = {},
): Promise<Map<string, ApNetLiveRow>> {
  const list = [...new Set(codes.map((c) => c.trim()).filter(Boolean))].slice(0, AP_NET_LIVE_MAX)
  const out = new Map<string, ApNetLiveRow>()
  if (!list.length) return out
  // จุดจ่ายเงินต้องได้ของสด แต่ก็ต้องไม่แขวนหน้าจอไว้กับ ATMS — 12 วิพอสำหรับ 100 ใบ
  // (วัดจริง 19/10/2026: 12 เธรด ~50 ใบ/วิ) · หมดเวลา = ถือว่าเรียกไม่ได้ ใช้ค่าในฐาน
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 12_000)
  try {
    const res = await fetch(`${NCAC}/atms/deposit/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY },
      body: JSON.stringify({ codes: list, force: Boolean(opts.force) }),
      cache: "no-store",
      signal: ctl.signal,
    })
    if (!res.ok) {
      console.warn(`[ap-net-live] NCAC ${res.status} — ใช้ยอดในฐานต่อ (${list.length} ใบ)`)
      return out
    }
    const data = await res.json().catch(() => null) as { rows?: RawRow[] } | null
    for (const r of data?.rows ?? []) {
      const code = str(r.deposit_code)
      if (!code) continue
      const source = String(r.source ?? "error")
      out.set(code, {
        depositCode: code,
        amountNet: str(r.amount_net),
        grandTotal: str(r.grand_total),
        vatRate: str(r.vat_rate),
        vatAmount: str(r.vat_amount),
        source: (["atms", "cache", "error", "not_found"] as const).includes(source as never)
          ? (source as ApNetLiveRow["source"]) : "error",
        changed: Boolean(r.changed),
      })
    }
  } catch (e) {
    // เงียบไม่ได้ — ถ้าเรียกไม่ได้ทุกครั้ง ยอดจะกลับไปเก่าโดยไม่มีใครรู้ (เคส 19/10/2026 ซ้ำ)
    console.warn(`[ap-net-live] เรียก NCAC ไม่สำเร็จ: ${e instanceof Error ? e.message : e}`)
    return out                       // timeout / NCAC ล่ม — fail-open ตามกติกาด้านบน
  } finally {
    clearTimeout(timer)
  }
  return out
}

/** ตัวเลขของยอดสุทธิที่ดึงสดมา — null เมื่ออ่านไม่ได้ (ผู้เรียกต้องถอยไปใช้ค่าในฐาน) */
export function liveNetNumber(row: ApNetLiveRow | undefined): number | null {
  if (!row?.amountNet) return null
  const n = Number(row.amountNet.replace(/,/g, ""))
  return Number.isFinite(n) && n > 0 ? n : null
}
