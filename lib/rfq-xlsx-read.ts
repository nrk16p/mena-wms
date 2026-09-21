// lib/rfq-xlsx-read.ts — อ่านไฟล์ .xlsx ที่อู่อัปโหลด → ตารางเซลล์ดิบให้ lib/rfq-import แปลงต่อ (ฝั่ง server เท่านั้น)
import * as XLSX from "xlsx"

export function sheetsFromBuffer(buf: Buffer): Record<string, unknown[][]> {
  const wb = XLSX.read(buf, { type: "buffer" })
  const out: Record<string, unknown[][]> = {}
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (ws) out[name] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }) as unknown[][]
  }
  return out
}
