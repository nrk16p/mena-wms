// ตรรกะล้วนของ dropdown ช่องค้นอะไหล่ช่องเดียว (สต๊อกคลัง + Hub) ในฟอร์มขอเบิก — ไม่แตะ React/DB
// ทดสอบใน scripts/check-store-withdraw-ui.ts

export type PartsSource<T> = { rows: T[]; loading: boolean; error: string }

/** title null = ไม่มีหัวกลุ่ม (ไม่เปิด Hub → หน้าตาเหมือนช่องค้นเดิม) */
type GroupBase = { title: string | null; loading: boolean; error: string }
export type PartsGroup<H, S> = (GroupBase & { kind: "hub"; rows: H[] }) | (GroupBase & { kind: "stock"; rows: S[] })

export const HUB_GROUP_TITLE = "อะไหล่ Hub (ของฝาก Sub)"
export const STOCK_GROUP_TITLE = "สต๊อกคลัง"

/**
 * จัดกลุ่มผลค้น: Hub ก่อน แล้วสต๊อกคลัง · hub = null คือคลังนี้/งานนี้ไม่เปิด Hub
 * — ไม่เปิด Hub: กลุ่มเดียวไม่มีหัว (เหมือนเดิม)
 * — เปิด Hub: กลุ่มที่ค้นเสร็จแล้วไม่เจออะไรจะซ่อน · ทั้งคู่ไม่เจอ = empty
 */
export function partsDropdown<H, S>(hub: PartsSource<H> | null, stock: PartsSource<S>) {
  const groups: PartsGroup<H, S>[] = []
  const show = (s: PartsSource<unknown>) => s.loading || !!s.error || s.rows.length > 0
  if (!hub) {
    groups.push({ kind: "stock", title: null, ...stock })
    return { groups, empty: !stock.loading && !stock.error && stock.rows.length === 0, loading: false }
  }
  // เปิด Hub: รอให้ทั้งสองฝั่งค้นเสร็จก่อนค่อยโชว์ ไม่งั้นแถวกระโดดแล้วกดผิดตัวได้
  if (hub.loading || stock.loading) return { groups, empty: false, loading: true }
  if (show(hub)) groups.push({ kind: "hub", title: HUB_GROUP_TITLE, ...hub })
  if (show(stock)) groups.push({ kind: "stock", title: STOCK_GROUP_TITLE, ...stock })
  return { groups, empty: groups.length === 0, loading: false }
}
