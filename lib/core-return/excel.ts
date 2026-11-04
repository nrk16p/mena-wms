// lib/core-return/excel.ts — Excel ของงานติดตามซาก: รายการตามตัวกรอง · รอบขายซาก · ซากรอขาย ณ วันนี้ (แยกคลัง × กลุ่มสินค้า × อายุในคลังซาก)
import type { Worksheet } from "exceljs"
import { STATUS_LABEL, daysSince, todayBkk, type CoreRow } from "./core"
import type { SaleRound } from "./db"

const CHOICE: Record<string, string> = { sell: "S1 ซากมีมูลค่า", rebuild: "A2 ของรีบิ้ว", no_core: "S2 ซากไม่มีมูลค่า", missing: "ไม่มีซากคืน" }
const MONEY = "#,##0.00"
const bkkDate = (d: Date | string | null | undefined) => (d ? todayBkk(new Date(d)) : "")

async function workbook() {
  const ExcelJS = (await import("exceljs")).default
  return new ExcelJS.Workbook()
}
function finish(ws: Worksheet, moneyKeys: string[] = []) {
  ws.getRow(1).font = { bold: true }
  ws.views = [{ state: "frozen", ySplit: 1 }]
  for (const k of moneyKeys) ws.getColumn(k).numFmt = MONEY
}

/** รายการตามตัวกรองบนหน้า (จัดซื้อส่งต่อทีมได้: มีค้างกี่วัน + การตามล่าสุด) */
export type GarageGroup = { key: { garageType?: string; garage?: string }; count: number; pieces: number; amount: number; vehicles: number; mrs: number; oldest: string; days: number | null; uncertain?: boolean }

export async function buildListWorkbook(rows: CoreRow[], opt: { truncated?: boolean; now?: Date; garages?: GarageGroup[] } = {}) {
  const now = opt.now ?? new Date()
  const wb = await workbook()
  const ws = wb.addWorksheet("ติดตามซาก")
  ws.columns = [
    { header: "วันที่เบิก", key: "d", width: 12 }, { header: "ค้าง (วัน)", key: "days", width: 10 }, { header: "สถานะ", key: "st", width: 26 },
    { header: "คลัง", key: "wh", width: 16 }, { header: "อู่ใน/อู่นอก", key: "gt", width: 10 }, { header: "อู่", key: "ga", width: 30 }, { header: "ที่มาชื่ออู่", key: "gs", width: 24 },
    { header: "WD", key: "wd", width: 16 }, { header: "MR", key: "mr", width: 16 },
    { header: "ทะเบียน", key: "pl", width: 14 }, { header: "เบอร์รถ", key: "vn", width: 10 }, { header: "พจส.", key: "dr", width: 18 },
    { header: "รหัสสินค้า", key: "sku", width: 16 }, { header: "ชื่อสินค้า", key: "nm", width: 40 }, { header: "กลุ่มสินค้า", key: "pg", width: 18 },
    { header: "จำนวนเบิก", key: "qty", width: 10 }, { header: "คืนแล้ว", key: "rq", width: 9 }, { header: "ยอดเงิน", key: "amt", width: 14 },
    { header: "คืนแบบ", key: "ch", width: 14 }, { header: "เข้าคลังซาก", key: "si", width: 12 }, { header: "รอบขาย", key: "rd", width: 12 },
    { header: "วันที่ขาย", key: "sd", width: 12 }, { header: "รีบิ้วเสร็จ", key: "rb", width: 12 }, { header: "S2 / ไม่มีซาก เพราะ", key: "nc", width: 18 },
    { header: "ตามแล้ว (ครั้ง)", key: "fc", width: 10 }, { header: "ตามล่าสุด", key: "fa", width: 12 }, { header: "โน้ตการตามล่าสุด", key: "fn", width: 40 },
    { header: "ตามครั้งถัดไป", key: "fx", width: 12 }, { header: "รอบไฟล์เดิม", key: "lr", width: 22 }, { header: "row_key", key: "k", width: 36 },
  ]
  for (const r of rows) {
    const open = r.coreStatus === "pending" || r.coreStatus === "legacy"
    ws.addRow({
      d: r.issuedDate, days: open ? daysSince(r.issuedDate, now) ?? "" : "", st: STATUS_LABEL[r.coreStatus] ?? r.coreStatus,
      wh: r.warehouse ?? "", gt: r.garageType ?? "", ga: r.garage ?? "", gs: r.garageSource ?? "", wd: r.wdCode ?? "", mr: r.mrCode ?? "", pl: r.plate ?? "", vn: r.vehicleNo ?? "", dr: r.driver ?? "",
      sku: r.skuCode ?? "", nm: r.skuName ?? "", pg: r.productGroup ?? "", qty: r.qtyIssued ?? "", rq: r.coreQtyReturned ?? 0, amt: r.amount ?? "",
      ch: r.ret ? CHOICE[r.ret.choice] ?? r.ret.choice : "", si: r.sale?.scrapInDate ?? "", rd: r.saleRoundNo ?? r.sale?.roundNo ?? "",
      sd: r.sale?.soldDate ?? "", rb: r.rebuild?.doneDate ?? "", nc: r.noCore?.reason ?? "",
      fc: r.followUp?.count ?? 0, fa: bkkDate(r.followUp?.lastAt), fn: r.followUp?.lastNote ?? "", fx: r.followUp?.nextDate ?? "",
      lr: r.legacyRound ?? "", k: r.row_key,
    })
  }
  finish(ws, ["amt"])
  if (opt.truncated) ws.addRow({ d: "รายการเกินที่ส่งออกได้ในครั้งเดียว — กรองให้แคบลงแล้ว Export อีกครั้ง" })
  if (opt.garages) {
    const g = wb.addWorksheet("ตามอู่")
    g.columns = [
      { header: "อู่ใน/อู่นอก", key: "t", width: 10 }, { header: "อู่", key: "g", width: 40 }, { header: "ยังไม่คืนซาก (บรรทัด)", key: "n", width: 14 },
      { header: "ชิ้นที่ยังไม่คืน", key: "p", width: 12 }, { header: "ยอดเงิน", key: "a", width: 14 }, { header: "จำนวนรถ", key: "v", width: 10 },
      { header: "จำนวน MR", key: "m", width: 10 }, { header: "เบิกเก่าสุด", key: "o", width: 12 }, { header: "ค้างนานสุด (วัน)", key: "d", width: 12 },
      { header: "หมายเหตุ", key: "u", width: 28 },
    ]
    for (const x of opt.garages) g.addRow({ t: x.key.garageType ?? "", g: x.key.garage || "(ไม่ระบุ)", n: x.count, p: x.pieces, a: x.amount, v: x.vehicles, m: x.mrs, o: x.oldest, d: x.days ?? "", u: x.uncertain ? "ชื่อจาก PO อาจเป็นร้านอะไหล่" : "" })
    finish(g, ["a"])
  }
  return Buffer.from(await wb.xlsx.writeBuffer())
}

