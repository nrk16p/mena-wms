// ของใช้ร่วมกันในแท็บหน้า Hub: ชนิดข้อมูล · เรียก API · สไตล์ช่อง
export type HubRow = { inventoryId: number; vendorCode: string; skuId: number; skuCode: string; skuName: string; unit: string; price: number | null; active: boolean; qty: number }
export type HubVendor = { code: string; name: string; active: boolean }
export type HubSite = { inventoryId: number; atmsHubInventoryId: number; active: boolean }
export type InvOpt = { id: number; name: string }

export const inputCls = "rounded-xl border border-[#E2E8E4] bg-white px-3 py-2.5 text-sm dark:border-white/10 dark:bg-[#0f1117]"
export const btnCls = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-[#1B8C4B] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
export const btnGhost = "inline-flex min-h-9 items-center gap-1 rounded-lg border border-[#E2E8E4] px-3 py-1.5 text-sm text-gray-700 hover:text-[#1B8C4B] disabled:opacity-60 dark:border-white/10 dark:text-gray-200"
export const tableWrap = "overflow-x-auto rounded-2xl border border-[#EEF2F0] dark:border-white/10"
export const th = "px-3 py-2"
export const thead = "bg-[#F6F8F7] text-xs text-gray-500 dark:bg-white/5"
export const tr = "border-t border-[#EEF2F0] dark:border-white/10"

export const num = (n: number) => n.toLocaleString("th-TH", { maximumFractionDigits: 3 })

/** เรียก API Hub แล้วคืน JSON · ไม่ ok = throw ข้อความจากเซิร์ฟเวอร์ (409 ก็ผ่านทางนี้) */
export async function hubFetch<T = Record<string, unknown>>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const r = await fetch(url, init ? { method: init.method ?? "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body) } : undefined)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((j as { error?: string }).error || "ทำรายการไม่สำเร็จ")
  return j as T
}
