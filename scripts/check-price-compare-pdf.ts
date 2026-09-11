// scripts/check-price-compare-pdf.ts — รัน: npx tsx scripts/check-price-compare-pdf.ts
import assert from "node:assert/strict"
import fs from "node:fs"
import { createHash } from "node:crypto"
import { PDFDocument } from "pdf-lib"
import { newDoc, emptySupplier, supplierTotals, fmtMoney, pickLowestPerLine, type PriceCompare, type PcSupplier, type PcFile } from "../lib/price-compare"
import { buildPriceCompareDocDef, pdfFilename, MIX_SUBTOTAL_LABEL, MIX_NET_LABEL, MIX_DISCOUNT_NOTE } from "../lib/price-compare-pdf"
import { renderPdfmake, seg } from "../lib/pdfmake-printer"
import { attachmentOrder, collectAttachments, assemblePdf } from "../lib/price-compare-attachments"
import { MEDIA_CDN_BASE, MEDIA_MAX_BYTES } from "../lib/media"

function uh03(): PriceCompare {
  const d = newDoc({ name: "นพรัตน์ อายยืน", email: "n@mena.co.th" }) as PriceCompare
  d.docNo = "PC-2609-002"; d.createdAt = "2026-09-07T09:00:00.000+07:00"; d.updatedAt = "2026-09-07T15:30:00.000+07:00"
  d.title = "Pump + Motor UH03"; d.requestDept = "ยานยนต์"; d.revision = 0; d.selectedSupplier = 1
  d.items = [
    { name: "Pump Rexroth", qty: 1, unit: "ตัว" }, { name: "Motor Rexroth", qty: 1, unit: "ตัว" },
    { name: "น้ำมัน HYD.", qty: 18, unit: "ลิตร" }, { name: "น้ำมันเกียร์", qty: 10, unit: "ลิตร" },
    { name: "ค่าแรงซ่อม+ประกอบทดสอบ", qty: 1, unit: "งาน" },
  ]
  const s = (name: string, note: string, prices: number[]): PcSupplier => ({ ...emptySupplier(5), name, note, prices })
  d.suppliers = [
    s("ช่างหมู", "ราคานี้เป็นราคาซ่อม Pump + Motor ของเดิมติดรถ", [21000, 18900, 110.56, 180, 7000]),
    s("คุณณัฐ", "ราคานี้เป็นราคาเปลี่ยน Pump + Motor ใหม่ มือ 1", [30000, 18000, 100, 100, 5500]),
    s("ศศ&ณ", "ราคานี้เป็นราคาเปลี่ยน Pump + Motor ใหม่ มือ 2", [30000, 25000, 107.14, 107.14, 5000]),
  ]
  d.suppliers[0].conditions.statusA = "2"
  d.suppliers[1].vatMode = "incl"; d.suppliers[1].quoteDate = "2026-09-03"; d.suppliers[1].validUntil = "2026-10-03"
  d.selectionReason = ""; d.fewerQuotesReason = ""
  d.committee = d.committee.map((m, i) => ({ ...m, name: ["คุณเสถียรพงษ์ ชะเอมจันทร์", "บุญภัก พรหมมา", "", "คุณนัชภัค ขจรวุฒิเดช"][i], pickedSupplier: i === 2 ? null : 1, reason: i === 2 ? "" : "ราคาถูกสุด", signedDate: i === 2 ? "" : "2026-09-07" }))
  return d
}

// เกรดเป็นแถวย่อยของรายการ (spec 2026-09-11-price-compare-grades-design.md) — ตรงกับ gradesDoc ใน check-price-compare-core
// Pump Rexroth 1 ตัว 3 เกรด: มือ 1 [—, 30,000, 30,000] · มือ 2 [—, —, 25,000] · ซ่อมเดิม [21,000, —, —] + HYD/เกียร์/ค่าแรง — ทุกเจ้า excl
// lineSupplier = ถูกสุดต่อรายการ (pickLowestPerLine) → [null, null, 1, 2, 2, 3]
function gradesDoc(): PriceCompare {
  const d = newDoc({ name: "นพรัตน์ อายยืน", email: "n@mena.co.th" }) as PriceCompare
  d.docNo = "PC-2609-998"; d.createdAt = "2026-09-11T09:00:00.000+07:00"; d.updatedAt = d.createdAt
  d.title = "Pump UH03 (เทียบเกรด)"; d.requestDept = "ยานยนต์"; d.selectedSupplier = null
  const pump = (grade: string) => ({ name: "Pump Rexroth", qty: 1, unit: "ตัว", group: "g-pump01", grade })
  d.items = [
    pump("มือ 1"), pump("มือ 2"), pump("ซ่อมเดิม"),
    { name: "น้ำมัน HYD.", qty: 18, unit: "ลิตร" }, { name: "น้ำมันเกียร์", qty: 10, unit: "ลิตร" },
    { name: "ค่าแรงซ่อม+ประกอบทดสอบ", qty: 1, unit: "งาน" },
  ]
  const s = (name: string, prices: (number | null)[]): PcSupplier => ({ ...emptySupplier(6), name, prices })
  d.suppliers = [
    s("ช่างหมู", [null, null, 21000, 110.56, 180, 7000]),
    s("คุณณัฐ", [30000, null, null, 100, 100, 5500]),
    s("ศศ&ณ", [30000, 25000, null, 107.14, 107.14, 5000]),
  ]
  d.lineSupplier = pickLowestPerLine(d)
  return d
}

