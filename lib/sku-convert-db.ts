// แปลงรหัส ATMS → SKU ใหม่ — Mongo side (list, detail, row lock, save).
// Every function takes a Db so the check script can point it at a local test Mongo; route handlers
// pass clientPromise's db. No lib/mongo import here (it throws without MONGO_URI).
// Mongo stores Dates; everything returned is the JSON shape of lib/sku-convert-types (ISO strings).
// Spec: docs/superpowers/specs/2026-10-06-sku-convert-design.md
import type { Db, Document, Filter } from "mongodb"
import { buildCodeBook, LOCK_MS, rowStatus } from "./sku-convert-core"
import type {
  CodeBook, ConvertCounts, ConvertItem, ConvertListResponse, ConvertListRow, Entry, Kind, Lock, MasterCodeRow,
  RowStatus, Wh,
} from "./sku-convert-types"

export const COLL = "sku_convert_items"
const CODES_COLL = "master_codes"
const STOCK_COLL = "atms_sku_master"

export interface ListQuery {
  wh: Wh
  kind: Kind
  q?: string
  group?: string
  status?: RowStatus
  hint?: boolean
  stock?: boolean
  page?: number
  limit?: number
}

type ItemDoc = { _id: string } & Document
type User = { email: string; name: string }

const items = (db: Db) => db.collection<ItemDoc>(COLL)
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const SORT = { moves: -1, issueAmt: -1, _id: 1 } as const
/** splitHint present and not "" (null also matches a missing field). */
const HAS_HINT = { $nin: [null, ""] }

/** Dates → ISO strings, recursively (Mongo shape → JSON shape). */
function toJson<T>(v: unknown): T {
  if (v instanceof Date) return v.toISOString() as T
  if (Array.isArray(v)) return v.map((x) => toJson(x)) as T
  if (v && typeof v === "object") {
    const proto = Object.getPrototypeOf(v)
    if (proto === Object.prototype || proto === null) {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toJson(x)])) as T
    }
  }
  return v as T
}

/** Row is free for `email`: nobody holds it, `email` holds it, or the holder's lock is ≥ LOCK_MS old. */
function freeFor(email: string, now: Date): Filter<ItemDoc> {
  return { $or: [{ lock: null }, { "lock.email": email }, { "lock.at": { $lte: new Date(now.getTime() - LOCK_MS) } }] }
}

// ---------------------------------------------------------------- list

export async function listItems(db: Db, q: ListQuery): Promise<ConvertListResponse> {
  const tab: Filter<ItemDoc> = { wh: q.wh, kind: q.kind }
  const filter: Filter<ItemDoc> = { ...tab }
  const text = q.q?.trim()
  if (text) {
    const rx = { $regex: esc(text), $options: "i" }
    filter.$or = [{ code: rx }, { name: rx }]
  }
  if (q.group) filter.group = q.group
  if (q.status) filter.status = q.status
  if (q.hint) filter.splitHint = HAS_HINT
  if (q.stock) filter.atmsQty = { $gt: 0 }

  const limit = Math.min(200, Math.max(1, Math.floor(q.limit ?? 50) || 50))
  const page = Math.max(1, Math.floor(q.page ?? 1) || 1)
  const col = items(db)

  const [total, rows, countRows, groups] = await Promise.all([
    col.countDocuments(filter),
    col.aggregate<ConvertListRow>([
      { $match: filter },
      { $sort: SORT },
      { $skip: (page - 1) * limit },
      { $limit: limit },
      { $addFields: { entryCount: { $size: { $ifNull: ["$entries", []] } } } },
      { $project: { lots: 0, suppliers: 0, suggest: 0, entries: 0 } },
    ]).toArray(),
    col.aggregate<ConvertCounts>([
      { $match: tab },
      {
        $group: {
          _id: null,
          all: { $sum: 1 },
          todo: { $sum: { $cond: [{ $eq: ["$status", "todo"] }, 1, 0] } },
          draft: { $sum: { $cond: [{ $eq: ["$status", "draft"] }, 1, 0] } },
          done: { $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] } },
          hint: { $sum: { $cond: [{ $and: [{ $eq: [{ $type: "$splitHint" }, "string"] }, { $ne: ["$splitHint", ""] }] }, 1, 0] } },
        },
      },
      { $project: { _id: 0 } },
    ]).toArray(),
    col.distinct("group", tab),
  ])

  return {
    total,
    page,
    limit,
    rows: toJson<ConvertListRow[]>(rows),
    counts: countRows[0] ?? { all: 0, todo: 0, draft: 0, done: 0, hint: 0 },
    groups: (groups as unknown[]).filter((g): g is string => typeof g === "string" && !!g).sort((a, b) => a.localeCompare(b, "th")),
  }
}

// ---------------------------------------------------------------- detail

export async function getItem(db: Db, id: string): Promise<ConvertItem | null> {
  const doc = await items(db).findOne({ _id: id })
  return doc ? toJson<ConvertItem>(doc) : null
}

