"use client"

import Link from "next/link"
import { useSession } from "next-auth/react"
import { useEffect, useState, Suspense } from "react"
import {
  PackageSearch, PlusCircle, Database, Car,
  GitCompare, Clock, Inbox, CheckCircle,
  TrendingUp, Layers, Tag,
} from "lucide-react"
import { WelcomePopup } from "@/components/welcome-popup"

type Stats = {
  totalApproved: number
  totalPending:  number
  totalRejected: number
  byType:        Record<string, number>
  totalBrands:   number
  recentSkus:    { SKU: string; ชื่ออะไหล่_TH: string; ประเภทค่าใช้จ่าย: string; createdAt: string }[]
}

const TYPE_META: Record<string, { label: string; color: string; bar: string }> = {
  PRT: { label: "อะไหล่",        color: "text-blue-600 dark:text-blue-400",   bar: "bg-blue-500" },
  PM:  { label: "PM",            color: "text-green-600 dark:text-green-400", bar: "bg-green-500" },
  LAB: { label: "ค่าแรง",        color: "text-yellow-600 dark:text-yellow-400", bar: "bg-yellow-500" },
  SVC: { label: "บริการ",        color: "text-orange-600 dark:text-orange-400", bar: "bg-orange-500" },
  CLN: { label: "สารเคมี",       color: "text-purple-600 dark:text-purple-400", bar: "bg-purple-500" },
  TRP: { label: "ขนส่ง",         color: "text-gray-600 dark:text-gray-400",   bar: "bg-gray-500" },
  ACC: { label: "อุปกรณ์เสริม",  color: "text-red-600 dark:text-red-400",    bar: "bg-red-500" },
}

const TYPE_COLOR_BADGE: Record<string, string> = {
  PRT: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  PM:  "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  LAB: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  SVC: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  CLN: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  TRP: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  ACC: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
}

const QUICK_LINKS = [
  { href: "/sku",           label: "รายการ SKU",     desc: "ค้นหาและดูอะไหล่ทั้งหมด",          icon: PackageSearch, color: "bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400" },
  { href: "/sku/new",       label: "เพิ่ม SKU ใหม่", desc: "สร้าง SKU พร้อมรหัสอัตโนมัติ",      icon: PlusCircle,    color: "bg-green-50 dark:bg-green-950/50 text-green-600 dark:text-green-400" },
  { href: "/sku/oe-search", label: "OE Cross-Ref",   desc: "ค้นข้ามเบอร์อะไหล่ / OEM ref",      icon: GitCompare,    color: "bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400" },
  { href: "/vehicles",      label: "ยานพาหนะ",        desc: "ดูและจัดการข้อมูลรถทั้งหมด",        icon: Car,           color: "bg-orange-50 dark:bg-orange-950/50 text-orange-600 dark:text-orange-400" },
  { href: "/codes/parts",   label: "Parts Catalog",  desc: "โครงสร้าง L1 · L2 · L3 ทั้งหมด",    icon: Layers,        color: "bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400" },
  { href: "/codes",         label: "Code Dictionary", desc: "ดู code ยี่ห้อ หน่วย Grade ฯลฯ",   icon: Database,      color: "bg-gray-50 dark:bg-white/5 text-gray-600 dark:text-gray-400" },
]

