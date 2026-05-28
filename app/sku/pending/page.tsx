"use client"

import { useState, useEffect, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { CheckCircle, XCircle, Clock } from "lucide-react"

type SkuRow = {
  SKU: string
  status: string
  createdBy: string
  createdByName: string
  createdAt: string
  ชื่ออะไหล่_TH: string
  Part_Name_EN: string
  คลังสินค้า: string
  ประเภทค่าใช้จ่าย: string
  ระบบ_L1: string
  ชุดประกอบ_L2: string
  ชิ้นส่วน_L3: string
  ราคาต่อหน่วย: number
  หน่วย: string
}

export default function PendingPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [items, setItems]     = useState<SkuRow[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing]   = useState<string | null>(null)

  const isAdmin = session?.user?.role === "admin"

  useEffect(() => {
    if (status === "authenticated" && !isAdmin) router.replace("/sku")
  }, [status, isAdmin, router])

  const load = useCallback(async () => {
    setLoading(true)
    const res  = await fetch("/api/sku?status=pending&limit=200")
    const data = await res.json()
    setItems(data.items ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { if (isAdmin) load() }, [isAdmin, load])

  async function approve(sku: string) {
    setActing(sku)
    await fetch(`/api/sku/${sku}/approve`, { method: "PUT" })
    setActing(null)
    load()
  }

  async function reject(sku: string) {
    if (!confirm(`ปฏิเสธ SKU: ${sku} ?`)) return
    setActing(sku)
    await fetch(`/api/sku/${sku}/approve`, { method: "DELETE" })
    setActing(null)
    load()
  }

  if (status === "loading" || (status === "authenticated" && !isAdmin)) {
    return <div className="text-sm text-gray-400 p-6">กำลังโหลด...</div>
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <Clock size={20} className="text-amber-500" />
          รออนุมัติ SKU
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{items.length} รายการรอการอนุมัติ</p>
      </div>

      {loading ? (
        <div className="text-sm text-gray-400">กำลังโหลด...</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] px-6 py-16 text-center">
          <CheckCircle size={40} className="mx-auto mb-3 text-green-400" />
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">ไม่มีรายการรออนุมัติ</p>
          <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">SKU ทุกรายการได้รับการอนุมัติแล้ว</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((row) => (
            <div key={row.SKU} className="rounded-xl border border-amber-200 dark:border-amber-800/40 bg-white dark:bg-[#0f1117] px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-sm font-semibold text-gray-900 dark:text-white">{row.SKU}</span>
                    <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">PENDING</span>
                  </div>
                  <p className="text-sm text-gray-900 dark:text-white font-medium truncate">{row.ชื่ออะไหล่_TH}</p>
                  {row.Part_Name_EN && <p className="text-xs text-gray-500 dark:text-gray-400">{row.Part_Name_EN}</p>}
                  <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500 dark:text-gray-400">
                    <span>{row.คลังสินค้า} · {row.ประเภทค่าใช้จ่าย}</span>
                    <span className="font-mono">{row.ระบบ_L1}-{row.ชุดประกอบ_L2}-{row.ชิ้นส่วน_L3}</span>
                    {row.ราคาต่อหน่วย > 0 && <span>{row.ราคาต่อหน่วย.toLocaleString()} บาท / {row.หน่วย}</span>}
                  </div>
                  <p className="text-[11px] text-gray-400 dark:text-gray-600 mt-1.5">
                    สร้างโดย <span className="font-medium">{row.createdByName || row.createdBy}</span>
                    {row.createdAt && <> · {new Date(row.createdAt).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</>}
                  </p>
                </div>

                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => approve(row.SKU)}
                    disabled={acting === row.SKU}
                    className="flex items-center gap-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
                  >
                    <CheckCircle size={13} />
                    อนุมัติ
                  </button>
                  <button
                    onClick={() => reject(row.SKU)}
                    disabled={acting === row.SKU}
                    className="flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
                  >
                    <XCircle size={13} />
                    ปฏิเสธ
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
