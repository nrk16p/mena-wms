// scripts/backfill-ap-pay.ts
// รัน (ดูอย่างเดียว): node -r dotenv/config node_modules/.bin/tsx scripts/backfill-ap-pay.ts
// รัน (เขียนจริง):    node -r dotenv/config node_modules/.bin/tsx scripts/backfill-ap-pay.ts --apply
//
// คิด "กำหนดจ่ายเงิน" (ap_tracking.pay) ใหม่ตามกติกาปัจจุบัน ให้กับใบที่บัญชีกดผ่านไปแล้ว
// ก่อนกติกาจะเปลี่ยน — ค่าใน pay ถูกคำนวณครั้งเดียวตอนกดผ่าน (route [code] บรรทัด 221)
// แล้วอ่านคืนมาโชว์ดิบ ๆ ไม่มีการคิดใหม่ ใบเก่าจึงค้างสูตรเดิมตลอดไป
//
// กติกาที่เปลี่ยนหลังจากมีใบค้างอยู่แล้ว:
//   21/08/2026 17:09 (7332f61) เครดิตสั้น 7D/15D ย้ายจากสาย "ตัดรอบ 25 → จ่ายวันที่ 5
//                              ของเดือนที่ 2" มาเป็นรอบพฤหัสนับจากวันส่งเอกสารเข้าบัญชี
//   28/08/2026 09:54 (48cec55) วันจ่าย = พฤหัส "สัปดาห์ถัดไป" ของอังคารที่ปิดรอบ (+7 วัน)
//   01/09/2026       (2527491) ตามรอบเครดิตยาว: เอาวันกดผ่านเข้ารอบตัด 25 ตรง ๆ ไม่บวกเครดิตก่อน
//                              (เดิมบวกเทอมเป็นวันครบกำหนดแล้วค่อยตัดรอบ = คิดเครดิตซ้ำสองชั้น)
// ตอนนั้นผู้ใช้เลือกปล่อยใบเก่าไว้ — 31/08/2026 สั่ง "อัพเดททั้งหมด" สคริปต์นี้คือการกลับมติเดิม
//
// ตัวตั้งที่ใช้คิดใหม่มาจาก pay.basis ที่เก็บไว้ตอนกดผ่าน (passedDate + creditTerm) — ไม่ใช่
// เวลาปัจจุบัน ผลจึงเป็น "ถ้าตอนนั้นใช้กติกาวันนี้จะได้อะไร" ไม่ใช่ "เลื่อนไปตามวันที่รันสคริปต์"
//
// ไม่แตะ: ใบที่จ่ายเงินไปแล้ว (paid.paymentNos) — เงินออกจริงแล้ว แก้ตารางย้อนหลังคือบิดหลักฐาน
//         ใบนอกรอบที่วันโอนยังอยู่ในตัวเลือกที่ถูกต้องของกติกาใหม่ (บัญชีเลือกเลื่อนเองก็นับ)
//         ใบที่ pay.basis ไม่ครบจนคิดใหม่ไม่ได้ — รายงานไว้ให้คนดู ไม่เดาแทน
import { MongoClient } from "mongodb"
import { apPayRecalc, ictDate, thaiDate, type ApPayType } from "../lib/ap-tracking"

const APPLY = process.argv.includes("--apply")
const MD = process.env.MONGO_DB ?? "master_data"
const s = (v: unknown) => String(v ?? "").trim()

type Pay = {
  type?: string; dueDate?: string; cutoff?: string; payDate?: string
  basis?: { passedAt?: string; passedDate?: string; creditTerm?: string; requestedType?: string }
  by?: string; at?: string
}
type Doc = {
  depositCode?: string; supplier?: string; sentMarkedAt?: string
  pay?: Pay | null; payPrev?: unknown; paid?: { paymentNos?: string[] } | null
}

type Verdict =
  | { kind: "same" }
  | { kind: "skip"; why: string }
  | { kind: "change"; next: { type: ApPayType; dueDate: string; cutoff: string; payDate: string } }

function recompute(d: Doc): Verdict {
  const pay = d.pay
  if (!pay) return { kind: "skip", why: "ไม่มี pay" }
  if (d.paid?.paymentNos?.length) return { kind: "skip", why: `จ่ายแล้ว (PV ${d.paid.paymentNos.join(", ")})` }

  const type = s(pay.type) as ApPayType
  if (type !== "ตามรอบ" && type !== "นอกรอบ") return { kind: "skip", why: `type ไม่รู้จัก "${type}"` }
  if (!s(pay.basis?.passedDate) && !s(pay.at)) return { kind: "skip", why: "ไม่มีวันกดผ่าน (basis.passedDate/at)" }
  if (type === "ตามรอบ" && !s(pay.basis?.creditTerm)) return { kind: "skip", why: "ตามรอบแต่ไม่มี basis.creditTerm" }

  // สูตรเดียวกับที่ UI ใช้ติดธงเตือน — อยู่ใน lib ตัวเดียว ไม่ให้สคริปต์กับหน้าเว็บคิดคนละอย่าง
  const next = apPayRecalc(pay, ictDate(s(d.sentMarkedAt)))
  return next ? { kind: "change", next } : { kind: "same" }
}