export default function Home() {
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "admin"

  const [stats,   setStats]   = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const TYPES = ["PRT", "PM", "LAB", "SVC", "CLN", "TRP", "ACC"]
      const [
        approvedRes, pendingRes, rejectedRes, brandRes, recentRes,
        ...typeRess
      ] = await Promise.all([
        fetch("/api/sku?status=approved&limit=1"),
        fetch("/api/sku?status=pending&limit=1"),
        fetch("/api/sku?status=rejected&limit=1"),
        fetch("/api/sku?status=approved&distinct=brand"),
        fetch("/api/sku?status=approved&limit=6&page=1"),
        ...TYPES.map((t) => fetch(`/api/sku?status=approved&type=${t}&limit=1`)),
      ])

      const [approved, pending, rejected, brands, recent, ...typeCounts] = await Promise.all([
        approvedRes.json(), pendingRes.json(), rejectedRes.json(),
        brandRes.json(), recentRes.json(),
        ...typeRess.map((r) => r.json()),
      ])

      const byType: Record<string, number> = {}
      TYPES.forEach((t, i) => { byType[t] = typeCounts[i].total ?? 0 })

      setStats({
        totalApproved: approved.total ?? 0,
        totalPending:  pending.total  ?? 0,
        totalRejected: rejected.total ?? 0,
        byType,
        totalBrands:   Array.isArray(brands) ? brands.length : 0,
        recentSkus:    recent.items ?? [],
      })
      setLoading(false)
    }
    load().catch(() => setLoading(false))
  }, [])

  const maxType = stats ? Math.max(...Object.values(stats.byType), 1) : 1

  const hour = new Date().getHours()
  const greeting = hour < 12 ? "อรุณสวัสดิ์" : hour < 17 ? "สวัสดีตอนบ่าย" : "สวัสดีตอนเย็น"

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <Suspense><WelcomePopup /></Suspense>

      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-400 dark:text-gray-500">{greeting} 👋</p>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-0.5">
            {session?.user?.name ?? "Mena WMS"}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            ระบบจัดการข้อมูล Master SKU — Mena Transport
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-xs text-gray-400 dark:text-gray-600 mt-1">
          <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
          Live
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Total SKU */}
        <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
              <PackageSearch size={14} />
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400">SKU ทั้งหมด</span>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {loading ? "—" : stats!.totalApproved.toLocaleString()}
          </p>
          <p className="text-[11px] text-gray-400 dark:text-gray-600 mt-0.5">อนุมัติแล้ว</p>
        </div>

        {/* Pending */}
        <div className="rounded-xl border border-amber-200 dark:border-amber-800/30 bg-white dark:bg-[#0f1117] p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400">
              <Clock size={14} />
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400">รออนุมัติ</span>
          </div>
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
            {loading ? "—" : stats!.totalPending.toLocaleString()}
          </p>
          <p className="text-[11px] text-gray-400 dark:text-gray-600 mt-0.5">
            {isAdmin && stats && stats.totalPending > 0
              ? <Link href="/sku/pending" className="text-amber-500 hover:underline">ดูรายการ →</Link>
              : "รายการ"}
          </p>
        </div>

        {/* Brands */}
        <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400">
              <Tag size={14} />
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400">ยี่ห้อ</span>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {loading ? "—" : stats!.totalBrands.toLocaleString()}
          </p>
          <p className="text-[11px] text-gray-400 dark:text-gray-600 mt-0.5">Brand ที่มี SKU</p>
        </div>

        {/* Approved rate */}
        <div className="rounded-xl border border-green-200 dark:border-green-800/30 bg-white dark:bg-[#0f1117] p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-green-50 dark:bg-green-950/60 text-green-600 dark:text-green-400">
              <CheckCircle size={14} />
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400">อนุมัติ %</span>
          </div>
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">
            {loading || !stats ? "—" : (
              stats.totalApproved + stats.totalPending + stats.totalRejected === 0
                ? "—"
                : `${Math.round(stats.totalApproved / (stats.totalApproved + stats.totalPending + stats.totalRejected) * 100)}%`
            )}
          </p>
          <p className="text-[11px] text-gray-400 dark:text-gray-600 mt-0.5">จากทุก submission</p>
        </div>
      </div>

      {/* ── Body: breakdown + quick links ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* SKU breakdown by type */}
        <div className="lg:col-span-2 rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={14} className="text-gray-400" />
            <p className="text-sm font-semibold text-gray-900 dark:text-white">SKU แยกตามประเภท</p>
          </div>
          {loading ? (
            <div className="space-y-3">
              {[1,2,3,4].map((i) => (
                <div key={i} className="animate-pulse">
                  <div className="flex justify-between mb-1.5"><div className="h-3 w-16 bg-gray-200 dark:bg-white/8 rounded" /><div className="h-3 w-8 bg-gray-200 dark:bg-white/8 rounded" /></div>
                  <div className="h-1.5 bg-gray-100 dark:bg-white/5 rounded-full"><div className="h-1.5 bg-gray-200 dark:bg-white/10 rounded-full" style={{ width: `${30 + i * 15}%` }} /></div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(stats!.byType)
                .filter(([, v]) => v > 0)
                .sort(([, a], [, b]) => b - a)
                .map(([type, count]) => {
                  const meta = TYPE_META[type]
                  const pct  = Math.round(count / maxType * 100)
                  return (
                    <Link key={type} href={`/sku?type=${type}`} className="block group">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-[11px] font-bold font-mono ${meta?.color}`}>{type}</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">{meta?.label}</span>
                        </div>
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
                          {count.toLocaleString()}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100 dark:bg-white/5 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${meta?.bar}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </Link>
                  )
                })}
              {stats && Object.values(stats.byType).every((v) => v === 0) && (
                <p className="text-xs text-gray-400 dark:text-gray-600">ยังไม่มีข้อมูล</p>
              )}
            </div>
          )}
        </div>

        {/* Quick links */}
        <div className="lg:col-span-3 rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5">
          <div className="flex items-center gap-2 mb-4">
            <Layers size={14} className="text-gray-400" />
            <p className="text-sm font-semibold text-gray-900 dark:text-white">เมนูหลัก</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {QUICK_LINKS.map((link) => {
              const Icon = link.icon
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="flex flex-col gap-2 rounded-xl border border-gray-100 dark:border-white/6 p-3.5 hover:border-gray-300 dark:hover:border-white/15 hover:shadow-sm transition-all duration-150 group"
                >
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${link.color}`}>
                    <Icon size={16} />
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-gray-900 dark:text-white leading-snug group-hover:text-gray-700 dark:group-hover:text-gray-100">
                      {link.label}
                    </p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 leading-snug">{link.desc}</p>
                  </div>
                </Link>
              )
            })}
            {/* My submissions */}
            <Link
              href="/sku/my-submissions"
              className="flex flex-col gap-2 rounded-xl border border-gray-100 dark:border-white/6 p-3.5 hover:border-gray-300 dark:hover:border-white/15 hover:shadow-sm transition-all duration-150 group"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 dark:bg-teal-950/50 text-teal-600 dark:text-teal-400">
                <Inbox size={16} />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-gray-900 dark:text-white leading-snug">รายการของฉัน</p>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 leading-snug">
                  รออนุมัติ / ถูกปฏิเสธ
                  {!loading && stats && stats.totalPending > 0
                    ? <span className="ml-1 text-amber-500 font-semibold">· {stats.totalPending}</span>
                    : ""}
                </p>
              </div>
            </Link>
          </div>
        </div>
      </div>

      {/* ── Recent SKUs ── */}
      {!loading && stats && stats.recentSkus.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-white/6">
            <div className="flex items-center gap-2">
              <Clock size={13} className="text-gray-400" />
              <p className="text-sm font-semibold text-gray-900 dark:text-white">SKU ล่าสุด</p>
            </div>
            <Link href="/sku" className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors">
              ดูทั้งหมด →
            </Link>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-white/5">
            {stats.recentSkus.slice(0, 5).map((row) => (
              <Link
                key={row.SKU}
                href={`/sku/${row.SKU}`}
                className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 dark:hover:bg-white/3 transition-colors"
              >
                <span className={`shrink-0 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${TYPE_COLOR_BADGE[row.ประเภทค่าใช้จ่าย] ?? ""}`}>
                  {row.ประเภทค่าใช้จ่าย}
                </span>
                <span className="font-mono text-xs text-gray-500 dark:text-gray-400 shrink-0">{row.SKU}</span>
                <span className="flex-1 text-sm text-gray-900 dark:text-white truncate">{row.ชื่ออะไหล่_TH}</span>
                <span className="text-[11px] text-gray-400 dark:text-gray-600 shrink-0">
                  {new Date(row.createdAt).toLocaleDateString("th-TH", { day: "numeric", month: "short" })}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── SKU format footer ── */}
      <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] px-5 py-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-600 mb-2">SKU Format</p>
        <code className="text-sm font-mono text-gray-900 dark:text-white">[WH]-[TYPE]-[L1]-[L2]-[L3]-[SEQ]</code>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          ตัวอย่าง: <code className="font-mono">XX-PRT-TRN-CLT-DSC-0001</code> → คลัง XX · อะไหล่ · ระบบส่งกำลัง · คลัทช์ · จานครัช · ลำดับ 1
        </p>
      </div>
    </div>
  )
}
