"use client"

// การ์ดแจ้ง "เมนูเปลี่ยน" — ขึ้นครั้งแรกที่เข้าหลังอัปเดต (หน้าไหนก็ได้) แล้วไม่ขึ้นอีก
// จำว่าเห็นแล้วใน localStorage ตาม NAV_VERSION → เปลี่ยนโครงเมนูรอบหน้า แค่เปลี่ยนเลขเวอร์ชันใน lib/nav.ts
// เปิดดูอีกได้จากลิงก์ "เมนูใหม่ เปลี่ยนอะไรบ้าง" ใต้ชื่อผู้ใช้ใน sidebar

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { Check, Search, Sparkles, Star, X } from "lucide-react"
import { useBranchScope } from "./use-branch-scope"
import { canSeeBranch } from "@/lib/branch-scope"
import { NAV_VERSION, byCategory, sidebarGroups } from "@/lib/nav"
import { NAV_NOTICE_OPEN, NAV_SEARCH_FOCUS } from "@/lib/nav-search-store"

const sansThai = { fontFamily: "'IBM Plex Sans Thai', sans-serif" }
const mitr = { fontFamily: "'Mitr', sans-serif" }
const KEY = `wms-nav-notice:${NAV_VERSION}`

export function NavUpdateNotice() {
  const { data: session, status } = useSession()
  const scope = useBranchScope()
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (status !== "authenticated") return
    try { if (localStorage.getItem(KEY) !== "1") setShow(true) } catch { /* ignore */ }
  }, [status])

  useEffect(() => {
    const reopen = () => setShow(true)
    window.addEventListener(NAV_NOTICE_OPEN, reopen)
    return () => window.removeEventListener(NAV_NOTICE_OPEN, reopen)
  }, [])

  if (!show || !session?.user) return null

  const dismiss = () => {
    setShow(false)
    try { localStorage.setItem(KEY, "1") } catch { /* ignore */ }
  }

  const groups = sidebarGroups({
    email: session.user.email,
    isAdmin: session.user.role === "admin",
    canSeeBranch: (b) => canSeeBranch(scope, b),
    access: session.user.access,
    isSuperAdmin: session.user.isSuperAdmin,
  })
  const { categories } = byCategory(groups)

  return (
    <section
      role="status"
      className="mx-auto mb-5 flex max-w-[1000px] flex-col gap-4 rounded-[20px] border border-[#1B8C4B]/60 bg-white px-5 py-4 dark:bg-[#151a10] sm:px-6 sm:py-5"
      style={{ boxShadow: "0 8px 24px rgba(27,140,75,.10)" }}
    >
      <div className="flex items-start gap-3.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EAF6EE] text-[#1B8C4B] dark:bg-white/10">
          <Sparkles size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] text-[#14271C] dark:text-white" style={{ ...mitr, fontWeight: 500 }}>เมนูซ้ายจัดใหม่เป็นหมวดแล้ว</h2>
          <p className="text-[12px] text-[#9AA8A0]" style={sansThai}>อัปเดต พ.ย. 69 · ลิงก์เดิมใช้ได้ทุกหน้า</p>
        </div>
        <button onClick={dismiss} aria-label="ปิด" className="rounded-lg p-1 text-[#9AA8A0] hover:bg-[#F0FDF4] hover:text-[#1B8C4B] dark:hover:bg-white/5">
          <X size={18} />
        </button>
      </div>

      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2" style={sansThai}>
        <div>
          <h3 className="mb-1 text-[12px] font-bold text-[#1B8C4B]">สิ่งที่เปลี่ยน</h3>
          <ol className="list-decimal space-y-0.5 pl-[18px] text-[13px] text-[#14271C] dark:text-gray-200">
            <li>กลุ่มเมนูเดิมทั้งหมด จัดเข้า {categories.length} หมวด หมวดไหนไม่ได้ใช้พับเก็บได้</li>
            <li>มีช่องค้นหาเมนูบนสุดของแถบซ้าย หรือกด Ctrl+K</li>
            <li>
              กดดาว <Star size={12} className="inline -mt-0.5 fill-[#E8A317] text-[#E8A317]" /> ข้างเมนูที่ใช้ประจำ
              (ชี้เมาส์ที่เมนูแล้วดาวจะโผล่) เมนูนั้นจะไปอยู่ใน &quot;เมนูโปรด&quot; บนสุดของแถบซ้ายและหน้าหลัก
            </li>
            <li>ตอนแถบซ้ายหุบ จะเหลือแค่เมนูโปรดกับไอคอนหมวด ชี้เมาส์ที่แถบเพื่อกางดูทั้งหมด</li>
          </ol>
        </div>
        <div>
          <h3 className="mb-1 text-[12px] font-bold text-[#1B8C4B]">สิ่งที่ไม่เปลี่ยน</h3>
          <ol className="list-decimal space-y-0.5 pl-[18px] text-[13px] text-[#14271C] dark:text-gray-200">
            <li>ชื่อเมนู ลำดับ และลิงก์ทุกหน้าเหมือนเดิม bookmark หรือลิงก์ที่ส่งในไลน์ยังเปิดได้</li>
            <li>ใครเห็นเมนูไหนได้ ยังเหมือนเดิม</li>
          </ol>
        </div>
      </div>

      <div style={sansThai}>
        <h3 className="mb-1.5 text-[12px] font-bold text-[#1B8C4B]">กลุ่มที่คุณใช้ ย้ายไปอยู่หมวดไหน</h3>
        <div className="grid gap-1.5">
          {categories.map(({ category: c, groups: gs }) => {
            const CIcon = c.icon
            return (
              <div key={c.key} className="flex items-start gap-2.5 rounded-[12px] border border-[#EEF2F0] bg-[#F6FAF7] px-3 py-2 text-[12.5px] dark:border-white/[0.07] dark:bg-white/[0.03]">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] dark:bg-white/10" style={{ background: c.bg, color: c.color }}>
                  <CIcon size={13} />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] text-[#14271C] dark:text-white" style={{ ...mitr, fontWeight: 500 }}>หมวด{c.label}</p>
                  <p className="text-[#6B7C72] dark:text-gray-400">{gs.map((g) => g.homeTitle && g.key === "ai-mixer" ? g.homeTitle : g.label).join(" · ")}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2" style={sansThai}>
        <button onClick={dismiss} className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#1B8C4B] px-3.5 py-1.5 text-[13px] text-white hover:bg-[#157A40]">
          <Check size={14} />รับทราบ
        </button>
        <button
          onClick={() => { dismiss(); window.dispatchEvent(new Event(NAV_SEARCH_FOCUS)) }}
          className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#EEF2F0] px-3.5 py-1.5 text-[13px] text-[#14271C] hover:border-[#1B8C4B] dark:border-white/10 dark:text-gray-200"
        >
          <Search size={14} />ลองค้นหาเมนู
        </button>
        <span className="text-[11.5px] text-[#9AA8A0] sm:ml-auto">การ์ดนี้ขึ้นครั้งเดียว เปิดดูอีกได้ที่ &quot;เมนูใหม่ เปลี่ยนอะไรบ้าง&quot; ใต้ชื่อคุณ</span>
      </div>
    </section>
  )
}
