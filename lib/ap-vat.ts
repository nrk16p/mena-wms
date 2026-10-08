// lib/ap-vat.ts — "รวมสุทธิ" ของใบ DD (ยอดที่ต้องจ่ายจริง) · ฝั่งเซิร์ฟเวอร์เท่านั้น
//
// ปัญหา: atms.deposit_header.amount = ผลรวม deposit_items.total เท่านั้น (ตรวจแล้วตรงทุกใบที่สุ่มดู)
// ซึ่งเป็นยอด "ก่อน VAT" สำหรับผู้ขายที่คิด VAT แยก → หน้า AP เคยโชว์ยอดต่ำกว่าที่จ่ายจริง 7%
//
// VAT อยู่ที่ระดับ "ใบ PO" ไม่ใช่ระดับผู้ขาย — วัดจริง 08/10/2026 กับ PO ทุกใบที่มี DD เดือน ก.ย.–ต.ค. 69
// (1,672 ใบ): purchase_orders.รวม ÷ ผลรวม purchase_order_items.total = 1.0000 (995 ใบ) หรือ
// 1.0700 (677 ใบ) เท่านั้น ไม่มีค่าอื่นเลย · ผู้ขายรายเดียวกันมีทั้งสองแบบได้ (บาง PO คีย์ราคารวม VAT มาแล้ว)
//
// กติกาที่ใช้: รวมสุทธิของใบ DD = amount × factor ของ PO ใบนั้น (1 หรือ 1.07)
//   • รับครบในใบเดียว → ได้เท่ากับ purchase_orders.รวม พอดี
//   • รับหลายงวด (DD หลายใบต่อ PO) → แบ่งตามสัดส่วนของแต่ละงวด ไม่ยัด PO.รวม ทุกงวด (ยอดจะบวมหลายเท่า)
//   • ใบที่ไม่มี PO ผูกใน ATMS (คืนสต๊อก/ค่าแรงรถร่วม/โยกคลัง ~22% ของใบ) → factor 1 = ใช้ amount เดิม
//   • PO ที่อัตราไม่เข้าทั้ง 1.00 และ 1.07 (ข้อมูลเพี้ยน) → factor 1 ไม่เดาแทน ATMS
//
// แคช: รายชื่อ PO ที่มี VAT ทั้งก้อน (ไม่ต่อใบ ไม่ต่อเดือน) — อายุเท่ากับก้อน atms อื่นในหน้า AP
// (สด 2 นาที · ของเก่าไม่เกิน 5 นาที) · 2 คิวรีต่อการโหลด: $group purchase_order_items (index po_code,
// ~20.6k แถว) + สแกน purchase_orders เอาเฉพาะ รหัส/รวม (~15.7k แถว) → ผลที่เก็บเป็นลิสต์รหัส PO ที่มี VAT
import clientPromise from "@/lib/mongo"
import { sharedCache } from "@/lib/shared-cache"
import { AP_VAT_RATE, apVatFactor } from "@/lib/ap-tracking"

const FRESH_MS = 2 * 60_000
const MAX_STALE_MS = 5 * 60_000
const SCAN_MAX_MS = 20_000

const num = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

async function loadVatPoCodes(): Promise<string[]> {
  const atms = (await clientPromise).db("atms")
  const [subs, pos] = await Promise.all([
    atms.collection("purchase_order_items").aggregate(
      [{ $group: { _id: "$po_code", sub: { $sum: "$total" } } }],
      { maxTimeMS: SCAN_MAX_MS },
    ).toArray(),
    atms.collection("purchase_orders")
      .find({}, { projection: { _id: 0, "รหัส": 1, "รวม": 1 } }).maxTimeMS(SCAN_MAX_MS).toArray(),
  ])
  const subBy = new Map<string, number>()
  for (const r of subs) {
    const code = String(r._id ?? "").trim()
    if (code) subBy.set(code, num(r.sub))
  }
  const out: string[] = []
  for (const p of pos) {
    const code = String(p["รหัส"] ?? "").trim()
    if (!code) continue
    if (apVatFactor(num(p["รวม"]), subBy.get(code) ?? 0) > 1) out.push(code)
  }
  return out
}

/** รหัส PO ที่คิด VAT แยก (factor 1.07) — ใบที่ไม่อยู่ในชุดนี้ถือว่ายอด DD เป็นรวมสุทธิอยู่แล้ว */
export async function getVatPoCodes(): Promise<Set<string>> {
  try {
    const codes = await sharedCache.get({
      key: "ap-vat:po", freshMs: FRESH_MS, maxStaleMs: MAX_STALE_MS, load: loadVatPoCodes,
    })
    return new Set(codes)
  } catch (e) {
    // อ่าน VAT ไม่ได้ ไม่ควรทำให้หน้า AP ล้มทั้งหน้า — ถอยไปเท่ากับพฤติกรรมเดิม (ยอดก่อน VAT)
    console.warn("[ap-vat] โหลดรายชื่อ PO ที่มี VAT ไม่สำเร็จ — ใช้ยอดดิบ:", e instanceof Error ? e.message : e)
    return new Set()
  }
}

export { AP_VAT_RATE }
