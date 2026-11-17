// scripts/backfill-ap-import-pay.ts
// รัน (ดูเฉย ๆ):  npx tsx scripts/backfill-ap-import-pay.ts [--code KKDD26110001] [--csv out.csv]
// รัน (เขียนจริง): npx tsx scripts/backfill-ap-import-pay.ts --write
//
// ใบที่ผ่านมาจาก "นำเข้าการตั้งเบิก" ก่อน 17/11/2026 ไม่มีวันจ่าย (กติกาเดิม 01/10/2026)
// สคริปต์นี้คิดวันจ่ายให้ด้วยสูตรเดียวกับปุ่มนำเข้าตอนนี้ (apImportPaySchedule):
//   นับจากวันกดส่งบัญชีครั้งล่าสุด ตามเครดิตเทอม · วันกดผ่าน = วันที่นำเข้าเดิม (review.at)
// แตะเฉพาะ: บัญชีผ่าน + ยังไม่มี pay + ยังไม่จ่าย + log บอกว่าผ่านจากนำเข้าการตั้งเบิก
// ใบที่หาเครดิตเทอมไม่เจอ = ข้าม (บัญชีกำหนดเองในหน้าใบ) · รันซ้ำได้ ใบที่มี pay แล้วไม่แตะ
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { MongoClient } from "mongodb"
import {
  apImportPaySchedule, apImportPayText, apLatestSentAt, apPaidConfirmed, ictDate, resolveCreditTerm, todayICT,
} from "../lib/ap-tracking"

const LOG_KEEP = 200
const s = (v: unknown) => (v == null ? "" : String(v)).trim()
type Doc = Record<string, unknown>
type LogE = { action?: string; field?: string; at?: string; detail?: string }

