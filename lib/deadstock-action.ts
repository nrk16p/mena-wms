// lib/deadstock-action.ts
// ชั้น overlay ของหน้า /deadstock — เก็บ "การจัดการ" ที่ผู้ใช้เลือกต่อใบ DD
// ตามแพตเทิร์นเดียวกับ ap_tracking / pr_tracking: ไม่ copy ข้อมูล ATMS แค่แปะทับอีกชั้น
import clientPromise from "@/lib/mongo"
import { ACTION_LABEL, type ActionKey } from "@/lib/deadstock-core"

const DB = process.env.MONGO_DB ?? "master_data"
const COLL = "deadstock_action"
const LOG_KEEP = 50 // เก็บ log ล่าสุดเท่านี้ต่อใบ — กัน array โตไม่มีเพดาน

export type ActionEntry = {
  action: ActionKey | ""
  note: string
  by: string
  byEmail: string
  at: string
}

type ActionDoc = ActionEntry & {
  key: string
  log?: { action: string; note: string; by: string; byEmail: string; at: string }[]
}

let indexReady: Promise<unknown> | null = null

async function col() {
  const client = await clientPromise
  const c = client.db(DB).collection<ActionDoc>(COLL)
  // สร้าง index ครั้งเดียวต่อ process — unique กัน race ตอนกดพร้อมกันสองหน้าจอ
  if (!indexReady) indexReady = c.createIndex({ key: 1 }, { unique: true }).catch(() => {})
  await indexReady
  return c
}

/** อ่านป้ายทั้งหมด — จำนวนน้อย (เฉพาะใบที่มีคนเลือกแล้ว) จึงดึงมาทั้งก้อนได้ */
export async function listActions(): Promise<Record<string, ActionEntry>> {
  const docs = await (await col()).find({}, { projection: { _id: 0, log: 0 } }).toArray()
  const out: Record<string, ActionEntry> = {}
  for (const d of docs) {
    out[d.key] = { action: d.action ?? "", note: d.note ?? "", by: d.by ?? "", byEmail: d.byEmail ?? "", at: d.at ?? "" }
  }
  return out
}

/** ตั้ง/ล้างป้ายของใบหนึ่ง — action = "" คือล้างป้าย (ยังเก็บ log ไว้) */
export async function setAction(
  key: string,
  action: ActionKey | "",
  note: string,
  by: string,
  byEmail: string
): Promise<ActionEntry> {
  const at = new Date().toISOString()
  const entry: ActionEntry = { action, note, by, byEmail, at }
  await (await col()).updateOne(
    { key },
    {
      $set: entry,
      $setOnInsert: { key },
      $push: {
        log: {
          $each: [{ action: action ? ACTION_LABEL[action] ?? action : "ล้างป้าย", note, by, byEmail, at }],
          $slice: -LOG_KEEP,
        },
      },
    },
    { upsert: true }
  )
  return entry
}
