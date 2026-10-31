import type { AtmsProgress, SwLine, SwRequest, SwReturn } from "@/lib/store-withdraw/types"

// รูปแบบที่ /api/store-withdraw/queue ส่งมาหลัง JSON (วันที่เป็นสตริง ISO)
export type QReturn = Omit<SwReturn, "createdAt" | "atms"> & { createdAt: string; atms: Omit<AtmsProgress, "lastCheckAt" | "startedAt"> & { lastCheckAt: string | null; startedAt: string | null } }
export type QItem = Omit<SwRequest, "createdAt" | "updatedAt" | "returns" | "atms" | "lines"> & {
  atms: QReturn["atms"]
  lines: SwLine[]
  createdAt: string
  updatedAt: string
  returns: QReturn[]
  itemType: "request" | "return"
  return?: QReturn
}
export type QKeyed = { id: number | null; code: string; pick_to: string; user: string; remark: string; created_at: string; approved: boolean }
export type QData = {
  columns: { NEW: QItem[]; PREPARING: QItem[]; READY: QItem[]; DONE_TODAY: QItem[] }
  atmsKeyed: QKeyed[]
}
export type LinkStatus = { linked: boolean; atmsUsername?: string; branch?: string }

export const itemKey = (i: QItem) => (i.itemType === "return" && i.return ? `${i.no}:${i.return.rid}` : i.no)

export async function api(url: string, init?: { method?: string; body?: unknown }) {
  const r = await fetch(url, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.error || "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง"), { status: r.status })
  return j
}
