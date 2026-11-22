"use client"

import { useEffect, useState } from "react"

export type HubHit = { skuId: number; skuCode: string; skuName: string; unit: string; vendorCode: string; vendorName: string; qty: number }

type Done = { key: string; rows: HubHit[]; error: string }

/**
 * ค้นอะไหล่ที่อยู่ใน Hub (รอหยุดพิมพ์ 300 ms · ≥ 2 ตัว) — ใช้ในช่องค้นอะไหล่ช่องเดียวของฟอร์มขอเบิก (SkuPicker)
 * ยิงเฉพาะตอน enabled (คลังนี้เปิด Hub + ประเภทงานเบิก Hub ได้) · ฟอร์มเช็กก่อนแล้วค่อยเปิด
 */
export function useHubLookup(q: string, inventoryId: number | undefined, enabled: boolean) {
  const [done, setDone] = useState<Done | null>(null)
  const term = q.trim()
  const on = enabled && !!inventoryId
  const tooShort = term.length < 2
  const key = `${inventoryId ?? ""}|${term}`

  useEffect(() => {
    if (!on || term.length < 2 || !inventoryId) return
    const ctl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const sp = new URLSearchParams({ inventoryId: String(inventoryId), q: term, limit: "20" })
        const r = await fetch(`/api/store-withdraw/hub/items?${sp}`, { signal: ctl.signal })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || "ค้น Hub ไม่สำเร็จ ลองใหม่อีกครั้ง")
        setDone({ key, rows: j.results ?? [], error: "" })
      } catch (e) {
        if (ctl.signal.aborted) return
        setDone({ key, rows: [], error: e instanceof Error ? e.message : "ค้น Hub ไม่สำเร็จ ลองใหม่อีกครั้ง" })
      }
    }, 300)
    return () => { clearTimeout(t); ctl.abort() }
  }, [on, term, inventoryId, key])

  const fresh = on && !tooShort && done?.key === key ? done : null
  return { rows: fresh?.rows ?? [], error: fresh?.error ?? "", loading: on && !tooShort && !fresh }
}
