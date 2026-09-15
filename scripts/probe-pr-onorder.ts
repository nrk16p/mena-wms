// scripts/probe-pr-onorder.ts — อ่านอย่างเดียว ไม่เขียน DB
// รัน: node -r dotenv/config node_modules/.bin/tsx scripts/probe-pr-onorder.ts <PR_CODE> [SKU]
// ตอบคำถามเดียว: ทำไมใบ PR ใบนี้ถึงไม่โผล่ในคอลัมน์ "กำลังสั่งซื้อ" ของ /safety-stock
// เดินตามตัวกรองของ openPrQtyBySku ทีละข้อ แล้วบอกว่าตกที่ข้อไหน
import clientPromise from "../lib/mongo"
import { ageDaysFromDmy, isVehiclePlate, ON_ORDER_MAX_AGE_DAYS, WAREHOUSES } from "../lib/safety-stock-core"

const MASTER_DB = process.env.MONGO_DB ?? "master_data"
const prCode = process.argv[2]
const wantSku = process.argv[3] ?? ""
const ok = (b: boolean) => (b ? "✅" : "❌")

async function main() {
  if (!prCode) { console.error("ต้องระบุเลข PR"); process.exit(1) }
  const client = await clientPromise
  const atms = client.db("atms")
  const asOf = new Date()

  // 1) หัวใบ PR
  const head = await atms.collection("purchase_requests")
    .findOne({ "ใบขอสั่งซื้อ (PR)": prCode }, { projection: { _id: 0 }, maxTimeMS: 20_000 })
  if (!head) {
    console.log(`❌ ไม่พบ ${prCode} ใน atms.purchase_requests เลย — scraper ยังไม่ได้ดึงใบนี้เข้ามา`)
    await client.close(); return
  }
  const h = head as Record<string, unknown>
  const wh = String(h["คลังสินค้า"] ?? ""), date = String(h["วันที่"] ?? "")
  const plate = String(h["ทะเบียน"] ?? ""), note = String(h["หมายเหตุ"] ?? "")
  const approved = typeof h["is approved"] === "boolean" ? (h["is approved"] as boolean) : null
  const age = ageDaysFromDmy(date, asOf)
  const inv = WAREHOUSES.find((w) => w.name === wh)?.id ?? "?"
  console.log(`\n=== ${prCode} ===`)
  console.log(`  วันที่ ${date} (อายุ ${age} วัน) · คลัง "${wh}" (inventoryId=${inv}) · ทะเบียน "${plate}"`)
  console.log(`  is approved = ${approved === null ? "ไม่มีฟิลด์/null (นับต่อ)" : approved} · หมายเหตุ "${note}"`)
  console.log(`\n  ตัวกรองหัวใบ (openPrQtyBySku):`)
  console.log(`   ${ok(!!inv && inv !== "?")} คลังอยู่ใน WAREHOUSES`)
  console.log(`   ${ok(!isVehiclePlate(plate))} ไม่ใช่อะไหล่ลงคัน (isVehiclePlate=${isVehiclePlate(plate)})`)
  console.log(`   ${ok(approved !== false)} ผ่านอนุมัติ / ไม่รู้`)
  console.log(`   ${ok(!/ยกเลิก/.test(note))} หมายเหตุไม่มีคำว่า "ยกเลิก"`)
  console.log(`   ${ok(age !== null && age >= 0 && age <= ON_ORDER_MAX_AGE_DAYS)} อายุ 0–${ON_ORDER_MAX_AGE_DAYS} วัน`)

  // 2) PO + DD ของใบนี้
  const pos = (await atms.collection("purchase_orders")
    .find({ "ใบขอสั่งซื้อ (PR)": prCode })
    .project({ _id: 0, "รหัส": 1, "สถานะการรับสินค้า": 1 })
    .maxTimeMS(20_000).toArray()) as Record<string, unknown>[]
  const live = pos.filter((p) => !String(p["สถานะการรับสินค้า"] ?? "").includes("ยกเลิก")).map((p) => String(p["รหัส"] ?? "")).filter(Boolean)
  const dd = live.length
    ? await atms.collection("deposit_header").distinct("purchase_order", { purchase_order: { $in: live } })
    : []
  console.log(`\n  PO ${pos.length} ใบ (ไม่ยกเลิก ${live.length}) · มีใบรับของ (DD) แล้ว ${dd.length} ใบ`)
  pos.forEach((p) => console.log(`    ${String(p["รหัส"])} · ${String(p["สถานะการรับสินค้า"] ?? "-")} · DD=${dd.includes(String(p["รหัส"])) ? "มี" : "ยังไม่มี"}`))
  console.log(`   ${ok(!(live.length > 0 && live.every((c) => dd.includes(c))))} ยังไม่มี DD ครบทุกใบ (ถ้า ❌ = ปิดงานแล้ว ไม่นับเป็นของกำลังมา)`)

  // 3) บรรทัดสินค้าในใบ
  const items = (await atms.collection("purchase_request_items")
    .find({ pr_code: prCode }).project({ _id: 0, sku: 1, amount: 1, warehouse: 1, group: 1, name: 1 })
    .maxTimeMS(20_000).toArray()) as Record<string, unknown>[]
  const poItems = live.length
    ? (await atms.collection("purchase_order_items").find({ po_code: { $in: live } })
        .project({ _id: 0, po_code: 1, sku: 1, received: 1 }).maxTimeMS(20_000).toArray()) as Record<string, unknown>[]
    : []
  console.log(`\n  บรรทัดในใบ PR ${items.length} รายการ:`)
  for (const it of items) {
    const sku = String(it.sku ?? "")
    if (wantSku && sku !== wantSku) continue
    const recv = poItems.filter((p) => String(p.sku ?? "") === sku).reduce((a, p) => a + (Number(p.received) || 0), 0)
    const net = Math.max(0, (Number(it.amount) || 0) - recv)
    console.log(`    ${sku.padEnd(14)} ${String(it.name ?? "").slice(0, 28).padEnd(30)} จำนวน ${it.amount} · รับแล้ว ${recv} · สุทธิ ${net}`)
    console.log(`       ${ok(String(it.warehouse ?? "") === wh)} warehouse บรรทัด "${it.warehouse}" ตรงกับหัวใบ "${wh}"`)
    console.log(`       ${ok(!/^ค่าแรง/.test(String(it.group ?? "")))} กลุ่ม "${it.group}" ไม่ใช่ค่าแรง`)
    console.log(`       ${ok(net > 0)} สุทธิ > 0`)
  }

  // 4) snapshot ที่หน้าเว็บอ่านจริง
  if (wantSku) {
    const snap = await client.db(MASTER_DB).collection("safety_stock_snapshot")
      .findOne({ code: wantSku, inventoryId: inv }, { projection: { _id: 0, code: 1, inventoryId: 1, stockQty: 1, onOrder: 1, updatedAt: 1 }, maxTimeMS: 20_000 })
    console.log(`\n  snapshot ที่หน้าเว็บอ่าน (${MASTER_DB}.safety_stock_snapshot):`)
    console.log(`   ${snap ? JSON.stringify(snap) : "ไม่พบแถว"}`)
  }
  await client.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
