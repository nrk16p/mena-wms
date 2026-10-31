"use client"

import { useEffect, useState } from "react"

type Done<T> = { key: string; rows: T[]; error: string }

// ค้นหาแบบรอหยุดพิมพ์ 300 ms · อย่างน้อย 2 ตัวอักษร · ยกเลิกคำขอเก่าทุกครั้งที่พิมพ์ใหม่ (ATMS เปราะ ห้ามยิงรัว)
export function useLookup<T>(kind: string, q: string, extra: Record<string, string | number | undefined> = {}) {
  const [done, setDone] = useState<Done<T> | null>(null)
  const term = q.trim()
  const extraKey = JSON.stringify(extra)
  const key = `${kind}|${term}|${extraKey}`
  const tooShort = term.length < 2

  useEffect(() => {
    if (term.length < 2) return
    const ctl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const sp = new URLSearchParams({ q: term, limit: "20" })
        for (const [k, v] of Object.entries(JSON.parse(extraKey) as Record<string, string | number | undefined>)) if (v != null && v !== "") sp.set(k, String(v))
        const r = await fetch(`/api/store-withdraw/lookup/${kind}?${sp}`, { signal: ctl.signal })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || "ค้นหาไม่สำเร็จ ลองใหม่อีกครั้ง")
        setDone({ key, rows: j.results ?? [], error: "" })
      } catch (e) {
        if (ctl.signal.aborted) return
        setDone({ key, rows: [], error: e instanceof Error ? e.message : "ค้นหาไม่สำเร็จ ลองใหม่อีกครั้ง" })
      }
    }, 300)
    return () => { clearTimeout(t); ctl.abort() }
  }, [kind, term, extraKey, key])

  const fresh = !tooShort && done?.key === key ? done : null
  return { rows: fresh?.rows ?? [], error: fresh?.error ?? "", loading: !tooShort && !fresh, tooShort }
}
