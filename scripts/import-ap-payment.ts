// scripts/import-ap-payment.ts
// รัน (ดูอย่างเดียว):  npx tsx scripts/import-ap-payment.ts [ไฟล์]
// รัน (เขียนจริง):     npx tsx scripts/import-ap-payment.ts [ไฟล์] --write
//
// นำเข้าหลักฐานจ่ายจริงจากไฟล์การเงิน (1 แถว = 1 invoice ต่อการจ่าย)
// → ap_tracking.paid = { paymentNos (เลข PV), date (วันจ่ายล่าสุด), amount, ... }
// รองรับ 2 แบบ (ตรวจจากหัวคอลัมน์อัตโนมัติ):
//  A) "Payment LKB Jan-Jul 2026.xlsx" — การเงินเติมคอลัมน์ "DD No." / "Payment No." / "Pay date" ให้เอง
//  B) "GL _ Payment Report Jan-Aug.xls.xlsx" — export ดิบ (ชีต "LKB Payment …"): PV=DocuNo · วันจ่าย=DocuDate
//     · ยอด=PayAmnt · DD อยู่ใน InvNo เฉพาะที่ร้านคีย์เลข DD เป็นเลขใบแจ้งหนี้ (~13%) ที่เหลือสะพานผ่าน
//     เลขตั้งหนี้ DocuNo_inv (LAPO…) → ap_tracking.voucherNos (ตรวจกับไฟล์ A ตรง 4,192/4,192 · 2026-09-08)
//     + ชีต "LKB GL …" คอลัมน์ GLdesc ระบุเลข DD ทุกใบที่ตั้งหนี้รวมกัน (เช่น LAPO26080090 = LBDD26080132+133)
//     ใช้เป็นชั้นแรกเพราะครบกว่า InvNo ที่ใส่ใบเดียว · ลำดับ: GLdesc ∪ InvNo → voucherNos
//     แถวที่แมปไม่ได้ = รายจ่ายที่ไม่ใช่ใบ DD (เงินออม/เช่าซื้อ/ค่าเช่า/สระบุรี) ข้ามเงียบ ๆ
// ใบที่มี paid = ขั้น "จ่ายแล้ว" ในหน้าเว็บ · source บอกที่มา เผื่ออนาคตดึงจากระบบการเงินตรง
//
// กติกาผู้ใช้ยืนยัน 21/08/2026:
// - เซลล์ DD มีหลายเลขคั่น "/" หรือ "-" = บิลเดียวจ่ายครอบหลายใบ · ".N" = งวดย่อย ตัดทิ้ง
// - ใบก่อน ม.ค. 69 (ไม่มีใน deposit_header) ข้าม — นอกขอบเขตระบบ
// - จ่ายหลายงวด: วันจ่ายหลัก = วันล่าสุด (เลข PV เก็บครบทุกงวด)
// - ใบไม่มี tracking สร้างให้ ยกเว้นคลังตระกูลสระบุรี (กติกาเดียวกับ import-ap-account)
// ยอดเงิน: แถวครอบหลายใบเป็นยอดรวม — แยกให้เมื่อผลบวกยอดหัวใบตรงกับยอดจ่าย (±1 บาท)
// ไม่ตรงเก็บเป็น sharedWith ไว้ ไม่เดาแบ่งเอง
import { readFileSync } from "node:fs"
import path from "node:path"
import { MongoClient } from "mongodb"
import * as XLSX from "xlsx"
import { parseAmount, parsePaymentDdCell } from "../lib/ap-tracking"

const DEFAULT_FILE = path.join(process.env.HOME ?? "", "Documents/project/detb/บัญชี/Payment LKB Jan-Jul 2026.xlsx")
const IMPORT_BY = "นำเข้าจากไฟล์การเงิน (Payment)"
const EXCEL_EPOCH = Date.UTC(1899, 11, 30)
const s = (v: unknown) => (v == null ? "" : String(v)).trim()
const ymd = (v: unknown): string => {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    return new Date(EXCEL_EPOCH + Math.round(v) * 86_400_000).toISOString().slice(0, 10)
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s(v))
  return m ? `${m[1]}-${m[2]}-${m[3]}` : ""
}

type Rec = { pvs: Set<string>; dates: Set<string>; ownAmount: number; sharedWith: Set<string>; sharedOnly: boolean }