async function main() {
  const write = process.argv.includes("--write")
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? s(process.argv[i + 1]) : "" }
  const code = arg("--code").toUpperCase()
  const csv = arg("--csv")

  const env = readFileSync(path.join(process.cwd(), ".env"), "utf8")
  const uri = env.match(/^MONGO_URI=(.+)$/m)![1].trim().replace(/^["']|["']$/g, "")
  const dbName = env.match(/^MONGO_DB=(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, "") ?? "master_data"
  if (dbName === "atms") throw new Error("MONGO_DB ต้องไม่ใช่ 'atms' — ฐานนั้นเป็น read-only ของ scraper")

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000 })
  await client.connect()
  try {
    const md = client.db(dbName), atms = client.db("atms")
    const filter: Doc = { "review.status": "ผ่าน", pay: null, ...(code ? { depositCode: code } : {}) }
    const docs = await md.collection("ap_tracking").find(filter, {
      projection: { _id: 0, depositCode: 1, review: 1, pay: 1, paid: 1, sentType: 1, sentMarkedAt: 1, log: 1, updatedAt: 1 },
      maxTimeMS: 30_000,
    }).toArray() as Doc[]
    const fromImport = docs.filter((d) => !apPaidConfirmed(d.paid as never)
      && ((d.log ?? []) as LogE[]).some((e) => e.field === "review" && s(e.action) === "บัญชีตรวจเอกสาร: ผ่าน" && s(e.detail).startsWith("นำเข้าการตั้งเบิก")))
    const codes = fromImport.map((d) => s(d.depositCode))
    const heads = codes.length ? await atms.collection("deposit_header").find({ deposit_code: { $in: codes } },
      { projection: { _id: 0, deposit_code: 1, supplier: 1, purchase_order: 1 }, maxTimeMS: 30_000 }).toArray() as Doc[] : []
    const headBy = new Map(heads.map((h) => [s(h.deposit_code), h]))
    const supNames = [...new Set(heads.map((h) => s(h.supplier)).filter(Boolean))]
    const poCodes = [...new Set(heads.map((h) => s(h.purchase_order)).filter(Boolean))]
    const [sups, pos] = await Promise.all([
      supNames.length ? md.collection("ap_supplier").find({ name: { $in: supNames } },
        { projection: { _id: 0, name: 1, creditTerm: 1, override: 1, atmsTerm: 1 }, maxTimeMS: 30_000 }).toArray() as Promise<Doc[]> : [],
      poCodes.length ? atms.collection("purchase_orders").find({ "รหัส": { $in: poCodes } },
        { projection: { _id: 0, "รหัส": 1, "ap term": 1 }, maxTimeMS: 30_000 }).toArray() as Promise<Doc[]> : [],
    ])
    const supBy = new Map(sups.map((x) => [s(x.name), x]))
    const poBy = new Map(pos.map((p) => [s(p["รหัส"]), p]))

    const today = todayICT()
    const at = new Date().toISOString()
    const rows: { code: string; supplier: string; term: string; sent: string; passed: string; payDate: string; text: string }[] = []
    const ops: unknown[] = []
    for (const d of fromImport) {
      const c = s(d.depositCode)
      const head = headBy.get(c)
      const sup = supBy.get(s(head?.supplier))
      const creditTerm = resolveCreditTerm(s(sup?.override), s(poBy.get(s(head?.purchase_order))?.["ap term"]), s(sup?.atmsTerm) || s(sup?.creditTerm)).creditTerm
      const sentDoc = ictDate(apLatestSentAt(s(d.sentMarkedAt), d.log as LogE[]))
      const review = (d.review ?? {}) as { at?: string; by?: string }
      const passedAt = s(review.at)
      const passedISO = ictDate(passedAt)
      const r = apImportPaySchedule({ passedISO, sentType: s(d.sentType), creditTerm, sentDocISO: sentDoc })
      const text = apImportPayText(r, sentDoc)
      rows.push({ code: c, supplier: s(head?.supplier), term: creditTerm, sent: sentDoc, passed: passedISO, payDate: r.ok ? r.schedule.payDate : "", text })
      if (!r.ok) continue
      const { schedule, payFrom } = r
      const pay = {
        ...schedule,
        basis: {
          passedAt, passedDate: passedISO, creditTerm, requestedType: s(d.sentType), source: "voucher-import", sentDate: sentDoc,
          ...(schedule.cutoff ? { cutoffFrom: payFrom } : {}),
        },
        by: s(review.by), at: passedAt,
      }
      ops.push({
        updateOne: {
          filter: { depositCode: c, "review.status": "ผ่าน", pay: null, updatedAt: d.updatedAt ?? { $exists: false } },
          update: {
            $set: { pay, updatedAt: at, updatedBy: "ระบบ (backfill วันจ่ายนำเข้าการตั้งเบิก)" },
            $push: { log: { $each: [{ action: "กำหนดจ่ายเงิน", field: "pay", detail: `${text} · เติมย้อนหลัง`, by: "ระบบ (backfill)", byEmail: "", at }], $slice: -LOG_KEEP } },
          },
        },
      })
    }

    rows.sort((a, b) => (a.payDate || "9").localeCompare(b.payDate || "9"))
    for (const r of rows) console.log(`${r.code}  ${r.term.padEnd(9)} ส่ง ${r.sent || "—"}  ผ่าน ${r.passed}  → ${r.payDate || "—"}  ${r.supplier.slice(0, 30)}`)
    const noTerm = rows.filter((r) => !r.payDate).length
    const past = rows.filter((r) => r.payDate && r.payDate < today).length
    const byPay = new Map<string, number>()
    for (const r of rows) if (r.payDate) byPay.set(r.payDate, (byPay.get(r.payDate) ?? 0) + 1)
    console.log(`\nผ่าน+ไม่มีวันจ่าย ${docs.length} ใบ · มาจากนำเข้าการตั้งเบิก ${fromImport.length} ใบ · คิดได้ ${ops.length} · ไม่มีเครดิตเทอม ${noTerm} · วันจ่ายก่อนวันนี้ (${today}) ${past}`)
    console.log("แยกตามวันจ่าย:", [...byPay].sort().map(([k, v]) => `${k}=${v}`).join("  "))
    if (csv) {
      writeFileSync(csv, "﻿เลขใบ,ซัพพลายเออร์,เครดิต,วันส่งล่าสุด,วันผ่าน(นำเข้า),วันจ่าย,ที่มา\n"
        + rows.map((r) => [r.code, r.supplier, r.term, r.sent, r.passed, r.payDate, r.text].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n"))
      console.log("เขียน", csv)
    }
    if (!write) { console.log("(ดูอย่างเดียว — ใส่ --write เพื่อเขียนจริง)"); return }
    let done = 0
    for (let i = 0; i < ops.length; i += 500) {
      const res = await md.collection("ap_tracking").bulkWrite(ops.slice(i, i + 500) as never, { ordered: false })
      done += res.modifiedCount
      await new Promise((r) => setTimeout(r, 500))
    }
    console.log(`เขียนแล้ว ${done}/${ops.length} ใบ (ที่เหลือมีคนแก้ระหว่างรัน — ข้าม) · หน้าเว็บแคช AP อาจค้างไม่เกิน 30 นาที`)
  } finally {
    await client.close()
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
