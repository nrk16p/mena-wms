// scripts/check-pdfmake-printer.ts — รัน: npx tsx scripts/check-pdfmake-printer.ts
import assert from "node:assert/strict"
import fs from "node:fs"
import { renderPdfmake, seg, fixThaiMarks } from "../lib/pdfmake-printer"

// wrapped in an async IIFE: this repo's tsx runs scripts as CJS, which rejects top-level await
async function main() {
  assert.equal(fixThaiMarks("ค้ำ"), "คํ้า")
  assert.ok(seg("ผู้จัดทำ").includes("ผู้จัด"), "ผู้ ต้องไม่ถูกแยกจากคำถัดไป")
  assert.equal(seg(""), "")
  // ก่อน ๆ/ฯ ต้องเป็น NBSP (U+00A0) ไม่ใช่ space ธรรมดา (U+0020) -- กัน ๆ/ฯ ขึ้นต้นบรรทัดเดี่ยว
  assert.ok(seg("ต่าง ๆ").endsWith("\u00A0ๆ"))
  assert.ok(!seg("ต่าง ๆ").includes(" ๆ"))
  assert.ok(seg("ราคา ฯลฯ").includes("\u00A0ฯ"))

  const pdf = await renderPdfmake({
    pageSize: "A4", pageOrientation: "landscape",
    defaultStyle: { font: "Sarabun", fontSize: 10 },
    content: [{ text: seg("แบบบันทึกผลการเปรียบเทียบราคา — ทดสอบฟอนต์ไทย น้ำมันเกียร์ ค้ำประกัน"), bold: true }],
  })
  assert.ok(pdf.length > 1000)
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-")
  fs.mkdirSync("tmp", { recursive: true })
  fs.writeFileSync("tmp/check-pdfmake-printer.pdf", pdf)
  console.log("check-pdfmake-printer: OK → tmp/check-pdfmake-printer.pdf")
}

main()
