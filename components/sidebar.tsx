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

type NavItem = { href: string; label: string; icon: React.ElementType; exact?: boolean }
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
      { href: "/sku", label: "รายการ SKU", icon: PackageSearch, exact: true },
      { href: "/sku/new", label: "เพิ่ม SKU ใหม่", icon: PlusCircle },
      { href: "/sku/my-submissions", label: "รายการของฉัน", icon: Inbox },
    ],
  },
  {
    label: "Reference",
    items: [
      { href: "/codes/parts", label: "Parts Catalog", icon: Layers },
      { href: "/vehicles", label: "ยานพาหนะ", icon: Car },
      { href: "/codes", label: "Code Dictionary", icon: Database, exact: true },
    ],
  },
]

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const pathname = usePathname()
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "admin"

  useEffect(() => {
    if (!isAdmin) return
    fetch("/api/sku?status=pending&limit=1")
      .then((r) => r.json())
      .then((d) => setPendingCount(d.total ?? 0))
      .catch(() => { })
  }, [isAdmin, pathname])

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href
    return pathname === href || pathname.startsWith(href + "/")
  }

  return (
    <aside
      className={`
        relative flex h-screen flex-col shrink-0 select-none
        bg-white dark:bg-[#0a0e14]
        shadow-[1px_0_0_0_#E2E8F0] dark:shadow-[1px_0_0_0_rgba(255,255,255,0.05)]
        transition-[width] duration-200 ease-out
        ${collapsed ? "w-15" : "w-62"}
      `}
    >
      {/* ── Logo ── */}
      <div className={`flex h-14 shrink-0 items-center gap-2.5 ${collapsed ? "justify-center px-0" : "px-3"}`}>
        {collapsed ? (
          <button
            onClick={() => setCollapsed(false)}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-[#0F6A3C] to-[#1B8C4B] shadow-sm hover:shadow-md hover:from-[#0d5e35] hover:to-[#167840] transition-all duration-150"
            title="ขยาย Sidebar"
          >
            <span className="text-[12px] font-black text-white tracking-tight">M</span>
          </button>
        ) : (
          <>
            <Link href="/" className="flex min-w-0 flex-1 items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-[#0F6A3C] to-[#1B8C4B] shadow-sm">
                <span className="text-[12px] font-black text-white tracking-tight">M</span>
              </div>
              <div className="min-w-0 leading-none">
                <p className="truncate text-[13px] font-bold tracking-tight text-[#1E293B] dark:text-white">
                  Mena WMS
                </p>
                <p className="mt-0.5 text-[10px] font-medium text-[#A5D6A7] dark:text-[#4CAF50]/50">
                  Warehouse · v1.0
                </p>
              </div>
            </Link>
            <button
              onClick={() => setCollapsed(true)}
              title="ย่อ Sidebar"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#64748B]/60 hover:bg-[#F4FBF5] hover:text-[#1B8C4B] dark:hover:bg-white/5 dark:hover:text-white transition-colors duration-150"
            >
              <PanelLeftClose size={14} />
            </button>
          </>
        )}
      </div>

      {/* ── Hairline ── */}
      <div className="mx-3 h-px bg-[#E2E8F0] dark:bg-white/5" />

      {/* ── Navigation ── */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label} className={gi > 0 ? "mt-1" : ""}>
            {/* Section label */}
            {!collapsed && (
              <p className={`px-2 pb-1 text-[9px] font-bold uppercase tracking-[0.2em] text-[#27802b] dark:text-[#27802b]/65 ${gi > 0 ? "pt-4" : "pt-1"}`}>
              ──  {group.label} ──
              </p>
            )}
            {collapsed && gi > 0 && (
              <div className="my-2 mx-auto h-px w-8 bg-[#E2E8F0] dark:bg-white/8" />
            )}

            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                const active = isActive(item.href, item.exact)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    className={`
                      relative flex items-center gap-2.5 rounded-xl text-[13px] font-medium
                      transition-all duration-150 ease-out
                      ${collapsed ? "h-10 w-10 mx-auto justify-center" : "h-9 px-2.5"}
                      ${active
                        ? "bg-[#1B8C4B] text-white shadow-sm shadow-[#1B8C4B]/25 dark:shadow-[#1B8C4B]/15"
                        : "text-[#64748B] dark:text-gray-400 hover:bg-[#F4FBF5] dark:hover:bg-white/5 hover:text-[#0F6A3C] dark:hover:text-white"
                      }
                    `}
                  >
                    <Icon size={15} className="shrink-0" />
                    {!collapsed && (
                      <span className="truncate leading-none">{item.label}</span>
                    )}
                    {collapsed && active && (
                      <span className="absolute -right-0.5 top-1/2 -translate-y-1/2 h-4.5 w-0.75 rounded-full bg-[#4CAF50]" />
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
              <p className="px-2 pb-1 pt-4 text-[9px] font-bold uppercase tracking-[0.2em] text-amber-600/80 dark:text-amber-500/60">
                Admin
              </p>
            )}
            {collapsed && (
              <div className="my-2 mx-auto h-px w-8 bg-[#E2E8F0] dark:bg-white/8" />
            )}
            <Link
              href="/sku/pending"
              title={collapsed ? "รออนุมัติ" : undefined}
              className={`
                relative flex items-center gap-2.5 rounded-xl text-[13px] font-medium
                transition-all duration-150
                ${collapsed ? "h-10 w-10 mx-auto justify-center" : "h-9 px-2.5"}
                ${isActive("/sku/pending")
                  ? "bg-amber-500 text-white shadow-sm shadow-amber-500/25"
                  : "text-amber-600/75 dark:text-amber-600/75 hover:bg-amber-50 dark:hover:bg-amber-950/20 hover:text-amber-700 dark:hover:text-amber-400"
                }
              `}
            >
              <Clock size={15} className="shrink-0" />
              {!collapsed && (
                <span className="flex-1 truncate leading-none">รออนุมัติ SKU</span>
              )}
              {pendingCount > 0 && !collapsed && (
                <span className={`
                  shrink-0 flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1
                  text-[10px] font-bold
                  ${isActive("/sku/pending") ? "bg-white/25 text-white" : "bg-amber-500 text-white"}
                `}>
                  {pendingCount}
                </span>
              )}
              {pendingCount > 0 && collapsed && (
                <span className="absolute -top-0.5 -right-0.5 h-1.75 w-1.75 rounded-full bg-amber-500 ring-[1.5px] ring-white dark:ring-[#0a0e14]" />
              )}
            </Link>
          </div>
        )}
      </nav>

      {/* ── Footer ── */}
      <div className={`shrink-0 pb-3 ${collapsed ? "px-1.5" : "px-2.5"}`}>
        <div className="mb-2 mx-0.5 h-px bg-[#E2E8F0] dark:bg-white/5" />

        <ThemeToggle collapsed={collapsed} />

        {/* Manual */}
        <ManualBook collapsed={collapsed} />

        {session?.user && (
          <div className={`
            mt-1 flex items-center gap-2.5 rounded-xl py-2 transition-colors duration-150
            hover:bg-[#F4FBF5] dark:hover:bg-white/5
            ${collapsed ? "justify-center px-0" : "px-2.5"}
          `}>
            {session.user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.user.image}
                alt=""
                className="h-7 w-7 shrink-0 rounded-full object-cover ring-2 ring-[#DFF3E3] dark:ring-white/10"
              />
            ) : (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-[#36573d] to-[#486649] dark:from-white/10 dark:to-white/5 text-[11px] font-bold text-[#1B8C4B] dark:text-gray-300">
                {session.user.name?.[0]?.toUpperCase() ?? "U"}
              </div>
            )}
            {!collapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold leading-none text-[#1E293B] dark:text-gray-200 mb-0.5">
                    {session.user.name}
                  </p>
                  <p className="truncate text-[10px] leading-none text-[#64748B] dark:text-gray-500">
                    {session.user.email}
                  </p>
                </div>
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  title="ออกจากระบบ"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[#64748B]/60 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/20 dark:hover:text-red-400 transition-colors"
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
