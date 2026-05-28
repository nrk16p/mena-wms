"use client"

import { Bell, Settings, CheckCircle, XCircle, Clock, ArrowRight, LogOut, CalendarDays } from "lucide-react"
import { useState, useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import { useSession, signOut } from "next-auth/react"
import Link from "next/link"

// ── Thai live clock ──────────────────────────────────────────────────────────
function useThaiBangkokClock() {
  const [display, setDisplay] = useState({ date: "", time: "" })

  useEffect(() => {
    function tick() {
      const now = new Date()
      const date = now.toLocaleDateString("th-TH", {
        timeZone: "Asia/Bangkok",
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      })
      const time = now.toLocaleTimeString("th-TH", {
        timeZone: "Asia/Bangkok",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
      setDisplay({ date, time })
    }
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [])

  return display
}

// ── Relative time ────────────────────────────────────────────────────────────
function relativeTime(iso?: string): string {
  if (!iso) return ""
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return "เมื่อกี้"
  if (m < 60) return `${m} นาทีที่แล้ว`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ชม. ที่แล้ว`
  return `${Math.floor(h / 24)} วันที่แล้ว`
}

type SkuItem = {
  _id: string
  SKU?: string
  "ชื่ออะไหล่_TH"?: string
  status?: string
  createdAt?: string
  updatedAt?: string
}

// ── Settings / profile dropdown ──────────────────────────────────────────────
function SettingsMenu({ session }: { session: ReturnType<typeof useSession>["data"] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function outside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", outside)
    return () => document.removeEventListener("mousedown", outside)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className={[
          "relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
          open
            ? "bg-[#f0fdf4] text-[#1B8C4B] dark:bg-white/5 dark:text-white"
            : "text-[#94a3b8] hover:bg-[#f0fdf4] hover:text-[#1B8C4B] dark:hover:bg-white/5 dark:hover:text-white",
        ].join(" ")}
        title="ตั้งค่า / โปรไฟล์"
      >
        <Settings size={16} />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] w-60 rounded-xl border border-[#e2e8f0] dark:border-white/10 bg-white dark:bg-[#0f1117] shadow-xl z-50 overflow-hidden">
          {/* User info */}
          <div className="flex items-center gap-3 px-4 py-3.5">
            {session?.user?.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.user.image}
                alt=""
                className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-[#e2e8f0] dark:ring-white/15"
              />
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1B8C4B] text-[13px] font-black text-white">
                {session?.user?.name?.[0]?.toUpperCase() ?? "U"}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-bold leading-none text-[#1a1a2e] dark:text-white mb-1">
                {session?.user?.name ?? "—"}
              </p>
              <p className="truncate text-[11px] leading-none text-[#94a3b8]">
                {session?.user?.email ?? "—"}
              </p>
            </div>
          </div>

          {/* Role badge */}
          {session?.user?.role && (
            <div className="px-4 pb-3">
              <span className={[
                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest",
                session.user.role === "admin"
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                  : "bg-[#f0fdf4] text-[#1B8C4B] dark:bg-[#1B8C4B]/10 dark:text-[#1B8C4B]",
              ].join(" ")}>
                {session.user.role}
              </span>
            </div>
          )}

          <div className="border-t border-[#e2e8f0] dark:border-white/[0.07]" />

          {/* Sign out */}
          <button
            onClick={() => { setOpen(false); signOut({ callbackUrl: "/login" }) }}
            className="flex w-full items-center gap-2.5 px-4 py-3 text-[12px] font-semibold text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
          >
            <LogOut size={13} />
            ออกจากระบบ
          </button>
        </div>
      )}
    </div>
  )
}

// ── Notification bell ────────────────────────────────────────────────────────
function NotifBell({ session, isAdmin }: {
  session: ReturnType<typeof useSession>["data"]
  isAdmin: boolean
}) {
  const [open, setOpen] = useState(false)
  const [notifs, setNotifs] = useState<SkuItem[]>([])
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const pathname = usePathname()

  useEffect(() => {
    if (!session?.user) return
    setLoading(true)
    if (isAdmin) {
      fetch("/api/sku?status=pending&limit=6")
        .then(r => r.json())
        .then(d => setNotifs(d.items ?? []))
        .catch(() => { })
        .finally(() => setLoading(false))
    } else {
      const email = encodeURIComponent(session.user.email ?? "")
      Promise.all([
        fetch(`/api/sku?status=approved&createdBy=${email}&limit=5`).then(r => r.json()),
        fetch(`/api/sku?status=rejected&createdBy=${email}&limit=5`).then(r => r.json()),
      ])
        .then(([approved, rejected]) => {
          const combined: SkuItem[] = [
            ...(approved.items ?? []),
            ...(rejected.items ?? []),
          ]
          combined.sort((a, b) =>
            new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
          )
          setNotifs(combined.slice(0, 6))
        })
        .catch(() => { })
        .finally(() => setLoading(false))
    }
  }, [session, isAdmin, pathname])

  useEffect(() => {
    function outside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", outside)
    return () => document.removeEventListener("mousedown", outside)
  }, [])

  const count = notifs.length

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className={[
          "relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
          open
            ? "bg-[#f0fdf4] text-[#1B8C4B] dark:bg-white/5 dark:text-white"
            : "text-[#94a3b8] hover:bg-[#f0fdf4] hover:text-[#1B8C4B] dark:hover:bg-white/5 dark:hover:text-white",
        ].join(" ")}
        title="การแจ้งเตือน"
      >
        <Bell size={16} />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-3.75 min-w-3.75 items-center justify-center rounded-full bg-[#1B8C4B] px-0.5 text-[8px] font-black text-white ring-[1.5px] ring-white dark:ring-[#0a0e14]">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] w-80 rounded-xl border border-[#e2e8f0] dark:border-white/10 bg-white dark:bg-[#0f1117] shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#e2e8f0] dark:border-white/[0.07]">
            <span className="text-[13px] font-semibold text-[#1a1a2e] dark:text-white">
              {isAdmin ? "รออนุมัติ" : "สถานะ SKU ของฉัน"}
            </span>
            {count > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#1B8C4B]/10 px-1.5 text-[10px] font-black text-[#1B8C4B]">
                {count}
              </span>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <span className="text-[12px] text-[#94a3b8]">กำลังโหลด…</span>
            </div>
          ) : notifs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-[#94a3b8]">
              <Bell size={22} strokeWidth={1.5} />
              <p className="text-[12px]">ไม่มีการแจ้งเตือน</p>
            </div>
          ) : (
            <div className="divide-y divide-[#e2e8f0] dark:divide-white/5 max-h-72 overflow-y-auto">
              {notifs.map(item => (
                <div key={item._id} className="flex items-start gap-3 px-4 py-3 hover:bg-[#f8fafc] dark:hover:bg-white/3 transition-colors">
                  <div className="mt-0.5 shrink-0">
                    {item.status === "approved" && <CheckCircle size={14} className="text-[#1B8C4B]" />}
                    {item.status === "rejected" && <XCircle size={14} className="text-red-500" />}
                    {item.status === "pending" && <Clock size={14} className="text-amber-500" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold text-[#1a1a2e] dark:text-white truncate leading-snug">
                      {item["ชื่ออะไหล่_TH"] || item.SKU || "—"}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      {item.SKU && (
                        <span className="text-[10px] text-[#94a3b8] font-mono">{item.SKU}</span>
                      )}
                      {item.SKU && <span className="text-[#d1d5db]">·</span>}
                      <span className="text-[10px] text-[#94a3b8]">
                        {item.status === "pending" && "รอการอนุมัติ"}
                        {item.status === "approved" && "อนุมัติแล้ว"}
                        {item.status === "rejected" && "ถูกปฏิเสธ"}
                      </span>
                      {(item.updatedAt || item.createdAt) && (
                        <>
                          <span className="text-[#d1d5db]">·</span>
                          <span className="text-[10px] text-[#b0b8c8]">
                            {relativeTime(item.updatedAt ?? item.createdAt)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {notifs.length > 0 && (
            <div className="border-t border-[#e2e8f0] dark:border-white/[0.07]">
              <Link
                href={isAdmin ? "/sku/pending" : "/sku/my-submissions"}
                onClick={() => setOpen(false)}
                className="flex items-center justify-center gap-1.5 py-2.5 text-[12px] font-semibold text-[#1B8C4B] hover:bg-[#f0fdf4] dark:hover:bg-white/3 transition-colors"
              >
                ดูรายการทั้งหมด <ArrowRight size={12} />
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Navbar ────────────────────────────────────────────────────────────────────
export function Navbar() {
  const { date, time } = useThaiBangkokClock()
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "admin"

  return (
    <header className="h-16 shrink-0 flex items-center justify-between px-6 bg-white dark:bg-[#0a0e14] border-b border-[#e2e8f0] dark:border-white/[0.07]">

      {/* Left — live clock */}
      <div className="flex items-center gap-2.5 select-none">
        <div className="flex items-center gap-1.5">
          <CalendarDays size={11} strokeWidth={1.8} className="text-[#94a3b8] dark:text-gray-600" />
          <span className="text-[14px] font-medium text-[#94a3b8] dark:text-gray-500">{date}</span>
        </div>
        <span className="h-3 w-px bg-[#e2e8f0] dark:bg-white/10" />
        <div className="flex items-center dark:bg-[#1B8C4B]/10">
          <span className="text-[14px] font-black tabular-nums text-[#1a1a2e] dark:text-white">{time} น.</span>
        </div>
      </div>

      {/* Right — settings + bell */}
      <div className="flex items-center gap-1">
        <SettingsMenu session={session} />
        <div className="mx-1 h-4 w-px bg-[#e2e8f0] dark:bg-white/10" />
        <NotifBell session={session} isAdmin={isAdmin} />
      </div>

    </header>
  )
}
