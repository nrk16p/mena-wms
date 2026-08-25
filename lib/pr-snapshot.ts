// Server-only helper: ดึงสถานะ PR → PO → DD จาก atms เป็น PrSnapshot (อ่านอย่างเดียว)
// ใช้ logic เดียวกับหน้า /pr: PO ยกเลิกไม่นับ · ปิดงานเมื่อ PO ที่เหลือมี DD ครบทุกใบ
import type { MongoClient } from "mongodb"
import type { PrSnapshot } from "@/lib/order-tracking"

const PR_KEY = "ใบขอสั่งซื้อ (PR)"
const PO_KEY = "รหัส"

type Doc = Record<string, unknown>
const s = (v: unknown) => (v == null ? "" : String(v)).trim()

// "DD/MM/YYYY" → "YYYY-MM-DD"
function toISO(d: string): string {
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ""
}

/** ผู้ขอซื้อรายใบ PR — ตัวเบาสำหรับหน้าที่ต้องการแค่ชื่อคน ไม่ต้องลากสถานะ PO/DD มาด้วย
 *  bounded ด้วยรายการ prCodes ที่ผู้เรียกส่งมา และ `ใบขอสั่งซื้อ (PR)` มี index อยู่ (pipeline
 *  ฝั่ง api-ncac สร้างให้ตอน scrape) · ผู้เรียกฝั่ง /deadstock ยัง cache ไว้ชั่วโมงละครั้งอยู่แล้ว
 *  พังก็คืน Map ว่าง ไม่ล้มทั้งหน้า — ชื่อผู้ขอซื้อเป็นข้อมูลเสริม */
export async function fetchRequesterByPr(client: MongoClient, prCodes: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const codes = [...new Set(prCodes.map((c) => c.trim()).filter(Boolean))]
  if (!codes.length) return out
  try {
    const docs = (await client.db("atms").collection("purchase_requests")
      .find({ [PR_KEY]: { $in: codes } }, { maxTimeMS: 20_000 })
      .project({ [PR_KEY]: 1, "ผู้ขอซื้อ": 1, _id: 0 })
      .toArray()) as Doc[]
    for (const d of docs) {
      const pr = s(d[PR_KEY])
      const who = s(d["ผู้ขอซื้อ"])
      if (pr && who) out.set(pr, who)
    }
  } catch (e) {
    console.error("[pr-snapshot] fetchRequesterByPr ", e)
  }
  return out
}

// ดึง snapshot หลาย PR ในชุดเดียว (bounded ตามจำนวน ticket ที่เปิดอยู่)
export async function fetchPrSnapshots(client: MongoClient, prCodes: string[]): Promise<Map<string, PrSnapshot>> {
  const out = new Map<string, PrSnapshot>()
  const codes = [...new Set(prCodes.map((c) => c.trim()).filter(Boolean))]
  if (!codes.length) return out

  const atms = client.db("atms")
  const [prs, pos] = await Promise.all([
    atms.collection("purchase_requests").find({ [PR_KEY]: { $in: codes } })
      .project({ [PR_KEY]: 1, "วันที่": 1, "คลังสินค้า": 1, "แผนก": 1, "ผู้ขอซื้อ": 1, "หมายเหตุ": 1, "รวม": 1, _id: 0 }).toArray() as Promise<Doc[]>,
    atms.collection("purchase_orders").find({ [PR_KEY]: { $in: codes } })
      .project({ [PR_KEY]: 1, [PO_KEY]: 1, "รวม": 1, "ซัพพลายเออร์": 1, "กำหนดส่งสินค้า": 1, "สถานะการรับสินค้า": 1, _id: 0 }).toArray() as Promise<Doc[]>,
  ])

  // PO ที่ถูกยกเลิกไม่นับ — ทั้งยอด/สถานะ/เกณฑ์ปิดงาน
  const posByPr = new Map<string, Doc[]>()
  const allPoCodes: string[] = []
  for (const po of pos) {
    if (s(po["สถานะการรับสินค้า"]).includes("ยกเลิก")) continue
    const pr = s(po[PR_KEY]); if (!pr) continue
    if (!posByPr.has(pr)) posByPr.set(pr, [])
    posByPr.get(pr)!.push(po)
    const code = s(po[PO_KEY]); if (code) allPoCodes.push(code)
  }

  const [ddPoCodes, trackDocs] = await Promise.all([
    allPoCodes.length
      ? atms.collection("deposit_header").distinct("purchase_order", { purchase_order: { $in: allPoCodes } }) as Promise<string[]>
      : Promise.resolve([] as string[]),
    client.db(process.env.MONGO_DB ?? "master_data").collection("pr_tracking")
      .find({ prCode: { $in: codes } }).project({ prCode: 1, expectedDelivery: 1, _id: 0 }).toArray() as Promise<Doc[]>,
  ])
  const receivedPo = new Set(ddPoCodes.map(s).filter(Boolean))
  const manualDue  = new Map(trackDocs.map((t) => [s(t.prCode), s(t.expectedDelivery)]))

  for (const p of prs) {
    const pr = s(p[PR_KEY]); if (!pr) continue
    const myPos = posByPr.get(pr) ?? []
    const poDues = myPos.map((po) => toISO(s(po["กำหนดส่งสินค้า"]))).filter(Boolean).sort()
    out.set(pr, {
      date:      s(p["วันที่"]),
      warehouse: s(p["คลังสินค้า"]),
      dept:      s(p["แผนก"]),
      requester: s(p["ผู้ขอซื้อ"]),
      note:      s(p["หมายเหตุ"]),
      total:     Number(p["รวม"]) || 0,
      poCodes:   myPos.map((po) => s(po[PO_KEY])).filter(Boolean),
      poTotal:   Math.round(myPos.reduce((a, po) => a + (Number(po["รวม"]) || 0), 0) * 100) / 100,
      suppliers: [...new Set(myPos.map((po) => s(po["ซัพพลายเออร์"])).filter(Boolean))],
      expectedDelivery: manualDue.get(pr) || poDues[0] || "",
      // ปิดงานเมื่อ PO ที่ไม่ยกเลิกทุกใบมีใบรับของ (DD) ครบ — ไม่ปิดเร็วเกินเพราะรับมาใบเดียว
      hasDD:     myPos.length > 0 && myPos.every((po) => receivedPo.has(s(po[PO_KEY]))),
    })
  }
  return out
}
