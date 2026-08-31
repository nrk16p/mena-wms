// scripts/backfill-ap-sent.ts
// รัน (ดูอย่างเดียว): node -r dotenv/config node_modules/.bin/tsx scripts/backfill-ap-sent.ts
// รัน (เขียนจริง):    node -r dotenv/config node_modules/.bin/tsx scripts/backfill-ap-sent.ts --apply
//
// คู่กับ backfill-ap-pay.ts — ตัวนั้นแก้ ap_tracking.pay (ตารางที่บัญชียืนยันตอนกดผ่าน)
// ตัวนี้แก้ ap_tracking.sentDate (วันที่จัดซื้อ "ขอ" ตอนกดส่งบัญชี) ซึ่งถูกแช่ไว้แบบเดียวกัน
// และเป็นตัวที่ยังโชว์ค้างอยู่บนหน้าเว็บว่า "บันทึกไว้: นอกรอบ 27 ส.ค. 69"
//
// ขอบเขต — เฉพาะใบที่ยังรออยู่ในคิวจริง:
//   ต้องยังไม่ผ่านบัญชี (ไม่มี pay) — ใบที่ผ่านแล้ว pay คือตัวจริง ส่วน sentDate คือบันทึกว่า
//     "จัดซื้อขออะไรมา" การเขียนทับคือลบประวัติคำขอทิ้งโดยไม่ได้อะไรกลับมา
//   ต้องยังไม่จ่ายเงิน (ไม่มี paid.paymentNos) — เงินออกแล้วห้ามขยับตาราง
//   ต้องมี sentMarkedAt — ไม่มีวันที่กดส่ง ก็ไม่มีจุดตั้งต้นให้คิดรอบ
// apSentRecalc clamp ขึ้นอย่างเดียว (ดูเหตุผลใน lib) — เกณฑ์คือรอบของวันที่กดส่งตัวเอง ไม่ใช่อายุใบ
import { MongoClient } from "mongodb"
import { apSentRecalc, resolveCreditTerm, ictDate, thaiDate } from "../lib/ap-tracking"

const APPLY = process.argv.includes("--apply")
const MD = process.env.MONGO_DB ?? "master_data"
const ATMS = "atms"   // เหมือน API ตาราง — ฐาน ATMS ไม่ได้ผูกกับ env ที่ไหนในโปรเจกต์
const s = (v: unknown) => String(v ?? "").trim()
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))

