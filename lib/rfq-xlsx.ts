// lib/rfq-xlsx.ts — ใบเสนอราคาอู่ → Excel เลย์เอาต์เดียวกับฟอร์มต้นฉบับ (1 ชีตต่อระบบ)
// เฉพาะฝั่ง server (route) · โหลด exceljs ตอนเรียกเท่านั้น
import { SHEET_ORDER, partKey, isAnswered, jobCost, type RfqInvite, type RfqJob, type RfqPart } from "@/lib/rfq-core"

const FONT = "Tahoma"
const HEAD = "FF1B8C4B", BAND_L = "FFE4EFE8", BAND_S = "FFDBEAFE", YELLOW = "FFFFF9C4", GRID = "FFE4EEE8"

export async function buildRfqWorkbook(inv: RfqInvite, jobs: RfqJob[], parts: RfqPart[]): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default
  const wb = new ExcelJS.Workbook()
  wb.creator = "Mena WMS"
  const border = { top: { style: "thin" as const, color: { argb: GRID } }, left: { style: "thin" as const, color: { argb: GRID } }, bottom: { style: "thin" as const, color: { argb: GRID } }, right: { style: "thin" as const, color: { argb: GRID } } }
  const fill = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } })
  for (const sheet of SHEET_ORDER.filter((s) => inv.sheets.includes(s))) {
    const js = jobs.filter((j) => j.sheet === sheet), ps = parts.filter((p) => p.sheet === sheet)
    if (!js.length && !ps.length) continue
    const title = (js[0] ?? ps[0]).sheetTitle
    const ws = wb.addWorksheet(`${sheet} ${title}`.slice(0, 31).replace(/[\\/?*[\]:]/g, "-"))
    ws.views = [{ state: "frozen", ySplit: 8 }]
    ws.getCell("A1").value = `ใบเสนอราคางานซ่อม — ${sheet} ${title}`; ws.getCell("A1").font = { name: FONT, bold: true, size: 14 }
    ws.getCell("A2").value = `ผู้เสนอราคา (อู่/ร้าน): ${inv.vendor}   ผู้ติดต่อ: ${inv.contact?.name ?? "—"} ${inv.contact?.phone ?? ""} ${inv.contact?.email ?? ""}`
    ws.getCell("A3").value = `รอบ: ${inv.title}   สถานะ: ${inv.status}   ส่งเมื่อ: ${inv.submittedAt ?? "—"}` + (inv.confirm ? `   ราคามีผล ${inv.confirm.validFrom} – ${inv.confirm.validTo}` : "")
    ;[2, 3].forEach((r) => { ws.getCell(`A${r}`).font = { name: FONT, size: 10 } })
    ws.getCell("A5").value = "ส่วนที่ 1 · ค่าแรง — อัตราต่อชั่วโมง × ชั่วโมงต่องาน"; ws.getCell("A5").font = { name: FONT, bold: true, size: 12 }
    // แถว 6 อัตราค่าแรงของชีต · แถว 7 กลุ่มคอลัมน์ · แถว 8 ชื่อคอลัมน์ (14 คอลัมน์ — ตัดเหมา เบา/กลาง/หนัก ออก 2026-09-18)
    const rate = inv.rates?.[sheet]
    const rateTxt = (n: number | undefined) => (n === undefined || n === null ? null : `${n.toLocaleString("th-TH")} บาท/ชม.`)
    ws.getCell("A6").value = !js.length ? "ไม่มีงานค่าแรงในชีตนี้"
      : `อัตราค่าแรง (ใช้ทั้ง Mixer L และ S): ปกติ ${rateTxt(rate?.normal) ?? "ยังไม่กรอก"} · นอกสถานที่ ${rateTxt(rate?.onsite) ?? (rate?.normal != null ? "ไม่รับ" : "ยังไม่กรอก")}`
    ws.getCell("A6").font = { name: FONT, bold: true, size: 10 }
    ws.mergeCells("G7:H7"); ws.getCell("G7").value = "ชั่วโมงที่เสนอ"
    ws.mergeCells("I7:J7"); ws.getCell("I7").value = "ค่าแรงปกติ (บาท)"; ws.getCell("I7").fill = fill(BAND_L)
    ws.mergeCells("K7:L7"); ws.getCell("K7").value = "ค่าแรงนอกสถานที่ (บาท)"; ws.getCell("K7").fill = fill(BAND_S)
    const H = ["ลำดับ", "รหัสงาน", "ชื่องาน", "ขอบเขตงานที่รวมในราคา", "ชม.อ้างอิง L", "ชม.อ้างอิง S", "ชม. Mixer L", "ชม. Mixer S", "Mixer L", "Mixer S", "Mixer L", "Mixer S", "รับประกัน (เดือน)", "หมายเหตุ"]
    ws.getRow(8).values = H
    for (let r = 7; r <= 8; r++) ws.getRow(r).eachCell((c) => { c.font = { name: FONT, bold: true, size: 10, color: r === 8 ? { argb: "FFFFFFFF" } : undefined }; if (r === 8) c.fill = fill(HEAD); c.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; c.border = border })
    ws.columns = [6, 14, 30, 40, 10, 10, 10, 10, 11, 11, 11, 11, 10, 24].map((w) => ({ width: w }))
    let row = 9
    for (const j of js) {
      const raw = inv.items[j.jobCode]; const a = isAnswered(raw) ? raw : undefined   // คำตอบรูปแบบเก่า (เหมา) = ไม่กรอก
      const skip = a?.mode === "skip"
      const c = jobCost(a, rate)
      const hS = a && !skip ? (a.sameAsL ? a.L.hours : a.S.hours) : undefined
      ws.getRow(row).values = [j.seq, j.jobCode, j.name, j.scope, j.refHoursL ?? "", j.refHoursS ?? "",
        skip ? "" : (a?.L.hours ?? ""), hS ?? "",
        c?.L.normal ?? "", c?.S.normal ?? "", c?.L.onsite ?? "", c?.S.onsite ?? "",
        a?.warrantyMonths ?? "", skip ? `ไม่รับงาน${a?.note ? " · " + a.note : ""}` : (a?.note ?? "")]
      ws.getRow(row).eachCell({ includeEmpty: true }, (cell, col) => { cell.font = { name: FONT, size: 10 }; cell.border = border; cell.alignment = { vertical: "top", wrapText: col >= 3 && col <= 4 }; if (col >= 7 && col <= 13) { cell.numFmt = "#,##0.##"; if (!a) cell.fill = fill(YELLOW) } })
      row++
    }
    if (ps.length) {
      row += 2
      ws.getCell(`A${row}`).value = "ส่วนที่ 2 · อะไหล่ (หน่วย: บาท ไม่รวม VAT)"; ws.getCell(`A${row}`).font = { name: FONT, bold: true, size: 12 }; row++
      ws.mergeCells(`F${row}:F${row}`); ws.getCell(`F${row}`).value = "Mixer L"; ws.getCell(`F${row}`).fill = fill(BAND_L)
      ws.getCell(`G${row}`).value = "Mixer S"; ws.getCell(`G${row}`).fill = fill(BAND_S); row++
      ws.getRow(row).values = ["ลำดับ", "รหัสอะไหล่", "รายการอะไหล่", "ใช้กับ", "หน่วย", "฿/หน่วย", "฿/หน่วย", "ยี่ห้อ/สเปกที่เสนอ", "รับประกัน (เดือน)", "ส่งมอบ (วัน)", "หมายเหตุ"]
      ws.getRow(row).eachCell((c) => { c.font = { name: FONT, bold: true, size: 10, color: { argb: "FFFFFFFF" } }; c.fill = fill(HEAD); c.alignment = { horizontal: "center", wrapText: true }; c.border = border }); row++
      for (const p of ps) {
        const a = inv.parts[partKey(p.sheet, p.sku)]
        ws.getRow(row).values = [p.seq, p.sku, p.name, p.useWith, p.unit, a?.skip ? "ไม่มีจำหน่าย" : (a?.priceL ?? ""), a?.skip ? "" : (a?.priceS ?? ""), a?.brand ?? "", a?.warrantyMonths ?? "", a?.leadDays ?? "", a?.note ?? ""]
        ws.getRow(row).eachCell({ includeEmpty: true }, (c, col) => { c.font = { name: FONT, size: 10 }; c.border = border; if (col === 6 || col === 7) { c.numFmt = "#,##0.##"; if (!a) c.fill = fill(YELLOW) } })
        row++
      }
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer())
}
