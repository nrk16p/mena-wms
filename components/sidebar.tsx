"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState, useEffect } from "react"
import { useSession, signOut } from "next-auth/react"
import {
  PanelLeftClose,
  LayoutDashboard,
  PackageSearch,
  PlusCircle,
  Layers,
  Database,
  LogOut,
  Clock,
  Car,
  Inbox,
  GitCompare,
  ChevronDown,
  Disc3,
  MapPin,
  ClipboardCheck,
  TableProperties,
  Search,
  BookOpen,
  BarChart3,
  Wrench,
  Flag,
  Factory,
} from "lucide-react"
import { ThemeToggle } from "./theme-toggle"
import { ManualBook } from "./manual-book"

type NavItem  = {
  href: string
  label: string
  icon: React.ElementType
  exact?: boolean
  subheader?: boolean
  indent?: boolean
  adminOnly?: boolean
}
type NavGroup = { label: string; items: NavItem[]; collapsible?: boolean }

const NAV_GROUPS: NavGroup[] = [
  {
    label: "ภาพรวม",
    items: [
      { href: "/", label: "หน้าหลัก", icon: LayoutDashboard, exact: true },
      { href: "/atms-new-sku-report/baseline", label: "นิยามตัวชี้วัด",   icon: BookOpen,  exact: true },
    ],
  },
  {
    label: "จัดการ SKU",
    collapsible: true,
    items: [
      { href: "/procurement-search", label: "ค้นหาห่วงโซ่จัดซื้อ", icon: Search },
      { href: "/atms-new-sku-report",label: "SKU ใหม่ ATMS",      icon: BarChart3, exact: true },
      { href: "/sku",                label: "รายการ SKU",       icon: PackageSearch, exact: true },
      { href: "/sku/new",            label: "เพิ่ม SKU ใหม่",   icon: PlusCircle },
      { href: "/sku/my-submissions", label: "รายการของฉัน",     icon: Inbox },
      { href: "/sku/oe-search",      label: "ค้นหา OE",         icon: GitCompare },
      { href: "/sku/bulk-update",    label: "Bulk Update",       icon: TableProperties },
      { href: "/codes/parts",        label: "แคตาล็อกอะไหล่",  icon: Layers },
      { href: "/vehicles",           label: "ยานพาหนะ",         icon: Car },
      { href: "/codes",              label: "พจนานุกรมโค้ด",   icon: Database, exact: true },
    ],
  },
  {
    label: "จัดการยาง",
    collapsible: true,
    items: [
      { href: "/tire",                       label: "ศูนย์จัดการยางรถ", icon: ClipboardCheck, exact: true },
      { href: "/tire/master",                label: "สเปคยาง (Master)", icon: Database, exact: true },
      { href: "#stock",                      label: "สต็อกยาง",          icon: MapPin,  subheader: true },
      { href: "/tire/latkrabang/stock-tire", label: "ลาดกระบัง",         icon: Disc3,   indent: true },
      { href: "/tire/saraburi/stock-tire",   label: "สระบุรี",            icon: Disc3,   indent: true },
    ],
  },
  {
    label: "จัดการซ่อม",
    collapsible: true,
    items: [
      { href: "/repair-external",           label: "รถซ่อมอู่นอก", icon: Wrench, exact: true },
      { href: "/repair-external/completed",  label: "รถซ่อมเสร็จ",  icon: Flag },
      { href: "/garages",                    label: "จัดการอู่",     icon: Factory },
      { href: "/repair-external/guide",      label: "คู่มือการใช้งาน", icon: BookOpen },
    ],
  },
]

