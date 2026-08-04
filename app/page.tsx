"use client"

import Link from "next/link"
import { useSession } from "next-auth/react"
import { Suspense, useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import {
  PackageSearch, PlusCircle, Database, Car, GitCompare, Inbox, Layers,
  BarChart3, TableProperties, ClipboardCheck, Disc3, FileText, BookOpen,
  Wrench, Flag, Factory, Code2, ClipboardList, ChevronDown,
} from "lucide-react"
import { WelcomePopup } from "@/components/welcome-popup"
import { Mascot } from "@/components/mascot"

const sansThai = { fontFamily: "'IBM Plex Sans Thai', sans-serif" }
const mitr = { fontFamily: "'Mitr', sans-serif" }

type PageLink = { href: string; label: string; desc: string; icon: React.ElementType }
type Module = {
  key: string
  title: string
  desc: string
  icon: React.ElementType
  color: string   // สีประจำโมดูล (ไอคอน/แถบ)
  bg: string      // พื้นไอคอน (light)
  links: PageLink[]
}

// โมดูลทั้งหมด — ติดตามสินค้าขึ้นก่อน (ใช้บ่อยสุด) ที่เหลือเรียงตาม sidebar
const MODULES: Module[] = [
  {
    key: "tracking",
    title: "จัดการติดตามสินค้า",
    desc: "ติดตามการสั่งซื้อ ตั้งแต่คำขอจนของถึงมือ",
    icon: FileText, color: "#7C3AED", bg: "#F3E8FF",
    links: [
      { href: "/pr",                   label: "ติดตาม PR / รับสินค้า",  desc: "PR อนุมัติแล้ว รอเปิด PO / รอรับของ", icon: FileText },
      { href: "/order-tracking",       label: "ติดตามคำขอเปิด PO",      desc: "แจ้งขอซื้อ · จัดซื้อรับเรื่อง · ปิดจบอัตโนมัติ", icon: ClipboardList },
      { href: "/pr/guide",             label: "คู่มือติดตาม PR",         desc: "วิธีอ่านสถานะและตัวกรอง",          icon: BookOpen },
      { href: "/order-tracking/guide", label: "คู่มือติดตามคำขอเปิด PO", desc: "ขั้นตอนแจ้งเรื่อง-รับเรื่อง-ปิดงาน", icon: BookOpen },
    ],
  },
  {
    key: "sku",
    title: "จัดการ SKU",
    desc: "ฐานข้อมูลอะไหล่และรหัสสินค้า",
    icon: PackageSearch, color: "#1B8C4B", bg: "#EAF6EE",
    links: [
      { href: "/sku",                 label: "รายการ SKU",       desc: "ค้นหา / ดูอะไหล่ทั้งหมด",        icon: PackageSearch },
      { href: "/sku/new",             label: "เพิ่ม SKU ใหม่",    desc: "สร้างรหัสอัตโนมัติ",              icon: PlusCircle },
      { href: "/sku/my-submissions",  label: "รายการของฉัน",     desc: "SKU ที่ส่งไป รอ/ผ่านอนุมัติ",     icon: Inbox },
      { href: "/sku/oe-search",       label: "ค้นหา OE",          desc: "ค้นข้ามเบอร์อะไหล่แท้",           icon: GitCompare },
      { href: "/codes/parts",         label: "แคตาล็อกอะไหล่",   desc: "หมวดหมู่ L1 · L2 · L3",           icon: Layers },
      { href: "/vehicles",            label: "ยานพาหนะ",          desc: "ข้อมูลรถทุกคัน",                  icon: Car },
      { href: "/codes",               label: "พจนานุกรมโค้ด",    desc: "ความหมายรหัสทุกส่วน",             icon: Database },
      { href: "/atms-new-sku-report", label: "SKU ใหม่ ATMS",     desc: "รายงาน SKU เกิดใหม่รายเดือน",     icon: BarChart3 },
      { href: "/sku/bulk-update",     label: "Bulk Update",       desc: "แก้ไข SKU ทีละหลายรายการ",        icon: TableProperties },
    ],
  },
  {
    key: "tire",
    title: "จัดการยาง",
    desc: "สต็อกยางและการเปลี่ยนยางทุกสาขา",
    icon: Disc3, color: "#1D4ED8", bg: "#DBEAFE",
    links: [
      { href: "/tire",                       label: "ศูนย์จัดการยางรถ",  desc: "ภาพรวมยางทุกคัน ทุกสาขา",  icon: ClipboardCheck },
      { href: "/tire/master",                label: "สเปคยาง (Master)",  desc: "ขนาด / ยี่ห้อ / รุ่นยาง",   icon: Database },
      { href: "/tire/latkrabang/stock-tire", label: "สต็อกยาง ลาดกระบัง", desc: "คลังยางสาขา ศลบ",          icon: Disc3 },
      { href: "/tire/saraburi/stock-tire",   label: "สต็อกยาง สระบุรี",   desc: "คลังยางสาขา สสบ",          icon: Disc3 },
    ],
  },
  {
    key: "repair",
    title: "จัดการอู่นอกและสั่งซื้ออะไหล่ลงคัน",
    desc: "งานซ่อมอู่ภายนอกและสั่งอะไหล่มาลงคัน",
    icon: Wrench, color: "#C2410C", bg: "#FFEDD5",
    links: [
      { href: "/repair-external",           label: "อู่นอก & อะไหล่ลงคัน", desc: "งานที่กำลังดำเนินการ (ตาราง/บอร์ด)", icon: Wrench },
      { href: "/repair-external/completed", label: "งานเสร็จ",              desc: "งานที่ปิดแล้ว (รถเสร็จ / ลงคันเสร็จ)", icon: Flag },
      { href: "/garages",                   label: "จัดการอู่ / ร้านอะไหล่", desc: "รายชื่อ master แก้แล้วอัปเดตทุกงาน", icon: Factory },
      { href: "/repair-external/guide",     label: "คู่มือการใช้งาน",        desc: "workflow สถานะ + SLA",              icon: BookOpen },
      { href: "/repair-external/api-guide", label: "คู่มือ API Sync",        desc: "API สำหรับทีมภายนอก (public)",       icon: Code2 },
    ],
  },
]

export default function Home() {
  const { data: session } = useSession()
  const hour = new Date().getHours()
  const greeting = hour < 12 ? "สวัสดีตอนเช้า" : hour < 17 ? "สวัสดีตอนบ่าย" : "สวัสดีตอนเย็น"
  const userName = session?.user?.name ?? "คุณ"

  // Accordion — โมดูลแรก (ติดตามสินค้า) กางไว้ ที่เหลือพับ · เปิดพร้อมกันหลายอันได้
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set([MODULES[0].key]))
  const toggleModule = (key: string) =>
    setOpenKeys((prev) => {
      const next = new Set(prev)
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
      {MODULES.map((m, mi) => {
        const MIcon = m.icon
        const isOpen = openKeys.has(m.key)
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
