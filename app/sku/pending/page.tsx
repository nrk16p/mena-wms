"use client"

import { useState, useEffect, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { CheckCircle, XCircle, Clock, ChevronDown, ChevronUp, AlertTriangle, Layers, ChevronRight } from "lucide-react"
import Link from "next/link"
import { ImageThumbs } from "@/components/image-thumbs"
import { swalRejectInput, swalToast } from "@/lib/swal"
import { type CodeLabels, labelOf, codeWithLabel, l2Label, l3Label } from "@/lib/code-labels"
import type { SkuImage } from "@/lib/media"

type SkuRow = {
  _id?: string
  SKU: string
  status: string
  createdBy: string
  createdByName: string
  createdAt: string
  updatedAt?: string
  ชื่ออะไหล่_TH: string
  Part_Name_EN: string
  เบอร์อะไหล่: string
  คลังสินค้า: string
  ประเภทค่าใช้จ่าย: string
  ระบบ_L1: string
  ชุดประกอบ_L2: string
  ชิ้นส่วน_L3: string
  ตำแหน่ง: string | string[]
  ราคาต่อหน่วย: number
  หน่วย: string
  ยี่ห้อ: string
  Grade: string
  เบอร์แท้อ้างอิง: string
  เบอร์เทียบอ้างอิง: string | string[]
  ทะเบียนหรือรุ่นรถ: string | string[]
  รหัสATMS: string | string[]
  images?: SkuImage[]
}

type SimilarRow = {
  SKU: string
  ชื่ออะไหล่_TH: string
  Part_Name_EN: string
  เบอร์อะไหล่: string
  ยี่ห้อ: string
  Grade: string
  ราคาต่อหน่วย: number
  หน่วย: string
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

// ประเภทที่ไม่มีราคาต่อหน่วย (ตั้งราคาตอนเบิก/ตอนทำใบเสนอราคา)
const NO_PRICE_TYPES = ["LAB", "SVC", "CLN", "TRP", "ACC"]

function toArr(v: string | string[] | undefined): string[] {
  if (!v) return []
  return Array.isArray(v) ? v.filter(Boolean) : (v ? [v] : [])
}

function fmtDateTime(v?: string) {
  if (!v) return "—"
  return new Date(v).toLocaleDateString("th-TH", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  })
}

/* ── ช่องข้อมูลหนึ่งช่อง — แสดงทุกช่องเสมอ ว่างก็ขึ้น "—" ── */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 min-w-0">
      <span className="text-gray-400 dark:text-gray-600 whitespace-nowrap shrink-0 w-24">{label}</span>
      <span className="min-w-0 text-gray-900 dark:text-white">{children}</span>
    </div>
  )
}

const dash = <span className="text-gray-300 dark:text-gray-700">—</span>