export function Sidebar() {
  const [collapsed, setCollapsed]       = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [groupOpen, setGroupOpen]       = useState<Record<string, boolean>>({})
  const pathname  = usePathname()
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "admin"

  useEffect(() => { setGroupOpen({}) }, [pathname])

  useEffect(() => {
    if (!isAdmin) return
    fetch("/api/sku?status=pending&limit=1")
      .then((r) => r.json())
      .then((d) => setPendingCount(d.total ?? 0))
      .catch(() => {})
  }, [isAdmin, pathname])

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href
    return pathname === href || pathname.startsWith(href + "/")
  }

  function isGroupOpen(group: NavGroup) {
    if (!group.collapsible) return true
    const manual = groupOpen[group.label]
    if (manual !== undefined) return manual
    return (
      group.items.some((i) => isActive(i.href, i.exact)) ||
      (group.label === "Master SKU" && isActive("/sku/pending"))
    )
  }

  const userInitial = session?.user?.name?.[0]?.toUpperCase() ?? "U"

  return (
    <aside className={[
      "relative flex h-screen flex-col shrink-0 select-none",
      "bg-white dark:bg-[#111714]",
      "border-r border-[#EEF2F0] dark:border-white/[0.07]",
      "transition-[width] duration-200 ease-out",
      collapsed ? "w-[60px]" : "w-64",
    ].join(" ")}>

      {/* ── Logo ── */}
      <div className={[
        "flex h-16 shrink-0 items-center gap-2.5",
        "border-b border-[#EEF2F0] dark:border-white/[0.07]",
        collapsed ? "justify-center px-0" : "px-4",
      ].join(" ")}>
        {collapsed ? (
          <button
            onClick={() => setCollapsed(false)}
            title="ขยาย Sidebar"
            className="flex h-9 w-9 items-center justify-center rounded-[11px] border border-[#EEF2F0] dark:border-white/10 hover:bg-[#F0FDF4] dark:hover:bg-white/5 transition-colors duration-100"
          >
            <svg width="26" height="26" viewBox="0 0 120 120" fill="none">
              <rect x="26" y="44" width="68" height="56" rx="11" fill="#ecca99"/>
              <path d="M30 50 L18 30 L46 40 Z" fill="#dab686"/>
              <path d="M90 50 L102 30 L74 40 Z" fill="#dab686"/>
              <path d="M26 60 H94" stroke="#d3a96f" strokeWidth="2.4"/>
              <rect x="45" y="80" width="30" height="13" rx="4" fill="#1B8C4B"/>
              <circle cx="48" cy="69" r="3.4" fill="#2b2b2b"/>
              <circle cx="72" cy="69" r="3.4" fill="#2b2b2b"/>
              <path d="M53 75 Q60 80 67 75" stroke="#2b2b2b" strokeWidth="2" strokeLinecap="round" fill="none"/>
            </svg>
          </button>
        ) : (
          <>
            <Link href="/" className="flex min-w-0 flex-1 items-center gap-2.5">
              <svg width="34" height="34" viewBox="0 0 120 120" fill="none" className="shrink-0">
                <rect x="26" y="44" width="68" height="56" rx="11" fill="#ecca99"/>
                <path d="M30 50 L18 30 L46 40 Z" fill="#dab686"/>
                <path d="M90 50 L102 30 L74 40 Z" fill="#dab686"/>
                <path d="M26 60 H94" stroke="#d3a96f" strokeWidth="2.4"/>
                <rect x="45" y="80" width="30" height="13" rx="4" fill="#1B8C4B"/>
                <circle cx="48" cy="69" r="3.4" fill="#2b2b2b"/>
                <circle cx="72" cy="69" r="3.4" fill="#2b2b2b"/>
                <path d="M53 75 Q60 80 67 75" stroke="#2b2b2b" strokeWidth="2" strokeLinecap="round" fill="none"/>
              </svg>
              <div className="min-w-0 leading-none">
                <p className="truncate text-[16px] text-[#14271C] dark:text-white leading-tight" style={{ fontFamily: "'Mitr', sans-serif", fontWeight: 600 }}>
                  Mena WMS
                </p>
                <p className="text-[10px] text-[#9AA8A0] tracking-[0.03em]" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
                  คลังอะไหล่ · ยาง
                </p>
              </div>
            </Link>
            <button
              onClick={() => setCollapsed(true)}
              title="ย่อ Sidebar"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[#9AA8A0] hover:bg-[#F0FDF4] hover:text-[#1B8C4B] dark:hover:bg-white/5 dark:hover:text-white transition-colors"
            >
              <PanelLeftClose size={13} />
            </button>
          </>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 overflow-y-auto px-3 py-3">
        {NAV_GROUPS.map((group, gi) => {
          const open = isGroupOpen(group)
          return (
            <div key={group.label} className={gi > 0 ? "mt-1" : ""}>

              {/* Section label (non-collapsible) */}
              {!collapsed && !group.collapsible && (
                <p className={[
                  "px-2.5 pb-1.5 text-[9px] font-bold uppercase tracking-[0.2em]",
                  "text-[#B3C0B8] dark:text-white/25",
                  gi > 0 ? "pt-4" : "pt-1",
                ].join(" ")}>
                  — {group.label} —
                </p>
              )}

              {/* Group header (collapsible) */}
              {!collapsed && group.collapsible && (
                <button
                  onClick={() => setGroupOpen((prev) => ({ ...prev, [group.label]: !open }))}
                  aria-expanded={open}
                  className={[
                    "relative flex w-full items-center gap-2 h-[38px] px-2.5 rounded-[11px] transition-colors duration-150",
                    gi > 0 ? "mt-3" : "mt-1",
                    "bg-[#F0FDF4] dark:bg-[#1B8C4B]/10",
                  ].join(" ")}
                >
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[18px] rounded-full bg-[#1B8C4B]" />
                  <span className="flex-1 text-left text-[11px] font-bold text-[#1B8C4B] dark:text-[#1B8C4B]/90" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
                    {group.label}
                  </span>
                  <span className={[
                    "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] bg-[#1B8C4B]",
                  ].join(" ")}>
                    <ChevronDown
                      size={10}
                      className={["text-white transition-transform duration-200", open ? "" : "-rotate-90"].join(" ")}
                    />
                  </span>
                </button>
              )}

              {collapsed && gi > 0 && (
                <div className="my-2.5 mx-auto h-[2px] w-8 rounded-full bg-[#EEF2F0] dark:bg-white/10" />
              )}

              <div className={["mt-0.5 space-y-px", !collapsed && !open ? "hidden" : ""].join(" ")}>
                {group.items.map((item) => {
                  const Icon = item.icon
                  if (item.adminOnly && !isAdmin) return null

                  if (item.subheader) {
                    if (collapsed) return null
                    return (
                      <p key={item.href} className="flex items-center gap-1.5 px-2.5 pt-2.5 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-[#9AA8A0] dark:text-gray-500" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
                        <Icon size={10} className="shrink-0" />
                        {item.label}
                      </p>
                    )
                  }

                  const active = isActive(item.href, item.exact)
                  const isAdminItem = item.adminOnly

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      className={[
                        "relative flex items-center gap-[11px] rounded-[11px] transition-all duration-100 ease-out",
                        collapsed ? "h-10 w-10 mx-auto justify-center" : item.indent ? "h-9 pl-7 pr-2.5" : "h-9 px-3",
                        isAdminItem
                          ? active
                            ? "bg-[#E8A317] text-[#14271C]"
                            : "bg-[#FFFBEB] dark:bg-amber-950/20 text-[#B07D12] dark:text-amber-400 hover:bg-amber-50"
                          : active
                            ? "bg-[#1B8C4B] text-white"
                            : "text-[#4B5F54] dark:text-gray-400 hover:bg-[#F0FDF4] dark:hover:bg-white/5 hover:text-[#0F6A3C] dark:hover:text-white",
                      ].join(" ")}
                      style={{ fontSize: item.indent ? 12.5 : 13, fontFamily: "'IBM Plex Sans Thai', sans-serif", fontWeight: 500 }}
                    >
                      <Icon size={item.indent ? 14 : 15} className="shrink-0" />
                      {!collapsed && <span className="truncate leading-none">{item.label}</span>}
                      {collapsed && active && (
                        <span className="absolute -right-1 top-1/2 -translate-y-1/2 h-4 w-1 rounded-full bg-white" />
                      )}
                    </Link>
                  )
                })}

                {/* รออนุมัติ SKU (admin only) */}
                {group.label === "จัดการ SKU" && isAdmin && (
                  <Link
                    href="/sku/pending"
                    title={collapsed ? "รออนุมัติ" : undefined}
                    className={[
                      "relative flex items-center gap-[11px] rounded-[11px] transition-all duration-100",
                      collapsed ? "h-10 w-10 mx-auto justify-center" : "h-9 px-3",
                      isActive("/sku/pending")
                        ? "bg-[#E8A317] text-[#14271C]"
                        : "bg-[#FFFBEB] dark:bg-amber-950/20 text-[#B07D12] dark:text-amber-400 hover:bg-amber-50",
                    ].join(" ")}
                    style={{ fontSize: 13, fontFamily: "'IBM Plex Sans Thai', sans-serif", fontWeight: 500 }}
                  >
                    <Clock size={15} className="shrink-0" />
                    {!collapsed && <span className="flex-1 truncate leading-none">รออนุมัติ SKU</span>}
                    {pendingCount > 0 && !collapsed && (
                      <span className="shrink-0 flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold text-white bg-[#E8A317] dark:bg-amber-500">
                        {pendingCount}
                      </span>
                    )}
                    {pendingCount > 0 && collapsed && (
                      <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-[#E8A317] ring-2 ring-white dark:ring-[#111714]" />
                    )}
                  </Link>
                )}
              </div>
            </div>
          )
        })}
      </nav>

      {/* ── Footer ── */}
      <div className={[
        "shrink-0 pt-2 pb-3 border-t border-[#EEF2F0] dark:border-white/[0.07]",
        collapsed ? "px-1.5" : "px-3",
      ].join(" ")}>
        <ThemeToggle collapsed={collapsed} />
        <ManualBook collapsed={collapsed} />

        {session?.user && (
          <div className={[
            "mt-1 flex items-center gap-2.5 rounded-[12px] py-2 px-2.5 bg-[#F6FAF7] dark:bg-white/5",
            collapsed ? "justify-center px-1" : "",
          ].join(" ")}>
            {session.user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.user.image}
                alt=""
                className="h-[30px] w-[30px] shrink-0 rounded-full object-cover"
              />
            ) : (
              <div
                className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-[#1B8C4B] text-[13px] font-bold text-white"
                style={{ fontFamily: "'Mitr', sans-serif" }}
              >
                {userInitial}
              </div>
            )}
            {!collapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-bold leading-snug text-[#14271C] dark:text-gray-200" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
                    {session.user.name}
                  </p>
                  <p className="truncate text-[10px] leading-none text-[#9AA8A0]" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
                    {session.user.email}
                  </p>
                </div>
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  title="ออกจากระบบ"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[#9AA8A0] hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/20 dark:hover:text-red-400 transition-colors"
                >
                  <LogOut size={13} />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
