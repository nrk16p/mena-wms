/* ตรวจชั้น DB งานแปลงรหัส ATMS (lib/sku-convert-db.ts) กับ Mongo ทดสอบในเครื่องเท่านั้น
 *   MONGO_TEST_URI=mongodb://127.0.0.1:27031 npx tsx scripts/check-sku-convert-db.ts
 * ใช้ db "sku_convert_test" (drop ทุกครั้งที่เริ่ม) · ไม่ยอมต่อ URI ที่ไม่ใช่ localhost
 */
import assert from "node:assert"
import { MongoClient, type Db } from "mongodb"
import {
  COLL, getItem, listItems, liveStock, loadCodeBook, nextTodo, releaseLock, saveEntries, takeLock,
} from "../lib/sku-convert-db"
import { emptyEntry, LOCK_MS } from "../lib/sku-convert-core"
import type { CodeBook, ConvertItem, Entry, MasterCodeRow } from "../lib/sku-convert-types"

const URI = process.env.MONGO_TEST_URI ?? "mongodb://127.0.0.1:27031"
const DB_NAME = "sku_convert_test"
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(URI)) {
  console.error(`refusing to run against ${URI} — local test Mongo only`)
  process.exit(1)
}

let pass = 0
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.stack ?? e.message : e}`); process.exitCode = 1 }
}

// ---------------------------------------------------------------- fixtures

const SLASH_CODE = "S10PM00116 (รับเข้า/ตัดเบิก เป็นลิตร)"
const SLASH_ID = `3:${SLASH_CODE}`
const T0 = new Date("2026-10-06T03:00:00Z")
const min = (n: number) => new Date(T0.getTime() + n * 60_000)
const A = { email: "a@menatransport.co.th", name: "เอ" }
const B = { email: "b@menatransport.co.th", name: "บี" }

function item(over: Record<string, unknown>) {
  const inv = over.inv as string
  const code = over.code as string
  return {
    _id: `${inv}:${code}`, wh: "LK", warehouse: "คลังลาดกระบัง", kind: "parts", name: code, group: "ไส้กรอง",
    unit: "ชิ้น", asOf: new Date("2026-09-30T00:00:00Z"), atmsQty: 0, atmsValue: 0, moves: 0, recv: 0,
    issue: 0, issueDocs: 0, issueAmt: 0, nSup: 1,
    lots: [{ seq: 1, date: new Date("2026-08-01T00:00:00Z"), unitCost: 100, qtyLeft: 1, value: 100 }],
    suppliers: [{ supplier: "ร้าน ก", n: 2, qty: 3, pMin: 90, pMed: 100, pMax: 110, last: new Date("2026-08-01T00:00:00Z") }],
    suggest: { type: "PRT", l1: "ENG" }, entries: [], status: "todo",
    ...over,
  }
}

const doneEntry = (code: string, qty: number | null, over: Partial<Entry> = {}): Entry => ({
  ...emptyEntry(), wh: "LK", type: "PRT", l1: "ENG", l2: "OIL", l3: "OFT", nameTh: "กรองน้ำมันเครื่อง",
  unit: "PC", atmsCodes: [code], qty, ...over,
})

const ITEMS = [
  // LK parts — list order A(50) B(40) C(30, issueAmt 800) D(30, issueAmt 200)
  item({ inv: "4", code: "LB-A", moves: 50, issueAmt: 1000, atmsQty: 10, splitHint: "ราคากลาง 800 vs 1,980 = 2.5 เท่า" }),
  item({ inv: "4", code: "LB-B", moves: 40, issueAmt: 900, group: "เบรก", status: "done",
         entries: [doneEntry("LB-B", null)], splitHint: "" }),
  item({ inv: "4", code: "LB-C", moves: 30, issueAmt: 800, atmsQty: 4 }),
  item({ inv: "4", code: "LB-D", moves: 30, issueAmt: 200, group: "เบรก", name: "ผ้าเบรก (หน้า) [ชุด]" }),
  // LK svc — more moves than every LK part, must never leak into the parts tab
  item({ inv: "4", code: "SV-1", kind: "svc", moves: 99, issueAmt: 5000, group: "ค่าแรง", suggest: { type: "LAB" } }),
  // SR: DIST (24) is grouped with สระบุรี · the slash/space/Thai id
  item({ inv: "24", code: "DS-1", wh: "SR", warehouse: "คลัง DIST", moves: 5, issueAmt: 10 }),
  item({ inv: "3", code: SLASH_CODE, wh: "SR", warehouse: "คลังสระบุรี", moves: 7, issueAmt: 70, atmsQty: 20,
         name: "น้ำมันเครื่อง 15W-40", unit: "ลิตร" }),
]

const CODES: (MasterCodeRow & { _id: string })[] = ([
  { dict: "WAREHOUSE", code: "LK", th: "ลาดกระบัง" }, { dict: "WAREHOUSE", code: "SR", th: "สระบุรี" },
  { dict: "EXPENSE_TYPE", code: "PRT", th: "อะไหล่" }, { dict: "EXPENSE_TYPE", code: "LAB", th: "ค่าแรง" },
  { dict: "SYSTEM_L1", code: "ENG", th: "ระบบเครื่องยนต์", order: 2 },
  { dict: "SYSTEM_L1", code: "BRK", th: "ระบบเบรก", order: 1 },
  { dict: "SUB_ASSEMBLY_L2", code: "OIL", th: "ระบบน้ำมันเครื่อง", parent: "ENG", meta: {} },
  { dict: "SUB_ASSEMBLY_L2", code: "ENGL", th: "ค่าแรงเครื่องยนต์", parent: "ENG", meta: { expenseType: "LAB" } },
  { dict: "COMPONENT_L3", code: "OFT", th: "กรองน้ำมันเครื่อง", parent: "ENG:OIL", meta: {} },
  { dict: "UNIT", code: "PC", th: "ชิ้น" }, { dict: "UNIT", code: "DAY", th: "วัน" },
  { dict: "GRADE", code: "G1", th: "แท้ศูนย์นำเข้า", meta: {} },
  { dict: "POSITION", code: "GN", th: "ทั่วไป" },
] as MasterCodeRow[]).map((r) => ({ ...r, _id: `${r.dict}:${r.parent ? r.parent + ":" : ""}${r.code}` }))

async function seed(db: Db) {
  await db.collection(COLL).deleteMany({})
  await db.collection(COLL).insertMany(structuredClone(ITEMS) as never[])
}

const rawLock = async (db: Db, id: string) =>
  ((await db.collection(COLL).findOne({ _id: id as never })) as { lock?: { email: string; at: Date } | null } | null)?.lock

// ---------------------------------------------------------------- run

async function main() {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 })
  await client.connect()
  const db = client.db(DB_NAME)
  try {
    await db.dropDatabase()
    await seed(db)
    await db.collection("master_codes").insertMany(CODES as never[])
    await db.collection("atms_sku_master").insertMany([
      { code: SLASH_CODE, inventoryId: "3", stockQty: 18, syncedAt: new Date("2026-10-06T01:00:00Z") },
      { code: SLASH_CODE, inventoryId: "4", stockQty: 999, syncedAt: new Date("2026-10-06T01:00:00Z") },
    ] as never[])

    let book!: CodeBook
    console.log("code book")
    await check("loadCodeBook builds from master_codes and caches", async () => {
      book = await loadCodeBook(db)
      assert.deepStrictEqual(book.l1.map((o) => o.code), ["BRK", "ENG"])
      assert.deepStrictEqual(book.l2.ENG.map((o) => o.code), ["OIL"])
      assert.deepStrictEqual(book.l2Lab.ENG.map((o) => o.code), ["ENGL"])
      assert.deepStrictEqual(book.l3["ENG:OIL"].map((o) => o.code), ["OFT"])
      assert.strictEqual(await loadCodeBook(db), book)
    })

    console.log("list")
    const lk = (over: Record<string, unknown> = {}) => listItems(db, { wh: "LK", kind: "parts", ...over })
    await check("LK parts sorted moves desc, issueAmt desc · svc/SR excluded", async () => {
      const r = await lk()
      assert.deepStrictEqual(r.rows.map((x) => x.code), ["LB-A", "LB-B", "LB-C", "LB-D"])
      assert.strictEqual(r.total, 4); assert.strictEqual(r.page, 1); assert.strictEqual(r.limit, 50)
    })
    await check("rows drop lots/suppliers/suggest/entries, add entryCount, dates as ISO strings", async () => {
      const r = await lk()
      const b = r.rows[1] as unknown as Record<string, unknown>
      for (const k of ["lots", "suppliers", "suggest", "entries"]) assert.ok(!(k in b), `${k} should be projected away`)
      assert.strictEqual(r.rows[1].entryCount, 1); assert.strictEqual(r.rows[0].entryCount, 0)
      assert.strictEqual(r.rows[0].asOf, "2026-09-30T00:00:00.000Z")
    })
    await check("counts + groups cover the whole wh+kind tab regardless of filters", async () => {
      const r = await lk({ group: "เบรก", status: "todo" })
      assert.deepStrictEqual(r.counts, { all: 4, todo: 3, draft: 0, done: 1, hint: 1 })
      assert.deepStrictEqual(r.groups, ["เบรก", "ไส้กรอง"])
      assert.deepStrictEqual(r.rows.map((x) => x.code), ["LB-D"]); assert.strictEqual(r.total, 1)
    })
    await check("q matches code or name, case-insensitive, regex chars escaped", async () => {
      assert.deepStrictEqual((await lk({ q: "lb-c" })).rows.map((x) => x.code), ["LB-C"])
      assert.deepStrictEqual((await lk({ q: "(หน้า) [" })).rows.map((x) => x.code), ["LB-D"])
      assert.deepStrictEqual((await lk({ q: ".*" })).rows.map((x) => x.code), [])
    })
    await check("group / status / hint / stock filters", async () => {
      assert.deepStrictEqual((await lk({ group: "เบรก" })).rows.map((x) => x.code), ["LB-B", "LB-D"])
      assert.deepStrictEqual((await lk({ status: "todo" })).rows.map((x) => x.code), ["LB-A", "LB-C", "LB-D"])
      assert.deepStrictEqual((await lk({ status: "done" })).rows.map((x) => x.code), ["LB-B"])
      assert.deepStrictEqual((await lk({ hint: true })).rows.map((x) => x.code), ["LB-A"])
      assert.deepStrictEqual((await lk({ stock: true })).rows.map((x) => x.code), ["LB-A", "LB-C"])
    })
    await check("paging · limit capped at 200", async () => {
      const r = await lk({ page: 2, limit: 2 })
      assert.deepStrictEqual(r.rows.map((x) => x.code), ["LB-C", "LB-D"]); assert.strictEqual(r.total, 4)
      assert.strictEqual((await lk({ limit: 5000 })).limit, 200)
    })
    await check("SR tab holds สระบุรี + DIST · svc tab separate", async () => {
      assert.deepStrictEqual((await listItems(db, { wh: "SR", kind: "parts" })).rows.map((x) => x._id), [SLASH_ID, "24:DS-1"])
      assert.deepStrictEqual((await listItems(db, { wh: "LK", kind: "svc" })).rows.map((x) => x.code), ["SV-1"])
    })

    console.log("detail")
    await check("getItem with the slash/space/Thai id · dates as ISO strings", async () => {
      const it = await getItem(db, SLASH_ID)
      assert.ok(it); assert.strictEqual(it.code, SLASH_CODE); assert.strictEqual(it.inv, "3")
      assert.strictEqual(it.asOf, "2026-09-30T00:00:00.000Z")
      assert.strictEqual(it.lots[0].date, "2026-08-01T00:00:00.000Z")
      assert.strictEqual(it.suppliers[0].last, "2026-08-01T00:00:00.000Z")
      assert.strictEqual(await getItem(db, "4:NOPE"), null)
    })
    await check("liveStock reads atms_sku_master by code + inventoryId", async () => {
      assert.deepStrictEqual(await liveStock(db, (await getItem(db, SLASH_ID))!),
        { qty: 18, syncedAt: "2026-10-06T01:00:00.000Z" })
      assert.strictEqual(await liveStock(db, (await getItem(db, "4:LB-A"))!), null)
    })

    console.log("lock")
    await check("A takes · B blocked with holder A · A refreshes", async () => {
      const a = await takeLock(db, "4:LB-C", A, T0)
      assert.ok(a.ok); assert.deepStrictEqual(a.lock, { ...A, at: T0.toISOString() })
      const b = await takeLock(db, "4:LB-C", B, min(1))
      assert.ok(!b.ok); assert.strictEqual(b.holder?.email, A.email); assert.strictEqual(b.holder?.name, A.name)
      assert.strictEqual(b.holder?.at, T0.toISOString())
      const a2 = await takeLock(db, "4:LB-C", A, min(2))
      assert.ok(a2.ok); assert.strictEqual(a2.lock.at, min(2).toISOString())
      assert.ok((await rawLock(db, "4:LB-C"))?.at instanceof Date, "lock.at stored as a Date")
    })
    await check("B takes over once A's lock is 31 min old · exactly 30 min counts as free (= isLockLive)", async () => {
      const early = await takeLock(db, "4:LB-C", B, min(2 + 29))
      assert.ok(!early.ok); assert.strictEqual(early.holder?.email, A.email)
      const b = await takeLock(db, "4:LB-C", B, min(2 + 31))
      assert.ok(b.ok); assert.strictEqual(b.lock.email, B.email)
      const a = await takeLock(db, "4:LB-C", A, new Date(min(33).getTime() + LOCK_MS))
      assert.ok(a.ok); assert.strictEqual(a.lock.email, A.email)
    })
    await check("missing id → notFound", async () => {
      const r = await takeLock(db, "4:NOPE", A, T0)
      assert.ok(!r.ok); assert.strictEqual(r.notFound, true)
    })
    await check("concurrent takeLock on a free row → exactly one wins (×25)", async () => {
      for (let i = 0; i < 25; i++) {
        await db.collection(COLL).updateOne({ _id: "4:LB-D" as never }, { $unset: { lock: "" } })
        const [ra, rb] = await Promise.all([takeLock(db, "4:LB-D", A, T0), takeLock(db, "4:LB-D", B, T0)])
        assert.strictEqual([ra, rb].filter((r) => r.ok).length, 1, `round ${i}: ${JSON.stringify([ra, rb])}`)
        const winner = ra.ok ? A : B
        const loser = ra.ok ? rb : ra
        assert.ok(!loser.ok); assert.strictEqual(loser.holder?.email, winner.email)
        assert.strictEqual((await rawLock(db, "4:LB-D"))?.email, winner.email)
      }
    })
    await check("releaseLock by non-holder is a no-op · by holder clears", async () => {
      await seed(db)
      await takeLock(db, SLASH_ID, A, T0)
      await releaseLock(db, SLASH_ID, B.email)
      assert.strictEqual((await rawLock(db, SLASH_ID))?.email, A.email)
      await releaseLock(db, SLASH_ID, A.email)
      assert.strictEqual(await rawLock(db, SLASH_ID), null)
      await releaseLock(db, "4:NOPE", A.email)
    })

    console.log("save")
    await check("holder saves a complete tied row → done, lock kept, updatedBy/At set", async () => {
      await seed(db)
      await takeLock(db, "4:LB-C", A, T0)
      const r = await saveEntries(db, "4:LB-C", A, [doneEntry("LB-C", 3), doneEntry("LB-C", 1)], book, false, min(5))
      assert.ok(r.ok)
      assert.strictEqual(r.item.status, "done"); assert.strictEqual(r.item.entries.length, 2)
      assert.deepStrictEqual(r.item.lock, { ...A, at: min(5).toISOString() })
      assert.deepStrictEqual(r.item.updatedBy, A); assert.strictEqual(r.item.updatedAt, min(5).toISOString())
      assert.strictEqual((await getItem(db, "4:LB-C"))?.status, "done")
    })
    await check("qty not tied / field missing → draft · [] → todo", async () => {
      const short = await saveEntries(db, "4:LB-C", A, [doneEntry("LB-C", 3)], book, false, min(6))
      assert.ok(short.ok); assert.strictEqual(short.item.status, "draft")
      const missing = await saveEntries(db, "4:LB-C", A, [doneEntry("LB-C", 4, { l3: "" })], book, false, min(6))
      assert.ok(missing.ok); assert.strictEqual(missing.item.status, "draft")
      const none = await saveEntries(db, "4:LB-C", A, [], book, false, min(6))
      assert.ok(none.ok); assert.strictEqual(none.item.status, "todo")
    })
    await check("non-holder save while lock live → 409 + holder, nothing written", async () => {
      await saveEntries(db, "4:LB-C", A, [doneEntry("LB-C", 4)], book, false, min(7))
      const before = await getItem(db, "4:LB-C")
      const r = await saveEntries(db, "4:LB-C", B, [doneEntry("LB-C", 1, { nameTh: "ของ B" })], book, false, min(8))
      assert.ok(!r.ok); assert.strictEqual(r.status, 409); assert.strictEqual(r.holder?.email, A.email)
      assert.deepStrictEqual(await getItem(db, "4:LB-C"), before)
    })
    await check("release: true clears the lock", async () => {
      const r = await saveEntries(db, "4:LB-C", A, [doneEntry("LB-C", 4)], book, true, min(9))
      assert.ok(r.ok); assert.strictEqual(r.item.lock, null); assert.strictEqual(r.item.status, "done")
    })
    await check("nobody holds the row → save allowed and takes the lock", async () => {
      const r = await saveEntries(db, "4:LB-C", B, [doneEntry("LB-C", 4, { note: "B" })], book, false, min(10))
      assert.ok(r.ok); assert.strictEqual(r.item.lock?.email, B.email); assert.deepStrictEqual(r.item.updatedBy, B)
    })
    await check("A's lock expired and B took over → A's save 409, nothing written", async () => {
      await takeLock(db, "4:LB-A", A, T0)
      const b = await takeLock(db, "4:LB-A", B, min(31))
      assert.ok(b.ok)
      const before = await getItem(db, "4:LB-A")
      const r = await saveEntries(db, "4:LB-A", A, [doneEntry("LB-A", 10)], book, false, min(32))
      assert.ok(!r.ok); assert.strictEqual(r.status, 409); assert.strictEqual(r.holder?.email, B.email)
      assert.deepStrictEqual(await getItem(db, "4:LB-A"), before)
    })
    await check("missing id → 404", async () => {
      const r = await saveEntries(db, "4:NOPE", A, [doneEntry("NOPE", 1)], book, false, T0)
      assert.ok(!r.ok); assert.strictEqual(r.status, 404)
    })
    await check("slash/space/Thai id: lock + save + reload", async () => {
      assert.ok((await takeLock(db, SLASH_ID, A, T0)).ok)
      const r = await saveEntries(db, SLASH_ID, A, [doneEntry(SLASH_CODE, 12, { wh: "SR" }), doneEntry(SLASH_CODE, 8, { wh: "SR" })],
        book, true, min(1))
      assert.ok(r.ok); assert.strictEqual(r.item.status, "done")
      assert.deepStrictEqual((await getItem(db, SLASH_ID))?.entries.map((e) => e.qty), [12, 8])
    })
    await check("svc row ignores qty when computing status", async () => {
      const lab = doneEntry("SV-1", null, { type: "LAB", l2: "ENGL", l3: "", unit: "DAY" })
      const r = await saveEntries(db, "4:SV-1", A, [lab], book, true, T0)
      assert.ok(r.ok); assert.strictEqual(r.item.status, "done")
    })

    console.log("next todo")
    await seed(db)
    const it = async (id: string) => (await getItem(db, id)) as ConvertItem
    await check("skips self and done rows · tie on moves broken by issueAmt", async () => {
      assert.strictEqual(await nextTodo(db, await it("4:LB-A"), A.email, T0), "4:LB-C")
      assert.strictEqual(await nextTodo(db, await it("4:LB-C"), A.email, T0), "4:LB-D")
    })
    await check("last row wraps to the first todo of the same wh+kind", async () => {
      assert.strictEqual(await nextTodo(db, await it("4:LB-D"), A.email, T0), "4:LB-A")
      assert.strictEqual(await nextTodo(db, await it("24:DS-1"), A.email, T0), SLASH_ID)
      assert.strictEqual(await nextTodo(db, await it(SLASH_ID), A.email, T0), "24:DS-1")
    })
    await check("rows live-locked by someone else are skipped; mine or expired are not", async () => {
      await takeLock(db, "4:LB-C", B, T0)
      assert.strictEqual(await nextTodo(db, await it("4:LB-A"), A.email, min(1)), "4:LB-D")
      assert.strictEqual(await nextTodo(db, await it("4:LB-A"), B.email, min(1)), "4:LB-C")
      assert.strictEqual(await nextTodo(db, await it("4:LB-A"), A.email, min(31)), "4:LB-C")
    })
    await check("no other todo → null", async () => {
      await db.collection(COLL).updateMany({ _id: { $in: ["4:LB-C", "4:LB-D"] } } as never, { $set: { status: "draft" } })
      assert.strictEqual(await nextTodo(db, await it("4:LB-A"), A.email, T0), null)
    })
  } finally {
    await client.close()
  }
  console.log(`\n${pass} passed${process.exitCode ? " — FAILURES above" : ""}`)
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