/** รอบขายซาก: สรุปรอบ + รายการซาก (มีช่อง "ราคาขาย" ว่างไว้กรอกต่อบรรทัด) */
export async function buildRoundWorkbook(round: SaleRound, items: CoreRow[], now = new Date()) {
  const wb = await workbook()
  const cost = items.reduce((a, r) => a + (r.amount ?? 0), 0)
  const s1 = wb.addWorksheet("สรุปรอบ")
  s1.columns = [{ header: "หัวข้อ", key: "k", width: 22 }, { header: "ค่า", key: "v", width: 40 }]
  const st = { open: "เปิดอยู่ (รอขาย)", sold: "ขายแล้ว", cancelled: "ยกเลิก" }[round.status]
  for (const [k, v] of [
    ["เลขรอบ", round.roundNo], ["สถานะ", st], ["คลัง", round.warehouses.join(", ")], ["ตัดรอบซากเข้าคลังถึง", round.cutoffDate],
    ["จำนวนรายการ", items.length], ["ยอดทุนเดิมรวม (บาท)", Math.round(cost * 100) / 100], ["สร้างโดย", round.createdBy.name], ["สร้างเมื่อ", bkkDate(round.createdAt)],
    ["วันที่ขาย", round.soldDate ?? ""], ["ผู้ซื้อ", round.buyer ?? ""], ["ราคาขายรวม (บาท)", round.totalPrice ?? ""], ["หมายเหตุ", round.note ?? ""],
  ] as [string, string | number][]) s1.addRow({ k, v })
  s1.getRow(1).font = { bold: true }
  const s2 = wb.addWorksheet("รายการซาก")
  s2.columns = [
    { header: "ลำดับ", key: "i", width: 7 }, { header: "คลัง", key: "wh", width: 16 }, { header: "WD", key: "wd", width: 16 }, { header: "MR", key: "mr", width: 16 },
    { header: "ทะเบียน", key: "pl", width: 14 }, { header: "เบอร์รถ", key: "vn", width: 10 }, { header: "รหัสสินค้า", key: "sku", width: 16 },
    { header: "ชื่อสินค้า", key: "nm", width: 40 }, { header: "กลุ่มสินค้า", key: "pg", width: 18 }, { header: "จำนวน", key: "qty", width: 8 },
    { header: "ทุนเดิม (บาท)", key: "amt", width: 14 }, { header: "เข้าคลังซาก", key: "si", width: 12 }, { header: "อยู่คลังซาก (วัน)", key: "age", width: 12 },
    { header: "ราคาขาย", key: "price", width: 12 }, { header: "row_key", key: "k", width: 36 },
  ]
  items.forEach((r, i) => s2.addRow({
    i: i + 1, wh: r.warehouse ?? "", wd: r.wdCode ?? "", mr: r.mrCode ?? "", pl: r.plate ?? "", vn: r.vehicleNo ?? "", sku: r.skuCode ?? "", nm: r.skuName ?? "",
    pg: r.productGroup ?? "", qty: r.coreQtyReturned || r.qtyIssued || "", amt: r.amount ?? "", si: r.sale?.scrapInDate ?? "",
    age: daysSince(r.sale?.scrapInDate, now) ?? "", price: r.coreStatus === "sold" && r.sale?.price != null ? r.sale.price : null,
  }))
  finish(s2, ["amt", "price"])
  return Buffer.from(await wb.xlsx.writeBuffer())
}

