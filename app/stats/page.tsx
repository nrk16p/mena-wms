import clientPromise from "@/lib/mongo"
import { EXPENSE_TYPE, SYSTEM_L1 } from "@/lib/codes"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "master_sku"

async function getStats() {
  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)
  const total  = await col.countDocuments()

  const byType = await col.aggregate([
    { $group: { _id: "$ประเภทค่าใช้จ่าย", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]).toArray()

  const byL1 = await col.aggregate([
    { $group: { _id: "$ระบบ_L1", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]).toArray()

  const byWh = await col.aggregate([
    { $group: { _id: "$คลังสินค้า", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]).toArray()

  return { total, byType, byL1, byWh }
}

export default async function StatsPage() {
  let stats = { total: 0, byType: [], byL1: [], byWh: [] } as Awaited<ReturnType<typeof getStats>>
  try { stats = await getStats() } catch {}

  const TYPE_COLOR: Record<string, string> = {
    PRT:"bg-blue-500",PM:"bg-green-500",LAB:"bg-yellow-500",
    SVC:"bg-orange-500",CLN:"bg-purple-500",TRP:"bg-gray-400",ACC:"bg-red-500",
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">สถิติ Mena WMS</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">ภาพรวมรายการอะไหล่ทั้งหมดในระบบ</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 mb-1">SKU ทั้งหมด</p>
          <p className="text-3xl font-semibold text-gray-900 dark:text-white">{stats.total.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 mb-1">ประเภท</p>
          <p className="text-3xl font-semibold text-gray-900 dark:text-white">{stats.byType.length}</p>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 mb-1">ระบบ L1</p>
          <p className="text-3xl font-semibold text-gray-900 dark:text-white">{stats.byL1.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {/* By Type */}
        <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5">
          <p className="text-sm font-semibold text-gray-900 dark:text-white mb-4">แยกตามประเภทค่าใช้จ่าย</p>
          <div className="space-y-3">
            {(stats.byType as {_id:string;count:number}[]).map((r) => {
              const pct = stats.total > 0 ? (r.count / stats.total) * 100 : 0
              return (
                <div key={r._id}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-700 dark:text-gray-300">{r._id} — {EXPENSE_TYPE[r._id]?.th ?? r._id}</span>
                    <span className="text-gray-500 dark:text-gray-400">{r.count}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-gray-100 dark:bg-white/8">
                    <div className={`h-1.5 rounded-full ${TYPE_COLOR[r._id] ?? "bg-gray-400"}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* By L1 */}
        <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5">
          <p className="text-sm font-semibold text-gray-900 dark:text-white mb-4">แยกตามระบบ L1</p>
          <div className="space-y-2.5">
            {(stats.byL1 as {_id:string;count:number}[]).map((r) => {
              const pct = stats.total > 0 ? (r.count / stats.total) * 100 : 0
              return (
                <div key={r._id}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-700 dark:text-gray-300">{r._id} — {SYSTEM_L1[r._id]?.th ?? r._id}</span>
                    <span className="text-gray-500 dark:text-gray-400">{r.count}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-gray-100 dark:bg-white/8">
                    <div className="h-1.5 rounded-full bg-gray-400 dark:bg-gray-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
