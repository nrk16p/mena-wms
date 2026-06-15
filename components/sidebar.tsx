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
  History,
  MapPin,
  ClipboardList,
  ClipboardCheck,
} from "lucide-react"
import { ThemeToggle } from "./theme-toggle"
import { ManualBook } from "./manual-book"

type NavItem  = {
  href: string
  label: string
  icon: React.ElementType
  exact?: boolean
  subheader?: boolean // non-clickable mini label (e.g. branch name)
  indent?: boolean    // indented link under a subheader
  adminOnly?: boolean // shown only to admins, amber styling
}
type NavGroup = { label: string; items: NavItem[]; collapsible?: boolean }

const NAV_GROUPS: NavGroup[] = [
  {
    label: "ภาพรวม",
    items: [
      { href: "/", label: "หน้าหลัก", icon: LayoutDashboard, exact: true },
    ],
  },
  {
    label: "จัดการ SKU",
    collapsible: true,
    items: [
      { href: "/sku",               label: "รายการ SKU",        icon: PackageSearch, exact: true },
      { href: "/sku/new",           label: "เพิ่ม SKU ใหม่",    icon: PlusCircle },
      { href: "/sku/my-submissions",label: "รายการของฉัน",      icon: Inbox },
      { href: "/sku/oe-search",     label: "ค้นหา OE",          icon: GitCompare },
      { href: "/codes/parts",       label: "แคตาล็อกอะไหล่",   icon: Layers },
      { href: "/vehicles",          label: "ยานพาหนะ",          icon: Car },
      { href: "/codes",             label: "พจนานุกรมโค้ด",    icon: Database, exact: true },
    ],
  },
  {
    label: "จัดการยาง",
    collapsible: true,
    items: [
      { href: "#latkrabang",                         label: "ลาดกระบัง",           icon: MapPin, subheader: true },
      { href: "/tire/latkrabang/stock-tire",         label: "สต็อกยาง",            icon: Disc3,         indent: true },
      { href: "/tire/latkrabang/change-history",     label: "ประวัติการเปลี่ยน",   icon: History,       indent: true },
      { href: "/tire/latkrabang/change-tire-request",label: "คำขอเปลี่ยนยาง",     icon: ClipboardList, indent: true },
      { href: "/tire/latkrabang/requests",           label: "อนุมัติเปลี่ยนยาง",  icon: ClipboardCheck,indent: true, adminOnly: true },
      { href: "#saraburi",                           label: "สระบุรี",              icon: MapPin, subheader: true },
      { href: "/tire/saraburi/stock-tire",           label: "สต็อกยาง",            icon: Disc3,         indent: true },
      { href: "/tire/saraburi/change-history",       label: "ประวัติการเปลี่ยน",   icon: History,       indent: true },
      { href: "/tire/saraburi/change-tire-request",  label: "คำขอเปลี่ยนยาง",     icon: ClipboardList, indent: true },
      { href: "/tire/saraburi/requests",             label: "อนุมัติเปลี่ยนยาง",  icon: ClipboardCheck,indent: true, adminOnly: true },
    ],
  },
]
// ── Sidebar ───────────────────────────────────────────────────────────
export function Sidebar() {
  const [collapsed, setCollapsed]   = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({})
  const pathname  = usePathname()
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "admin"

  // reset manual toggles on navigation so groups auto-open/auto-hide per route
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
    // auto-open when the current route lives inside this group
    return (
      group.items.some((i) => isActive(i.href, i.exact)) ||
      (group.label === "Master SKU" && isActive("/sku/pending"))
    )
  }

  return (
    <aside className={[
      "relative flex h-screen flex-col shrink-0 select-none",
      "bg-white dark:bg-[#0a0e14]",
      "border-r border-[#e2e8f0] dark:border-white/[0.07]",
      "transition-[width] duration-200 ease-out",
      collapsed ? "w-[60px]" : "w-64",
    ].join(" ")}>

      {/* ── Logo ── */}
      <div className={[
        "flex h-16 shrink-0 items-center gap-3",
        "border-b border-[#e2e8f0] dark:border-white/[0.07]",
        collapsed ? "justify-center px-0" : "px-4",
      ].join(" ")}>
        {collapsed ? (
          <button
            onClick={() => setCollapsed(false)}
            title="ขยาย Sidebar"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#e2e8f0] dark:border-white/10 hover:bg-[#f0fdf4] dark:hover:bg-white/5 transition-colors duration-100 overflow-hidden bg-white dark:bg-[#0a0e14]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/favicon.ico" alt="Mena WMS" className="h-8 w-8 object-contain" />
          </button>
        ) : (
          <>
            <Link href="/" className="flex min-w-0 flex-1 items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/favicon.ico" alt="Mena WMS" className="h-8 w-8 shrink-0 object-contain" />
              <div className="min-w-0 leading-none">
                <p className="truncate text-[15px] font-black tracking-tight text-[#1a1a2e] dark:text-white">
                  Mena WMS
                </p>
              </div>
            </Link>
            <button
              onClick={() => setCollapsed(true)}
              title="ย่อ Sidebar"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#94a3b8] hover:bg-[#f0fdf4] hover:text-[#1B8C4B] dark:hover:bg-white/5 dark:hover:text-white transition-colors"
            >
              <PanelLeftClose size={14} />
            </button>
          </>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3">
        {NAV_GROUPS.map((group, gi) => {
          const open = isGroupOpen(group)
          return (
          <div key={group.label} className={gi > 0 ? "mt-1" : ""}>

            {/* Section label */}
            {!collapsed && group.collapsible && (
              <button
                onClick={() => setGroupOpen((prev) => ({ ...prev, [group.label]: !open }))}
                aria-expanded={open}
                className={[
                  "group/header relative flex w-full items-center gap-2 rounded-xl py-2 pl-3 pr-2",
                  gi > 0 ? "mt-3" : "mt-0.5",
                  "transition-colors duration-150",
                  open
                    ? "bg-[#f0fdf4] dark:bg-[#1B8C4B]/10"
                    : "hover:bg-[#f0fdf4] dark:hover:bg-white/5",
                ].join(" ")}
              >
                {/* left accent bar */}
                <span
                  className={[
                    "absolute left-0 top-1/2 -translate-y-1/2 w-0.75 rounded-full bg-[#1B8C4B] transition-all duration-200",
                    open ? "h-5 opacity-100" : "h-2 opacity-40 group-hover/header:opacity-70",
                  ].join(" ")}
                />
                <span className="flex-1 text-left text-[11px] font-bold tracking-tight text-[#1B8C4B] dark:text-[#1B8C4B]/90">
                  {group.label}
                </span>
                <span
                  className={[
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors duration-150",
                    open
                      ? "bg-[#1B8C4B] text-white"
                      : "bg-[#1B8C4B]/10 text-[#1B8C4B] group-hover/header:bg-[#1B8C4B]/20",
                  ].join(" ")}
                >
                  <ChevronDown
                    size={12}
                    className={["transition-transform duration-200", open ? "" : "-rotate-90"].join(" ")}
                  />
                </span>
              </button>
            )}
            {!collapsed && !group.collapsible && (
              <p className={[
                "px-2 pb-1.5 text-[9px] font-black uppercase tracking-[0.22em]",
                "text-[#1B8C4B] dark:text-[#1B8C4B]/60",
                gi > 0 ? "pt-4" : "pt-1",
              ].join(" ")}>
                — {group.label} —
              </p>
            )}
            {collapsed && gi > 0 && (
              <div className="my-2.5 mx-auto h-[2px] w-8 rounded-full bg-[#e2e8f0] dark:bg-white/10" />
            )}

            <div className={["space-y-1", !collapsed && !open ? "hidden" : ""].join(" ")}>
              {group.items.map((item) => {
                const Icon   = item.icon
                if (item.adminOnly && !isAdmin) return null
                if (item.subheader) {
                  if (collapsed) return null
                  return (
                    <p key={item.href} className="flex items-center gap-1.5 px-2 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-[#94a3b8] dark:text-gray-500">
                      <Icon size={10} className="shrink-0" />
                      {item.label}
                    </p>
                  )
                }
                const active = isActive(item.href, item.exact)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    className={[
                      "relative flex items-center gap-2.5 rounded-xl text-[13px] font-semibold",
                      "transition-all duration-100 ease-out",
                      collapsed ? "h-10 w-10 mx-auto justify-center" : item.indent ? "h-9 pl-7 pr-2.5" : "h-9 px-2.5",
                      item.adminOnly
                        ? active
                          ? "bg-amber-400 text-[#1a1a2e] font-bold"
                          : "text-amber-600/80 dark:text-amber-500/70 hover:bg-amber-50 dark:hover:bg-amber-950/20 hover:text-amber-700"
                        : active
                          ? "bg-[#1B8C4B] text-white font-bold"
                          : "text-[#4b5563] dark:text-gray-400 hover:bg-[#f0fdf4] dark:hover:bg-white/5 hover:text-[#0F6A3C] dark:hover:text-white",
                    ].join(" ")}
                  >
                    <Icon size={15} className="shrink-0" />
                    {!collapsed && <span className="truncate leading-none">{item.label}</span>}
                    {/* active dot when collapsed */}
                    {collapsed && active && (
                      <span className="absolute -right-1 top-1/2 -translate-y-1/2 h-4 w-1 rounded-full bg-white" />
                    )}
                  </Link>
                )
              })}

              {/* ── Admin link (admin only, part of the Master SKU group) ── */}
              {group.label === "Master SKU" && isAdmin && (
            <Link
              href="/sku/pending"
              title={collapsed ? "รออนุมัติ" : undefined}
              className={[
                "relative flex items-center gap-2.5 rounded-xl text-[13px] font-semibold",
                "transition-all duration-100",
                collapsed ? "h-10 w-10 mx-auto justify-center" : "h-9 px-2.5",
                isActive("/sku/pending")
                  ? "bg-amber-400 text-[#1a1a2e] font-bold"
                  : "text-amber-600/80 dark:text-amber-500/70 hover:bg-amber-50 dark:hover:bg-amber-950/20 hover:text-amber-700",
              ].join(" ")}
            >
              <Clock size={15} className="shrink-0" />
              {!collapsed && <span className="flex-1 truncate leading-none">รออนุมัติ SKU</span>}
              {pendingCount > 0 && !collapsed && (
                <span className={[
                  "shrink-0 flex h-5 min-w-5 items-center justify-center rounded-full px-1",
                  "text-[10px] font-black",
                  isActive("/sku/pending") ? "bg-white text-amber-600" : "bg-amber-400 text-[#1a1a2e]",
                ].join(" ")}>
                  {pendingCount}
                </span>
              )}
              {pendingCount > 0 && collapsed && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-white dark:ring-[#0a0e14]" />
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
        "shrink-0 pt-2 pb-3",
        "border-t border-[#e2e8f0] dark:border-white/[0.07]",
        collapsed ? "px-1.5" : "px-2.5",
      ].join(" ")}>

        <ThemeToggle collapsed={collapsed} />
        <ManualBook collapsed={collapsed} />

        {session?.user && (
          <div className={[
            "mt-1 flex items-center gap-2.5 rounded-xl py-2 transition-colors",
            "hover:bg-[#f0fdf4] dark:hover:bg-white/5",
            collapsed ? "justify-center px-0" : "px-2.5",
          ].join(" ")}>
            {session.user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.user.image}
                alt=""
                className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-[#e2e8f0] dark:ring-white/15"
              />
            ) : (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1B8C4B] text-[11px] font-black text-white">
                {session.user.name?.[0]?.toUpperCase() ?? "U"}
              </div>
            )}
            {!collapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-bold leading-none text-[#1E293B] dark:text-gray-200 mb-0.5">
                    {session.user.name}
                  </p>
                  <p className="truncate text-[10px] leading-none text-[#64748B] dark:text-gray-500">
                    {session.user.email}
                  </p>
                </div>
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  title="ออกจากระบบ"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[#94a3b8] hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/20 dark:hover:text-red-400 transition-colors"
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
