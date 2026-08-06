"use client"

import { Bell, CheckCircle, XCircle, Clock, ArrowRight, LogOut, Menu, ChevronDown, AlertTriangle } from "lucide-react"
import { useState, useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import { useSession, signOut } from "next-auth/react"
import Link from "next/link"
import { UserAvatar } from "./user-avatar"

const THAI = "'IBM Plex Sans Thai', sans-serif"

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

// ── Profile dropdown ─────────────────────────────────────────────────────────
function ProfileRow({ label, value }: { label: string; value?: string | number | null }) {
  if (value === null || value === undefined || value === "") return null
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-[7px]">
      <span className="shrink-0 text-[11px] text-[#9AA8A0] dark:text-gray-500" style={{ fontFamily: THAI }}>
        {label}
      </span>
      <span className="min-w-0 truncate text-right text-[12px] font-semibold text-[#14271C] dark:text-gray-100" style={{ fontFamily: THAI }}>
        {value}
      </span>
    </div>
  )
}

function ProfileMenu({ session }: { session: ReturnType<typeof useSession>["data"] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function outside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", outside)
    document.addEventListener("keydown", esc)
    return () => {
      document.removeEventListener("mousedown", outside)
      document.removeEventListener("keydown", esc)
    }
  }, [])

  const user = session?.user
  const emp  = user?.employee
  const isAdmin = user?.role === "admin"

  // บรรทัดที่ 2 ของปุ่ม: ตำแหน่ง → แผนก → role (แล้วแต่ว่ามีอะไร)
  const subtitle = emp?.position ?? emp?.department ?? (isAdmin ? "ผู้ดูแลระบบ" : "ผู้ใช้งาน")
  const fullName = [emp?.firstname, emp?.lastname].filter(Boolean).join(" ") || user?.name || "—"

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={[
          "flex h-[34px] items-center gap-2 rounded-[10px] border py-1 pl-1 pr-1.5 sm:pr-2 transition-colors duration-100",
          open
            ? "border-[#D6EBD9] bg-[#F0FDF4] dark:border-white/15 dark:bg-white/5"
            : "border-[#EEF2F0] bg-white hover:bg-[#F6FAF7] dark:border-white/10 dark:bg-[#111714] dark:hover:bg-white/5",
        ].join(" ")}
        title="โปรไฟล์ผู้ใช้"
      >
        <UserAvatar src={user?.image} name={user?.name} size={26} />

        <span className="hidden min-w-0 max-w-[168px] flex-col items-start leading-none sm:flex">
          <span className="w-full truncate text-[12px] font-bold text-[#14271C] dark:text-gray-100" style={{ fontFamily: THAI }}>
            {user?.name ?? "—"}
          </span>
          <span className="mt-[3px] w-full truncate text-[10px] text-[#9AA8A0] dark:text-gray-500" style={{ fontFamily: THAI }}>
            {subtitle}
          </span>
        </span>

        <ChevronDown
          size={13}
          className={`shrink-0 text-[#9AA8A0] transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-[290px] overflow-hidden rounded-[16px] border border-[#EEF2F0] bg-white shadow-xl dark:border-white/10 dark:bg-[#111714]"
        >
          {/* หัวการ์ด — รูปโปรไฟล์ + ชื่อ + อีเมล */}
          <div className="relative bg-linear-to-br from-[#1B8C4B] to-[#12703A] px-4 pb-4 pt-4 text-white">
            <div className="flex items-center gap-3">
              <UserAvatar src={user?.image} name={user?.name} size={44} ring />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-bold leading-tight" style={{ fontFamily: THAI }}>
                  {fullName}
                </p>
                <p className="mt-1 truncate text-[10.5px] leading-none text-white/70" style={{ fontFamily: THAI }}>
                  {user?.email ?? "—"}
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span
                className={[
                  "inline-flex items-center rounded-full px-2 py-[3px] text-[9.5px] font-bold uppercase tracking-[0.12em]",
                  isAdmin ? "bg-[#FFD97A] text-[#5C4104]" : "bg-white/20 text-white",
                ].join(" ")}
                style={{ fontFamily: THAI }}
              >
                {user?.role ?? "user"}
              </span>
              {emp?.employee_status && (
                <span className="inline-flex items-center rounded-full bg-white/15 px-2 py-[3px] text-[9.5px] font-bold uppercase tracking-[0.12em]" style={{ fontFamily: THAI }}>
                  {emp.employee_status}
                </span>
              )}
              {emp?.position_level && (
                <span className="inline-flex items-center rounded-full bg-white/15 px-2 py-[3px] text-[9.5px] font-medium" style={{ fontFamily: THAI }}>
                  {emp.position_level}
                </span>
              )}
            </div>
          </div>

          {/* ข้อมูลพนักงานจาก Mena API */}
          {emp ? (
            <div className="divide-y divide-[#F4F7F5] py-1 dark:divide-white/5">
              <ProfileRow label="รหัสพนักงาน" value={emp.employee_id} />
              <ProfileRow label="ตำแหน่ง"     value={emp.position} />
              <ProfileRow label="แผนก"        value={emp.department} />
              <ProfileRow label="สาขา"        value={emp.site} />
            </div>
          ) : (
            <div className="flex items-start gap-2.5 px-4 py-3">
              <AlertTriangle size={13} className="mt-[2px] shrink-0 text-[#E8A317]" />
              <div className="min-w-0">
                <p className="text-[11.5px] font-semibold leading-snug text-[#14271C] dark:text-gray-200" style={{ fontFamily: THAI }}>
                  ยังไม่ได้เชื่อมข้อมูลพนักงาน
                </p>
                <p className="mt-0.5 break-words text-[10px] leading-snug text-[#9AA8A0]" style={{ fontFamily: THAI }}>
                  {session?.apiAuthError ?? "ระบบ HR ไม่ตอบกลับ — ใช้งาน WMS ได้ตามปกติ"}
                </p>
              </div>
            </div>
          )}

          <div className="border-t border-[#EEF2F0] dark:border-white/[0.07]" />

          <button
            onClick={() => { setOpen(false); signOut({ callbackUrl: "/login" }) }}
            className="flex w-full items-center gap-2.5 px-4 py-3 text-[12px] font-medium text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-950/20"
            style={{ fontFamily: THAI }}
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
export function Navbar({ onMenuClick }: { onMenuClick?: () => void }) {
  const { date, time } = useThaiBangkokClock()
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "admin"

  return (
    <header className="h-16 shrink-0 flex items-center justify-between px-4 lg:px-6 bg-white dark:bg-[#111714] border-b border-[#EEF2F0] dark:border-white/[0.07]">

      {/* Left — hamburger (มือถือ) + live clock */}
      <div className="flex items-center gap-2.5 select-none">
        <button
          onClick={onMenuClick}
          aria-label="เปิดเมนู"
          className="lg:hidden flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#4B5F54] dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5"
        >
          <Menu size={20} />
        </button>
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

      {/* Right — แจ้งเตือน + โปรไฟล์ผู้ใช้ */}
      <div className="flex items-center gap-2">
        <NotifBell session={session} isAdmin={isAdmin} />
        <span className="h-4.5 w-px bg-[#E2E8E4] dark:bg-white/10" />
        <ProfileMenu session={session} />
      </div>
    </header>
  )
}
