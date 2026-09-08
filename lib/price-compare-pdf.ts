// lib/price-compare-pdf.ts — docDefinition ของ "แบบบันทึกผลการเปรียบเทียบราคา" (A4 แนวนอน หน้าเดียว) + หน้ารูปแนบ
// ตัวเลขทุกช่องมาจาก supplierTotals ใน lib/price-compare เพื่อให้ตรงกับหน้าเว็บเสมอ
import fs from "fs"
import path from "path"
import { seg } from "./pdfmake-printer"
import { supplierTotals, fmtMoney, lineTotal, MAX_SUPPLIERS, DEFAULT_COMMITTEE_ROLES, type PriceCompare, type PcTotals } from "./price-compare"

/* eslint-disable @typescript-eslint/no-explicit-any */
export type ImagePage = { heading: string; pngBase64: string }

const COMPANY = "บริษัท มีนาทรานสปอร์ต จำกัด (มหาชน)"
const FORM_TITLE = "แบบบันทึกผลการเปรียบเทียบราคา   (ราคา 5,000 บาทขึ้นไป)"
const GRAY = "#D9D9D9"     // สีคอลัมน์ Supplier 2 ตามฟอร์ม
const LINE = "#000000"
const MIN_ROWS = 16        // จำนวนแถวรายการขั้นต่ำ (เติมแถวว่างให้เหมือนฟอร์มกระดาษ) — มากกว่านี้แล้วล้นหน้า
const TICK = "√"      // Sarabun ไม่มี U+2713 ✓ — ใช้ √ แทน
const SUP_W = 50           // ความกว้างคอลัมน์ราคาแต่ละช่อง (4 supplier × 2 ช่อง)
const COL1_W = 36          // คอลัมน์ซ้ายสุด: "ลำดับ" / ป้ายเทาของบล็อกเงื่อนไข-กรรมการ (กว้างเท่ากันทั้ง 3 ตาราง)

// โลโก้ในช่องซ้ายบนเป็นตราวงกลม "Mena" อย่างเดียว (mena-mark.png = ครอปจาก mena-logo.jpg ซึ่งเป็นแบนเนอร์ยาว
// มีชื่อบริษัทติดมาด้วย ใส่ในช่องแคบๆ แล้วเล็กจนอ่านไม่ออก) — ไม่มีไฟล์ก็ยังพิมพ์ได้ แค่ขึ้นคำว่า Mena แทน
let LOGO = ""
for (const f of ["mena-mark.png", "mena-logo.jpg"]) {
  try { LOGO = `data:image/${f.endsWith(".png") ? "png" : "jpeg"};base64,${fs.readFileSync(path.join(process.cwd(), "fonts", f)).toString("base64")}`; break } catch { /* ลองไฟล์ถัดไป */ }
}

const thDate = (iso: string): string => {
  if (!iso) return ""
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number)
  if (!y || !m || !d) return ""
  return `${d}/${m}/${y + 543}`
}
/** ข้อความไทยทั่วไป — ผ่าน seg() เพื่อให้ pdfmake ขึ้นบรรทัดตรงรอยคำ */
const t = (text: string, extra: any = {}) => ({ text: seg(text), ...extra })
/** ป้ายสั้นที่ไม่ต้องตัดคำ และต้องค้นเจอแบบตรงตัวใน docDefinition (check script ค้นหาข้อความนี้) */
const raw = (text: string, extra: any = {}) => ({ text, ...extra })
const money = (n: number | null, extra: any = {}) => ({ text: fmtMoney(n), alignment: "right", ...extra })
const cell = (text: string, extra: any = {}) => ({ text, alignment: "center", ...extra })

// เส้นตารางบางแบบฟอร์มกระดาษ
const gridLayout = (pad = 1) => ({
  hLineWidth: () => 0.5, vLineWidth: () => 0.5,
  hLineColor: () => LINE, vLineColor: () => LINE,
  paddingLeft: () => 2, paddingRight: () => 2, paddingTop: () => pad, paddingBottom: () => pad,
})