/** Next `todo` row after `item` in list order (same wh+kind), skipping rows someone else holds; wraps around. */
export async function nextTodo(db: Db, item: ConvertItem, meEmail: string, now: Date = new Date()): Promise<string | null> {
  const base: Filter<ItemDoc> = {
    wh: item.wh, kind: item.kind, status: "todo", _id: { $ne: item._id },
  }
  const free = freeFor(meEmail, now)
  // strictly after the current row in { moves: -1, issueAmt: -1, _id: 1 }
  const after: Filter<ItemDoc> = {
    $or: [
      { moves: { $lt: item.moves } },
      { moves: item.moves, issueAmt: { $lt: item.issueAmt } },
      { moves: item.moves, issueAmt: item.issueAmt, _id: { $gt: item._id } },
    ],
  }
  const first = (filter: Filter<ItemDoc>) =>
    items(db).find(filter, { projection: { _id: 1 } }).sort(SORT).limit(1).next()
  const hit = (await first({ ...base, $and: [free, after] })) ?? (await first({ ...base, $and: [free] }))
  return hit?._id ?? null
}

/** Today's ATMS stock for the row (atms_sku_master, synced daily by the cron) — freshest sync wins. */
export async function liveStock(db: Db, item: ConvertItem): Promise<{ qty: number; syncedAt: string } | null> {
  const doc = await db.collection(STOCK_COLL).findOne(
    { code: item.code, inventoryId: item.inv },
    { projection: { _id: 0, stockQty: 1, syncedAt: 1 }, sort: { syncedAt: -1 } },
  )
  if (!doc) return null
  const at = doc.syncedAt
  return {
    qty: Number(doc.stockQty ?? 0) || 0,
    syncedAt: at instanceof Date ? at.toISOString() : typeof at === "string" ? at : "",
  }
}

// ---------------------------------------------------------------- lock

export async function takeLock(
  db: Db, id: string, user: User, now: Date = new Date(),
): Promise<{ ok: true; lock: Lock } | { ok: false; notFound?: true; holder?: Lock }> {
  const col = items(db)
  const lock = { email: user.email, name: user.name, at: now }
  const doc = await col.findOneAndUpdate(
    { _id: id, ...freeFor(user.email, now) },
    { $set: { lock } },
    { returnDocument: "after", projection: { lock: 1 } },
  )
  if (doc) return { ok: true, lock: toJson<Lock>(lock) }
  const cur = await col.findOne({ _id: id }, { projection: { lock: 1 } })
  if (!cur) return { ok: false, notFound: true }
  return { ok: false, holder: cur.lock ? toJson<Lock>(cur.lock) : undefined }
}

/** Only the holder can release; anyone else is a no-op. */
export async function releaseLock(db: Db, id: string, email: string): Promise<void> {
  await items(db).updateOne({ _id: id, "lock.email": email }, { $set: { lock: null } })
}

// ---------------------------------------------------------------- save

export async function saveEntries(
  db: Db, id: string, user: User, entries: Entry[], book: CodeBook, release: boolean, now: Date = new Date(),
): Promise<{ ok: true; item: ConvertItem } | { ok: false; status: 404 | 409; holder?: Lock }> {
  const col = items(db)
  const cur = await col.findOne({ _id: id }, { projection: { kind: 1, atmsQty: 1 } })
  if (!cur) return { ok: false, status: 404 }
  const status = rowStatus(cur.kind as Kind, Number(cur.atmsQty ?? 0), entries, book)
  const me = { email: user.email, name: user.name }
  const doc = await col.findOneAndUpdate(
    { _id: id, ...freeFor(user.email, now) },
    { $set: { entries, status, updatedBy: me, updatedAt: now, lock: release ? null : { ...me, at: now } } },
    { returnDocument: "after" },
  )
  if (doc) return { ok: true, item: toJson<ConvertItem>(doc) }
  const after = await col.findOne({ _id: id }, { projection: { lock: 1 } })
  if (!after) return { ok: false, status: 404 }
  return { ok: false, status: 409, holder: after.lock ? toJson<Lock>(after.lock) : undefined }
}

// ---------------------------------------------------------------- code book

const BOOK_DICTS = [
  "WAREHOUSE", "EXPENSE_TYPE", "SYSTEM_L1", "SUB_ASSEMBLY_L2", "COMPONENT_L3", "UNIT", "GRADE", "POSITION",
  "VEHICLE_TYPE", "BRAND",
]
const BOOK_TTL_MS = 5 * 60 * 1000
const bookCache = new Map<string, { at: number; book: Promise<CodeBook> }>()

/** master_codes → buildCodeBook, cached 5 minutes per database. */
export async function loadCodeBook(db: Db): Promise<CodeBook> {
  const key = db.databaseName
  const hit = bookCache.get(key)
  if (hit && Date.now() - hit.at < BOOK_TTL_MS) return hit.book
  const book = db.collection(CODES_COLL)
    .find({ dict: { $in: BOOK_DICTS } }, { projection: { _id: 0, dict: 1, code: 1, th: 1, parent: 1, order: 1, meta: 1 } })
    .toArray()
    .then((rows) => buildCodeBook(rows as unknown as MasterCodeRow[]))
  bookCache.set(key, { at: Date.now(), book })
  book.catch(() => { if (bookCache.get(key)?.book === book) bookCache.delete(key) })
  return book
}