function SimilarSkus({ row, labels }: { row: SkuRow; labels: CodeLabels }) {
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [items, setItems]     = useState<SimilarRow[] | null>(null)

  async function load() {
    if (items !== null) { setOpen((o) => !o); return }
    setLoading(true)
    setOpen(true)
    const params = new URLSearchParams({
      wh: row.คลังสินค้า, type: row.ประเภทค่าใช้จ่าย,
      l1: row.ระบบ_L1, l2: row.ชุดประกอบ_L2, l3: row.ชิ้นส่วน_L3,
      status: "approved", limit: "50",
    })
    const res  = await fetch(`/api/sku?${params}`)
    const data = await res.json()
    setItems(data.items ?? [])
    setLoading(false)
  }

  const count = items?.length ?? null

  const where = [
    labelOf(labels, "WAREHOUSE", row.คลังสินค้า),
    labelOf(labels, "EXPENSE_TYPE", row.ประเภทค่าใช้จ่าย),
    labelOf(labels, "SYSTEM_L1", row.ระบบ_L1),
    l2Label(labels, row.ระบบ_L1, row.ชุดประกอบ_L2),
    l3Label(labels, row.ระบบ_L1, row.ชุดประกอบ_L2, row.ชิ้นส่วน_L3),
  ].filter(Boolean).join(" · ")

  return (
    <div className="mt-3 border-t border-gray-100 dark:border-white/5 pt-3">
      <button
        type="button"
        onClick={load}
        className={`flex items-center gap-1.5 text-xs font-medium text-left transition-colors ${
          count === 0 ? "text-gray-400 dark:text-gray-600" :
          count !== null && count > 0 ? "text-amber-600 dark:text-amber-400 hover:text-amber-700" :
          "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
        }`}
      >
        <Layers size={12} className="shrink-0" />
        ดู SKU ที่อนุมัติแล้วในหมวดเดียวกัน — {where}
        {count !== null && (
          <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
            count > 0 ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300" :
            "bg-gray-100 dark:bg-white/8 text-gray-500"
          }`}>
            {count} รายการ
          </span>
        )}
        {loading ? <span className="ml-1 opacity-50">โหลด...</span> : open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
      </button>

      {open && items !== null && (
        <div className="mt-2 rounded-lg border border-gray-100 dark:border-white/8 overflow-hidden">
          {items.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-gray-400 text-center">ไม่มีรายการซ้ำในหมวดนี้</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 dark:bg-white/3 border-b border-gray-100 dark:border-white/5">
                  {["SKU", "ชื่ออะไหล่", "เบอร์", "ยี่ห้อ", "Grade", "ราคา"].map((h) => (
                    <th key={h} className="px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.SKU} className="border-b border-gray-50 dark:border-white/3 last:border-0 hover:bg-gray-50 dark:hover:bg-white/3">
                    <td className="px-3 py-2 font-mono text-gray-900 dark:text-white whitespace-nowrap">
                      <Link href={`/sku/${r.SKU}`} className="hover:underline">{r.SKU}</Link>
                    </td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300 max-w-[200px] truncate">{r.ชื่ออะไหล่_TH}</td>
                    <td className="px-3 py-2 font-mono text-gray-500 dark:text-gray-400 whitespace-nowrap">{r.เบอร์อะไหล่ || "—"}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{labelOf(labels, "BRAND", r.ยี่ห้อ) || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="rounded px-1.5 py-0.5 bg-gray-100 dark:bg-white/8 text-gray-600 dark:text-gray-300 font-medium">{r.Grade || "—"}</span>
                    </td>
                    <td className="px-3 py-2 text-right text-gray-900 dark:text-white whitespace-nowrap">
                      {r.ราคาต่อหน่วย > 0 ? `${r.ราคาต่อหน่วย.toLocaleString()} บ.` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

export default function PendingPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [items, setItems]     = useState<SkuRow[]>([])
  const [labels, setLabels]   = useState<CodeLabels>({})
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

  // ชื่อเต็มของทุกชุดรหัส — เรียกครั้งเดียว
  useEffect(() => {
    if (!isAdmin) return
    fetch("/api/codes/labels").then((r) => r.json()).then(setLabels).catch(() => {})
  }, [isAdmin])

  async function approve(sku: string) {
    setActing(sku)
    await fetch(`/api/sku/${sku}/approve`, { method: "PUT" })
    setActing(null)
    swalToast("success", "อนุมัติ SKU สำเร็จ")
    load()
  }

  async function handleReject(sku: string) {
    const result = await swalRejectInput(sku)
    if (!result.isConfirmed) return
    setActing(sku)
    await fetch(`/api/sku/${sku}/approve`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: result.value ?? "" }),
    })
    setActing(null)
    swalToast("info", "ปฏิเสธ SKU แล้ว")
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
        <div className="space-y-4">
          {items.map((row) => {
            const atmsCodes  = toArr(row.รหัสATMS)
            const compatRefs = toArr(row.เบอร์เทียบอ้างอิง)
            const vehicles   = toArr(row.ทะเบียนหรือรุ่นรถ)
            const positions  = toArr(row.ตำแหน่ง)
            const images     = Array.isArray(row.images) ? row.images : []
            const noPrice    = NO_PRICE_TYPES.includes(row.ประเภทค่าใช้จ่าย)

            const whTh   = labelOf(labels, "WAREHOUSE", row.คลังสินค้า)
            const typeTh = labelOf(labels, "EXPENSE_TYPE", row.ประเภทค่าใช้จ่าย)
            const l1Th   = labelOf(labels, "SYSTEM_L1", row.ระบบ_L1)
            const l2Th   = l2Label(labels, row.ระบบ_L1, row.ชุดประกอบ_L2)
            const l3Th   = l3Label(labels, row.ระบบ_L1, row.ชุดประกอบ_L2, row.ชิ้นส่วน_L3)

            return (
              <div key={row._id ?? row.SKU} className="rounded-xl border border-amber-200 dark:border-amber-800/40 bg-white dark:bg-[#0f1117] overflow-hidden">
                {/* Header bar */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3 bg-amber-50 dark:bg-amber-950/20 border-b border-amber-100 dark:border-amber-800/30">
                  <span className="font-mono text-sm font-bold text-gray-900 dark:text-white tracking-tight">{row.SKU}</span>
                  <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                    <AlertTriangle size={9} />
                    PENDING
                  </span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${TYPE_COLOR[row.ประเภทค่าใช้จ่าย] ?? ""}`}>
                    {row.ประเภทค่าใช้จ่าย}{typeTh && typeTh !== row.ประเภทค่าใช้จ่าย ? ` — ${typeTh}` : ""}
                  </span>
                  <span className="text-[11px] text-gray-600 dark:text-gray-300">
                    <span className="font-mono text-gray-500 dark:text-gray-400">{row.คลังสินค้า}</span>
                    {whTh && whTh !== row.คลังสินค้า ? ` — ${whTh}` : ""}
                  </span>
                  <div className="ml-auto text-[11px] text-gray-400 dark:text-gray-500">
                    <span className="font-medium text-gray-600 dark:text-gray-300">{row.createdByName || row.createdBy}</span>
                    {row.createdAt && <> · {fmtDateTime(row.createdAt)}</>}
                  </div>
                </div>

                {/* หมวดจัดเก็บ — ชื่อเต็มของแต่ละชั้น */}
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-5 py-2 border-b border-gray-100 dark:border-white/5 bg-gray-50/60 dark:bg-white/2 text-[12px]">
                  {[
                    { code: row.ระบบ_L1,     th: l1Th, tag: "L1" },
                    { code: row.ชุดประกอบ_L2, th: l2Th, tag: "L2" },
                    { code: row.ชิ้นส่วน_L3,   th: l3Th, tag: "L3" },
                  ].map((lv, i) => (
                    <span key={lv.tag} className="flex items-center gap-1.5">
                      {i > 0 && <ChevronRight size={11} className="text-gray-300 dark:text-gray-700" />}
                      <span className="text-[9px] font-semibold uppercase text-gray-400 dark:text-gray-600">{lv.tag}</span>
                      {lv.code ? (
                        <>
                          <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">{lv.code}</span>
                          <span className="text-gray-800 dark:text-gray-200">{lv.th !== lv.code ? lv.th : ""}</span>
                        </>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-600">
                          {noPrice ? "ไม่ใช้ในประเภทนี้" : "ไม่ระบุ"}
                        </span>
                      )}
                    </span>
                  ))}
                </div>

                {/* Body */}
                <div className="px-5 py-4">
                  <div className="flex items-start gap-4">
                    {/* Left: all details */}
                    <div className="flex-1 min-w-0 space-y-3">
                      {/* Name */}
                      <div>
                        <p className="text-base font-semibold text-gray-900 dark:text-white leading-snug">{row.ชื่ออะไหล่_TH}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{row.Part_Name_EN || "— ไม่มีชื่ออังกฤษ —"}</p>
                      </div>

                      {/* ทุกฟิลด์ — แสดงเสมอ ว่างก็ขึ้นขีด */}
                      <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
                        <Field label="เบอร์อะไหล่">
                          {row.เบอร์อะไหล่ && row.เบอร์อะไหล่ !== "-"
                            ? <span className="font-mono font-medium">{row.เบอร์อะไหล่}</span>
                            : dash}
                        </Field>
                        <Field label="เบอร์แท้">
                          {row.เบอร์แท้อ้างอิง ? <span className="font-mono">{row.เบอร์แท้อ้างอิง}</span> : dash}
                        </Field>
                        <Field label="ยี่ห้อ">
                          {row.ยี่ห้อ
                            ? <>{labelOf(labels, "BRAND", row.ยี่ห้อ)}<span className="ml-1.5 font-mono text-[11px] text-gray-400">{row.ยี่ห้อ}</span></>
                            : dash}
                        </Field>
                        <Field label="Grade">
                          {row.Grade ? codeWithLabel(labels, "GRADE", row.Grade) : dash}
                        </Field>
                        <Field label="ราคาต่อหน่วย">
                          {noPrice
                            ? <span className="text-gray-400 dark:text-gray-500">ไม่กำหนดราคา ({row.ประเภทค่าใช้จ่าย})</span>
                            : row.ราคาต่อหน่วย > 0
                              ? <span className="font-medium">{row.ราคาต่อหน่วย.toLocaleString()} บาท</span>
                              : dash}
                        </Field>
                        <Field label="หน่วย">
                          {row.หน่วย ? codeWithLabel(labels, "UNIT", row.หน่วย) : dash}
                        </Field>
                        <Field label="ตำแหน่ง">
                          {positions.length > 0
                            ? positions.map((p) => codeWithLabel(labels, "POSITION", p)).join(" · ")
                            : dash}
                        </Field>
                        <Field label="แก้ไขล่าสุด">
                          <span className="text-gray-500 dark:text-gray-400">{fmtDateTime(row.updatedAt)}</span>
                        </Field>
                        <Field label="ผู้ส่งคำขอ">
                          <span className="text-gray-500 dark:text-gray-400">{row.createdBy || "—"}</span>
                        </Field>
                        <Field label="สถานะ">
                          <span className="text-amber-600 dark:text-amber-400">รออนุมัติ</span>
                        </Field>
                      </div>

                      {/* Tags: ATMS, compatRefs, vehicles */}
                      <div className="space-y-1.5">
                        <div className="flex items-start gap-2 flex-wrap">
                          <span className="text-[11px] text-gray-400 dark:text-gray-600 w-24 shrink-0 pt-0.5">รหัส ATMS</span>
                          <div className="flex flex-wrap gap-1">
                            {atmsCodes.length > 0 ? atmsCodes.map((c) => (
                              <span key={c} className="rounded px-1.5 py-0.5 text-[11px] font-mono font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">{c}</span>
                            )) : <span className="text-[11px] text-gray-300 dark:text-gray-700">—</span>}
                          </div>
                        </div>
                        <div className="flex items-start gap-2 flex-wrap">
                          <span className="text-[11px] text-gray-400 dark:text-gray-600 w-24 shrink-0 pt-0.5">เบอร์เทียบ</span>
                          <div className="flex flex-wrap gap-1">
                            {compatRefs.length > 0 ? compatRefs.map((c) => (
                              <span key={c} className="rounded px-1.5 py-0.5 text-[11px] font-mono bg-gray-100 dark:bg-white/8 text-gray-600 dark:text-gray-300">{c}</span>
                            )) : <span className="text-[11px] text-gray-300 dark:text-gray-700">—</span>}
                          </div>
                        </div>
                        <div className="flex items-start gap-2 flex-wrap">
                          <span className="text-[11px] text-gray-400 dark:text-gray-600 w-24 shrink-0 pt-0.5">รถ/รุ่น</span>
                          <div className="flex flex-wrap gap-1">
                            {vehicles.length > 0 ? vehicles.map((v) => {
                              const isType = v.startsWith("@type:")
                              const code   = isType ? v.slice(6) : v
                              return (
                                <span key={v} className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                                  isType ? "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300"
                                  : "bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 font-mono"
                                }`}>
                                  {isType ? `${labelOf(labels, "VEHICLE_TYPE", code)} (ทุกคัน)` : code}
                                </span>
                              )
                            }) : <span className="text-[11px] text-gray-300 dark:text-gray-700">—</span>}
                          </div>
                        </div>
                      </div>

                      {/* รูปที่แนบมากับคำขอ */}
                      <div className="flex items-start gap-2">
                        <span className="text-[11px] text-gray-400 dark:text-gray-600 w-24 shrink-0 pt-0.5">รูปภาพ</span>
                        {images.length > 0 ? (
                          <ImageThumbs images={images} max={6} />
                        ) : (
                          <span className="text-[11px] text-gray-300 dark:text-gray-700 pt-0.5">— ไม่มีรูปแนบ —</span>
                        )}
                      </div>

                      {/* Duplicate checker */}
                      <SimilarSkus row={row} labels={labels} />
                    </div>

                    {/* Right: action buttons */}
                    <div className="flex flex-col gap-2 shrink-0 pt-1">
                      <button
                        onClick={() => approve(row.SKU)}
                        disabled={acting === row.SKU}
                        className="flex items-center gap-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white px-4 py-2 text-xs font-semibold transition-colors disabled:opacity-50"
                      >
                        <CheckCircle size={13} />
                        อนุมัติ
                      </button>
                      <button
                        onClick={() => handleReject(row.SKU)}
                        disabled={acting === row.SKU}
                        className="flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 px-4 py-2 text-xs font-semibold transition-colors disabled:opacity-50"
                      >
                        <XCircle size={13} />
                        ปฏิเสธ
                      </button>
                      <Link
                        href={`/sku/${row.SKU}`}
                        className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 dark:border-white/10 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 px-4 py-2 text-xs font-medium transition-colors"
                      >
                        แก้ไข
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