const line = (p: { dueDate?: string; cutoff?: string; payDate?: string }, type: string) =>
  type === "นอกรอบ"
    ? `นอกรอบ · โอน ${thaiDate(s(p.payDate))}`
    // ใบเก่าก่อน 01/09/2026 มี dueDate ติดมาด้วย — โชว์ไว้ให้เห็นว่าค่าเดิมคิดจากอะไร ใบใหม่เว้นว่าง
    : `ตามรอบ · ${s(p.dueDate) ? `ครบกำหนด ${thaiDate(s(p.dueDate))} · ` : ""}ตัดรอบ ${s(p.cutoff) ? thaiDate(s(p.cutoff)) : "—"} · จ่าย ${thaiDate(s(p.payDate))}`

async function main() {
  const uri = process.env.MONGO_URI
  if (!uri) throw new Error("ไม่มี MONGO_URI")
  const client = new MongoClient(uri)
  await client.connect()
  const col = client.db(MD).collection<Doc>("ap_tracking")

  const docs = await col.find(
    { pay: { $ne: null } },
    { projection: { _id: 0, depositCode: 1, supplier: 1, sentMarkedAt: 1, pay: 1, paid: 1 } },
  ).toArray()

  console.log(`โหมด: ${APPLY ? "เขียนจริง (--apply)" : "ดูอย่างเดียว (dry run)"} · db ${MD}`)
  console.log(`ใบที่มีกำหนดจ่ายอยู่แล้ว: ${docs.length} ใบ\n`)

  const changes: { code: string; doc: Doc; next: Extract<Verdict, { kind: "change" }>["next"] }[] = []
  const skips: { code: string; why: string }[] = []
  let same = 0

  for (const d of docs) {
    const code = s(d.depositCode) || "(ไม่มีเลข DD)"
    const v = recompute(d)
    if (v.kind === "same") { same++; continue }
    if (v.kind === "skip") { skips.push({ code, why: v.why }); continue }
    changes.push({ code, doc: d, next: v.next })
  }

  if (changes.length) {
    console.log(`── ต้องแก้ ${changes.length} ใบ ──`)
    for (const c of changes) {
      const term = s(c.doc.pay?.basis?.creditTerm) || "—"
      console.log(`${c.code}  ${s(c.doc.supplier).slice(0, 28)}  [${term}] ผ่าน ${thaiDate(s(c.doc.pay?.basis?.passedDate) || ictDate(s(c.doc.pay?.at)))}`)
      console.log(`   เดิม: ${line(c.doc.pay!, s(c.doc.pay?.type))}`)
      console.log(`   ใหม่: ${line(c.next, c.next.type)}`)
    }
    console.log()
  }
  if (skips.length) {
    console.log(`── ข้าม ${skips.length} ใบ ──`)
    for (const k of skips) console.log(`${k.code}  ${k.why}`)
    console.log()
  }
  console.log(`สรุป: ตรงกติกาใหม่อยู่แล้ว ${same} · ต้องแก้ ${changes.length} · ข้าม ${skips.length}`)

  if (!APPLY) {
    console.log("\nยังไม่เขียนอะไรลงฐาน — เติม --apply เมื่อยืนยันตัวเลขข้างบนแล้ว")
    await client.close()
    return
  }

  const at = new Date().toISOString()
  let written = 0
  for (const c of changes) {
    const prev = c.doc.pay!
    await col.updateOne(
      { depositCode: c.code },
      {
        // เก็บของเดิมไว้ใน payPrev — ย้อนกลับได้ และตรวจได้ว่าเลขเก่าคืออะไร
        $set: {
          pay: { ...prev, ...c.next, recalcAt: at, recalcNote: "อัพเดทตามกติกา 01/09/2026 (ตามรอบเครดิตยาว: ตัดรอบ 25 จากวันกดผ่านตรง ๆ ไม่บวกเครดิตก่อน)" },
          payPrev: { ...prev, supersededAt: at },
        },
        $push: {
          log: {
            action: "คิดกำหนดจ่ายใหม่ตามกติกาปัจจุบัน", field: "pay",
            detail: `${line(prev, s(prev.type))} → ${line(c.next, c.next.type)}`,
            by: "ระบบ (backfill-ap-pay)", byEmail: "", at,
          },
        } as never,
      },
    )
    written++
  }
  console.log(`\nเขียนแล้ว ${written} ใบ (ของเดิมเก็บไว้ที่ payPrev)`)
  await client.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