export const AGE_BUCKETS = [
  { key: "a30", label: "0–30 วัน", max: 30 }, { key: "a60", label: "31–60 วัน", max: 60 },
  { key: "a90", label: "61–90 วัน", max: 90 }, { key: "a90p", label: "เกิน 90 วัน", max: Infinity },
] as const
export const ageBucket = (days: number) => AGE_BUCKETS.find((b) => days <= b.max)!.key

/** ซากรอขาย ณ วันนี้: สรุปคลัง × กลุ่มสินค้า × อายุในคลังซาก (จำนวน/ทุนเดิม) + รายการทั้งหมด */
export async function buildScrapAgingWorkbook(rows: CoreRow[], now = new Date()) {
  type Agg = Record<string, { n: number; amt: number }>
  const groups = new Map<string, { wh: string; pg: string; b: Agg }>()
  for (const r of rows) {
    const wh = r.warehouse || "(ไม่ระบุคลัง)"
    const pg = r.productGroup || "(ไม่ระบุกลุ่ม)"
    const id = wh + "\u0000" + pg
    const g = groups.get(id) ?? { wh, pg, b: Object.fromEntries(AGE_BUCKETS.map((x) => [x.key, { n: 0, amt: 0 }])) as Agg }
    const k = ageBucket(daysSince(r.sale?.scrapInDate, now) ?? 0)
    g.b[k].n++
    g.b[k].amt += r.amount ?? 0
    groups.set(id, g)
  }
  const wb = await workbook()
  const s1 = wb.addWorksheet("สรุปตามคลัง-กลุ่ม")
  s1.columns = [
    { header: "คลัง", key: "wh", width: 18 }, { header: "กลุ่มสินค้า", key: "pg", width: 24 },
    ...AGE_BUCKETS.flatMap((b) => [{ header: `${b.label} (รายการ)`, key: b.key + "n", width: 12 }, { header: `${b.label} (ทุนเดิม)`, key: b.key + "a", width: 14 }]),
    { header: "รวม (รายการ)", key: "tn", width: 12 }, { header: "รวม (ทุนเดิม)", key: "ta", width: 14 },
  ]
  const sorted = [...groups.values()].sort((a, b) => a.wh.localeCompare(b.wh, "th") || a.pg.localeCompare(b.pg, "th"))
  for (const g of sorted) {
    const row: Record<string, string | number> = { wh: g.wh, pg: g.pg, tn: 0, ta: 0 }
    for (const b of AGE_BUCKETS) {
      row[b.key + "n"] = g.b[b.key].n
      row[b.key + "a"] = Math.round(g.b[b.key].amt * 100) / 100
      ;(row.tn as number) += g.b[b.key].n
      ;(row.ta as number) += g.b[b.key].amt
    }
    row.ta = Math.round((row.ta as number) * 100) / 100
    s1.addRow(row)
  }
  finish(s1, [...AGE_BUCKETS.map((b) => b.key + "a"), "ta"])
  const s2 = wb.addWorksheet("รายการซากรอขาย")
  s2.columns = [
    { header: "คลัง", key: "wh", width: 16 }, { header: "กลุ่มสินค้า", key: "pg", width: 20 }, { header: "เข้าคลังซาก", key: "si", width: 12 },
    { header: "อยู่คลังซาก (วัน)", key: "age", width: 12 }, { header: "ช่วงอายุ", key: "bk", width: 12 }, { header: "รอบขาย", key: "rd", width: 12 },
    { header: "WD", key: "wd", width: 16 }, { header: "MR", key: "mr", width: 16 }, { header: "ทะเบียน", key: "pl", width: 14 },
    { header: "รหัสสินค้า", key: "sku", width: 16 }, { header: "ชื่อสินค้า", key: "nm", width: 40 }, { header: "จำนวน", key: "qty", width: 8 },
    { header: "ทุนเดิม (บาท)", key: "amt", width: 14 },
  ]
  for (const r of rows) {
    const age = daysSince(r.sale?.scrapInDate, now) ?? 0
    s2.addRow({ wh: r.warehouse ?? "", pg: r.productGroup ?? "", si: r.sale?.scrapInDate ?? "", age, bk: AGE_BUCKETS.find((b) => b.key === ageBucket(age))!.label,
      rd: r.saleRoundNo ?? "", wd: r.wdCode ?? "", mr: r.mrCode ?? "", pl: r.plate ?? "", sku: r.skuCode ?? "", nm: r.skuName ?? "", qty: r.coreQtyReturned || r.qtyIssued || "", amt: r.amount ?? "" })
  }
  finish(s2, ["amt"])
  return Buffer.from(await wb.xlsx.writeBuffer())
}
