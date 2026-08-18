"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react"
import { swalError, swalToast } from "@/lib/swal"
import { thaiDate, thaiDateTime } from "@/lib/ap-tracking"
import { CARD, NUM, mitr } from "@/components/ap-style"

// รูปร่างเอกสารที่ pipeline atms_audit เขียนไว้ที่ atms.deposit_audit
type Month = { ym: string; atms: number | null; mongo: number; diff: number | null; with_items: number }
type MissingItem = { deposit_code: string; amount: string; month: string }
type Audit = {
  at: string
  since: string
  ok: boolean
  months: Month[]
  totals: { atms: number; mongo: number; with_items: number; diff: number; unreadable_months: number }
  missing_items: MissingItem[]
  missing_items_total: number
}

const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number)
  return `${TH_MONTHS[(m || 1) - 1]} ${((y || 0) + 543) % 100}`
}
const n = (v: number) => v.toLocaleString("th-TH")
const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 100))

export function ApAuditPage() {
  const [audit, setAudit] = useState<Audit | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ap-tracking/audit", { cache: "no-store" })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? "โหลดผลตรวจไม่สำเร็จ")
      setAudit(d.audit ?? null)
      return d.audit as Audit | null
    } catch (e) {
      swalError(e instanceof Error ? e.message : "โหลดผลตรวจไม่สำเร็จ")
      return null
    } finally { setLoading(false) }
  }, [])

  // เริ่มโหลดนอก render pass (setTimeout 0) — เรียก load() ตรง ๆ ใน effect จะ setState
  // แบบ synchronous ทำให้ render ซ้อนโดยไม่จำเป็น · ref กันไม่ให้ยิงซ้ำตอน effect รันรอบสอง
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  // สั่งตรวจสด แล้วรอผลใหม่ — ตัวตรวจใช้เวลาไม่กี่วินาที แต่ Render อาจ cold start จึงรอได้ถึง 2 นาที
  const runNow = async () => {
    if (running) return
    setRunning(true)
    const before = audit?.at ?? ""
    try {
      const res = await fetch("/api/ap-tracking/audit", { method: "POST" })
      const d = await res.json()
      if (res.status === 429) { swalToast("info", `เพิ่งตรวจไปเมื่อกี้ — ลองใหม่ในอีก ${d.retry_after_min} นาที`); return }
      if (!res.ok) throw new Error(d?.detail ? JSON.stringify(d.detail) : (d?.error ?? "สั่งตรวจไม่สำเร็จ"))
      swalToast("success", "สั่งตรวจแล้ว — กำลังรอผล")
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 5000))
        const fresh = await load()
        if (fresh && fresh.at !== before) { swalToast("success", "ตรวจเสร็จแล้ว"); return }
      }
      swalToast("info", "ยังไม่ได้ผลใหม่ — กดรีเฟรชอีกครั้งในอีกสักครู่")
    } catch (e) {
      swalError(e instanceof Error ? e.message : "สั่งตรวจไม่สำเร็จ")
    } finally { setRunning(false) }
  }

  const ok = audit?.ok ?? false
  const diff = audit?.totals.diff ?? 0

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/ap-tracking" className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" aria-label="กลับหน้าติดตามเจ้าหนี้">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <h1 className="text-lg font-bold tracking-tight text-[#14271C] dark:text-white" style={mitr}>ผลตรวจความครบถ้วน</h1>
          </div>
          <div className="text-[11px] text-gray-400">
            {audit ? `ตรวจล่าสุด ${thaiDateTime(audit.at)}` : loading ? "กำลังโหลด…" : "ยังไม่เคยตรวจ"}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={runNow} disabled={running}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5">
            <RefreshCw className={`h-4 w-4 ${running ? "animate-spin" : ""}`} />
            {running ? "กำลังตรวจ…" : "ตรวจเดี๋ยวนี้"}
          </button>
        </div>
      </div>

      {/* ผลชี้ขาดต้องอ่านออกตั้งแต่แถบแรก ไม่ต้องไล่ตาราง */}
      {audit && (
        <div className={`${CARD} flex flex-wrap items-center gap-3 p-4 ${ok
          ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20"
          : "border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20"}`}>
          {ok ? <ShieldCheck className="h-6 w-6 shrink-0 text-emerald-600 dark:text-emerald-400" />
              : <TriangleAlert className="h-6 w-6 shrink-0 text-amber-600 dark:text-amber-400" />}
          <div>
            <div className="font-bold" style={mitr}>
              {ok ? "ข้อมูลครบทุกเดือน" : "พบความไม่ตรงกัน"}
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-300">
              ATMS <span className={NUM}>{n(audit.totals.atms)}</span> ใบ · ในระบบ <span className={NUM}>{n(audit.totals.mongo)}</span> ใบ
              {diff !== 0 && <> · <span className="font-medium text-amber-700 dark:text-amber-400">ต่าง {n(Math.abs(diff))} ใบ</span></>}
              {audit.missing_items_total > 0 && <> · <span className="font-medium text-amber-700 dark:text-amber-400">ไม่มีรายการสินค้า {n(audit.missing_items_total)} ใบ</span></>}
              {audit.totals.unreadable_months > 0 && <> · <span className="text-rose-600 dark:text-rose-400">อ่าน ATMS ไม่ได้ {audit.totals.unreadable_months} เดือน</span></>}
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-white/10">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50/80 text-xs text-gray-500 dark:bg-white/5 dark:text-gray-400">
            <tr>
              <th className="px-3 py-2.5 text-left font-medium">เดือน</th>
              <th className="px-3 py-2.5 text-right font-medium">ATMS</th>
              <th className="px-3 py-2.5 text-right font-medium">ในระบบ</th>
              <th className="px-3 py-2.5 text-right font-medium">ต่าง</th>
              <th className="px-3 py-2.5 text-left font-medium">มีรายการสินค้า</th>
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: 8 }).map((_, i) => (
              <tr key={`sk-${i}`} className="border-t border-gray-100 dark:border-white/5">
                <td colSpan={5} className="px-3 py-3"><div className="h-4 animate-pulse rounded bg-gray-100 dark:bg-white/5" /></td>
              </tr>
            ))}
            {audit?.months.map((m) => {
              const p = pct(m.with_items, m.mongo)
              const bad = m.diff !== 0
              return (
                <tr key={m.ym} className="border-t border-gray-100 hover:bg-gray-50/60 dark:border-white/5 dark:hover:bg-white/5">
                  <td className="px-3 py-2.5">{monthLabel(m.ym)}</td>
                  <td className={`px-3 py-2.5 text-right ${NUM}`}>{m.atms === null ? "—" : n(m.atms)}</td>
                  <td className={`px-3 py-2.5 text-right ${NUM}`}>{n(m.mongo)}</td>
                  <td className={`px-3 py-2.5 text-right ${NUM} ${m.diff === null ? "text-rose-600 dark:text-rose-400"
                    : bad ? "font-medium text-amber-700 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                    {m.diff === null ? "อ่านไม่ได้" : m.diff === 0 ? "0" : (m.diff > 0 ? `+${n(m.diff)}` : n(m.diff))}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      {/* แถบสัดส่วน — กวาดสายตาลงคอลัมน์แล้วเห็นเดือนที่ตกทันที ไม่ต้องอ่านตัวเลขทุกแถว */}
                      <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${p}%` }} />
                      </div>
                      <span className={`text-xs text-gray-500 dark:text-gray-400 ${NUM}`}>{n(m.with_items)} · {p}%</span>
                    </div>
                  </td>
                </tr>
              )
            })}
            {!loading && !audit && (
              <tr><td colSpan={5} className="px-3 py-16 text-center text-gray-400">ยังไม่มีผลตรวจ — กด “ตรวจเดี๋ยวนี้”</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ส่วนที่ต้องลงมือจริง — ใบยอด 0.00 ไม่นับ เพราะ ATMS ก็ไม่มีรายการเหมือนกัน */}
      {audit && (
        <div className={`${CARD} p-4`}>
          <h2 className="text-sm font-bold" style={mitr}>ใบที่มียอดเงินแต่ไม่มีรายการสินค้า</h2>
          {audit.missing_items_total === 0 ? (
            <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">ไม่มี — ทุกใบที่มียอดเงินมีรายการสินค้าครบ</p>
          ) : (
            <>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                รอบดึงข้อมูลย้อนหลังแค่ 2 เดือน — ใบที่หลุดหน้าต่างไปแล้วระบบจะไม่ย้อนมาเก็บเอง ต้องสั่งดึงพร้อมระบุวันเริ่ม
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {audit.missing_items.map((x) => (
                  <li key={x.deposit_code} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{x.deposit_code}</span>
                    <span className={`text-gray-500 dark:text-gray-400 ${NUM}`}>{x.amount}</span>
                    <span className="text-xs text-gray-400">{monthLabel(x.month)}</span>
                  </li>
                ))}
              </ul>
              {audit.missing_items_total > audit.missing_items.length && (
                <p className="mt-2 text-xs text-gray-400">แสดง {n(audit.missing_items.length)} จาก {n(audit.missing_items_total)} ใบ</p>
              )}
            </>
          )}
        </div>
      )}

      <p className="text-xs text-gray-400">
        วิธีวัด: อ่านยอดรวมที่ ATMS รายงานบนแถบแบ่งหน้าของหน้าใบรับของ (เดือนละ 1 คำขอ) แล้วเทียบกับจำนวนที่เก็บไว้ในระบบ
        · ตรวจอัตโนมัติทุกวัน 06:00 พร้อมรอบดึงข้อมูลเต็ม
        {audit && <> · นับตั้งแต่ {thaiDate(`${audit.since}-01`)}</>}
      </p>
    </div>
  )
}
