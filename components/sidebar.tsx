"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import { useSession, signOut } from "next-auth/react"
import {
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  PackageSearch,
  PlusCircle,
  Tags,
  BarChart3,
  Layers,
  Database,
  LogOut,
} from "lucide-react"
import { ThemeToggle } from "./theme-toggle"

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
      { href: "/sku", label: "รายการ SKU", icon: PackageSearch },
      { href: "/sku/new", label: "เพิ่ม SKU ใหม่", icon: PlusCircle },
    ],
  },
  {
    label: "Reference",
    items: [
      { href: "/codes/parts", label: "Parts Catalog", icon: Layers },
      { href: "/codes", label: "Code Dictionary", icon: Database },
      { href: "/stats", label: "สถิติ", icon: BarChart3 },
    ],
  },
]

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname()
  const { data: session } = useSession()

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href
    return pathname.startsWith(href)
  }

  return (
    <aside
      className={`
        relative flex h-screen flex-col shrink-0
        border-r border-gray-200 dark:border-white/8
        bg-white dark:bg-[#0f1117]
        transition-all duration-300 ease-in-out
        ${collapsed ? "w-[56px]" : "w-[224px]"}
      `}
    >
      <div className={`flex h-14 items-center border-b border-gray-200 dark:border-white/8 ${collapsed ? "justify-center px-0" : "justify-between px-4"}`}>
        {!collapsed ? (
          <>
            <Link href="/" className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-gray-800 to-gray-950 dark:from-white dark:to-gray-300 text-white dark:text-gray-900 text-xs font-bold shadow-sm">
                S
              </div>
              <div className="leading-tight">
                <p className="text-[13px] font-semibold tracking-tight text-gray-900 dark:text-white">Mena WMS</p>
                <p className="text-[10px] text-gray-400 dark:text-gray-500">Warehouse Management</p>
              </div>
            </Link>
            <button
              onClick={() => setCollapsed(true)}
              className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-white/8 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
          </>
        ) : (
          <button onClick={() => setCollapsed(false)} className="group flex flex-col items-center gap-0.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-gray-800 to-gray-950 dark:from-white dark:to-gray-300 text-white dark:text-gray-900 text-xs font-bold shadow-sm">
              S
            </div>
            <ChevronRight size={10} className="text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300" />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-5">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            {!collapsed && (
              <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-600">
                {group.label}
              </p>
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
                      group relative flex items-center gap-2.5 rounded-lg py-2 text-[13px] font-medium transition-all duration-150
                      ${collapsed ? "justify-center px-0" : "px-2.5"}
                      ${active
                        ? "bg-gray-950 dark:bg-white text-white dark:text-gray-900"
                        : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/6 hover:text-gray-900 dark:hover:text-white"
                      }
                    `}
                  >
                    <Icon size={15} className="shrink-0" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-gray-200 dark:border-white/8 px-2 py-3 space-y-1">
        <ThemeToggle collapsed={collapsed} />

        {/* User info + sign out */}
        {session?.user && (
          <div className={`flex items-center gap-2 rounded-lg px-2 py-2 ${collapsed ? "justify-center" : ""}`}>
            {session.user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={session.user.image} alt="" className="h-6 w-6 rounded-full shrink-0 ring-1 ring-gray-200 dark:ring-white/10" />
            ) : (
              <div className="h-6 w-6 rounded-full bg-gray-200 dark:bg-white/10 shrink-0 flex items-center justify-center text-[10px] font-semibold text-gray-600 dark:text-gray-300">
                {session.user.name?.[0]?.toUpperCase() ?? "U"}
              </div>
            )}
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-gray-700 dark:text-gray-300 truncate">{session.user.name}</p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-600 truncate">{session.user.email}</p>
                </div>
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  title="ออกจากระบบ"
                  className="shrink-0 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                >
                  <LogOut size={13} />
                </button>
              </>
            )}
          </div>
        )}

        {!collapsed && (
          <p className="px-2.5 pt-1 text-[10px] text-gray-400 dark:text-gray-600">
            Mena Transport · WMS v1.0
          </p>
        )}
      </div>
    </aside>
  )
}
