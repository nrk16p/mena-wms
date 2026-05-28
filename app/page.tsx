import Link from "next/link"
import { PackageSearch, PlusCircle, Tags, BarChart3 } from "lucide-react"

export default function Home() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Mena WMS</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">ระบบจัดการข้อมูลอะไหล่และชิ้นส่วน — Mena Transport</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link href="/sku" className="group block rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-6 hover:border-gray-400 dark:hover:border-white/20 transition-colors">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
              <PackageSearch size={20} />
            </div>
            <div>
              <p className="font-semibold text-gray-900 dark:text-white">รายการ SKU</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">ค้นหา ดู และแก้ไขรายการอะไหล่ทั้งหมด</p>
            </div>
          </div>
        </Link>

        <Link href="/sku/new" className="group block rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-6 hover:border-gray-400 dark:hover:border-white/20 transition-colors">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-50 dark:bg-green-950 text-green-600 dark:text-green-400">
              <PlusCircle size={20} />
            </div>
            <div>
              <p className="font-semibold text-gray-900 dark:text-white">เพิ่ม SKU ใหม่</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">กรอกข้อมูลอะไหล่และสร้าง SKU อัตโนมัติ</p>
            </div>
          </div>
        </Link>

        <Link href="/codes" className="group block rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-6 hover:border-gray-400 dark:hover:border-white/20 transition-colors">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-400">
              <Tags size={20} />
            </div>
            <div>
              <p className="font-semibold text-gray-900 dark:text-white">Code Dictionary</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">ดู code ทั้งหมด: L1, L2, L3, ยี่ห้อ, หน่วย</p>
            </div>
          </div>
        </Link>

        <Link href="/stats" className="group block rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-6 hover:border-gray-400 dark:hover:border-white/20 transition-colors">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 dark:bg-orange-950 text-orange-600 dark:text-orange-400">
              <BarChart3 size={20} />
            </div>
            <div>
              <p className="font-semibold text-gray-900 dark:text-white">สถิติ</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">ภาพรวมจำนวน SKU แยกตามหมวด</p>
            </div>
          </div>
        </Link>
      </div>

      <div className="mt-8 rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-600 mb-3">SKU Format</p>
        <code className="text-sm font-mono text-gray-900 dark:text-white">[WH2]-[TYPE3]-[L1]-[L2]-[L3]-[SEQ4]</code>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">ตัวอย่าง: <code className="font-mono">LK-PRT-ENG-OIL-OFT-0001</code> → ลาดกระบัง / อะไหล่ / เครื่องยนต์ / ระบบน้ำมัน / กรองน้ำมันเครื่อง / ลำดับที่ 1</p>
      </div>
    </div>
  )
}
