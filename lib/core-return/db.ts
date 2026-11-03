// lib/core-return/db.ts — Mongo ของงานติดตามซากอะไหล่
// แถวฐาน = master_data.core_return_base (โหลดด้วย core-return-base/load_base.py) · ประวัติ = core_return_log (เขียนต่อท้ายอย่างเดียว + โซ่แฮช)
// ชื่อ db จาก env CORE_RETURN_DB (ค่าเริ่มต้น master_data) · เทสต์ inject MongoClient ได้ด้วย setCoreReturnClient
import type { Collection, Db, MongoClient } from "mongodb"
import { entryHash, verifyEntries, type ChainEntry, type ChainResult } from "@/lib/store-withdraw/chain"
import type { CoreRow, CoreStatus } from "./core"

export type CoreLogDoc = {
  row_key: string
  action: "return" | "sold" | "rebuilt" | "follow_up" | "create" | "round_add" | "round_cancel"
  from: CoreStatus | null
  to: CoreStatus | null
  actor: { email: string; name: string; via: string }
  at: Date
  note?: string
  data?: Record<string, unknown>
  seq: number
  hash: string
}

let injected: MongoClient | null = null
const indexed = new WeakSet<Db>()

/** ใช้ในเทสต์/เดโมในเครื่องเท่านั้น */
export function setCoreReturnClient(c: MongoClient | null) {
  injected = c
}

export async function getCoreDb(): Promise<Db> {
  const sw = (await import("../store-withdraw/db")).injectedStoreWithdrawClient()
  const client = injected ?? sw ?? (await (await import("../mongo")).default)
  const db = client.db(process.env.CORE_RETURN_DB || "master_data")
  if (!indexed.has(db)) {
    const base = db.collection("core_return_base")
    // 4 ตัวแรกตรงกับที่ load_base.py สร้าง (สเปกเดียวกัน = ไม่ชน) · ที่เหลือเพิ่มสำหรับหน้าติดตาม
    await Promise.all([
      base.createIndex({ row_key: 1 }, { unique: true }),
      base.createIndex({ wdCode: 1 }),
      base.createIndex({ plate: 1, issuedDate: -1 }),
      base.createIndex({ coreStatus: 1, issuedDate: -1 }),
      base.createIndex({ issuedDate: 1, row_key: 1 }),
      base.createIndex({ warehouse: 1, coreStatus: 1, issuedDate: 1 }),
      base.createIndex({ mrCode: 1 }),
      base.createIndex({ wdCode: 1, skuCode: 1 }), // กันซ้ำกับฐาน ATMS: แถว WMS กับแถว stockmovement ของ WD+SKU เดียวกัน
      base.createIndex({ "requester.email": 1, coreStatus: 1, issuedDate: 1 }, { sparse: true }),
      base.createIndex({ swNo: 1 }, { sparse: true }),
      base.createIndex({ garageType: 1, garage: 1, coreStatus: 1 }),
      base.createIndex({ "followUp.nextDate": 1 }, { sparse: true }),
      base.createIndex({ saleRoundNo: 1 }, { sparse: true }),
      db.collection("core_sale_rounds").createIndex({ roundNo: 1 }, { unique: true }),
      db.collection("core_sale_rounds").createIndex({ createdAt: -1 }),
      db.collection("core_return_log").createIndex({ row_key: 1, seq: 1 }, { unique: true }),
      db.collection("core_return_log").createIndex({ at: -1 }),
    ])
    indexed.add(db)
  }
  return db
}

export async function baseCol(): Promise<Collection<CoreRow>> {
  return (await getCoreDb()).collection<CoreRow>("core_return_base")
}
export async function logCol(): Promise<Collection<CoreLogDoc>> {
  return (await getCoreDb()).collection<CoreLogDoc>("core_return_log")
}

/** เขียน log ต่อโซ่แฮชต่อแถว (แบบเดียวกับ store-withdraw writeLog) · ชนกัน = unique {row_key, seq} → อ่านท้ายโซ่ใหม่แล้วลองอีก */
export async function writeCoreLog(entry: Omit<CoreLogDoc, "at" | "seq" | "hash">, at = new Date()) {
  const col = await logCol()
  for (let attempt = 0; attempt < 60; attempt++) {
    const last = await col.find({ row_key: entry.row_key }, { projection: { seq: 1, hash: 1 } }).sort({ seq: -1 }).limit(1).next()
    const seq = (last?.seq ?? 0) + 1
    const base: Record<string, unknown> = { ...entry, at, seq }
    for (const k of Object.keys(base)) if (base[k] === undefined) delete base[k]
    const hash = entryHash(last?.hash ?? "", base)
    try {
      await col.insertOne({ ...base, hash } as unknown as CoreLogDoc)
      return
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e
      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 15)))
    }
  }
  throw new Error("writeCoreLog: เขียนประวัติไม่สำเร็จหลังลองซ้ำหลายครั้ง")
}

export type SaleRound = {
  roundNo: string // SR-YYMM-NN
  warehouses: string[]
  cutoffDate: string // YYYY-MM-DD · เอาซากที่เข้าคลังซากไม่เกินวันนี้
  status: "open" | "sold" | "cancelled"
  keys: string[] // row_key ที่เข้ารอบตอนสร้าง
  count: number
  costAmount: number // ยอดทุนเดิมรวม (amount)
  createdBy: { email: string; name: string }
  createdAt: Date
  soldDate?: string | null
  buyer?: string | null
  totalPrice?: number | null
  note?: string
  soldBy?: { email: string; name: string } | null
  soldAt?: Date | null
  cancelledBy?: { email: string; name: string } | null
  cancelledAt?: Date | null
  cancelReason?: string
}

export async function roundCol(): Promise<Collection<SaleRound>> {
  return (await getCoreDb()).collection<SaleRound>("core_sale_rounds")
}

/** ออกเลขรอบ SR-YYMM-NN แบบ atomic (เลขที่ข้ามไม่นำกลับมาใช้) */
export async function nextRoundNo(now = new Date()): Promise<string> {
  const bkk = new Date(now.getTime() + 7 * 3600_000).toISOString()
  const yymm = bkk.slice(2, 4) + bkk.slice(5, 7)
  const r = await (await getCoreDb()).collection<{ _id: string; seq: number }>("counters").findOneAndUpdate(
    { _id: `core_sale_round:${yymm}` }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" },
  )
  if (!r || typeof r.seq !== "number") throw new Error("nextRoundNo: counter update returned no document")
  return `SR-${yymm}-${String(r.seq).padStart(2, "0")}`
}

export function verifyCoreLog(entries: CoreLogDoc[]): ChainResult {
  return verifyEntries(entries as unknown as ChainEntry[])
}
