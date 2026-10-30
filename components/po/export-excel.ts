"use client"
// ดาวน์โหลด Excel หน้า /po — ชีต "ใบสั่งซื้อ" (ตามที่กรองอยู่) + ชีต "รายการสินค้า"
// รายการสินค้าดึงทีละ PO_ITEMS_CHUNK ใบ (ทีละ 3 request) · โหลด xlsx ตอนกดเท่านั้น หน้าแรกจะได้ไม่หนัก
import {
  poSheetRows, poItemSheetRows, poExportFileName, PO_ITEMS_CHUNK, PO_SHEET_DATE_COLS, PO_SHEET_MONEY_COLS,
  type PoDateField, type PoItem, type PoRow,
} from "@/lib/po-export"

type Result = { ok: true } | { ok: false; error: string }

// "2026-10-21" → เลขวันแบบ Excel — เขียนเลขตรง ๆ ไม่ผ่าน Date ของ JS (เขตเวลาเลื่อนวันได้)
const excelSerial = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? (Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - Date.UTC(1899, 11, 30)) / 86400000 : null
}

async function fetchItems(codes: string[], onProgress: (done: number) => void): Promise<Map<string, PoItem[]> | string> {
  const chunks: string[][] = []
  for (let i = 0; i < codes.length; i += PO_ITEMS_CHUNK) chunks.push(codes.slice(i, i + PO_ITEMS_CHUNK))
  const out = new Map<string, PoItem[]>()
  let next = 0, done = 0, failed = ""
  const worker = async () => {
    while (next < chunks.length && !failed) {
      const chunk = chunks[next++]
      const res = await fetch(`/api/po/items?codes=${encodeURIComponent(chunk.join(","))}`).catch(() => null)
      const d = res ? await res.json().catch(() => ({})) : {}
      if (!res || !res.ok) { failed = d?.error ?? "โหลดรายการสินค้าไม่สำเร็จ ลองใหม่อีกครั้ง"; return }
      for (const [code, list] of Object.entries((d.items ?? {}) as Record<string, PoItem[]>)) out.set(code, list)
      done += chunk.length
      onProgress(done)
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return failed || out
}

export async function downloadPoExcel(
  rows: PoRow[], range: { from: string; to: string; field: PoDateField }, onProgress: (pct: number) => void,
): Promise<Result> {
  if (!rows.length) return { ok: false, error: "ไม่มีใบสั่งซื้อให้ดาวน์โหลด" }
  const items = await fetchItems(rows.map((r) => r.code), (done) => onProgress(Math.round((done / rows.length) * 90)))
  if (typeof items === "string") return { ok: false, error: items }

  const XLSX = await import("xlsx")
  const build = (data: Record<string, string | number>[], widths: Record<string, number>) => {
    const ws = XLSX.utils.json_to_sheet(data)
    const head = Object.keys(data[0] ?? {})
    head.forEach((k, c) => {
      if (!PO_SHEET_MONEY_COLS.has(k) && !PO_SHEET_DATE_COLS.has(k)) return
      for (let r = 1; r <= data.length; r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })]
        if (!cell) continue
        if (PO_SHEET_MONEY_COLS.has(k) && cell.t === "n") cell.z = "#,##0.00"
        const serial = PO_SHEET_DATE_COLS.has(k) && cell.t === "s" ? excelSerial(String(cell.v)) : null
        if (serial !== null) Object.assign(cell, { t: "n", v: serial, z: "dd/mm/yyyy", w: undefined })
      }
    })
    ws["!cols"] = head.map((k) => ({ wch: widths[k] ?? Math.min(Math.max(k.length + 2, 12), 30) }))
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: data.length, c: Math.max(head.length - 1, 0) } }) }
    return ws
  }

  const counts = new Map([...items].map(([code, list]) => [code, list.length]))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, build(poSheetRows(rows, counts), {
    "เลขที่ PO": 15, "ซัพพลายเออร์": 34, "สถานะการรับสินค้า": 20, "ยอดรวม": 14, "ใบขอซื้อ (PR)": 15,
    "ใบรับของ (DD)": 30, "วันที่รับของ": 24, "หมายเหตุ PR": 50, "คลังสินค้า": 18,
  }), "ใบสั่งซื้อ")
  XLSX.utils.book_append_sheet(wb, build(poItemSheetRows(rows, items), {
    "เลขที่ PO": 15, "ซัพพลายเออร์": 30, "สถานะการรับสินค้า": 20, "กลุ่มสินค้า": 18, "รหัสสินค้า": 18,
    "ชื่อสินค้า": 44, "ราคาต่อหน่วย": 14, "รวม": 14, "หมายเหตุ": 30,
  }), "รายการสินค้า")
  onProgress(100)
  XLSX.writeFile(wb, poExportFileName(range.from, range.to, range.field))
  return { ok: true }
}
