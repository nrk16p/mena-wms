"use client"

/**
 * เลขใบแจ้งซ่อม (MR / Job) → ลิงก์เปิดหน้าใบนั้นบน ATMS
 *
 * ATMS เปิดหน้าใบด้วย "internal id" ไม่ใช่เลขที่ใบ (เช่น SBMR26080287) จึงต้องแปลงก่อน
 * ผ่าน `GET /api/atms/maintenance-request/by-code/[code]` ซึ่งคืน `view_url` มาให้
 *
 * ทำเป็น <a> จริงที่ href ชี้ไป `?go=1` (ฝั่ง server redirect ให้เลย) — คลิกกลาง /
 * ctrl+click / "เปิดในแท็บใหม่" จึงใช้ได้ตามปกติ ส่วนการคลิกซ้ายธรรมดาถูกดักไว้เพื่อ
 * เปิดแท็บเปล่ารอก่อน (กัน popup blocker) แล้วค่อยพาไปที่ view_url เมื่อ lookup สำเร็จ
 *
 * เลขที่หาไม่เจอใน ATMS (พิมพ์ผิด / ยังไม่ sync) ต้องบอกผู้ใช้ตรง ๆ — ปล่อยให้ `?go=1`
 * ทำงานเองจะได้แท็บที่โชว์ JSON error ดิบ ซึ่งไม่มีใครอ่านรู้เรื่อง
 */

import { useState } from "react"
import { ExternalLink, Loader2 } from "lucide-react"
import { swalError } from "@/lib/swal"

const lookupUrl = (code: string) =>
  `/api/atms/maintenance-request/by-code/${encodeURIComponent(code)}`

export function AtmsJobLink({ code, className = "", iconSize = 10, title = "เปิดใบแจ้งซ่อมบน ATMS" }: {
  code: string
  className?: string
  iconSize?: number
  title?: string
}) {
  const [loading, setLoading] = useState(false)

  async function open(e: React.MouseEvent) {
    // ปล่อยให้เบราว์เซอร์จัดการเองเมื่อผู้ใช้สั่งเปิดแท็บ/หน้าต่างใหม่ด้วยตัวเอง
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    if (loading) return

    // เปิดแท็บทันทีระหว่างยังอยู่ในจังหวะที่ผู้ใช้กด — เปิดหลัง await จะโดน popup blocker
    const tab = window.open("", "_blank")
    setLoading(true)
    try {
      const res = await fetch(lookupUrl(code))
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d?.view_url) {
        tab?.close()
        swalError(
          res.status === 404
            ? `ไม่พบเลข ${code} ใน ATMS — ตรวจว่าพิมพ์ถูกไหม หรือใบยังไม่ถูก sync`
            : `เปิดใบ ${code} ไม่สำเร็จ — ATMS ไม่ตอบ กรุณาลองใหม่`
        )
        return
      }
      if (tab) tab.location.href = String(d.view_url)
      else window.open(String(d.view_url), "_blank", "noreferrer")
    } catch {
      tab?.close()
      swalError(`เปิดใบ ${code} ไม่สำเร็จ — เชื่อมต่อ ATMS ไม่ได้`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <a
      href={`${lookupUrl(code)}?go=1`}
      target="_blank"
      rel="noreferrer"
      onClick={open}
      title={title}
      className={
        "inline-flex items-center gap-0.5 font-mono font-semibold text-blue-700 underline decoration-dotted underline-offset-2 transition-opacity hover:opacity-75 dark:text-blue-300 " +
        className
      }
    >
      {code}
      {loading
        ? <Loader2 size={iconSize} className="animate-spin" />
        : <ExternalLink size={iconSize} />}
    </a>
  )
}
