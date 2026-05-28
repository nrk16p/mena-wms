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
} from "lucide-react"
import { ThemeToggle } from "./theme-toggle"
import { ManualBook } from "./manual-book"

type NavItem  = { href: string; label: string; icon: React.ElementType; exact?: boolean }
type NavGroup = { label: string; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
    ],
  },
  {
    label: "Master SKU",
    items: [
      { href: "/sku",              label: "รายการ SKU",     icon: PackageSearch, exact: true },
      { href: "/sku/new",          label: "เพิ่ม SKU ใหม่", icon: PlusCircle },
      { href: "/sku/my-submissions", label: "รายการของฉัน", icon: Inbox },
    ],
  },
  {
    label: "Reference",
    items: [
      { href: "/codes/parts", label: "Parts Catalog",    icon: Layers },
      { href: "/vehicles",    label: "ยานพาหนะ",         icon: Car },
      { href: "/codes",       label: "Code Dictionary",  icon: Database, exact: true },
    ],
  },
]

// ── Sidebar ───────────────────────────────────────────────────────────
export function Sidebar() {
  const [collapsed, setCollapsed]   = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const pathname  = usePathname()
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "admin"

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
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label} className={gi > 0 ? "mt-1" : ""}>

            {/* Section label */}
            {!collapsed && (
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

            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon   = item.icon
                const active = isActive(item.href, item.exact)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    className={[
                      "relative flex items-center gap-2.5 rounded-xl text-[13px] font-semibold",
                      "transition-all duration-100 ease-out",
                      collapsed ? "h-10 w-10 mx-auto justify-center" : "h-9 px-2.5",
                      active
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
            </div>
          </div>
        ))}

        {/* ── Admin section ── */}
        {isAdmin && (
          <div className="mt-1">
            {!collapsed && (
              <p className="px-2 pb-1.5 pt-4 text-[9px] font-black uppercase tracking-[0.22em] text-amber-500 dark:text-amber-500/60">
                — Admin —
              </p>
            )}
            {collapsed && (
              <div className="my-2.5 mx-auto h-[2px] w-8 rounded-full bg-[#e2e8f0] dark:bg-white/10" />
            )}
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
          </div>
        )}
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