async function main() {
  const uri = process.env.MONGO_URI
  if (!uri) throw new Error("ไม่มี MONGO_URI")
  const client = new MongoClient(uri)
  await client.connect()
  const md = client.db(MD)
  const atms = client.db(ATMS)
  const col = md.collection("ap_tracking")

  const open = await col.find(
    {
      sentDate: { $nin: ["", null] },
      sentMarkedAt: { $nin: ["", null] },
      $or: [{ pay: null }, { pay: { $exists: false } }],
      "paid.paymentNos.0": { $exists: false },
    },
    { projection: { _id: 0, depositCode: 1, sentType: 1, sentDate: 1, sentMarkedAt: 1 } },
  ).toArray()
  console.log(`โหมด: ${APPLY ? "เขียนจริง (--apply)" : "ดูอย่างเดียว (dry run)"} · db ${MD}/${ATMS}`)
  console.log(`ใบที่ยังรอคิว (ยังไม่ผ่าน + ยังไม่จ่าย + มีวันกดส่ง): ${open.length}\n`)

  // เครดิตเทอมรายใบต้อง join สามทาง เหมือนที่ API ตารางทำ (route.ts:150-160)
  // ATMS เป็นฐานโปรดักชันที่ทรุดง่าย — แบ่ง batch + projection แคบ ไม่ยิงทีเดียวทั้งก้อน
  const codes = open.map((d) => s(d.depositCode)).filter(Boolean)
  const heads: Record<string, unknown>[] = []
  for (const part of chunk(codes, 300)) {
    heads.push(...await atms.collection("deposit_header").find(
      { deposit_code: { $in: part } },
      { projection: { _id: 0, deposit_code: 1, supplier: 1, purchase_order: 1 } },
    ).toArray())
  }
  const headBy = new Map(heads.map((h) => [s(h.deposit_code), h]))
  const supNames = [...new Set(heads.map((h) => s(h.supplier)).filter(Boolean))]
  const poCodes = [...new Set(heads.map((h) => s(h.purchase_order)).filter(Boolean))]

  const sups: Record<string, unknown>[] = []
  for (const part of chunk(supNames, 300)) {
    sups.push(...await md.collection("ap_supplier").find(
      { name: { $in: part } }, { projection: { _id: 0, name: 1, creditTerm: 1, override: 1, atmsTerm: 1 } },
    ).toArray())
  }
  const termBy = new Map(sups.map((x) => [s(x.name), { override: s(x.override), master: s(x.atmsTerm) || s(x.creditTerm) }]))

  const pos: Record<string, unknown>[] = []
  for (const part of chunk(poCodes, 300)) {
    pos.push(...await atms.collection("purchase_orders").find(
      { "รหัส": { $in: part } }, { projection: { _id: 0, "รหัส": 1, "ap term": 1 } },
    ).toArray())
  }
  const poBy = new Map(pos.map((p) => [s(p["รหัส"]), p]))

  const changes: { code: string; type: string; from: string; to: string; term: string; marked: string }[] = []
  let noHead = 0
  for (const d of open) {
    const code = s(d.depositCode)
    const h = headBy.get(code)
    if (!h) { noHead++; continue }
    const sup = termBy.get(s(h.supplier))
    const { creditTerm } = resolveCreditTerm(sup?.override ?? "", s(poBy.get(s(h.purchase_order))?.["ap term"]), sup?.master ?? "")
    const marked = ictDate(s(d.sentMarkedAt))
    const next = apSentRecalc(s(d.sentType), s(d.sentDate), marked, creditTerm)
    if (next) changes.push({ code, type: s(d.sentType), from: s(d.sentDate), to: next, term: creditTerm || "—", marked })
  }

  const byMonth = new Map<string, number>()
  for (const c of changes) byMonth.set(c.marked.slice(0, 7), (byMonth.get(c.marked.slice(0, 7)) ?? 0) + 1)

  console.log(`── ต้องแก้ ${changes.length} ใบ (แยกตามเดือนที่กดส่ง) ──`)
  for (const [m, n] of [...byMonth].sort()) console.log(`  ${m}  ${n} ใบ`)
  console.log()
  for (const c of changes.slice(0, 25)) {
    console.log(`${c.code}  ${c.type} [${c.term}] กดส่ง ${thaiDate(c.marked)} · ${thaiDate(c.from)} → ${thaiDate(c.to)}`)
  }
  if (changes.length > 25) console.log(`… อีก ${changes.length - 25} ใบ`)
  console.log(`\nสรุป: ตรวจ ${open.length} · ต้องแก้ ${changes.length} · ไม่เจอหัวใบใน ATMS ${noHead}`)

  if (!APPLY) {
    console.log("\nยังไม่เขียนอะไรลงฐาน — เติม --apply เมื่อยืนยันตัวเลขข้างบนแล้ว")
    await client.close()
    return
  }

  const at = new Date().toISOString()
  for (const part of chunk(changes, 200)) {
    await col.bulkWrite(part.map((c) => ({
      updateOne: {
        filter: { depositCode: c.code },
        update: {
          // เก็บของเดิมไว้ที่ sentDatePrev — ย้อนกลับได้เหมือน payPrev
          $set: { sentDate: c.to, sentDatePrev: c.from, sentRecalcAt: at },
          $push: {
            log: {
              action: "ปรับวันที่ขอตามกติกาปัจจุบัน", field: "sent",
              detail: `${c.type} ${thaiDate(c.from)} → ${thaiDate(c.to)} (กดส่ง ${thaiDate(c.marked)})`,
              by: "ระบบ (backfill-ap-sent)", byEmail: "", at,
            },
          },
        } as never,
      },
    })))
  }
  console.log(`\nเขียนแล้ว ${changes.length} ใบ (ของเดิมเก็บไว้ที่ sentDatePrev)`)
  await client.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
