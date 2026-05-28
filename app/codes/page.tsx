import Link from "next/link"
import clientPromise from "@/lib/mongo"
import { Database, ChevronRight } from "lucide-react"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "master_codes"

const DICT_META: Record<string, { label: string; description: string; color: string }> = {
  WAREHOUSE:       { label: "คลังสินค้า",               description: "LK / SR / KK / BK / XX",             color: "bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400" },
  EXPENSE_TYPE:    { label: "ประเภทค่าใช้จ่าย",        description: "PRT / PM / LAB / SVC / CLN / TRP / ACC", color: "bg-green-50 dark:bg-green-950 text-green-600 dark:text-green-400" },
  SYSTEM_L1:       { label: "ระบบ L1",                 description: "ENG / COL / FUL / ACS / BRK ...",      color: "bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-400" },
  SUB_ASSEMBLY_L2: { label: "ชุดประกอบ L2",            description: "แยกตาม L1 — OIL / RAD / RDR ...",      color: "bg-orange-50 dark:bg-orange-950 text-orange-600 dark:text-orange-400" },
  COMPONENT_L3:    { label: "ชิ้นส่วน L3",             description: "แยกตาม L1+L2 — OFT / DSC / CPS ...",   color: "bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400" },
  POSITION:        { label: "ตำแหน่ง",                 description: "GN / FN / RR / LF / RT ...",           color: "bg-teal-50 dark:bg-teal-950 text-teal-600 dark:text-teal-400" },
  UNIT:            { label: "หน่วย",                   description: "PC / SET / LTR / KG / JOB ...",        color: "bg-cyan-50 dark:bg-cyan-950 text-cyan-600 dark:text-cyan-400" },
  GRADE:           { label: "Grade",                   description: "OEM / OE / A / B / NA",                color: "bg-yellow-50 dark:bg-yellow-950 text-yellow-600 dark:text-yellow-400" },
  VEHICLE_TYPE:    { label: "รุ่น/ประเภทรถ",           description: "MX10_ISZ / HD_HIN / TRL_SEM ...",      color: "bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400" },
}

async function getDictSummary() {
  const client = await clientPromise
  const raw = await client.db(DB).collection(COLL)
    .aggregate([{ $group: { _id: "$dict", count: { $sum: 1 } } }])
    .toArray()
  return Object.fromEntries(raw.map((r) => [r._id as string, r.count as number]))
}

export default async function CodesPage() {
  let counts: Record<string, number> = {}
  try { counts = await getDictSummary() } catch {}

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <Database size={20} className="text-gray-400" />
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Code Dictionary</h1>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        จัดการ code ทั้งหมดในระบบ — แก้ไข / เพิ่ม / ลบ ได้ทันที ไม่ต้องแก้โค้ด
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Object.entries(DICT_META).map(([dict, meta]) => (
          <Link
            key={dict}
            href={`/codes/${dict}`}
            className="group flex items-center justify-between rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5 hover:border-gray-400 dark:hover:border-white/20 transition-colors"
          >
            <div className="flex items-start gap-3">
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold ${meta.color}`}>
                {dict.slice(0, 2)}
              </div>
              <div>
                <p className="font-semibold text-sm text-gray-900 dark:text-white">{meta.label}</p>
                <p className="text-[11px] text-gray-400 dark:text-gray-600 mt-0.5">{meta.description}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {counts[dict] ?? 0} รายการ
                </p>
              </div>
            </div>
            <ChevronRight size={15} className="text-gray-300 dark:text-gray-700 group-hover:text-gray-500 dark:group-hover:text-gray-400 transition-colors" />
          </Link>
        ))}
      </div>
    </div>
  )
}
