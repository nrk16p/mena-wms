"use client"

import { Bell, Settings, CheckCircle, XCircle, Clock, ArrowRight, LogOut } from "lucide-react"
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
          "relative flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border border-[#EEF2F0] transition-colors duration-100",
          open
            ? "bg-[#F0FDF4] text-[#1B8C4B] border-[#D6EBD9]"
            : "bg-white text-[#5B7568] hover:bg-[#F0FDF4] hover:text-[#1B8C4B] dark:bg-[#111714] dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5",
        ].join(" ")}
        title="ตั้งค่า / โปรไฟล์"
      >
        <Settings size={15} />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] w-60 rounded-[16px] border border-[#EEF2F0] dark:border-white/10 bg-white dark:bg-[#111714] shadow-xl z-50 overflow-hidden">
          {/* User info */}
          <div className="flex items-center gap-3 px-4 py-3.5">
            {session?.user?.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.user.image}
                alt=""
                className="h-9 w-9 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1B8C4B] text-[13px] font-bold text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>
                {session?.user?.name?.[0]?.toUpperCase() ?? "U"}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-bold leading-none text-[#14271C] dark:text-white mb-1" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
                {session?.user?.name ?? "—"}
              </p>
              <p className="truncate text-[11px] leading-none text-[#9AA8A0]" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
                {session?.user?.email ?? "—"}
              </p>
            </div>
          </div>

          {session?.user?.role && (
            <div className="px-4 pb-3">
              <span className={[
                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest",
                session.user.role === "admin"
                  ? "bg-[#FDF3DD] text-[#B07D12]"
                  : "bg-[#EAF6EE] text-[#1B8C4B]",
              ].join(" ")} style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
                {session.user.role}
              </span>
            </div>
          )}

          <div className="border-t border-[#EEF2F0] dark:border-white/[0.07]" />

          <button
            onClick={() => { setOpen(false); signOut({ callbackUrl: "/login" }) }}
            className="flex w-full items-center gap-2.5 px-4 py-3 text-[12px] font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
            style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}
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
          "relative flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border border-[#EEF2F0] transition-colors duration-100",
          open
            ? "bg-[#F0FDF4] text-[#1B8C4B] border-[#D6EBD9]"
            : "bg-white text-[#5B7568] hover:bg-[#F0FDF4] hover:text-[#1B8C4B] dark:bg-[#111714] dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/5",
        ].join(" ")}
        title="การแจ้งเตือน"
      >
        <Bell size={15} />
        {count > 0 && (
          <span className="absolute -top-[3px] -right-[3px] flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[#1B8C4B] px-1 text-[8px] font-bold text-white border-[2px] border-white dark:border-[#111714]"
            style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] w-80 rounded-[16px] border border-[#EEF2F0] dark:border-white/10 bg-white dark:bg-[#111714] shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#EEF2F0] dark:border-white/[0.07]">
            <span className="text-[13px] font-bold text-[#14271C] dark:text-white" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
              {isAdmin ? "รออนุมัติ" : "สถานะ SKU ของฉัน"}
            </span>
            {count > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#EAF6EE] px-1.5 text-[10px] font-bold text-[#1B8C4B]" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
                {count}
              </span>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <span className="text-[12px] text-[#9AA8A0]" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>กำลังโหลด…</span>
            </div>
          ) : notifs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-[#9AA8A0]">
              <Bell size={22} strokeWidth={1.5} />
              <p className="text-[12px]" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>ไม่มีการแจ้งเตือน</p>
            </div>
          ) : (
            <div className="divide-y divide-[#F4F7F5] dark:divide-white/5 max-h-72 overflow-y-auto">
              {notifs.map(item => (
                <div key={item._id} className="flex items-start gap-3 px-4 py-3 hover:bg-[#F6FAF7] dark:hover:bg-white/3 transition-colors">
                  <div className="mt-0.5 shrink-0">
                    {item.status === "approved" && <CheckCircle size={14} className="text-[#1B8C4B]" />}
                    {item.status === "rejected" && <XCircle size={14} className="text-red-500" />}
                    {item.status === "pending"  && <Clock size={14} className="text-[#E8A317]" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium text-[#14271C] dark:text-white truncate leading-snug" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
                      {item["ชื่ออะไหล่_TH"] || item.SKU || "—"}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      {item.SKU && (
                        <span className="text-[10px] text-[#9AA8A0]" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>{item.SKU}</span>
                      )}
                      {item.SKU && <span className="text-[#D1D5DB]">·</span>}
                      <span className="text-[10px] text-[#9AA8A0]" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
                        {item.status === "pending"  && "รอการอนุมัติ"}
                        {item.status === "approved" && "อนุมัติแล้ว"}
                        {item.status === "rejected" && "ถูกปฏิเสธ"}
                      </span>
                      {(item.updatedAt || item.createdAt) && (
                        <>
                          <span className="text-[#D1D5DB]">·</span>
                          <span className="text-[10px] text-[#B0B8C8]" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
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
            <div className="border-t border-[#EEF2F0] dark:border-white/[0.07]">
              <Link
                href={isAdmin ? "/sku/pending" : "/sku/my-submissions"}
                onClick={() => setOpen(false)}
                className="flex items-center justify-center gap-1.5 py-2.5 text-[12px] font-medium text-[#1B8C4B] hover:bg-[#F0FDF4] dark:hover:bg-white/3 transition-colors"
                style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}
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
    <header className="h-16 shrink-0 flex items-center justify-between px-6 bg-white dark:bg-[#111714] border-b border-[#EEF2F0] dark:border-white/[0.07]">

      {/* Left — live clock */}
      <div className="flex items-center gap-2.5 select-none">
        <div className="flex items-center gap-1.5">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="3" width="12" height="10" rx="2" stroke="#9AA8A0" strokeWidth="1.4"/>
            <path d="M2 6h12M5.5 1.5v3M10.5 1.5v3" stroke="#9AA8A0" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <span className="text-[13px] text-[#9AA8A0] dark:text-gray-500" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>{date}</span>
        </div>
        <span className="h-[13px] w-px bg-[#E2E8E4] dark:bg-white/10" />
        <span className="text-[14px] text-[#14271C] dark:text-white tabular-nums" style={{ fontFamily: "'Mitr', sans-serif", fontWeight: 600 }}>
          {time} น.
        </span>
      </div>

      {/* Right — icon buttons + avatar */}
      <div className="flex items-center gap-1.5">
        <SettingsMenu session={session} />
        <NotifBell session={session} isAdmin={isAdmin} />
      </div>
    </header>
  )
}
