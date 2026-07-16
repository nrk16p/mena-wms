"use client"

import Link from "next/link"
import { useSession } from "next-auth/react"
import { useEffect, useState, Suspense } from "react"
import {
  PackageSearch, PlusCircle, Database, Car,
  GitCompare, Clock, Inbox,
  TrendingUp, Layers, Tag,
} from "lucide-react"
import { WelcomePopup } from "@/components/welcome-popup"
import { Mascot } from "@/components/mascot"

type Stats = {
  totalApproved: number
  totalPending:  number
  totalRejected: number
  byType:        Record<string, number>
  totalBrands:   number
  recentSkus:    { SKU: string; ชื่ออะไหล่_TH: string; ประเภทค่าใช้จ่าย: string; createdAt: string }[]
}

const TYPE_META: Record<string, { label: string; color: string; colorHex: string }> = {
  PRT: { label: "อะไหล่",       color: "text-[#1D4ED8] dark:text-blue-400",   colorHex: "#1D4ED8" },
  PM:  { label: "PM",           color: "text-[#15803D] dark:text-green-400",  colorHex: "#15803D" },
  LAB: { label: "ค่าแรง",       color: "text-[#A16207] dark:text-amber-400",  colorHex: "#A16207" },
  SVC: { label: "บริการ",       color: "text-[#C2410C] dark:text-orange-400", colorHex: "#C2410C" },
  CLN: { label: "สารเคมี",      color: "text-[#7C3AED] dark:text-violet-400", colorHex: "#7C3AED" },
  TRP: { label: "ขนส่ง",        color: "text-[#6B7C72] dark:text-gray-400",   colorHex: "#6B7C72" },
  ACC: { label: "อุปกรณ์เสริม", color: "text-red-600 dark:text-red-400",      colorHex: "#DC2626" },
}

const TYPE_COLOR_BADGE: Record<string, string> = {
  PRT: "bg-[#DBEAFE] text-[#1D4ED8] dark:bg-blue-500/15 dark:text-blue-300",
  PM:  "bg-[#DCFCE7] text-[#15803D] dark:bg-green-500/15 dark:text-green-300",
  LAB: "bg-[#FEF9C3] text-[#A16207] dark:bg-amber-500/15 dark:text-amber-300",
  SVC: "bg-[#FFEDD5] text-[#C2410C] dark:bg-orange-500/15 dark:text-orange-300",
  CLN: "bg-[#F3E8FF] text-[#7C3AED] dark:bg-violet-500/15 dark:text-violet-300",
  TRP: "bg-[#F1F5F9] text-[#6B7C72] dark:bg-white/5 dark:text-gray-400",
  ACC: "bg-[#FEE2E2] text-[#DC2626] dark:bg-red-500/15 dark:text-red-300",
}

const QUICK_LINKS = [
  { href: "/sku",                label: "ค้นหา SKU",        desc: "ดูอะไหล่ทั้งหมด",         icon: PackageSearch },
  { href: "/sku/new",            label: "เพิ่ม SKU ใหม่",   desc: "รหัสอัตโนมัติ",            icon: PlusCircle    },
  { href: "/sku/oe-search",      label: "OE Cross-Ref",     desc: "ค้นข้ามเบอร์อะไหล่",       icon: GitCompare    },
  { href: "/tire",               label: "ศูนย์จัดการยางรถ", desc: "ทุกคัน · ทุกสาขา",       icon: Database      },
  { href: "/vehicles",           label: "ยานพาหนะ",          desc: "ข้อมูลรถทั้งหมด",          icon: Car           },
  { href: "/codes/parts",        label: "แคตาล็อกอะไหล่",  desc: "L1 · L2 · L3",             icon: Layers        },
]