type Cell = Record<string, unknown>
const priceTableOf = (dd: { content: unknown[] }) => (dd.content[1] as { table: { widths: unknown[]; body: Cell[][] } }).table
/** แถวเกรดในตารางเทียบราคา — ช่องรายการเป็น array [เครื่องหมาย, seg("เกรด: <ชื่อ>")] */
const gradeRowOf = (body: Cell[][], grade: string) =>
  body.find((r) => Array.isArray(r[1]?.text) && (r[1].text as string[]).includes(seg(`เกรด: ${grade}`)))

// wrapped in an async IIFE: this repo's tsx runs scripts as CJS, which rejects top-level await
async function main() {
  assert.equal(pdfFilename(uh03()), "PC-2609-002 Pump + Motor UH03.pdf")
  assert.equal(pdfFilename({ ...uh03(), title: "a/b:c*d?" }), "PC-2609-002 a-b-c-d-.pdf", "อักขระต้องห้ามในชื่อไฟล์ถูกแทนด้วย -")

  const dd = buildPriceCompareDocDef(uh03())
  assert.equal(dd.pageOrientation, "landscape")
  assert.equal(dd.defaultStyle.font, "Sarabun")
  const flat = JSON.stringify(dd)
  assert.ok(flat.includes("PC-2609-002"))
  assert.ok(flat.includes("54,238.39"), "สุทธิ supplier 1")
  assert.ok(flat.includes("(รวมในราคา)"), "supplier 2 เป็นราคารวม VAT")
  assert.ok(flat.includes("56,300.00"), "สุทธิ supplier 2 (incl) = หลังส่วนลด")
  assert.ok(flat.includes("3/9/2569"), "วันที่ใบเสนอราคา")
  // เลือก supplier 2 ทั้งที่ supplier 1 ถูกที่สุด → ต้องพิมพ์เหตุผลที่เลือก
  { const r = buildPriceCompareDocDef({ ...uh03(), selectedSupplier: 2, selectionReason: "ของใหม่ มือ 1" }); assert.ok(JSON.stringify(r).includes("เหตุผลที่เลือก")) }
  // เลือกรายที่ถูกที่สุดอยู่แล้ว → เหตุผลที่ค้างในเอกสารต้องไม่ถูกพิมพ์
  { const r = buildPriceCompareDocDef({ ...uh03(), selectedSupplier: 1, selectionReason: "เหตุผลเก่าค้างอยู่" }); assert.ok(!JSON.stringify(r).includes("เหตุผลที่เลือก"), "เลือกรายถูกสุดแล้วต้องไม่พิมพ์เหตุผลที่เลือก") }
  assert.ok(flat.includes("Supplier 4"), "ต้องพิมพ์ 4 คอลัมน์เสมอแม้มี 3 ราย")
  assert.ok(flat.includes("ผู้ได้รับเลือก"))
  // fixture ตั้งต้นไม่มีเหตุผลทั้งสองข้อ → บรรทัดเหตุผลต้องไม่ถูกพิมพ์
  assert.ok(!flat.includes("เหตุผลที่เลือก"), "ไม่มี selectionReason ต้องไม่มีบรรทัดเหตุผลที่เลือก")
  assert.ok(!flat.includes("เหตุผลที่มีใบเสนอราคาน้อยกว่า 3 ราย"), "ไม่มี fewerQuotesReason ต้องไม่มีบรรทัดนั้น")

  // supplier ที่เสนอราคาแบบไม่มี VAT: ช่องภาษีขึ้น "ไม่มี VAT" และสุทธิ = ยอดหลังส่วนลด
  const dNone = uh03()
  dNone.suppliers[2].vatMode = "none"
  const tNone = supplierTotals(dNone, 2)
  assert.equal(tNone.vat, 0)
  assert.equal(tNone.net, tNone.afterDiscount, "vatMode none: สุทธิ = ยอดหลังส่วนลด")
  const flatNone = JSON.stringify(buildPriceCompareDocDef(dNone))
  // ข้อความไทยทั่วไปผ่าน seg() (มี ZWSP คั่นคำ) จึงต้องเทียบกับรูปที่ seg() แล้ว
  assert.ok(flatNone.includes(seg("ไม่มี VAT")), "ช่องภาษีของ supplier 3 ต้องขึ้น ไม่มี VAT")
  assert.ok(flatNone.includes(fmtMoney(tNone.net)), `สุทธิ supplier 3 (none) = ${fmtMoney(tNone.net)}`)

  // เหตุผลที่มีใบเสนอราคาน้อยกว่า 3 ราย — ป้ายหัวข้อเป็นข้อความตรงตัว ส่วนเนื้อความผ่าน seg()
  const dFewer = uh03()
  dFewer.suppliers = dFewer.suppliers.slice(0, 2)   // ราคาครบแค่ 2 ราย < MIN_QUOTES
  dFewer.fewerQuotesReason = "มีผู้ขายรายเดียว"
  const flatFewer = JSON.stringify(buildPriceCompareDocDef(dFewer))
  assert.ok(flatFewer.includes("เหตุผลที่มีใบเสนอราคาน้อยกว่า 3 ราย"))
  assert.ok(flatFewer.includes(seg("มีผู้ขายรายเดียว")))
  // ครบ 3 รายแล้ว → เหตุผลที่ค้างในเอกสารต้องไม่ถูกพิมพ์
  assert.ok(
    !JSON.stringify(buildPriceCompareDocDef({ ...uh03(), fewerQuotesReason: "เหตุผลเก่าค้างอยู่" })).includes("เหตุผลที่มีใบเสนอราคาน้อยกว่า 3 ราย"),
    "ใบเสนอราคาครบ 3 รายแล้วต้องไม่พิมพ์เหตุผลที่มีน้อยกว่า 3 ราย",
  )

  // เอกสารเลือกทั้งใบต้องไม่มีบล็อกสรุปโหมดผสมโผล่มา
  assert.ok(!flat.includes(seg(MIX_SUBTOTAL_LABEL)), "เลือกทั้งใบต้องไม่มีแถวยอดที่เลือกจากเจ้านี้")
  assert.ok(!flat.includes(seg(MIX_DISCOUNT_NOTE)), "เลือกทั้งใบต้องไม่มีหมายเหตุส่วนลดของโหมดผสม")

  // --- โหมดผสม: เลือก supplier รายบรรทัด [1,2,2,2,3] ---
  // vatMode ของ supplier 2 ตั้งกลับเป็น excl เพื่อให้ยอดตรงกับ fixture ของ check-price-compare-core (ทุกเจ้าเป็น excl)
  const dMix = uh03()
  dMix.selectedSupplier = null
  dMix.suppliers[1].vatMode = "excl"
  dMix.lineSupplier = [1, 2, 2, 2, 3]
  const ddMix = buildPriceCompareDocDef(dMix)
  const flatMix = JSON.stringify(ddMix)
  // ป้ายประกอบจาก array (คำไทยผ่าน seg()) จึงเทียบทีละชิ้นแทนการค้นทั้งประโยค
  assert.ok(
    flatMix.includes(`[√] `) && flatMix.includes(seg("เลือกรายบรรทัด")) && flatMix.includes(" (ผสม 3 ") && flatMix.includes(seg("เจ้า")),
    "ช่องผู้ได้รับเลือกต้องบอกว่าเลือกรายบรรทัดจากกี่เจ้า",
  )
  assert.ok(!flatMix.includes("[√] Supplier"), "โหมดผสมต้องไม่ติ๊ก Supplier รายใดรายหนึ่ง")
  assert.ok(flatMix.includes(seg(MIX_SUBTOTAL_LABEL)) && flatMix.includes(seg(MIX_NET_LABEL)), "ต้องมีสองแถวสรุปโหมดผสม")
  assert.ok(flatMix.includes("22,470.00"), "สุทธิที่เลือกของ supplier 1 (21,000 + VAT)")
  assert.ok(flatMix.includes("22,256.00"), "สุทธิที่เลือกของ supplier 2 (20,800 + VAT)")
  assert.ok(flatMix.includes("5,350.00"), "สุทธิที่เลือกของ supplier 3 (5,000 + VAT)")
  assert.ok(flatMix.includes("50,076.00"), "ยอดรวมผสมอยู่ในช่อง Supplier 4 ที่ว่าง")
  // ปักหมุด branch grandInTable: ยอดรวมต้องอยู่ในคู่ช่องของ Supplier 4 ในแถว "สุทธิที่เลือก" ไม่ใช่บรรทัดใต้ตาราง
  {
    const body = ((ddMix.content as Record<string, unknown>[])[1].table as { body: Record<string, unknown>[][] }).body
    const netRow = body.find((r) => r[0]?.text === seg(MIX_NET_LABEL))
    assert.ok(netRow, "ต้องมีแถวสุทธิที่เลือกในตารางเทียบราคา")
    const grandCell = netRow![netRow!.length - 2]   // คู่ช่องสุดท้าย = Supplier 4 (ช่องหลังเป็น placeholder ของ colSpan)
    assert.equal(grandCell.colSpan, 2, "ยอดรวมผสมกินสองช่องของ Supplier 4")
    const txt = (grandCell.text as string[]).join("")
    assert.ok(txt.includes(seg("รวมผสม")) && txt.includes("50,076.00"), `ช่อง Supplier 4 ต้องเป็นยอดรวมผสม (ได้ "${txt}")`)
  }
  assert.ok(flatMix.includes(seg(MIX_DISCOUNT_NOTE)), "ต้องมีหมายเหตุว่าส่วนลดไม่ถูกนำมาคิด")
  assert.ok((flatMix.match(/√/g) ?? []).length >= 5, "ต้องติ๊กเซลล์ราคาที่เลือกครบทั้ง 5 แถว")
  // เลือกถูกสุดทุกแถวอยู่แล้ว → เหตุผลที่ค้างในเอกสารต้องไม่ถูกพิมพ์ (เกณฑ์เดียวกับโหมดเลือกทั้งใบ)
  assert.ok(
    !JSON.stringify(buildPriceCompareDocDef({ ...dMix, selectionReason: "เหตุผลเก่าค้างอยู่" })).includes("เหตุผลที่เลือก"),
    "โหมดผสมที่เลือกถูกสุดทุกแถวต้องไม่พิมพ์เหตุผลที่เลือก",
  )

  // --- โหมดผสมที่ไม่ได้เลือกถูกสุดทุกแถว: แถว 1 ใช้คุณณัฐ (30,000) แทนช่างหมู (21,000) → ต้องพิมพ์เหตุผล ---
  const dMixReason = uh03()
  dMixReason.selectedSupplier = null
  dMixReason.suppliers[1].vatMode = "excl"
  dMixReason.lineSupplier = [2, 2, 2, 2, 3]
  dMixReason.selectionReason = "ของใหม่ มือ 1"
  const ddMixReason = buildPriceCompareDocDef(dMixReason)
  const flatMixReason = JSON.stringify(ddMixReason)
  assert.deepEqual(pickLowestPerLine(dMixReason)[0], 1, "แถว 1 ที่ถูกสุดคือ Supplier 1 — fixture นี้จงใจเลือกไม่ตรง")
  assert.ok(flatMixReason.includes("เหตุผลที่เลือก"), "โหมดผสมที่มีแถวไม่ถูกสุด ต้องมีป้ายเหตุผลที่เลือก")
  assert.ok(flatMixReason.includes(seg("ของใหม่ มือ 1")), "ต้องพิมพ์ข้อความเหตุผลที่ผู้ใช้กรอกจริง")

  // มี supplier ครบ 4 ราย → ไม่เหลือช่องว่างในตาราง ยอดรวมผสมต้องมาเป็นบรรทัดใต้ตารางแทน
  {
    const d4 = uh03()
    d4.selectedSupplier = null
    d4.suppliers[1].vatMode = "excl"
    d4.suppliers.push({ ...emptySupplier(5), name: "เจ้าที่สี่", prices: [40000, 40000, 200, 200, 9000] })
    d4.lineSupplier = [1, 2, 2, 2, 3]
    const dd4 = buildPriceCompareDocDef(d4)
    const line = (dd4.content as { text?: unknown }[]).find((c) => JSON.stringify(c.text ?? "").includes("50,076.00"))
    assert.ok(line, "supplier ครบ 4 ราย → ยอดรวมผสมต้องเป็นบรรทัดใต้ตาราง")
  }

  // ฟอร์มโหมดผสมต้องยังจบในหน้าเดียวเหมือนเอกสารเลือกทั้งใบ
  for (const [name, def] of [["uh03", dd], ["mixed", ddMix], ["mixed-reason", ddMixReason]] as const) {
    const out = await renderPdfmake(def)
    assert.equal((await PDFDocument.load(out)).getPageCount(), 1, `ฟอร์ม ${name} ต้องเป็นหน้าเดียว`)
    if (name !== "uh03") { fs.mkdirSync("tmp", { recursive: true }); fs.writeFileSync(`tmp/price-compare-${name}.pdf`, out) }
  }
  console.log("mixed mode: OK → tmp/price-compare-mixed.pdf, tmp/price-compare-mixed-reason.pdf")

  // --- snapshot: docDefinition ของเอกสารที่ไม่มีเกรด ต้องเหมือนโค้ดก่อนฟีเจอร์เกรดทุกไบต์ ---
  // hash = sha1(JSON.stringify(buildPriceCompareDocDef(fixture))) — literal ด้านล่างสร้างจาก lib/price-compare-pdf.ts @ ea4033f
  // (ก่อนแถวเกรดใน PDF) กับ fixture ชุดเดียวกันนี้ จึงพิสูจน์ว่าการสร้างแถวจาก groupsOf + โควตาแถวหัวรายการไม่เปลี่ยน PDF ของใบเดิม
  // fixture ทุกตัวใช้ค่าตายตัว (createdAt/updatedAt เป็น literal, newDoc ไม่มี new Date()/id สุ่ม) — hash รวมโลโก้ fonts/mena-mark.png ด้วย
  // เปลี่ยนเลย์เอาต์โดยตั้งใจ (หรือเปลี่ยนโลโก้): เปิดดู PDF จริงให้ถูกต้องก่อน แล้วรัน
  //   PC_PDF_SNAPSHOT_PRINT=1 npx tsx scripts/check-price-compare-pdf.ts
  // เพื่อพิมพ์ hash ชุดใหม่ (โหมดนี้พิมพ์อย่างเดียว ไม่ assert) แล้วนำมาแทน literal ในคอมมิตเดียวกับการเปลี่ยนเลย์เอาต์
  // ห้ามอัปเดต hash เพียงเพื่อให้ test ผ่าน ถ้าไม่ได้ตั้งใจเปลี่ยนหน้าตา PDF ของใบเดิม
  {
    const mixOf = (ls: (number | null)[], reason = "") => {
      const d = uh03(); d.selectedSupplier = null; d.suppliers[1].vatMode = "excl"; d.lineSupplier = ls; d.selectionReason = reason; return d
    }
    const fewer = () => { const d = uh03(); d.suppliers = d.suppliers.slice(0, 2); d.fewerQuotesReason = "มีผู้ขายรายเดียว"; return d }
    const four = () => {
      const d = mixOf([1, 2, 2, 2, 3])
      d.suppliers.push({ ...emptySupplier(5), name: "เจ้าที่สี่", prices: [40000, 40000, 200, 200, 9000] }); return d
    }
    const long40 = () => {
      const d = uh03()
      d.items = Array.from({ length: 40 }, (_, i) => ({ name: `รายการทดสอบที่ ${i + 1}`, qty: 1, unit: "ชิ้น" }))
      d.suppliers = d.suppliers.map((sp) => ({ ...sp, prices: Array.from({ length: 40 }, () => 100) })); return d
    }
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
    const cases: [name: string, def: unknown, sha1: string][] = [
      ["uh03", buildPriceCompareDocDef(uh03()), "8dd10695e769f268b49c3e38936726954dd91b3b"],
      ["uh03-sel2-reason", buildPriceCompareDocDef({ ...uh03(), selectedSupplier: 2, selectionReason: "ของใหม่ มือ 1" }), "f7ac7298ca19c75ba6ce1d5dfd666eefed04ea0e"],
      ["fewer", buildPriceCompareDocDef(fewer()), "5707080be5812ee31b1fd63c46e096a40911e025"],
      ["mixed", buildPriceCompareDocDef(mixOf([1, 2, 2, 2, 3])), "a9e566fc5d3c14402bcaa86dec9604039a472cdc"],
      ["mixed-reason", buildPriceCompareDocDef(mixOf([2, 2, 2, 2, 3], "ของใหม่ มือ 1")), "b1672d428ea3cb511f61ca47909ce483ca338f6e"],
      ["mixed4", buildPriceCompareDocDef(four()), "5682d161aa5f1c3c59c591c838f2302865090956"],
      ["long40", buildPriceCompareDocDef(long40()), "514ff3d816d14b6f283990030c0fe50fac4efc62"],
      ["image", buildPriceCompareDocDef(uh03(), [{ heading: "หลักฐาน: ใบเสนอราคา Supplier 1 — ช่างหมู", pngBase64: png }]), "f4e826b46599c30dadd9df5d879704a73c3a0036"],
    ]
    const sha1 = (def: unknown) => createHash("sha1").update(JSON.stringify(def)).digest("hex")
    if (process.env.PC_PDF_SNAPSHOT_PRINT) {
      for (const [name, def] of cases) console.log(`snapshot ${name}: ${sha1(def)}`)
    } else {
      for (const [name, def, want] of cases) {
        assert.equal(sha1(def), want, `docDefinition ของ fixture ${name} เปลี่ยนจากก่อนฟีเจอร์เกรด (ea4033f) — ถ้าตั้งใจเปลี่ยนเลย์เอาต์ ดูวิธีอัปเดตในคอมเมนต์ด้านบน`)
      }
      console.log(`snapshot: ${cases.length} plain/mixed docDefinitions byte-identical to ea4033f — OK`)
    }
  }

  // --- เกรดแถวย่อย: แถวหัวรายการ + แถวเกรด, ติ๊กที่เกรด·เจ้าที่เลือก, ยอดจาก lib (โหมดผสมเมื่อเลือกครบทุกรายการ) ---
  {
    const g = gradesDoc()
    assert.deepEqual(g.lineSupplier, [null, null, 1, 2, 2, 3], "ถูกสุดต่อรายการ = ซ่อมเดิม·S1, HYD·S2, เกียร์·S2, ค่าแรง·S3")
    const ddG = buildPriceCompareDocDef(g)
    const flatG = JSON.stringify(ddG)
    const { widths, body } = priceTableOf(ddG)
    assert.ok(body.every((r) => r.length === widths.length), "ทุกแถว (หัวรายการ/เกรด/ธรรมดา/สรุป) ต้องมี cell เท่ากับจำนวนคอลัมน์")
    for (const gr of ["มือ 1", "มือ 2", "ซ่อมเดิม"]) assert.ok(flatG.includes(seg(`เกรด: ${gr}`)), `ต้องมีแถวเกรด ${gr}`)

    // แถวหัวรายการ: ลำดับ 1 + ชื่อ/จำนวน/หน่วย ช่องราคาเว้นว่าง; แถวเกรดตามมาทันที ไม่มีลำดับ
    const head = body.findIndex((r) => r[1]?.text === seg("Pump Rexroth"))
    assert.ok(head > 0, "ต้องมีแถวหัวรายการ Pump Rexroth")
    assert.equal(body[head][0].text, "1")
    assert.ok(body[head].slice(4).every((c) => !c.text), "แถวหัวรายการไม่มีราคา")
    assert.deepEqual([1, 2, 3].map((k) => body[head + k]), ["มือ 1", "มือ 2", "ซ่อมเดิม"].map((gr) => gradeRowOf(body, gr)), "แถวเกรดเรียงต่อจากหัวรายการตามลำดับ")
    assert.ok([1, 2, 3].every((k) => body[head + k][0].text === ""), "แถวเกรดไม่มีเลขลำดับ")
    // ลำดับนับต่อรายการ: HYD เป็นรายการที่ 2 ไม่ใช่แถวที่ 4
    assert.equal(body.find((r) => r[1]?.text === seg("น้ำมัน HYD."))![0].text, "2")

    // ติ๊ก √ ที่ ซ่อมเดิม·S1 (ช่องราคาต่อหน่วยของ S1 = index 4) และเกรดที่ไม่ได้เลือกไม่มีติ๊ก
    assert.equal(gradeRowOf(body, "ซ่อมเดิม")![4].text, "√ 21,000.00", "ติ๊กที่ ซ่อมเดิม·S1")
    assert.ok(!JSON.stringify(gradeRowOf(body, "มือ 1")).includes("√") && !JSON.stringify(gradeRowOf(body, "มือ 2")).includes("√"), "เกรดที่ไม่ได้เลือกต้องไม่มีติ๊ก")

    // ยอดโหมดผสม (group-aware จาก lib): S1 22,470 · S2 2,996 · S3 5,350 → รวมผสม 30,816
    assert.ok(flatG.includes(seg(MIX_NET_LABEL)), "เลือกครบทุกรายการ → มีบล็อกสรุปโหมดผสม")
    assert.ok(flatG.includes("22,470.00") && flatG.includes("2,996.00") && flatG.includes("5,350.00"), "สุทธิที่เลือกต่อเจ้า")
    assert.ok(flatG.includes("30,816.00"), "รวมผสม 30,816.00")
    assert.ok(!flatG.includes("เหตุผลที่เลือก"), "เลือกถูกสุดทุกรายการ → ไม่ต้องพิมพ์เหตุผล")

    // เลือก มือ 2·S3 แทน → รวมผสม 35,096 + ต้องพิมพ์เหตุผลที่เลือก
    const alt = gradesDoc()
    alt.lineSupplier = [null, 3, null, 2, 2, 3]
    alt.selectionReason = "ต้องการของใหม่ มือ 2"
    const ddAlt = buildPriceCompareDocDef(alt)
    const flatAlt = JSON.stringify(ddAlt)
    assert.ok(flatAlt.includes("35,096.00"), "รวมผสมเมื่อเลือก มือ 2·S3 = 35,096.00")
    assert.ok(flatAlt.includes("เหตุผลที่เลือก") && flatAlt.includes(seg("ต้องการของใหม่ มือ 2")), "ไม่ได้เลือกถูกสุด → ต้องพิมพ์เหตุผล")
    const altBody = priceTableOf(ddAlt).body
    assert.equal(gradeRowOf(altBody, "มือ 2")![8].text, "√ 25,000.00", "ติ๊กที่ มือ 2·S3 (ช่องราคาต่อหน่วยของ S3 = index 8)")
    assert.ok(!JSON.stringify(gradeRowOf(altBody, "ซ่อมเดิม")).includes("√"), "ย้ายการเลือกแล้ว ซ่อมเดิมต้องไม่มีติ๊ก")

    // กลุ่มค้าง (ยังไม่เลือกเกรด) → ไม่มีบล็อกผสม แต่แถวหัวรายการ/เกรดยังพิมพ์ครบ
    const open = gradesDoc(); open.lineSupplier = [null, null, null, 2, 2, 3]
    const flatOpen = JSON.stringify(buildPriceCompareDocDef(open))
    assert.ok(!flatOpen.includes(seg(MIX_NET_LABEL)) && flatOpen.includes(seg("เกรด: ซ่อมเดิม")), "กลุ่มค้าง: ไม่มียอดผสม แต่ยังมีแถวเกรด")

    // เอกสารไม่มีเกรด: ไม่มีแถวเกรด และ cell ครบทุกแถวเหมือนเดิม (docDefinition ต้องเหมือนเดิมทุกไบต์ — ตรวจเทียบก่อน/หลังตอนแก้)
    assert.ok(!flat.includes(seg("เกรด")) && !flatMix.includes(seg("เกรด")), "เอกสารไม่มีเกรดต้องไม่มีแถวเกรด")
    const plain = priceTableOf(dd)
    assert.ok(plain.body.every((r) => r.length === plain.widths.length))

    for (const [name, def] of [["grades", ddG], ["grades-alt", ddAlt]] as const) {
      const out = await renderPdfmake(def)
      assert.equal((await PDFDocument.load(out)).getPageCount(), 1, `ฟอร์ม ${name} ต้องเป็นหน้าเดียว`)
      fs.writeFileSync(`tmp/price-compare-${name}.pdf`, out)
    }
    console.log("grades: OK → tmp/price-compare-grades.pdf, tmp/price-compare-grades-alt.pdf")
  }

  // หน้ารูปแนบ
  const png1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
  const dd2 = buildPriceCompareDocDef(uh03(), [{ heading: "หลักฐาน: ใบเสนอราคา Supplier 1 — ช่างหมู", pngBase64: png1x1 }])
  assert.ok(JSON.stringify(dd2).includes("data:image/png;base64,"))
  assert.ok(JSON.stringify(dd2).includes('"pageBreak":"before"'))

  const pdf = await renderPdfmake(dd2)
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-")
  fs.mkdirSync("tmp", { recursive: true })
  fs.writeFileSync("tmp/price-compare-uh03.pdf", pdf)
  console.log("check-price-compare-pdf: OK → tmp/price-compare-uh03.pdf (เปิดเทียบกับต้นแบบหน้า 1)")

  // --- ลำดับหลักฐาน: ทั่วไป → Supplier 1..N ---
  {
    const d = uh03()
    const f = (n: string): PcFile => ({ mediaId: 1, batchId: "b", filename: n, webpUrl: `${MEDIA_CDN_BASE}/${n}`, thumbnailUrl: "" })
    d.evidenceFiles = [f("line-chat.jpg")]
    d.suppliers[0].quotationFiles = [f("q1.jpg")]
    d.suppliers[1].quotationFiles = [f("quote2.pdf"), f("q2b.jpg")]
    const order = attachmentOrder(d)
    assert.deepEqual(order.map((o) => o.file.filename), ["line-chat.jpg", "q1.jpg", "quote2.pdf", "q2b.jpg"])
    assert.equal(order[0].heading, "หลักฐาน: line-chat.jpg")
    assert.equal(order[2].heading, "ใบเสนอราคา Supplier 2 — คุณณัฐ: quote2.pdf")

    // --- collectAttachments ด้วย fetch ปลอม: รูป = PNG 1×1 (sharp แปลงได้), pdf = เอกสาร 2 หน้า, ไฟล์เสีย = 404 ---
    const twoPage = await PDFDocument.create(); twoPage.addPage(); twoPage.addPage()
    const pdfBytes = await twoPage.save()
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64")
    d.suppliers[2].quotationFiles = [f("broken.jpg")]
    const fakeFetch = (async (url: string) => {
      if (url.endsWith("broken.jpg")) return new Response(null, { status: 404 })
      if (url.endsWith(".pdf")) return new Response(pdfBytes, { status: 200, headers: { "content-type": "application/pdf" } })
      return new Response(png, { status: 200, headers: { "content-type": "image/png" } })
    }) as unknown as typeof fetch
    const plan = await collectAttachments(d, fakeFetch)
    assert.equal(plan.imagePages.length, 3, "รูป 3 ไฟล์")
    assert.equal(plan.pdfInserts.length, 1)
    assert.equal(plan.pdfInserts[0].afterImageIndex, 1, "PDF ของ supplier 2 อยู่หลังรูปที่ 2 (index 1)")
    assert.deepEqual(plan.failed, ["broken.jpg"])

    const out = await assemblePdf(d, plan)
    const merged = await PDFDocument.load(out)
    // หน้า 1 ฟอร์ม + รูป line-chat + รูป q1 + PDF 2 หน้า + รูป q2b + หน้าแจ้งไฟล์เสีย = 7
    assert.equal(merged.getPageCount(), 7)
    fs.writeFileSync("tmp/price-compare-merged.pdf", out)
    console.log("attachments: OK → tmp/price-compare-merged.pdf")
  }

  // --- ลำดับการแทรกต้องคงที่เมื่อ PDF สองไฟล์ afterImageIndex ตรงกัน (supplier เดียวอัปโหลด PDF สองไฟล์ ไม่มีรูปคั่น) ---
  {
    const d = uh03()
    d.evidenceFiles = []
    const f = (n: string): PcFile => ({ mediaId: 1, batchId: "b", filename: n, webpUrl: `${MEDIA_CDN_BASE}/${n}`, thumbnailUrl: "" })
    d.suppliers[0].quotationFiles = [f("photo.jpg"), f("a.pdf"), f("b.pdf")]
    d.suppliers[1].quotationFiles = []
    d.suppliers[2].quotationFiles = []

    const a4 = await PDFDocument.create(); a4.addPage([595.28, 841.89])
    const letter = await PDFDocument.create(); letter.addPage([612, 792])
    const png1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64")
    const aBytes = await a4.save(), bBytes = await letter.save()
    const fakeFetch = (async (url: string) => {
      if (url.endsWith("a.pdf")) return new Response(aBytes, { status: 200, headers: { "content-type": "application/pdf" } })
      if (url.endsWith("b.pdf")) return new Response(bBytes, { status: 200, headers: { "content-type": "application/pdf" } })
      return new Response(png1x1, { status: 200, headers: { "content-type": "image/png" } })
    }) as unknown as typeof fetch

    const plan = await collectAttachments(d, fakeFetch)
    assert.equal(plan.pdfInserts.length, 2)
    assert.ok(plan.pdfInserts.every((p) => p.afterImageIndex === 0), "ทั้งสอง PDF ชี้ afterImageIndex เดียวกัน (หลังรูปเดียวที่มี)")

    const out = await assemblePdf(d, plan)
    const merged = await PDFDocument.load(out)
    assert.equal(merged.getPageCount(), 4, "1 ฟอร์ม + 1 รูป + 2 หน้า PDF (a.pdf, b.pdf)")
    assert.ok(Math.abs(merged.getPage(2).getSize().width - 595.28) < 0.1, "หน้า index 2 = a.pdf (A4)")
    assert.ok(Math.abs(merged.getPage(3).getSize().width - 612) < 0.1, "หน้า index 3 = b.pdf (Letter) — ต้องไม่สลับลำดับ")
    console.log("attachments (stable order, same afterImageIndex): OK")
  }

  // --- fetch timeout: ไฟล์ที่ไม่มีวันตอบ ต้องตกไปที่ failed[] แทนที่จะค้างตลอดกาล ---
  {
    const d = uh03()
    d.evidenceFiles = []
    const f = (n: string): PcFile => ({ mediaId: 1, batchId: "b", filename: n, webpUrl: `${MEDIA_CDN_BASE}/${n}`, thumbnailUrl: "" })
    d.suppliers[0].quotationFiles = [f("slow.jpg")]
    d.suppliers[1].quotationFiles = []
    d.suppliers[2].quotationFiles = []
    const hangingFetch = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))
      })) as unknown as typeof fetch

    const plan = await collectAttachments(d, hangingFetch, { timeoutMs: 100 })
    assert.deepEqual(plan.failed, ["slow.jpg"], "fetch ที่ไม่ตอบเกิน timeoutMs ต้องถูก abort แล้วตกไป failed")
    assert.equal(plan.imagePages.length, 0)
    console.log("attachments (fetch timeout): OK")
  }

  // --- SSRF guard + เพดานขนาด: URL นอก CDN ต้องไม่ถูก fetch เลย, ไฟล์ใหญ่เกิน MEDIA_MAX_BYTES ต้องตกไป failed[] ---
  {
    const d = uh03()
    const f = (n: string): PcFile => ({ mediaId: 1, batchId: "b", filename: n, webpUrl: `${MEDIA_CDN_BASE}/${n}`, thumbnailUrl: "" })
    d.evidenceFiles = [
      f("ok.jpg"),
      { mediaId: 2, batchId: "b", filename: "metadata.jpg", webpUrl: "http://169.254.169.254/latest", thumbnailUrl: "" },
      f("huge.jpg"),
    ]
    for (const s of d.suppliers) s.quotationFiles = []

    const png1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64")
    const calls: string[] = []
    const fakeFetch = (async (url: string) => {
      calls.push(url)
      const headers: Record<string, string> = { "content-type": "image/png" }
      if (url.endsWith("huge.jpg")) headers["content-length"] = String(MEDIA_MAX_BYTES + 1)
      return new Response(png1x1, { status: 200, headers })
    }) as unknown as typeof fetch

    const plan = await collectAttachments(d, fakeFetch)
    assert.ok(!calls.some((u) => u.includes("169.254.169.254")), "URL นอก CDN ต้องไม่ถูก fetch เลย")
    assert.equal(calls.length, 2, "fetch เฉพาะ ok.jpg กับ huge.jpg")
    assert.deepEqual(plan.failed, ["metadata.jpg", "huge.jpg"])
    assert.equal(plan.imagePages.length, 1, "เหลือเฉพาะไฟล์บน CDN ที่ขนาดไม่เกินเพดาน")
    console.log("attachments (SSRF guard + size cap): OK")
  }

  // --- ฟอร์มยาวหลายหน้า: index ที่แทรก PDF ต้องอิงจำนวนหน้าฟอร์มจริง ไม่ใช่สมมติว่าฟอร์มมีหน้าเดียว ---
  {
    const d = uh03()
    const N_ITEMS = 40
    d.items = Array.from({ length: N_ITEMS }, (_, i) => ({ name: `รายการทดสอบที่ ${i + 1}`, qty: 1, unit: "ชิ้น" }))
    d.suppliers = d.suppliers.map((s) => ({ ...s, prices: Array.from({ length: N_ITEMS }, () => 100) }))
    d.evidenceFiles = []
    const f = (n: string): PcFile => ({ mediaId: 1, batchId: "b", filename: n, webpUrl: `${MEDIA_CDN_BASE}/${n}`, thumbnailUrl: "" })
    d.suppliers[0].quotationFiles = [f("photo.jpg"), f("letter.pdf")]
    d.suppliers[1].quotationFiles = []
    d.suppliers[2].quotationFiles = []

    const letter = await PDFDocument.create(); letter.addPage([612, 792])
    const letterBytes = await letter.save()
    const png1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64")
    const fakeFetch = (async (url: string) =>
      url.endsWith(".pdf")
        ? new Response(letterBytes, { status: 200, headers: { "content-type": "application/pdf" } })
        : new Response(png1x1, { status: 200, headers: { "content-type": "image/png" } })) as unknown as typeof fetch

    const plan = await collectAttachments(d, fakeFetch)
    assert.equal(plan.imagePages.length, 1)
    assert.equal(plan.pdfInserts.length, 1)
    assert.deepEqual(plan.failed, [])

    const out = await assemblePdf(d, plan)
    const merged = await PDFDocument.load(out)
    assert.equal(merged.getPageCount(), 2 + 1 + 1, "ฟอร์ม 2 หน้า + หน้ารูป 1 + PDF แนบ 1 หน้า")
    const sizes = merged.getPages().map((pg) => pg.getSize())
    const imgIdx = sizes.findIndex((z) => Math.abs(z.width - 595.28) < 0.5 && Math.abs(z.height - 841.89) < 0.5)
    const letterIdx = sizes.findIndex((z) => Math.abs(z.width - 612) < 0.5)
    assert.ok(imgIdx > 0, `ต้องเจอหน้ารูป A4 แนวตั้งหลังหน้าฟอร์ม (ได้ ${imgIdx})`)
    assert.ok(letterIdx > imgIdx, `PDF แนบ (index ${letterIdx}) ต้องอยู่หลังหน้ารูป (index ${imgIdx})`)
    console.log("attachments (multi-page form insert index): OK")
  }
}

main()
