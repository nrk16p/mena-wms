"use client"

// กล่อง "แจ้งการเงิน ขอจ่ายนอกรอบ" — สร้างข้อความจากใบที่เลือก (ราย DD เลือกหลายใบได้)
// คัดลอกหรือเด้งเปิดโปรแกรมอีเมล (mailto:) — ไม่มีการส่งจากเซิร์ฟเวอร์ จึงไม่มี infra ให้ดูแล
import { useMemo, useState } from "react"
import { Copy, Mail } from "lucide-react"
import { swalToast } from "@/lib/swal"
import { apFinanceRequestText, nextThursday, thaiDate, todayICT, upcomingThursdays, type ApFinanceItem } from "@/lib/ap-tracking"
import { NUM, baht, mitr } from "@/components/ap-style"

const EMAIL_KEY = "apFinanceEmailTo"     // จำอีเมลผู้รับล่าสุดไว้ในเครื่อง — แก้แล้วระบบจำ
// อีเมลกลางสำหรับส่งขอจ่ายนอกรอบ (ผู้ใช้กำหนด 21/08/2026)
const DEFAULT_TO = "account@menatransport.co.th, Account-center@menatransport.co.th, dpFinAcc@menatransport.co.th"
const EMAIL_CC_KEY = "apFinanceEmailCc"
const DEFAULT_CC = "Natchaphak.k@menatransport.co.th"    // สำเนาถึง (ผู้ใช้กำหนด 21/08/2026)

