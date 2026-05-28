"use client"

import { useState, useEffect, useCallback } from "react"
import { useSession } from "next-auth/react"
import { Clock, XCircle, Pencil, CheckCircle, AlertTriangle, RefreshCw } from "lucide-react"
import Link from "next/link"

type SkuRow = {
  SKU: string
  status: string
  createdAt: string
  updatedAt: string
  ชื่ออะไหล่_TH: string
  Part_Name_EN: string
  เบอร์อะไหล่: string
  คลังสินค้า: string
  ประเภทค่าใช้จ่าย: string
  ระบบ_L1: string
  ชุดประกอบ_L2: string
  ชิ้นส่วน_L3: string
  ราคาต่อหน่วย: number
  หน่วย: string
  ยี่ห้อ: string
  Grade: string
  รหัสATMS: string | string[]
  rejectedReason?: string
  rejectedBy?: string
  rejectedAt?: string
}

const TYPE_COLOR: Record<string, string> = {
  PRT: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  PM:  "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  LAB: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  SVC: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  CLN: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  TRP: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  ACC: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
}

function toArr(v: string | string[] | undefined): string[] {
  if (!v) return []
  return Array.isArray(v) ? v.filter(Boolean) : (v ? [v] : [])
}

function SkuCard({ row, onResubmit, resubmitting }: {
  row: SkuRow
  onResubmit?: (sku: string) => void
  resubmitting?: boolean
}) {
  const atmsCodes = toArr(row.รหัสATMS)
  const isRejected = row.status === "rejected"

  return (
    <div className={`rounded-xl border bg-white dark:bg-[#0f1117] overflow-hidden ${
      isRejected
        ? "border-red-200 dark:border-red-800/40"
        : "border-amber-200 dark:border-amber-800/40"
    }`}>
      {/* Header */}
      <div className={`flex items-center gap-3 px-4 py-2.5 border-b text-xs ${
        isRejected
          ? "bg-red-50 dark:bg-red-950/20 border-red-100 dark:border-red-800/30"
          : "bg-amber-50 dark:bg-amber-950/20 border-amber-100 dark:border-amber-800/30"
      }`}>
        <span className="font-mono font-bold text-gray-900 dark:text-white">{row.SKU}</span>
        {isRejected ? (
          <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
            <XCircle size={9} /> ถูกปฏิเสธ
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
            <Clock size={9} /> รออนุมัติ
          </span>
        )}
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${TYPE_COLOR[row.ประเภทค่าใช้จ่าย] ?? ""}`}>
          {row.ประเภทค่าใช้จ่าย}
        </span>
        <span className="font-mono text-gray-500 dark:text-gray-400">
          {row.คลังสินค้า} · {row.ระบบ_L1}-{row.ชุดประกอบ_L2}-{row.ชิ้นส่วน_L3}
        </span>
        <span className="ml-auto text-gray-400 dark:text-gray-500">
          {new Date(row.createdAt).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })}
        </span>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0 space-y-1.5">
            <p className="font-semibold text-gray-900 dark:text-white leading-snug">{row.ชื่ออะไหล่_TH}</p>
            {row.Part_Name_EN && <p className="text-xs text-gray-500 dark:text-gray-400">{row.Part_Name_EN}</p>}

            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-600 dark:text-gray-400 mt-1">
              {row.เบอร์อะไหล่ && <span><span className="text-gray-400">เบอร์ </span><span className="font-mono font-medium text-gray-900 dark:text-white">{row.เบอร์อะไหล่}</span></span>}
              {row.ยี่ห้อ      && <span><span className="text-gray-400">ยี่ห้อ </span>{row.ยี่ห้อ}</span>}
              {row.Grade       && <span><span className="text-gray-400">Grade </span>{row.Grade}</span>}
              {row.ราคาต่อหน่วย > 0 && <span>{row.ราคาต่อหน่วย.toLocaleString()} บ. / {row.หน่วย}</span>}
            </div>

            {atmsCodes.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-gray-400">ATMS</span>
                {atmsCodes.map((c) => (
                  <span key={c} className="rounded px-1.5 py-0.5 text-[11px] font-mono font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">{c}</span>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-1.5 shrink-0">
            <Link
              href={`/sku/${row.SKU}`}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 px-3 py-1.5 text-xs font-medium transition-colors"
            >
              <Pencil size={11} /> แก้ไข
            </Link>
            {isRejected && onResubmit && (
              <button
                onClick={() => onResubmit(row.SKU)}
                disabled={resubmitting}
                className="flex items-center gap-1.5 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:opacity-90 px-3 py-1.5 text-xs font-semibold transition-opacity disabled:opacity-50"
              >
                <RefreshCw size={11} className={resubmitting ? "animate-spin" : ""} />
                ส่งใหม่
              </button>
            )}
          </div>
        </div>

        {/* Rejection reason */}
        {isRejected && (
          <div className="mt-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-800/30 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <AlertTriangle size={13} className="text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-red-600 dark:text-red-400 mb-0.5">เหตุผลการปฏิเสธ</p>
                <p className="text-xs text-red-700 dark:text-red-300">
                  {row.rejectedReason || "ไม่ได้ระบุเหตุผล"}
                </p>
                {row.rejectedAt && (
                  <p className="text-[10px] text-red-400 dark:text-red-600 mt-1">
                    {new Date(row.rejectedAt).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function MySubmissionsPage() {
  const { data: session, status } = useSession()
  const [pending,  setPending]  = useState<SkuRow[]>([])
  const [rejected, setRejected] = useState<SkuRow[]>([])
  const [loading,  setLoading]  = useState(true)
  const [resubmitting, setResubmitting] = useState<string | null>(null)

  const email = session?.user?.email ?? ""

  const load = useCallback(async () => {
    if (!email) return
    setLoading(true)
    const [pRes, rRes] = await Promise.all([
      fetch(`/api/sku?createdBy=${encodeURIComponent(email)}&status=pending&limit=100`),
      fetch(`/api/sku?createdBy=${encodeURIComponent(email)}&status=rejected&limit=100`),
    ])
    const [pData, rData] = await Promise.all([pRes.json(), rRes.json()])
    setPending(pData.items  ?? [])
    setRejected(rData.items ?? [])
    setLoading(false)
  }, [email])

  useEffect(() => { if (status === "authenticated") load() }, [status, load])

  async function resubmit(sku: string) {
    setResubmitting(sku)
    await fetch(`/api/sku/${sku}/resubmit`, { method: "PUT" })
    setResubmitting(null)
    load()
  }

  if (status === "loading") return <div className="text-sm text-gray-400 p-6">กำลังโหลด...</div>

  const total = pending.length + rejected.length

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">รายการของฉัน</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          {loading ? "กำลังโหลด..." : total === 0 ? "ไม่มีรายการรออนุมัติหรือถูกปฏิเสธ" : `${total} รายการ`}
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-gray-400">กำลังโหลด...</div>
      ) : total === 0 ? (
        <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] px-6 py-16 text-center">
          <CheckCircle size={40} className="mx-auto mb-3 text-green-400" />
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">ทุกรายการได้รับการอนุมัติแล้ว</p>
          <Link href="/sku/new" className="inline-block mt-4 text-xs text-gray-500 hover:text-gray-900 dark:hover:text-white underline">
            + เพิ่ม SKU ใหม่
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Rejected */}
          {rejected.length > 0 && (
            <section>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-red-600 dark:text-red-400 mb-3">
                <XCircle size={15} />
                ถูกปฏิเสธ ({rejected.length})
              </h2>
              <div className="space-y-3">
                {rejected.map((row) => (
                  <SkuCard
                    key={row.SKU}
                    row={row}
                    onResubmit={resubmit}
                    resubmitting={resubmitting === row.SKU}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Pending */}
          {pending.length > 0 && (
            <section>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-600 dark:text-amber-400 mb-3">
                <Clock size={15} />
                รออนุมัติ ({pending.length})
              </h2>
              <div className="space-y-3">
                {pending.map((row) => (
                  <SkuCard key={row.SKU} row={row} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