export function pdfFilename(doc: PriceCompare): string {
  const safe = doc.title.replace(/[\\/:*?"<>|]/g, "-").trim()
  return `${doc.docNo}${safe ? " " + safe : ""}.pdf`
}

export function buildPriceCompareDocDef(doc: PriceCompare, imagePages: ImagePage[] = []): any {
  const N = MAX_SUPPLIERS
  const sup = (i: number) => doc.suppliers[i]   // undefined ถ้าไม่มี
  const totals = Array.from({ length: N }, (_, i) => (sup(i) ? supplierTotals(doc, i) : null))
  const fill = (i: number) => (i === 1 ? { fillColor: GRAY } : {})   // ฟอร์มเดิมทำคอลัมน์ Supplier 2 เป็นสีเทา
  const supCols = Array.from({ length: N * 2 }, () => SUP_W)

  // ---------- ส่วนหัว ----------
  const logoCell = LOGO
    ? { image: LOGO, fit: [COL1_W - 4, 30], alignment: "center", margin: [0, 12, 0, 0] }
    : cell("Mena", { bold: true, margin: [0, 14, 0, 0] })
  const header = {
    table: {
      widths: [COL1_W, 178, 84, "*", 62, 62],
      body: [
        [
          { rowSpan: 3, ...logoCell },
          t(COMPANY, { alignment: "center", fontSize: 8 }),
          { rowSpan: 2, ...t(doc.title, { alignment: "center", bold: true, margin: [0, 7, 0, 0] }) },
          { rowSpan: 2, ...t(FORM_TITLE, { bold: true, alignment: "center", margin: [0, 7, 0, 0] }) },
          t("เลขที่ :", { fontSize: 8 }),
          cell(doc.docNo, { bold: true }),
        ],
        [{}, t("ชื่อสินค้า / งานซ่อม :", { fontSize: 8 }), {}, {}, t("วันที่เริ่มจัดทำ :", { fontSize: 8 }), cell(thDate(doc.createdAt))],
        [
          {}, t("หน่วยงานที่ร้องขอ :", { fontSize: 8 }), t(doc.requestDept, { alignment: "center" }),
          {
            columns: [
              t("ผู้จัดทำ :", { fontSize: 8, width: 42 }),
              t(doc.preparedBy?.name ?? "", { width: "*" }),
              t("ครั้งที่แก้ไข :", { fontSize: 8, width: 52 }),
              { text: String(doc.revision ?? 0), width: 18 },
            ],
          },
          t("วันที่แก้ไขล่าสุด :", { fontSize: 8 }), cell(thDate(doc.updatedAt)),
        ],
      ],
    },
    layout: gridLayout(2),
  }

  // ---------- ตารางเทียบราคา ----------
  const supplierHead = Array.from({ length: N }, (_, i) => [
    { colSpan: 2, ...cell(`Supplier ${i + 1}`, { bold: true, ...fill(i) }) }, {},
  ]).flat()
  const supplierName = Array.from({ length: N }, (_, i) => [
    { colSpan: 2, ...t(sup(i)?.name ?? "", { alignment: "center", bold: true, ...fill(i) }) }, {},
  ]).flat()
  const supplierSub = Array.from({ length: N }, (_, i) => [
    cell("ราคา/หน่วย", { fontSize: 7, ...fill(i) }), t("ยอดรวม", { alignment: "center", fontSize: 7, ...fill(i) }),
  ]).flat()

  const itemRows = doc.items.map((it, r) => [
    cell(String(r + 1)), t(it.name), cell(String(it.qty)), t(it.unit, { alignment: "center" }),
    ...Array.from({ length: N }, (_, i) => {
      const p = sup(i)?.prices[r] ?? null
      return [money(p, fill(i)), money(lineTotal(it, p), fill(i))]
    }).flat(),
  ])
  const emptyRow = () => [
    { text: " " }, {}, {}, {},
    ...Array.from({ length: N }, (_, i) => [{ text: " ", ...fill(i) }, { text: " ", ...fill(i) }]).flat(),
  ]
  // แถวหมายเหตุใต้ราคา (ตามฟอร์ม: เว้น 1 แถวแล้วเขียนคำอธิบายราคาของแต่ละราย)
  const noteRow = [
    { text: " " }, {}, {}, {},
    ...Array.from({ length: N }, (_, i) => [
      { colSpan: 2, ...t(sup(i)?.note ?? "", { fontSize: 7, alignment: "center", bold: true, ...fill(i) }) }, {},
    ]).flat(),
  ]
  const blankRows = Array.from({ length: Math.max(0, MIN_ROWS - doc.items.length - 2) }, emptyRow)

  // ช่อง VAT บอกฐานราคาด้วย: none → "ไม่มี VAT", incl → "(รวมในราคา) / 3,683.18"
  const vatCell = (i: number) => {
    const s = sup(i), tt = totals[i]
    if (!s || !tt) return { text: "", ...fill(i) }
    if (s.vatMode === "none") return t("ไม่มี VAT", { alignment: "right", fontSize: 7, ...fill(i) })
    // ขึ้นบรรทัดเองด้วย array (ช่องกว้าง 50pt ใส่บรรทัดเดียวไม่พอ) และไม่ seg() ป้ายสั้นนี้
    if (s.vatMode === "incl") return { text: ["(รวมในราคา)", "\n", fmtMoney(tt.vat)], alignment: "right", fontSize: 7, ...fill(i) }
    return money(tt.vat, fill(i))
  }
  const sumRow = (label: string, key: keyof PcTotals, bold = false) => [
    { colSpan: 2, ...t(label, { alignment: "center", bold }) }, {}, {}, {},
    ...Array.from({ length: N }, (_, i) => [
      { text: "", ...fill(i) },
      key === "vat" ? vatCell(i) : money(totals[i] ? totals[i]![key] : null, { bold, ...fill(i) }),
    ]).flat(),
  ]
  const priceTable = {
    table: {
      headerRows: 3,
      widths: [COL1_W, "*", 36, 36, ...supCols],
      body: [
        [
          { rowSpan: 3, ...cell("ลำดับ", { bold: true, margin: [0, 10, 0, 0] }) },
          { rowSpan: 3, ...cell("รายการ", { bold: true, margin: [0, 10, 0, 0] }) },
          { rowSpan: 3, ...cell("จำนวน", { bold: true, margin: [0, 10, 0, 0] }) },
          { rowSpan: 3, ...cell("หน่วย", { bold: true, margin: [0, 10, 0, 0] }) },
          ...supplierHead,
        ],
        [{}, {}, {}, {}, ...supplierName],
        [{}, {}, {}, {}, ...supplierSub],
        ...itemRows,
        emptyRow(),
        noteRow,
        ...blankRows,
        sumRow("รวมราคา ก่อนภาษี", "subtotal", true),
        sumRow("ส่วนลด", "discount"),
        sumRow("รวมราคาหลังส่วนลด", "afterDiscount"),
        sumRow("ภาษีมูลค่าเพิ่ม 7 %", "vat"),
        sumRow("รวมราคาทั้งหมด (สุทธิ)", "net", true),
      ],
    },
    layout: gridLayout(0.8),
    fontSize: 8,
  }

  // ---------- เงื่อนไขในการคัดเลือก ----------
  const condKeys: [string, keyof PriceCompare["suppliers"][number]["conditions"]][] = [
    ["(1) เงื่อนไขการชำระเงิน", "payment"], ["(2) ระยะเวลาส่งมอบหลังรับ PO", "leadTime"],
    ["(3) เงื่อนไขการรับประกัน", "warranty"], ["หมายเหตุ (ถ้ามี)", "remark"],
    ["(4) จำนวนช่องซ่อมที่อู่มี", "bays"], ["(5) จำนวนรถMena ที่เข้าซ่อมอยู่ในขณะนี้", "menaTrucksIn"],
  ]
  const condLabel = {
    rowSpan: 8,
    ...t("เงื่อนไขในการคัดเลือก ต้องระบุให้ครบถ้วน", { alignment: "center", fontSize: 7, bold: true, fillColor: GRAY, margin: [0, 22, 0, 0] }),
  }
  const condRows = condKeys.map(([label, key], r) => [
    r === 0 ? condLabel : {},
    t(label, { fontSize: 8 }),
    ...Array.from({ length: N }, (_, i) => [
      { colSpan: 2, ...t(sup(i)?.conditions[key] ?? "", { alignment: "center", ...fill(i) }) }, {},
    ]).flat(),
  ])
  const statusRow = [
    {}, t("(6) สถานะ ของรถMena ที่เข้าซ่อมอยู่ในขณะนี้", { fontSize: 8 }),
    ...Array.from({ length: N }, (_, i) => [
      t(`ขA - ${sup(i)?.conditions.statusA ?? ""} คัน`, { alignment: "center", fontSize: 7, ...fill(i) }),
      t(`ขB - ${sup(i)?.conditions.statusB ?? ""} คัน`, { alignment: "center", fontSize: 7, ...fill(i) }),
    ]).flat(),
  ]
  const quoteRow = [
    {}, t("(7) วันที่ใบเสนอราคา / ใช้ได้ถึง", { fontSize: 8 }),
    ...Array.from({ length: N }, (_, i) => [
      { text: thDate(sup(i)?.quoteDate ?? ""), alignment: "center", fontSize: 7, ...fill(i) },
      { text: thDate(sup(i)?.validUntil ?? ""), alignment: "center", fontSize: 7, ...fill(i) },
    ]).flat(),
  ]
  const condTable = {
    table: { widths: [COL1_W, "*", ...supCols], body: [...condRows, statusRow, quoteRow] },
    layout: gridLayout(0.8),
    fontSize: 8,
  }

  // ---------- คณะกรรมการ ----------
  const member = (i: number) => {
    const m = doc.committee?.[i]
    return {
      stack: [
        t(`1) เลือก supplier ลำดับที่  ${m?.pickedSupplier ?? "........"}`, { bold: true, fontSize: 8 }),
        t(`2) เหตุผลในการเลือก : ${m?.reason ?? ""}`, { bold: true, fontSize: 8 }),
        { text: " ", margin: [0, 20, 0, 0] },                       // ที่ว่างลงนาม
        t(m?.name ?? "", { alignment: "center", fontSize: 8 }),
        t(`วันที่ ${m?.signedDate ? thDate(m.signedDate) : "................"}`, { alignment: "center", fontSize: 8 }),
      ],
    }
  }
  const chosen = Array.from({ length: N }, (_, i) =>
    raw(`[${doc.selectedSupplier === i + 1 ? TICK : "  "}] Supplier ${i + 1}`, { fontSize: 8 })
  )
  const C = DEFAULT_COMMITTEE_ROLES.length   // จำนวนช่องกรรมการ — ทั้งความกว้าง แถวลงนาม และแถวตำแหน่ง ใช้ค่าเดียวกัน
  const committeeTable = {
    table: {
      widths: [COL1_W, ...Array.from({ length: C }, () => "*"), 74],
      body: [
        [
          { rowSpan: 2, ...t("คณะกรรมการพิจารณาคัดเลือกและข้อสรุป", { alignment: "center", fontSize: 7, bold: true, fillColor: GRAY, margin: [0, 24, 0, 0] }) },
          ...Array.from({ length: C }, (_, i) => member(i)),
          { rowSpan: 2, stack: [raw("ผู้ได้รับเลือก", { bold: true, fontSize: 8, decoration: "underline", alignment: "center" }), ...chosen] },
        ],
        [
          {},
          ...Array.from({ length: C }, (_, i) => t(doc.committee?.[i]?.role ?? DEFAULT_COMMITTEE_ROLES[i], { alignment: "center", bold: true, fontSize: 8 })),
          {},
        ],
      ],
    },
    layout: gridLayout(1),
    fontSize: 8,
  }

  // ---------- เหตุผล (พิมพ์เฉพาะที่มีข้อความ) ----------
  // ป้ายหัวข้อสองอันนี้เป็นข้อยกเว้นของกฎ seg() เหมือน "ผู้ได้รับเลือก"/"(รวมในราคา)" — ป้ายสั้นบรรทัดเดียว
  // ไม่ต้องตัดคำ และ check script ค้นหาแบบตรงตัว ส่วนข้อความที่ผู้ใช้พิมพ์ต่อท้ายยังผ่าน seg() ตามปกติ
  const reason = (label: string, value: string, top: number) =>
    ({ text: [label, ": ", seg(value)], fontSize: 8, margin: [0, top, 0, 0] })
  const reasons = [
    doc.selectionReason ? reason("เหตุผลที่เลือก", doc.selectionReason, 3) : null,
    doc.fewerQuotesReason ? reason("เหตุผลที่มีใบเสนอราคาน้อยกว่า 3 ราย", doc.fewerQuotesReason, 2) : null,
  ].filter(Boolean)

  // ---------- หน้ารูปแนบ (แนวตั้ง หน้าละ 1 รูป) ----------
  const attachments = imagePages.flatMap((p) => [
    { text: seg(p.heading), bold: true, fontSize: 12, pageBreak: "before", pageOrientation: "portrait", margin: [0, 0, 0, 8] },
    { image: `data:image/png;base64,${p.pngBase64}`, fit: [540, 740], alignment: "center" },
  ])

  return {
    pageSize: "A4", pageOrientation: "landscape", pageMargins: [24, 18, 24, 16],
    defaultStyle: { font: "Sarabun", fontSize: 9 },
    info: { title: `${doc.docNo} ${doc.title}` },
    // บล็อกกรรมการห้ามถูกตัดกลางหน้า (unbreakable) — ถ้ารายการเยอะจนล้น ให้ยกไปทั้งบล็อกที่หน้าถัดไป
    content: [header, priceTable, condTable, { stack: [committeeTable], unbreakable: true }, ...reasons, ...attachments],
  }
}