export function ApFinanceRequestDialog({ items, onClose }: { items: ApFinanceItem[]; onClose: () => void }) {
  const [reason, setReason] = useState("")
  const [to, setTo] = useState(() => {
    try { return localStorage.getItem(EMAIL_KEY) || DEFAULT_TO } catch { return DEFAULT_TO }
  })
  const [cc, setCc] = useState(() => {
    try { return localStorage.getItem(EMAIL_CC_KEY) || DEFAULT_CC } catch { return DEFAULT_CC }
  })
  const thursdays = useMemo(() => upcomingThursdays(todayICT(), 4), [])
  const [thu, setThu] = useState(() => nextThursday(todayICT()))

  const { subject, body } = useMemo(() => apFinanceRequestText(items, thu, reason), [items, thu, reason])
  const total = items.reduce((n, it) => n + it.amount, 0)

  const rememberTo = (v: string) => {
    setTo(v)
    try { localStorage.setItem(EMAIL_KEY, v) } catch { /* private mode — จำไม่ได้ก็แค่กรอกใหม่ */ }
  }
  const rememberCc = (v: string) => {
    setCc(v)
    try { localStorage.setItem(EMAIL_CC_KEY, v) } catch { /* เช่นกัน */ }
  }
  const copy = async () => {
    await navigator.clipboard.writeText(body)
    swalToast("success", "คัดลอกข้อความแล้ว")
  }
  // เปิด Gmail compose ในเบราว์เซอร์ (บริษัทใช้ Google Workspace — login เว็บนี้ก็ Google)
  // ดีกว่า mailto ที่ต้องพึ่งแอปเมลในเครื่องซึ่งหลายคนไม่ได้ตั้งค่าไว้
  const openGmail = () => {
    const url = "https://mail.google.com/mail/?view=cm&fs=1"
      + `&to=${encodeURIComponent(to)}${cc.trim() ? `&cc=${encodeURIComponent(cc)}` : ""}`
      + `&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    window.open(url, "_blank", "noopener")
  }
  // ทางสำรองสำหรับคนที่ใช้แอปเมลในเครื่อง (Outlook ฯลฯ)
  const openMailApp = () => {
    window.location.href = `mailto:${encodeURIComponent(to)}?${cc.trim() ? `cc=${encodeURIComponent(cc)}&` : ""}subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }
  // Gmail รับ URL ยาวได้ราว ~8,000 ตัวอักษร — ใบเยอะมากให้ใช้คัดลอกแทน
  const mailtoTooLong = body.length > 6000

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-2xl border border-gray-200/80 bg-white p-4 dark:border-white/10 dark:bg-[#161a23]"
        onClick={(e) => e.stopPropagation()}>
        <div>
          <div className="font-bold" style={mitr}>✉️ แจ้งการเงิน · ขอจ่ายนอกรอบ</div>
          <div className="text-xs text-gray-500">{items.length} ใบ · <span className={NUM}>{baht(total)}</span> บาท</div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block space-y-1 text-xs">
            <span className="text-gray-500">รอบพฤหัสที่ขอจ่าย</span>
            <select value={thu} onChange={(e) => setThu(e.target.value)}
              className="w-full rounded-lg border border-gray-200/80 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-white/5">
              {thursdays.map((d) => <option key={d} value={d}>{thaiDate(d)}</option>)}
            </select>
          </label>
          <label className="block space-y-1 text-xs">
            <span className="flex items-center gap-2 text-gray-500">
              อีเมลผู้รับ (แก้ได้ ระบบจำค่าไว้)
              {/* คนที่เคยพิมพ์อีเมลทดสอบไว้ localStorage จะทับค่ากลาง — ให้กดกลับได้คลิกเดียว */}
              {to !== DEFAULT_TO && (
                <button type="button" onClick={() => rememberTo(DEFAULT_TO)}
                  className="text-emerald-700 underline underline-offset-2 dark:text-emerald-400">ใช้อีเมลกลาง</button>
              )}
            </span>
            <input value={to} onChange={(e) => rememberTo(e.target.value)}
              className="w-full rounded-lg border border-gray-200/80 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-white/5" />
          </label>
          <label className="block space-y-1 text-xs sm:col-span-2">
            <span className="flex items-center gap-2 text-gray-500">
              สำเนาถึง (CC)
              {cc !== DEFAULT_CC && (
                <button type="button" onClick={() => rememberCc(DEFAULT_CC)}
                  className="text-emerald-700 underline underline-offset-2 dark:text-emerald-400">ใช้ค่าเริ่มต้น</button>
              )}
            </span>
            <input value={cc} onChange={(e) => rememberCc(e.target.value)}
              className="w-full rounded-lg border border-gray-200/80 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-white/5" />
          </label>
        </div>

        <label className="block space-y-1 text-xs">
          <span className="text-gray-500">สาเหตุที่ตกรอบ (เว้นว่างได้ — ข้อความจะเว้นช่องไว้ให้เติม)</span>
          <textarea value={reason} rows={2} maxLength={300}
            onChange={(e) => setReason(e.target.value)}
            placeholder="เช่น เอกสารประกอบมีการแก้ไข ทำให้ติดตามไม่ทันรอบ"
            className="w-full rounded-lg border border-gray-200/80 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-white/5" />
        </label>

        {/* ตัวอย่างข้อความจริงที่จะได้ — เห็นก่อนคัดลอก/ส่ง ไม่ต้องเดา */}
        <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs leading-relaxed dark:bg-white/5">{body}</pre>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {mailtoTooLong && <span className="mr-auto text-[11px] text-amber-600">ข้อความยาวมาก — เบราว์เซอร์อาจตัด แนะนำใช้คัดลอกแล้ววางเอง</span>}
          <button onClick={onClose}
            className="rounded-lg border border-gray-200/80 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">ปิด</button>
          <button onClick={openMailApp} title="เปิดโปรแกรมเมลในเครื่อง (Outlook ฯลฯ)"
            className="rounded-lg border border-gray-200/80 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">
            แอปเมล
          </button>
          <button onClick={copy}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200/80 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">
            <Copy className="h-4 w-4" />คัดลอก
          </button>
          <button onClick={openGmail}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">
            <Mail className="h-4 w-4" />เปิด Gmail
          </button>
        </div>
      </div>
    </div>
  )
}
