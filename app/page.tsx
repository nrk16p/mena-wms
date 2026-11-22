"use client"

import Link from "next/link"
import { useSession } from "next-auth/react"
import { Suspense, useEffect, useMemo, useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { ChevronDown, LayoutGrid, Star } from "lucide-react"
import { WelcomePopup } from "@/components/welcome-popup"
import { Mascot } from "@/components/mascot"
import { useBranchScope } from "@/components/use-branch-scope"
import { canSeeBranch } from "@/lib/branch-scope"
// เมนูทั้งหมดอยู่ที่ lib/nav.ts ที่เดียว — sidebar ก็อ่านจากไฟล์เดียวกัน
import { homeModules, sidebarGroups, searchNav, favoriteItems, NAV_CATEGORIES, type HomeModule } from "@/lib/nav"
import { useNavQuery, setNavQuery, useNavFavorites } from "@/lib/nav-search-store"
import { Highlight } from "@/components/sidebar"
import { useSearchParams } from "next/navigation"

const sansThai = { fontFamily: "'IBM Plex Sans Thai', sans-serif" }
const mitr = { fontFamily: "'Mitr', sans-serif" }

export default function Home() {
  const { data: session } = useSession()
  // ผู้ใช้ที่ผูกกับสาขา (site_id 2/3) เห็นเฉพาะเมนูสาขาตัวเอง · โมดูลลับเห็นเฉพาะอีเมลที่กำหนด
  const scope = useBranchScope()
  const viewer = useMemo(() => ({
      email: session?.user?.email,
      isAdmin: session?.user?.role === "admin",
      canSeeBranch: (b: string) => canSeeBranch(scope, b),
      access: session?.user?.access,
      isSuperAdmin: session?.user?.isSuperAdmin,
    }),
    [session?.user?.email, session?.user?.role, session?.user?.access, session?.user?.isSuperAdmin, scope],
  )
  const modules = useMemo(() => homeModules(viewer), [viewer])
  // ค้นหาเมนู — พิมพ์ที่ช่องค้นหาใน sidebar แล้วหน้าหลักแสดงผลเป็นการ์ด
  const query = useNavQuery()
  const hits = useMemo(() => searchNav(sidebarGroups(viewer), query, viewer.isAdmin), [viewer, query])
  // ชิปหมวด — กรองการ์ดโมดูลตามหมวด
  const [catFilter, setCatFilter] = useState<string>("all")
  // มาจากไอคอนหมวดบนแถบย่อ (/?cat=repair) → มือถือกรองหมวด · จอใหญ่เลื่อนไปคอลัมน์นั้น
  const [catParam, setCatParam] = useState<string | null>(null)
  useEffect(() => {
    if (!catParam) return
    setCatFilter(catParam)
    document.getElementById(`cat-${catParam}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [catParam])
  const favHrefs = useNavFavorites()
  const favs = useMemo(() => favoriteItems(sidebarGroups(viewer), favHrefs), [viewer, favHrefs])
  const cats = NAV_CATEGORIES
    .map((c) => ({ c, mods: modules.filter((m) => m.category === c.key) }))
    .filter((x) => x.mods.length > 0)
  const uncategorized = modules.filter((m) => !m.category)
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

  function renderModule(m: HomeModule, mi: number) {
    const MIcon = m.icon
    const isOpen = openKeys ? openKeys.has(m.key) : m.key === modules[0]?.key
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
  }

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-5 lg:max-w-[1200px]">
      <Suspense><WelcomePopup /></Suspense>
      <Suspense><CatParam onChange={setCatParam} /></Suspense>

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

      {query.trim() ? (
        /* ── ผลค้นหาเมนู (พิมพ์จากช่องค้นหาใน sidebar) ── */
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-[18px] text-[#14271C] dark:text-white" style={{ ...mitr, fontWeight: 500 }}>
              {hits.length ? `ผลค้นหา "${query}"` : `ไม่พบเมนูที่ตรงกับ "${query}"`}
            </h2>
            <span className="text-[12px] text-[#9AA8A0]" style={sansThai}>
              {hits.length ? `เจอ ${hits.length} เมนู · Enter เปิดอันแรก · ↑↓ เลือก · Esc ล้าง` : "ลองพิมพ์สั้นลง หรือใช้ชื่อเอกสาร เช่น PR, PO, WD"}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {hits.map((h) => {
              const HIcon = h.icon
              return (
                <Link
                  key={h.href}
                  href={h.href}
                  onClick={() => setNavQuery("")}
                  className="flex items-center gap-3 rounded-[14px] border border-[#EEF2F0] dark:border-white/[0.07] bg-white dark:bg-[#151a10] px-3.5 py-3 transition-all duration-150 hover:border-[#1B8C4B] hover:shadow-[0_6px_16px_-10px_rgba(20,39,28,.25)]"
                  style={{ minHeight: 56 }}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] dark:bg-white/5" style={{ background: h.bg, color: h.color }}>
                    <HIcon size={17} />
                  </div>
                  <div className="min-w-0" style={sansThai}>
                    <p className="truncate text-[10.5px] leading-snug text-[#1B8C4B]">{h.category ? `${h.category.label} › ` : ""}{h.groupLabel}</p>
                    <p className="truncate text-[13px] font-medium leading-snug text-[#14271C] dark:text-white"><Highlight text={h.label} query={query} /></p>
                    <p className="truncate text-[11px] leading-snug text-[#9AA8A0] dark:text-gray-500">{h.desc}</p>
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      ) : (
        <>
          {/* ── เมนูโปรด ── */}
          {favs.length > 0 && (
            <section className="rounded-[20px] border border-[#EEF2F0] dark:border-white/[0.07] bg-white dark:bg-[#151a10] px-5 py-4" style={{ boxShadow: "0 2px 8px rgba(20,39,28,.04)" }}>
              <h2 className="mb-2.5 flex items-center gap-1.5 text-[14px] text-[#14271C] dark:text-white" style={{ ...mitr, fontWeight: 500 }}>
                <Star size={15} className="fill-[#E8A317] text-[#E8A317]" />เมนูโปรด
              </h2>
              <div className="flex flex-wrap gap-2" style={sansThai}>
                {favs.map((f) => {
                  const FIcon = f.icon
                  return (
                    <Link key={f.href} href={f.href} title={f.desc}
                      className="inline-flex items-center gap-2 rounded-[12px] border border-[#EEF2F0] dark:border-white/[0.07] px-3 py-2 text-[13px] text-[#14271C] dark:text-gray-200 transition-colors hover:border-[#1B8C4B]">
                      <span className="flex h-6 w-6 items-center justify-center rounded-[7px] dark:bg-white/5" style={{ background: f.bg, color: f.color }}><FIcon size={13} /></span>
                      {f.label}
                    </Link>
                  )
                })}
              </div>
            </section>
          )}

          {/* ── จอใหญ่: ตารางหมวด (หมวดละคอลัมน์) เห็นทุกเมนูในหน้าเดียว ── */}
          <div className="hidden gap-4 lg:grid" style={{ gridTemplateColumns: `repeat(${Math.max(cats.length, 1)}, minmax(0, 1fr))` }}>
            {cats.map(({ c, mods }) => {
              const CIcon = c.icon
              return (
                <section id={`cat-${c.key}`} key={c.key}
                  className={["flex min-w-0 flex-col gap-3 rounded-[20px] border bg-white dark:bg-[#151a10] p-4 scroll-mt-4",
                    catParam === c.key ? "border-[#1B8C4B]/60" : "border-[#EEF2F0] dark:border-white/[0.07]"].join(" ")}
                  style={{ boxShadow: "0 2px 8px rgba(20,39,28,.04)" }}>
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] dark:bg-white/10" style={{ background: c.bg, color: c.color }}>
                      <CIcon size={16} />
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-[16px] leading-tight text-[#14271C] dark:text-white" style={{ ...mitr, fontWeight: 500 }}>{c.label}</h2>
                      <p className="truncate text-[11px] text-[#9AA8A0]" style={sansThai}>{c.desc}</p>
                    </div>
                  </div>
                  {mods.map((m) => {
                    const MIcon = m.icon
                    return (
                      <div key={m.key} className="border-t border-[#EEF2F0] pt-2.5 dark:border-white/[0.07]">
                        <h3 className="mb-1 flex items-center gap-2 text-[12.5px] font-semibold text-[#14271C] dark:text-white" style={sansThai} title={m.desc}>
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] dark:bg-white/10" style={{ background: m.bg, color: m.color }}><MIcon size={12} /></span>
                          <span className="truncate">{m.title}</span>
                        </h3>
                        <ul className="space-y-px" style={sansThai}>
                          {m.links.map((l) => {
                            const LIcon = l.icon
                            return (
                              <li key={l.href}>
                                <Link href={l.href} title={l.desc}
                                  className="flex items-center gap-2 rounded-[9px] px-2 py-1.5 text-[13px] text-[#4B5F54] transition-colors hover:bg-[#F0FDF4] hover:text-[#0F6A3C] dark:text-gray-300 dark:hover:bg-white/5 dark:hover:text-white">
                                  <LIcon size={14} className="shrink-0" style={{ color: m.color }} />
                                  <span className="truncate">{l.label}</span>
                                </Link>
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    )
                  })}
                </section>
              )
            })}
          </div>

          {/* ── มือถือ/จอเล็ก: ชิปหมวด + การ์ดพับได้แบบเดิม ── */}
          <div className="flex flex-col gap-5 lg:hidden">
          <div className="flex flex-wrap gap-2" style={sansThai}>
            <button
              type="button"
              onClick={() => setCatFilter("all")}
              className={["inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors",
                catFilter === "all" ? "border-[#14271C] bg-[#14271C] text-white dark:border-white dark:bg-white dark:text-[#14271C]" : "border-[#EEF2F0] bg-white text-[#6B7C72] hover:border-[#1B8C4B] dark:border-white/10 dark:bg-[#151a10] dark:text-gray-300"].join(" ")}
            >
              <LayoutGrid size={14} />ทั้งหมด
            </button>
            {cats.map(({ c, mods }) => {
              const CIcon = c.icon
              const on = catFilter === c.key
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCatFilter(on ? "all" : c.key)}
                  className={["inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors",
                    on ? "border-[#14271C] bg-[#14271C] text-white dark:border-white dark:bg-white dark:text-[#14271C]" : "border-[#EEF2F0] bg-white text-[#6B7C72] hover:border-[#1B8C4B] dark:border-white/10 dark:bg-[#151a10] dark:text-gray-300"].join(" ")}
                >
                  <CIcon size={14} />{c.label}<span className="text-[11px] opacity-70">{mods.length}</span>
                </button>
              )
            })}
          </div>

          {/* ── โมดูลแยกตามหมวด — Accordion: กดหัวข้อเพื่อกาง/พับ ── */}
          {cats.filter(({ c }) => catFilter === "all" || catFilter === c.key).map(({ c, mods }) => {
            const CIcon = c.icon
            return (
              <div key={c.key} className="flex flex-col gap-3">
                <div className="mt-1 flex items-center gap-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] dark:bg-white/10" style={{ background: c.bg, color: c.color }}>
                    <CIcon size={15} />
                  </span>
                  <h2 className="text-[16px] text-[#14271C] dark:text-white" style={{ ...mitr, fontWeight: 500 }}>{c.label}</h2>
                  <span className="text-[12px] text-[#9AA8A0]" style={sansThai}>{c.desc}</span>
                  <span className="h-px flex-1 bg-[#EEF2F0] dark:bg-white/[0.07]" />
                </div>
                {mods.map((m) => renderModule(m, modules.indexOf(m)))}
              </div>
            )
          })}
          {catFilter === "all" && uncategorized.map((m) => renderModule(m, modules.indexOf(m)))}
          </div>
        </>
      )}
    </div>
  )
}

/** อ่าน ?cat= (ต้องอยู่ใน Suspense ตามกติกา useSearchParams) แล้วส่งค่าขึ้นไปให้หน้าหลัก */
function CatParam({ onChange }: { onChange: (cat: string | null) => void }) {
  const cat = useSearchParams().get("cat")
  useEffect(() => { onChange(cat) }, [cat, onChange])
  return null
}
