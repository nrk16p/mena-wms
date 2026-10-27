"use client"
// ดาวน์โหลด Excel ของหน้าเจ้าหนี้ — ชีต "บิล" (ตามที่กรองอยู่) + ชีต "รายการสินค้า" (ดึงจาก API ทีเดียวทุกใบ)
// โหลด xlsx ตอนกดเท่านั้น หน้าแรกจะได้ไม่หนัก
import {
  vpBillSheetRows, vpItemSheetRows, vpExportFileName, VP_EXPORT_MAX, type VpBill, type VpItem,
} from "@/lib/vendor-portal"

type Result = { ok: true } | { ok: false; unauthorized?: boolean; error: string }

const DATE_COLS = new Set(["วันที่รับของ", "กำหนดโอน", "วันที่โอน"])
const MONEY_COLS = new Set(["ยอดเงิน", "ราคาต่อหน่วย", "ยอดรวม"])

// "2026-10-21" → เลขวันแบบ Excel (นับจาก 30/12/1899) — เขียนเลขตรง ๆ ไม่ผ่าน Date
// เพราะ Date ของ JS โดนเขตเวลาเลื่อนวันได้ (ทดสอบแล้วเลื่อนไปวันก่อนหน้า)
const excelSerial = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? (Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - Date.UTC(1899, 11, 30)) / 86400000 : null
}

export async function downloadVpExcel(bills: VpBill[], username: string, todayISO: string): Promise<Result> {
  if (!bills.length) return { ok: false, error: "ไม่มีบิลให้ดาวน์โหลด" }
  if (bills.length > VP_EXPORT_MAX) return { ok: false, error: `ดาวน์โหลดได้ครั้งละไม่เกิน ${VP_EXPORT_MAX} ใบ กรองให้น้อยลงแล้วลองใหม่` }

  const res = await fetch("/api/vendor-portal/export-items", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ codes: bills.map((b) => b.depositCode) }),
  }).catch(() => null)
  if (!res) return { ok: false, error: "เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง" }
  if (res.status === 401) return { ok: false, unauthorized: true, error: "" }
  const d = await res.json().catch(() => ({}))
  if (!res.ok) return { ok: false, error: d?.error ?? "เตรียมไฟล์ไม่สำเร็จ" }
  const itemRows = (d.rows ?? []) as { depositCode: string; receivedAt: string; items: VpItem[] | null }[]

  const XLSX = await import("xlsx")
  const build = (rows: Record<string, string | number>[], widths: number[]) => {
    const ws = XLSX.utils.json_to_sheet(rows)
    const head = Object.keys(rows[0] ?? {})
    head.forEach((k, c) => {
      if (!MONEY_COLS.has(k) && !DATE_COLS.has(k)) return
      for (let r = 1; r <= rows.length; r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })]
        if (!cell) continue
        if (MONEY_COLS.has(k) && cell.t === "n") cell.z = "#,##0.00"
        const serial = DATE_COLS.has(k) && cell.t === "s" ? excelSerial(String(cell.v)) : null
        if (serial !== null) Object.assign(cell, { t: "n", v: serial, z: "dd/mm/yyyy", w: undefined })
      }
    })
    ws["!cols"] = widths.map((wch) => ({ wch }))
    return ws
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, build(vpBillSheetRows(bills), [15, 12, 18, 10, 12, 14, 16, 12, 12]), "บิล")
  const items = vpItemSheetRows(itemRows)
  if (items.length) XLSX.utils.book_append_sheet(wb, build(items, [15, 12, 16, 40, 10, 14, 14]), "รายการสินค้า")
  XLSX.writeFile(wb, vpExportFileName(username, todayISO))
  return { ok: true }
}
