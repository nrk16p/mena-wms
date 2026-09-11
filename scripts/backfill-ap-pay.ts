// scripts/backfill-ap-pay.ts
// รัน (รายงานอย่างเดียว): node -r dotenv/config node_modules/.bin/tsx scripts/backfill-ap-pay.ts
// --apply ถูกล็อกแล้ว (11/09/2026) — ดูเหตุผลข้างล่าง
//
// ⛔ ห้ามเขียนทับ pay — ผู้ใช้สั่ง 11/09/2026 "ถ้าบัญชีเคยกด ให้ยึดตามที่บัญชีกด"
//   pay ทุกใบเกิดจากบัญชีกดผ่านเท่านั้น (route [code] บรรทัด 221) การเขียนทับจึงเท่ากับลบการ
//   ตัดสินใจของบัญชีทุกครั้งที่รัน · หลักฐานว่าค่าที่บัญชีกดคือตัวที่ใช้จริง: รอบ 31/08 ย้ายนอกรอบ
//   75 ใบจาก 27 ส.ค. → 3 ก.ย. แต่การเงินจ่ายจริง 27 ส.ค. ครบทั้ง 75 ใบ
//   ทั้งสองรอบที่เคยรัน (31/08: 91 ใบ · 01/09: 338 ใบ) ย้อนกลับเป็นค่าที่บัญชีกดแล้วเมื่อ 11/09/2026
//   ค่าที่ระบบเคยคิดเก็บอยู่ที่ payPrev · ประวัติขึ้น "ย้อนกำหนดจ่ายกลับเป็นค่าที่บัญชีกดไว้"
//   กติกาเปลี่ยนเมื่อไหร่ ใบเก่าคงค่าที่บัญชีกดไว้ หน้าเว็บขึ้นธง ⚠️ บอกเลขตามกติกาวันนี้ให้เห็นเท่านั้น
//   จะใช้เลขใหม่ต้องให้บัญชีกดยืนยันเองในหน้าเว็บ ไม่ใช่สคริปต์
//
// ที่เหลือคือรายงาน: ใบไหนคิดด้วยกติกาเดิม และกติกาวันนี้จะได้อะไร (สูตรเดียวกับธง ⚠️)
// ตัวตั้งมาจาก pay.basis ที่เก็บไว้ตอนกดผ่าน (passedDate + creditTerm) ไม่ใช่เวลาปัจจุบัน
//
// กติกาที่เปลี่ยนหลังจากมีใบค้างอยู่แล้ว (เหตุที่สคริปต์นี้เคยถูกรันเขียนจริง):
//   21/08/2026 17:09 (7332f61) เครดิตสั้น 7D/15D ย้ายจากสาย "ตัดรอบ 25 → จ่ายวันที่ 5
//                              ของเดือนที่ 2" มาเป็นรอบพฤหัสนับจากวันส่งเอกสารเข้าบัญชี
//   28/08/2026 09:54 (48cec55) วันจ่าย = พฤหัส "สัปดาห์ถัดไป" ของอังคารที่ปิดรอบ (+7 วัน)
//   01/09/2026       (2527491) ตามรอบเครดิตยาว: เอาวันกดผ่านเข้ารอบตัด 25 ตรง ๆ ไม่บวกเครดิตก่อน
//                              (เดิมบวกเทอมเป็นวันครบกำหนดแล้วค่อยตัดรอบ = คิดเครดิตซ้ำสองชั้น)
//
// ไม่นับ: ใบที่จ่ายเงินไปแล้ว (paid.paymentNos) · ใบนอกรอบที่วันโอนยังอยู่ในตัวเลือกของกติกาใหม่
//         · ใบที่ pay.basis ไม่ครบจนคิดใหม่ไม่ได้ (รายงานไว้ให้คนดู ไม่เดาแทน)
import { MongoClient } from "mongodb"
import { apPayRecalc, ictDate, thaiDate, type ApPayType } from "../lib/ap-tracking"

const MD = process.env.MONGO_DB ?? "master_data"
const s = (v: unknown) => String(v ?? "").trim()

type Pay = {
  type?: string; dueDate?: string; cutoff?: string; payDate?: string
  basis?: { passedAt?: string; passedDate?: string; creditTerm?: string; requestedType?: string }
  by?: string; at?: string
}
type Doc = {
  depositCode?: string; supplier?: string; sentMarkedAt?: string
  pay?: Pay | null; paid?: { paymentNos?: string[] } | null
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
  // ล็อกก่อนต่อฐาน — ไม่มีทางเขียนหลุดออกไปแม้แต่ใบเดียว
  if (process.argv.includes("--apply")) {
    throw new Error("--apply ถูกล็อก (11/09/2026): pay คือค่าที่บัญชีกดผ่าน ห้ามสคริปต์เขียนทับ — ดูเหตุผลที่หัวไฟล์")
  }
  const uri = process.env.MONGO_URI
  if (!uri) throw new Error("ไม่มี MONGO_URI")
  const client = new MongoClient(uri)
  await client.connect()
  const col = client.db(MD).collection<Doc>("ap_tracking")

  const docs = await col.find(
    { pay: { $ne: null } },
    { projection: { _id: 0, depositCode: 1, supplier: 1, sentMarkedAt: 1, pay: 1, paid: 1 } },
  ).toArray()

  console.log(`โหมด: รายงานอย่างเดียว · db ${MD}`)
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
    console.log(`── คิดด้วยกติกาเดิม ${changes.length} ใบ (คงตามที่บัญชีกด) ──`)
    for (const c of changes) {
      const term = s(c.doc.pay?.basis?.creditTerm) || "—"
      console.log(`${c.code}  ${s(c.doc.supplier).slice(0, 28)}  [${term}] ผ่าน ${thaiDate(s(c.doc.pay?.basis?.passedDate) || ictDate(s(c.doc.pay?.at)))}`)
      console.log(`   บัญชีกด:     ${line(c.doc.pay!, s(c.doc.pay?.type))}`)
      console.log(`   กติกาวันนี้: ${line(c.next, c.next.type)}`)
    }
    console.log()
  }
  if (skips.length) {
    console.log(`── ข้าม ${skips.length} ใบ ──`)
    for (const k of skips) console.log(`${k.code}  ${k.why}`)
    console.log()
  }
  console.log(`สรุป: ตรงกติกาวันนี้ ${same} · คิดด้วยกติกาเดิม ${changes.length} · ข้าม ${skips.length}`)
  await client.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
