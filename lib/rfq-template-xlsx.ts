// lib/rfq-template-xlsx.ts — เทมเพลต Excel ให้อู่กรอกออฟไลน์แล้วอัปโหลดกลับ (ผู้ใช้ขอ 2026-09-21)
// เลย์เอาต์/ชื่อหัวคอลัมน์มาจาก lib/rfq-import (ที่เดียว) · ช่องกรอกเป็นพื้นเหลือง · ค่าที่กรอกในเว็บแล้วจะเติมมาให้แก้ต่อ
// เฉพาะฝั่ง server · โหลด exceljs ตอนเรียกเท่านั้น
import { SHEET_ORDER, isAnswered, partKey, type RfqInvite, type RfqJob, type RfqPart } from "@/lib/rfq-core"
import { HOW_TO, JOB_COLS, META_SHEET, PART_COLS, RATE_LABEL, RATE_ONSITE_LABEL, SEC_LABOUR, SEC_PARTS } from "@/lib/rfq-import"

const FONT = "Tahoma"
const HEAD = "FF046132", FILLIN = "FFFFF9C4", GRID = "FFE4EEE8", NOTE = "FFF3F4F5"

export async function buildRfqTemplate(inv: RfqInvite, jobs: RfqJob[], parts: RfqPart[]): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default
  const wb = new ExcelJS.Workbook()
  wb.creator = "Mena WMS"
  const border = { top: { style: "thin" as const, color: { argb: GRID } }, left: { style: "thin" as const, color: { argb: GRID } }, bottom: { style: "thin" as const, color: { argb: GRID } }, right: { style: "thin" as const, color: { argb: GRID } } }
  const fill = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } })

  for (const sheet of SHEET_ORDER.filter((x) => inv.sheets.includes(x))) {
    const js = jobs.filter((j) => j.sheet === sheet), ps = parts.filter((p) => p.sheet === sheet)
    if (!js.length && !ps.length) continue
    const title = (js[0] ?? ps[0]).sheetTitle
    const ws = wb.addWorksheet(`${sheet} ${title}`.slice(0, 31).replace(/[\\/?*[\]:]/g, "-"))
    ws.getCell("A1").value = `ใบขอราคา — ${sheet} ${title}`; ws.getCell("A1").font = { name: FONT, bold: true, size: 14 }
    ws.getCell("A2").value = `อู่: ${inv.vendor}   รอบ: ${inv.title}   ปิดรับ: ${inv.deadline}`
    ws.getCell("A3").value = HOW_TO
    ;[2, 3].forEach((r) => { ws.getCell(`A${r}`).font = { name: FONT, size: 10 }; ws.getCell(`A${r}`).fill = fill(NOTE) })

    let row = 5
    const rate = inv.rates?.[sheet]
    if (js.length) {
      ws.getCell(`A${row}`).value = SEC_LABOUR; ws.getCell(`A${row}`).font = { name: FONT, bold: true, size: 12 }; row++
      ws.getCell(`A${row}`).value = RATE_LABEL; ws.getCell(`C${row}`).value = RATE_ONSITE_LABEL
      ws.getCell(`B${row}`).value = rate?.normal ?? ""; ws.getCell(`D${row}`).value = rate?.onsite ?? ""
      for (const c of ["A", "C"]) ws.getCell(`${c}${row}`).font = { name: FONT, bold: true, size: 10 }
      for (const c of ["B", "D"]) { const cell = ws.getCell(`${c}${row}`); cell.fill = fill(FILLIN); cell.border = border; cell.numFmt = "#,##0.##" }
      row += 2
      ws.getRow(row).values = [...JOB_COLS]
      ws.getRow(row).eachCell((c) => { c.font = { name: FONT, bold: true, size: 10, color: { argb: "FFFFFFFF" } }; c.fill = fill(HEAD); c.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; c.border = border })
      row++
      for (const j of js) {
        const raw = inv.items[j.jobCode]; const a = isAnswered(raw) ? raw : undefined
        const skip = a?.mode === "skip"
        ws.getRow(row).values = [j.seq, j.jobCode, j.name, j.scope, j.refHoursL ?? "", j.refHoursS ?? "",
          skip ? "" : a?.L.hours ?? "", skip ? "" : (a?.sameAsL ? a?.L.hours : a?.S.hours) ?? "",
          a?.warrantyMonths ?? "", skip ? "x" : "", a?.note ?? ""]
        ws.getRow(row).eachCell({ includeEmpty: true }, (c, col) => {
          c.font = { name: FONT, size: 10 }; c.border = border; c.alignment = { vertical: "top", wrapText: col === 3 || col === 4 }
          if (col >= 7 && col <= 11) { c.fill = fill(FILLIN); if (col === 7 || col === 8 || col === 9) c.numFmt = "#,##0.##" }
        })
        row++
      }
      row += 2
    }
    if (ps.length) {
      ws.getCell(`A${row}`).value = SEC_PARTS; ws.getCell(`A${row}`).font = { name: FONT, bold: true, size: 12 }; row++
      ws.getRow(row).values = [...PART_COLS]
      ws.getRow(row).eachCell((c) => { c.font = { name: FONT, bold: true, size: 10, color: { argb: "FFFFFFFF" } }; c.fill = fill(HEAD); c.alignment = { horizontal: "center", wrapText: true }; c.border = border })
      row++
      for (const p of ps) {
        const a = inv.parts[partKey(p.sheet, p.sku)]
        ws.getRow(row).values = [p.seq, p.sku, p.name, p.useWith, p.unit,
          a?.skip ? "" : a?.priceL ?? "", a?.skip ? "" : a?.priceS ?? "",
          a?.brand ?? "", a?.warrantyMonths ?? "", a?.leadDays ?? "", a?.skip ? "x" : "", a?.note ?? ""]
        ws.getRow(row).eachCell({ includeEmpty: true }, (c, col) => {
          c.font = { name: FONT, size: 10 }; c.border = border
          if (col >= 6 && col <= 12) { c.fill = fill(FILLIN); if (col === 6 || col === 7 || col === 9 || col === 10) c.numFmt = "#,##0.##" }
        })
        row++
      }
    }
    ws.columns = [6, 16, 34, 40, 10, 10, 12, 12, 12, 12, 26].map((w) => ({ width: w }))
    ws.views = [{ state: "frozen", ySplit: js.length ? 8 : 6 }]
  }

  // ชีตซ่อน: ผูกไฟล์กับใบนี้ (ตอนอัปโหลดจะตรวจ token ให้ตรงกัน)
  const meta = wb.addWorksheet(META_SHEET)
  meta.addRows([["token", inv.token], ["catalogVersion", inv.catalogVersion], ["sheets", inv.sheets.join(",")], ["vendor", inv.vendor], ["generatedAt", new Date().toISOString()]])
  meta.state = "veryHidden"
  return Buffer.from(await wb.xlsx.writeBuffer())
}