// ── Stat Card ──
function StatCard({
  icon,
  label,
  value,
  caption,
  pending,
  link,
  isAdmin,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  caption?: React.ReactNode
  pending?: boolean
  link?: string
  isAdmin?: boolean
}) {
  return (
    <div
      className={`bg-white dark:bg-[#151a10] rounded-[16px] p-[16px_18px] border ${
        pending ? "border-[#FBE7C4] dark:border-amber-500/20" : "border-[#EEF2F0] dark:border-white/[0.07]"
      }`}
      style={{ boxShadow: "0 2px 8px rgba(20,39,28,.04)" }}
    >
      <div className="flex items-center gap-[9px] mb-3">
        <div
          className={`w-8 h-8 rounded-[10px] flex items-center justify-center ${
            pending ? "bg-[#FDF3DD] dark:bg-amber-500/10 text-[#E8A317] dark:text-amber-400" : "bg-[#EAF6EE] dark:bg-[#1B8C4B]/10 text-[#1B8C4B] dark:text-[#1B8C4B]"
          }`}
        >
          {icon}
        </div>
        <span className="text-[12px] text-[#6B7C72] dark:text-[#9AA8A0]" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
          {label}
        </span>
      </div>
      <p
        className={`text-[28px] leading-none ${pending ? "text-[#E8A317] dark:text-amber-400" : "text-[#14271C] dark:text-white"}`}
        style={{ fontFamily: "'Mitr', sans-serif", fontWeight: 600 }}
      >
        {value}
      </p>
      <div className="mt-1 text-[11px] text-[#9AA8A0] dark:text-gray-500" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
        {pending && link && isAdmin ? (
          <Link href={link} className="text-[#E8A317] dark:text-amber-400 font-medium">ดูรายการ →</Link>
        ) : caption}
      </div>
    </div>
  )
}

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
  const greeting = hour < 12 ? "สวัสดีตอนเช้า" : hour < 17 ? "สวัสดีตอนบ่าย" : "สวัสดีตอนเย็น"
  const userName = session?.user?.name ?? "คุณ"

  const approvalRate = stats && (stats.totalApproved + stats.totalPending + stats.totalRejected) > 0
    ? Math.round(stats.totalApproved / (stats.totalApproved + stats.totalPending + stats.totalRejected) * 100)
    : null

  return (
    <div className="max-w-[1000px] mx-auto flex flex-col gap-4">
      <Suspense><WelcomePopup /></Suspense>

      {/* ── Hero greeting card ── */}
      <div
        className="flex items-center gap-5 bg-white dark:bg-[#151a10] rounded-[20px] p-[20px_24px] border border-[#EEF2F0] dark:border-white/[0.07]"
        style={{ boxShadow: "0 2px 8px rgba(20,39,28,.04)" }}
      >
        <Mascot size={88} wave bubble="สวัสดีครับ!" />
        <div className="flex-1">
          <h1
            className="text-[22px] text-[#14271C] dark:text-white leading-snug"
            style={{ fontFamily: "'Mitr', sans-serif", fontWeight: 500 }}
          >
            {greeting}, {userName}
          </h1>
          {stats && (
            <p className="text-[14px] text-[#6B7C72] dark:text-gray-400 mt-1" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
              {stats.totalPending > 0 && (
                <>มี <span className="text-[#E8A317] dark:text-amber-400 font-semibold">{stats.totalPending} SKU</span> รออนุมัติ · </>
              )}
              SKU ทั้งหมด {stats.totalApproved.toLocaleString()} รายการ
            </p>
          )}
        </div>
        {isAdmin && stats && stats.totalPending > 0 && (
          <Link
            href="/sku/pending"
            className="shrink-0 text-white text-[14px] rounded-[13px] px-[22px] py-3"
            style={{
              fontFamily: "'IBM Plex Sans Thai', sans-serif",
              fontWeight: 500,
              background: "#1B8C4B",
              boxShadow: "0 5px 12px -3px rgba(27,140,75,.5)",
            }}
          >
            ดูคำขอ
          </Link>
        )}
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-[14px]">
        <StatCard
          icon={<PackageSearch size={17} color="currentColor" />}
          label="SKU ทั้งหมด"
          value={loading ? "—" : stats!.totalApproved.toLocaleString()}
          caption="อนุมัติแล้ว"
        />
        <StatCard
          icon={<Clock size={17} color="currentColor" />}
          label="รออนุมัติ"
          value={loading ? "—" : stats!.totalPending}
          caption="รายการ"
          pending
          link="/sku/pending"
          isAdmin={isAdmin}
        />
        <StatCard
          icon={<Tag size={17} color="currentColor" />}
          label="ยี่ห้อ"
          value={loading ? "—" : stats?.totalBrands ?? 0}
          caption="Brand ที่มี SKU"
        />
        <StatCard
          icon={
            <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
              <path d="M3 8.5l3 3 7-7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          }
          label="อนุมัติ %"
          value={loading || approvalRate === null ? "—" : `${approvalRate}%`}
          caption="จากทุก submission"
        />
      </div>

      {/* ── SKU breakdown + Quick links ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-[14px]">

        {/* SKU breakdown */}
        <div
          className="lg:col-span-2 bg-white dark:bg-[#151a10] rounded-[16px] p-[18px_20px] border border-[#EEF2F0] dark:border-white/[0.07]"
          style={{ boxShadow: "0 2px 8px rgba(20,39,28,.04)" }}
        >
          <p
            className="text-[14px] text-[#14271C] dark:text-white mb-4"
            style={{ fontFamily: "'Mitr', sans-serif", fontWeight: 500 }}
          >
            SKU แยกตามประเภท
          </p>
          {loading ? (
            <div className="space-y-3">
              {[1,2,3,4].map((i) => (
                <div key={i} className="animate-pulse">
                  <div className="flex justify-between mb-1.5">
                    <div className="h-3 w-16 bg-[#F0F4F1] dark:bg-white/5 rounded" />
                    <div className="h-3 w-8 bg-[#F0F4F1] dark:bg-white/5 rounded" />
                  </div>
                  <div className="h-1.5 bg-[#F0F4F1] dark:bg-white/5 rounded-full" style={{ width: `${30 + i * 15}%` }} />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-[13px]">
              {Object.entries(stats!.byType)
                .filter(([, v]) => v > 0)
                .sort(([, a], [, b]) => b - a)
                .map(([type, count]) => {
                  const meta = TYPE_META[type]
                  const pct  = Math.round(count / maxType * 100)
                  return (
                    <Link key={type} href={`/sku?type=${type}`} className="block group">
                      <div className="flex justify-between mb-1.5">
                        <span className="text-[12px] text-[#4B5F54] dark:text-gray-400" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
                          <strong className={meta?.color} style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>{type}</strong>
                          {" "}{meta?.label}
                        </span>
                        <span className="text-[12px] font-semibold text-[#14271C] dark:text-white" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
                          {count.toLocaleString()}
                        </span>
                      </div>
                      <div className="h-[7px] rounded-[5px] bg-[#F0F4F1] dark:bg-white/10">
                        <div
                          className="h-[7px] rounded-[5px] bg-[#1B8C4B] transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </Link>
                  )
                })}
              {stats && Object.values(stats.byType).every((v) => v === 0) && (
                <p className="text-[12px] text-[#9AA8A0] dark:text-gray-500" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>ยังไม่มีข้อมูล</p>
              )}
            </div>
          )}
        </div>

        {/* Quick links */}
        <div
          className="lg:col-span-3 bg-white dark:bg-[#151a10] rounded-[16px] p-[18px_20px] border border-[#EEF2F0] dark:border-white/[0.07]"
          style={{ boxShadow: "0 2px 8px rgba(20,39,28,.04)" }}
        >
          <p
            className="text-[14px] text-[#14271C] dark:text-white mb-4"
            style={{ fontFamily: "'Mitr', sans-serif", fontWeight: 500 }}
          >
            เมนูหลัก
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-[11px]">
            {QUICK_LINKS.map((link) => {
              const Icon = link.icon
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="flex flex-col gap-[10px] rounded-[14px] p-[14px] transition-all duration-150 border border-[#EEF2F0] dark:border-white/[0.07] hover:border-[#CFE3D6] dark:hover:border-white/20 hover:shadow-[0_6px_16px_-10px_rgba(20,39,28,.25)] dark:hover:shadow-none"
                >
                  <div className="w-9 h-9 rounded-[11px] bg-[#EAF6EE] dark:bg-[#1B8C4B]/10 text-[#1B8C4B] flex items-center justify-center">
                    <Icon size={18} color="currentColor" />
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-[#14271C] dark:text-white leading-snug" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
                      {link.label}
                    </p>
                    <p className="text-[10.5px] text-[#9AA8A0] dark:text-gray-500 mt-0.5 leading-snug" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
                      {link.desc}
                    </p>
                  </div>
                </Link>
              )
            })}
            {/* รายการของฉัน */}
            <Link
              href="/sku/my-submissions"
              className="flex flex-col gap-[10px] rounded-[14px] p-[14px] transition-all duration-150 border border-[#EEF2F0] dark:border-white/[0.07] hover:border-[#CFE3D6] dark:hover:border-white/20 hover:shadow-[0_6px_16px_-10px_rgba(20,39,28,.25)] dark:hover:shadow-none"
            >
              <div className="w-9 h-9 rounded-[11px] bg-[#EAF6EE] dark:bg-[#1B8C4B]/10 text-[#1B8C4B] flex items-center justify-center">
                <Inbox size={18} color="currentColor" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-[#14271C] dark:text-white leading-snug" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
                  รายการของฉัน
                </p>
                <p className="text-[10.5px] text-[#9AA8A0] dark:text-gray-500 mt-0.5 leading-snug" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
                  รออนุมัติ / ถูกปฏิเสธ
                  {!loading && stats && stats.totalPending > 0 && (
                    <span className="ml-1 text-[#E8A317] dark:text-amber-400 font-semibold">· {stats.totalPending}</span>
                  )}
                </p>
              </div>
            </Link>
          </div>
        </div>
      </div>

      {/* ── Recent SKUs ── */}
      {!loading && stats && stats.recentSkus.length > 0 && (
        <div
          className="bg-white dark:bg-[#151a10] rounded-[16px] overflow-hidden border border-[#EEF2F0] dark:border-white/[0.07]"
          style={{ boxShadow: "0 2px 8px rgba(20,39,28,.04)" }}
        >
          <div className="flex items-center justify-between px-5 py-[14px] border-b border-[#F2F6F4] dark:border-white/[0.07]">
            <p
              className="text-[14px] text-[#14271C] dark:text-white"
              style={{ fontFamily: "'Mitr', sans-serif", fontWeight: 500 }}
            >
              SKU ล่าสุด
            </p>
            <Link
              href="/sku"
              className="text-[12px] font-medium text-[#1B8C4B] dark:text-[#1B8C4B]/90"
              style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}
            >
              ดูทั้งหมด →
            </Link>
          </div>
          <div>
            {stats.recentSkus.slice(0, 5).map((row, i) => {
              const badge = TYPE_COLOR_BADGE[row.ประเภทค่าใช้จ่าย] ?? "bg-[#F1F5F9] text-[#6B7C72] dark:bg-white/5 dark:text-gray-400"
              return (
                <Link
                  key={row.SKU}
                  href={`/sku/${row.SKU}`}
                  className={`flex items-center gap-3 px-5 py-3 transition-colors hover:bg-[#F7FBF8] dark:hover:bg-white/3 ${
                    i < 4 ? "border-b border-[#F4F7F5] dark:border-white/5" : ""
                  }`}
                >
                  <span
                    className={`shrink-0 text-[9.5px] font-bold rounded-[6px] px-[7px] py-[3px] ${badge}`}
                    style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}
                  >
                    {row.ประเภทค่าใช้จ่าย}
                  </span>
                  <span className="text-[11px] text-[#9AA8A0] dark:text-gray-500 shrink-0" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
                    {row.SKU}
                  </span>
                  <span className="flex-1 text-[13px] text-[#14271C] dark:text-white truncate" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
                    {row.ชื่ออะไหล่_TH}
                  </span>
                  <span className="text-[11px] text-[#9AA8A0] dark:text-gray-500 shrink-0" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
                    {new Date(row.createdAt).toLocaleDateString("th-TH", { day: "numeric", month: "short" })}
                  </span>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* ── SKU format footer ── */}
      <div
        className="bg-white dark:bg-[#151a10] rounded-[16px] px-5 py-4 border border-[#EEF2F0] dark:border-white/[0.07]"
        style={{ boxShadow: "0 2px 8px rgba(20,39,28,.04)" }}
      >
        <p
          className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#9AA8A0] dark:text-gray-500 mb-2"
          style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif", letterSpacing: "0.16em" }}
        >
          รูปแบบรหัส SKU
        </p>
        <code
          className="text-[15px] font-bold text-[#14271C] dark:text-white tracking-[0.02em]"
          style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}
        >
          [WH]-[TYPE]-[L1]-[L2]-[L3]-[SEQ]
        </code>
        <p className="text-[12px] text-[#6B7C72] dark:text-gray-400 mt-1.5" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
          ตัวอย่าง{" "}
          <code className="text-[#1B8C4B] dark:text-[#1B8C4B]/90 font-medium" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
            XX-PRT-TRN-CLT-DSC-0001
          </code>
          {" "}→ คลัง XX · อะไหล่ · ระบบส่งกำลัง · คลัทช์ · จานครัช · ลำดับ 1
        </p>
      </div>
    </div>
  )
}
