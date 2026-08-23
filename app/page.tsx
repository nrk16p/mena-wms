"use client"

import Link from "next/link"
import { useSession } from "next-auth/react"
import { Suspense, useMemo, useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { ChevronDown } from "lucide-react"
import { WelcomePopup } from "@/components/welcome-popup"
import { Mascot } from "@/components/mascot"
import { useBranchScope } from "@/components/use-branch-scope"
import { canSeeBranch } from "@/lib/branch-scope"
// เมนูทั้งหมดอยู่ที่ lib/nav.ts ที่เดียว — sidebar ก็อ่านจากไฟล์เดียวกัน
import { homeModules } from "@/lib/nav"

const sansThai = { fontFamily: "'IBM Plex Sans Thai', sans-serif" }
const mitr = { fontFamily: "'Mitr', sans-serif" }

export default function Home() {
  const { data: session } = useSession()
  // ผู้ใช้ที่ผูกกับสาขา (site_id 2/3) เห็นเฉพาะเมนูสาขาตัวเอง · โมดูลลับเห็นเฉพาะอีเมลที่กำหนด
  const scope = useBranchScope()
  const modules = useMemo(
    () => homeModules({
      email: session?.user?.email,
      isAdmin: session?.user?.role === "admin",
      canSeeBranch: (b) => canSeeBranch(scope, b),
    }),
    [session?.user?.email, session?.user?.role, scope],
  )
  const hour = new Date().getHours()
  const greeting = hour < 12 ? "สวัสดีตอนเช้า" : hour < 17 ? "สวัสดีตอนบ่าย" : "สวัสดีตอนเย็น"
  const userName = session?.user?.name ?? "คุณ"

  // Accordion — โมดูลแรก (ติดตามสินค้า) กางไว้ ที่เหลือพับ · เปิดพร้อมกันหลายอันได้
  // null = ยังไม่เคยกด → ใช้ค่าเริ่มต้น (โมดูลแรกกาง) เพราะรายการโมดูลมาหลัง session โหลดเสร็จ
  const [openKeys, setOpenKeys] = useState<Set<string> | null>(null)
  const defaultOpen = () => new Set(modules.length ? [modules[0].key] : [])
  const toggleModule = (key: string) =>
    setOpenKeys((prev) => {
      const next = new Set(prev ?? defaultOpen())
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-5">
      <Suspense><WelcomePopup /></Suspense>

      {/* ── Hero ทักทาย (กะทัดรัด — มือถือซ่อน mascot ใหญ่) ── */}
      <div
        className="flex items-center gap-4 rounded-[20px] border border-[#EEF2F0] dark:border-white/[0.07] bg-white dark:bg-[#151a10] px-5 py-4 sm:gap-5 sm:px-6 sm:py-5"
        style={{ boxShadow: "0 2px 8px rgba(20,39,28,.04)" }}
      >
        <div className="hidden sm:block"><Mascot size={72} wave bubble="สวัสดีครับ!" /></div>
        <div className="min-w-0 flex-1">
          <h1 className="text-[19px] leading-snug text-[#14271C] dark:text-white sm:text-[22px]" style={{ ...mitr, fontWeight: 500 }}>
            {greeting}, {userName}
          </h1>
          <p className="mt-0.5 text-[13px] text-[#6B7C72] dark:text-gray-400" style={sansThai}>
            เลือกโมดูลที่ต้องการใช้งานด้านล่างได้เลย
          </p>
        </div>
      </div>

      {/* ── โมดูลทั้งหมด — Accordion: กดหัวข้อเพื่อกาง/พับ (อันแรกกางไว้) ── */}
      {modules.map((m, mi) => {
        const MIcon = m.icon
        const isOpen = openKeys ? openKeys.has(m.key) : mi === 0
        return (
          <motion.section
            key={m.key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut", delay: mi * 0.06 }}
            className="overflow-hidden rounded-[20px] border border-[#EEF2F0] dark:border-white/[0.07] bg-white dark:bg-[#151a10]"
            style={{ boxShadow: "0 2px 8px rgba(20,39,28,.04)" }}
          >
            {/* หัวโมดูล = ปุ่ม accordion */}
            <button
              type="button"
              onClick={() => toggleModule(m.key)}
              className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-[#F9FCFA] dark:hover:bg-white/[0.02]"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl dark:bg-white/10" style={{ background: m.bg, color: m.color }}>
                <MIcon size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold text-[#14271C] dark:text-white" style={mitr}>{m.title}</h2>
                <p className="truncate text-[12px] text-[#9AA8A0]" style={sansThai}>{m.desc}</p>
              </div>
              <span className="shrink-0 rounded-full bg-[#F6FAF7] dark:bg-white/5 px-2 py-0.5 text-[11px] font-medium text-[#9AA8A0]" style={sansThai}>{m.links.length} เมนู</span>
              <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.25 }} className="shrink-0 text-[#9AA8A0]">
                <ChevronDown size={18} />
              </motion.span>
            </button>

            {/* เนื้อหาโมดูล — กาง/พับแบบ animate (height auto, 0.35s easeInOut) */}
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  key="content"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.35, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  {/* ลิงก์หน้าในโมดูล — มือถือ 1 คอลัมน์ปุ่มใหญ่กดง่าย · จอใหญ่ 3 คอลัมน์ */}
                  <div className="grid grid-cols-1 gap-2.5 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-3">
                    {m.links.map((l) => {
                      const LIcon = l.icon
                      return (
                        <Link
                          key={l.href}
                          href={l.href}
                          className="group flex items-center gap-3 rounded-[14px] border border-[#EEF2F0] dark:border-white/[0.07] px-3.5 py-3 transition-all duration-150 hover:shadow-[0_6px_16px_-10px_rgba(20,39,28,.25)] dark:hover:border-white/20 dark:hover:shadow-none"
                          style={{ minHeight: 56 }}
                        >
                          <div
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] transition-colors dark:bg-white/5"
                            style={{ background: m.bg, color: m.color }}
                          >
                            <LIcon size={17} />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-medium leading-snug text-[#14271C] dark:text-white" style={sansThai}>{l.label}</p>
                            <p className="truncate text-[11px] leading-snug text-[#9AA8A0] dark:text-gray-500" style={sansThai}>{l.desc}</p>
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>
        )
      })}
    </div>
  )
}