async function main() {
  const args = process.argv.slice(2)
  const write = args.includes("--write")
  const file = args.find((a) => !a.startsWith("--")) ?? DEFAULT_FILE

  const wb = XLSX.read(readFileSync(file), { cellDates: false, dense: true })
  // แบบ B มีหลายชีต (GL + Payment) — เลือกชีตที่มีคอลัมน์ DocuNo_inv (ชีต Payment)
  const pick = wb.SheetNames.find((n) => {
    const h = (XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, range: 0 })[0] ?? []).map((c) => s(c))
    return h.includes("DD No.") || h.includes("DocuNo_inv")
  }) ?? wb.SheetNames[0]
  const ws = wb.Sheets[pick]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: false })
  const head = (rows[0] ?? []).map((c) => s(c))
  const raw = !head.some((h) => h.startsWith("DD No"))
  const col = raw
    ? { dd: head.indexOf("InvNo"), pv: head.indexOf("DocuNo"), date: head.indexOf("DocuDate"), amt: head.indexOf("PayAmnt"), lapo: head.indexOf("DocuNo_inv") }
    : { dd: head.findIndex((h) => h.startsWith("DD")), pv: head.findIndex((h) => h.startsWith("Payment No")),
        date: head.findIndex((h) => h.startsWith("Pay date")), amt: head.findIndex((h) => h === "PayAmnt"), lapo: -1 }
  if (col.dd < 0 || col.pv < 0 || col.date < 0) throw new Error("หาคอลัมน์ DD/Payment No./Pay date ไม่เจอ")
  console.log(`ชีต "${pick}" · รูปแบบ ${raw ? "B (export ดิบ — DD จาก InvNo + สะพานเลขตั้งหนี้)" : "A (มีคอลัมน์ DD No.)"}`)

  const env = readFileSync(path.join(process.cwd(), ".env"), "utf8")
  const uri = env.match(/^MONGO_URI=(.+)$/m)![1].trim().replace(/^["']|["']$/g, "")
  const mdName = env.match(/^MONGO_DB=(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, "") ?? "master_data"
  if (mdName === "atms") throw new Error("MONGO_DB ต้องไม่ใช่ 'atms'")
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000 })
  await client.connect()

  const col2 = client.db(mdName).collection("ap_tracking")

  // แบบ B: สะพานเลขตั้งหนี้ (DocuNo_inv) → ใบ DD ผ่าน ap_tracking.voucherNos (LAPO เดียวครอบหลายใบได้)
  const ddByVoucher = new Map<string, string[]>()
  if (raw) {
    const vouchers = [...new Set(rows.slice(1).map((r) => s(r[col.lapo])).filter(Boolean))]
    for (let i = 0; i < vouchers.length; i += 2000) {
      for (const d of await col2.find({ voucherNos: { $in: vouchers.slice(i, i + 2000) } },
        { projection: { _id: 0, depositCode: 1, voucherNos: 1 } }).toArray()) {
        for (const v of (d.voucherNos as string[] | undefined) ?? []) {
          const list = ddByVoucher.get(v) ?? []
          if (!list.includes(String(d.depositCode))) list.push(String(d.depositCode))
          ddByVoucher.set(v, list)
        }
      }
    }
  }
  // แบบ B: ชีต GL — เลขตั้งหนี้ → เลข DD ทุกใบในคำอธิบาย (ครบกว่า InvNo ที่ใส่แค่ใบแรก)
  const ddByGl = new Map<string, string[]>()
  if (raw) {
    const glName = wb.SheetNames.find((n) => {
      const h = (XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, range: 0 })[0] ?? []).map((c) => s(c))
      return h.includes("GLdesc") && h.includes("DocuNo")
    })
    if (glName) {
      const g = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[glName], { header: 1, raw: true, blankrows: false })
      const gh = (g[0] ?? []).map((c) => s(c)); const cDoc = gh.indexOf("DocuNo"), cDesc = gh.indexOf("GLdesc")
      for (const r of g.slice(1)) {
        const l = s(r[cDoc]); if (!l) continue
        const list = ddByGl.get(l) ?? []
        for (const code of parsePaymentDdCell(s(r[cDesc]))) if (!list.includes(code)) list.push(code)
        if (list.length) ddByGl.set(l, list)
      }
      console.log(`ชีต GL "${glName}" · เลขตั้งหนี้ที่มีเลข DD ${ddByGl.size.toLocaleString("th-TH")}`)
    }
  }
  let viaInv = 0, viaGl = 0, viaVoucher = 0, unmapped = 0
  const codesOf = (row: unknown[]): string[] => {
    const direct = parsePaymentDdCell(s(row[col.dd]))
    if (!raw) { if (direct.length) viaInv++; return direct }
    const gl = ddByGl.get(s(row[col.lapo])) ?? []
    if (gl.length) { viaGl++; return [...new Set([...gl, ...direct])] }
    if (direct.length) { viaInv++; return direct }
    const bridged = ddByVoucher.get(s(row[col.lapo])) ?? []
    if (bridged.length) viaVoucher++; else unmapped++
    return bridged
  }

  // ยอดหัวใบจาก ATMS — ใช้แยกยอดของแถวที่จ่ายครอบหลายใบ + เป็นตัวกรอง "อยู่ในขอบเขตระบบ"
  const recs = new Map<string, Rec>()
  const allCodes = new Set<string>()
  const rowCodes = rows.slice(1).map((row) => codesOf(row))
  for (const codes of rowCodes) for (const code of codes) allCodes.add(code)
  const headBy = new Map<string, { amount: number; warehouse: string }>()
  const codeList = [...allCodes]
  for (let i = 0; i < codeList.length; i += 2000) {
    for (const h of await client.db("atms").collection("deposit_header")
      .find({ deposit_code: { $in: codeList.slice(i, i + 2000) } },
        { projection: { _id: 0, deposit_code: 1, amount: 1, warehouse: 1 } }).toArray()) {
      headBy.set(s(h.deposit_code), { amount: parseAmount(h.amount), warehouse: s(h.warehouse) })
    }
  }

  // แบบ B: เลขตั้งหนี้เดียวครอบหลายใบ DD และอาจจ่ายหลายงวดคนละแถว → รวมยอดจ่ายต่อเลขตั้งหนี้ก่อนค่อยแยก
  const voucherTotal = new Map<string, number>()
  if (raw) for (const [i, row] of rows.slice(1).entries()) {
    if (rowCodes[i].length < 2) continue
    const v = s(row[col.lapo])
    voucherTotal.set(v, (voucherTotal.get(v) ?? 0) + parseAmount(row[col.amt]))
  }
  const voucherSplitDone = new Set<string>()
  // ตัวคูณแยกยอด: ยอดจ่ายรวม VAT แต่ยอดหัวใบ DD ของคลังนอก DIST/สระบุรี ไม่รวม VAT (กติกาเดียวกับ /pr)
  const splitFactor = (headSum: number, paid: number): number | null =>
    Math.abs(headSum - paid) <= 1 ? 1 : Math.abs(headSum * 1.07 - paid) <= 1 ? 1.07 : null

  let junkRows = 0
  for (const [i, row] of rows.slice(1).entries()) {
    const codes = rowCodes[i]
    if (!codes.length) { if (!raw && s(row[col.dd])) junkRows++; continue }
    const pv = s(row[col.pv])
    const d = ymd(row[col.date])
    const amt = parseAmount(row[col.amt])
    // แถวครอบหลายใบ: แยกยอดเมื่อผลบวกยอดหัวใบ (หรือ ×1.07) ตรงกับยอดจ่าย (±1)
    const headSum = codes.reduce((n, c) => n + (headBy.get(c)?.amount ?? 0), 0)
    const voucher = raw ? s(row[col.lapo]) : ""
    const groupAmt = voucherTotal.get(voucher) ?? amt
    const factor = codes.length === 1 ? 1 : splitFactor(headSum, groupAmt)
    for (const code of codes) {
      const r = recs.get(code) ?? { pvs: new Set(), dates: new Set(), ownAmount: 0, sharedWith: new Set(), sharedOnly: false }
      if (pv) r.pvs.add(pv)
      if (d) r.dates.add(d)
      if (codes.length === 1) r.ownAmount += amt
      else if (factor != null) {
        // แบ่งครั้งเดียวต่อเลขตั้งหนี้ (แถวงวดถัดไปของเลขเดียวกันไม่บวกซ้ำ)
        if (!voucher || !voucherSplitDone.has(voucher)) r.ownAmount += Math.round((headBy.get(code)?.amount ?? 0) * factor * 100) / 100
      }
      else { r.sharedOnly = true; codes.filter((c) => c !== code).forEach((c) => r.sharedWith.add(c)) }
      recs.set(code, r)
    }
    if (voucher && codes.length > 1) voucherSplitDone.add(voucher)
  }

  const cur = new Map<string, Record<string, unknown>>()
  for (let i = 0; i < codeList.length; i += 2000) {
    for (const d of await col2.find({ depositCode: { $in: codeList.slice(i, i + 2000) } },
      { projection: { _id: 0, depositCode: 1, "paid.paymentNos": 1, "paid.amount": 1 } }).toArray()) {
      cur.set(String(d.depositCode), d)
    }
  }
  const isSaraburi = (w: string) => w.includes("สระบุรี") && !w.includes("DIST")

  const now = new Date().toISOString()
  let willWrite = 0, skipOld = 0, skipSaraburi = 0, skipSame = 0, newDocs = 0, sharedN = 0, amountFixed = 0
  const ops: Parameters<typeof col2.bulkWrite>[0] = []
  for (const [code, r] of recs) {
    if (!r.pvs.size || !r.dates.size) continue
    const h = headBy.get(code)
    if (!h) { skipOld++; continue }                                 // ก่อน ม.ค. 69 / เลขเพี้ยน — นอกขอบเขต
    const c = cur.get(code)
    if (!c && isSaraburi(h.warehouse)) { skipSaraburi++; continue } // สระบุรีไม่มี tracking — ไม่สร้าง
    const oldPaid = c?.paid as { paymentNos?: string[]; amount?: number } | undefined
    const oldPvs = new Set(oldPaid?.paymentNos ?? [])
    const pvs = [...r.pvs].sort()
    const newAmount = !r.sharedOnly && r.ownAmount ? Math.round(r.ownAmount * 100) / 100 : undefined
    const samePv = pvs.every((p) => oldPvs.has(p)) && oldPvs.size === pvs.length
    const sameAmt = (oldPaid?.amount ?? null) === (newAmount ?? null)
    if (samePv && sameAmt) { skipSame++; continue }  // รันซ้ำ
    if (samePv && !sameAmt) amountFixed++
    if (!c) newDocs++
    if (r.sharedOnly) sharedN++
    const paid: Record<string, unknown> = {
      paymentNos: pvs,
      date: [...r.dates].sort().at(-1),                            // หลายงวด = วันล่าสุด
      source: "payment-file",
      by: IMPORT_BY, at: now,
    }
    if (newAmount != null) paid.amount = newAmount
    if (r.sharedWith.size) paid.sharedWith = [...r.sharedWith].sort()
    willWrite++
    ops.push({
      updateOne: {
        filter: { depositCode: code },
        update: {
          $set: { depositCode: code, paid, updatedAt: now, updatedBy: IMPORT_BY },
          $push: { log: { action: "บันทึกการจ่ายเงิน (นำเข้าไฟล์การเงิน)", field: "paid",
                          detail: `PV ${pvs.join(", ")} · จ่าย ${paid.date}${r.sharedWith.size ? ` · จ่ายรวมกับ ${[...r.sharedWith].join(", ")}` : ""}`,
                          by: IMPORT_BY, at: now } },
          $setOnInsert: { createdAt: now, createdBy: IMPORT_BY },
        },
        upsert: true,
      },
    })
  }

  console.log(`ไฟล์: ${path.basename(file)} · แถว ${rows.length - 1} · ใบ DD ไม่ซ้ำ ${recs.size.toLocaleString("th-TH")}${raw ? ` · DD จากชีต GL ${viaGl} · จาก InvNo ${viaInv} · ผ่าน voucherNos ${viaVoucher} · แมปไม่ได้ (ไม่ใช่ใบ DD) ${unmapped}` : ` · แถวเลขอ่านไม่ได้ ${junkRows}`}`)
  console.log(`\n── สรุป ──────────────────────────────`)
  console.log(`  จะบันทึกจ่ายแล้ว               ${willWrite.toLocaleString("th-TH")} ใบ  (สร้าง tracking ใหม่ ${newDocs} · PV เดิมแต่แก้ยอด ${amountFixed})`)
  console.log(`  ยอดแยกไม่ได้ (จ่ายรวมหลายใบ)    ${sharedN}  — เก็บ PV/วันจ่ายครบ แต่ไม่ใส่ยอด`)
  console.log(`  ข้าม: ก่อนขอบเขตระบบ/เลขเพี้ยน  ${skipOld}`)
  console.log(`  ข้าม: คลังสระบุรี               ${skipSaraburi}`)
  console.log(`  ข้าม: นำเข้าแล้ว (รันซ้ำ)        ${skipSame}`)
  if (!write) console.log("\nโหมดดูอย่างเดียว — ใส่ --write เพื่อเขียนจริง")
  else if (ops.length) {
    const res = await col2.bulkWrite(ops, { ordered: false })
    console.log(`\nเขียนแล้ว: สร้างใหม่ ${res.upsertedCount.toLocaleString("th-TH")} · อัปเดต ${res.modifiedCount.toLocaleString("th-TH")}`)
  }
  await client.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
