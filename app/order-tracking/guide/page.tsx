import Link from "next/link"
import {
  ClipboardList, GitCompare, Plus, UserCheck, RefreshCw, MessageSquare,
  History, Search, MousePointerClick, PackageCheck, BookOpen,
} from "lucide-react"
import { OT_STATUSES } from "@/lib/order-tracking"

const sansThai = { fontFamily: "'IBM Plex Sans Thai', sans-serif" }
const mitr = { fontFamily: "'Mitr', sans-serif" }

function Section({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10] p-5">
      <h2 className="mb-3 flex items-center gap-2 text-[15px] font-bold text-[#14271C] dark:text-white" style={mitr}>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1B8C4B]/10 text-[#1B8C4B]"><Icon size={16} /></span>
        {title}
      </h2>
      <div className="space-y-2 text-[13px] leading-relaxed text-[#4B5F54] dark:text-gray-300">{children}</div>
    </section>
  )
}

const STEP_DETAIL: Record<string, { who: string; desc: string }> = {
  "แจ้งเรื่อง":     { who: "ผู้ขอ (ทุกแผนก)", desc: "เปิดเรื่องแจ้งความต้องการซื้อ — มีเลข PR หรือยังไม่มีก็ได้ · มี PR ก็ยังเริ่มที่ขั้นนี้ รอจัดซื้อรับเรื่อง" },
  "รับเรื่องแล้ว":   { who: "ทีมจัดซื้อ", desc: "กดปุ่ม \"รับเรื่อง\" — ระบบบันทึกชื่อผู้กดเป็นผู้รับผิดชอบอัตโนมัติ + กรอกประมาณการเสร็จได้" },
  "เปิด PO-รอของ": { who: "ระบบ (อัตโนมัติ)", desc: "เมื่อ PR ที่ผูกไว้มีใบสั่งซื้อ (PO) ในระบบ ATMS สถานะจะขยับให้เอง" },
  "ปิดงาน":         { who: "ระบบ (อัตโนมัติ)", desc: "เมื่อมีการรับของ (DD) สถานะปิดจบให้เอง · เรื่องที่ไม่มี PR ปิดเองได้ด้วยปุ่ม \"ปิดงาน\"" },
}

export default function Page() {
  return (
    <div className="mx-auto max-w-[860px] px-4 py-6" style={sansThai}>
      {/* Header */}
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#1B8C4B]/10 text-[#1B8C4B]">
          <BookOpen size={22} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-[#14271C] dark:text-white" style={mitr}>คู่มือการใช้งาน · ติดตามคำสั่งซื้อ</h1>
          <p className="text-xs text-[#9AA8A0]">แจ้งความต้องการซื้อ → จัดซื้อรับเรื่อง → sync สถานะจากระบบ PR จนปิดงานอัตโนมัติ</p>
        </div>
      </div>

      <div className="space-y-4">
        {/* ภาพรวม */}
        <Section icon={ClipboardList} title="ภาพรวม">
          <p>หน้า <Link href="/order-tracking" className="font-medium text-[#1B8C4B] hover:underline">ติดตามคำสั่งซื้อ</Link> คือ<b>ตั๋วงาน (ticket) ครอบระบบ PR</b> — ใช้แจ้งความต้องการซื้อได้<b>ตั้งแต่ยังไม่มีเลข PR</b> แล้วให้ระบบตามสถานะต่อให้จนของถึง:</p>
          <p className="rounded-lg bg-[#F6FAF7] dark:bg-white/5 px-3 py-2 font-medium text-[#14271C] dark:text-gray-200">
            🆕 แจ้งเรื่อง (มี/ไม่มี PR) → 🔄 รับเรื่องแล้ว → 📦 เปิด PO-รอของ → ✅ ปิดงาน
          </p>
          <p>2 ขั้นแรกเป็นการกระทำของคน · 2 ขั้นหลัง<b>ระบบ sync จากข้อมูล ATMS อัตโนมัติ</b> (PR → PO → ใบรับของ DD) ทุกครั้งที่เปิดหน้า</p>
        </Section>

        {/* Flow 4 ขั้น */}
        <Section icon={GitCompare} title="ขั้นตอนงาน — ใครทำอะไร">
          <div className="mt-1 overflow-hidden rounded-xl border border-[#EEF2F0] dark:border-white/8">
            {OT_STATUSES.map((s, i) => {
              const d = STEP_DETAIL[s.value]
              return (
                <div key={s.value} className={`px-3.5 py-2.5 ${i > 0 ? "border-t border-[#F1F5F2] dark:border-white/5" : ""}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: s.color }}>{i + 1}. {s.emoji} {s.value}</span>
                    <span className="text-[11px] font-medium text-[#9AA8A0]">โดย: {d?.who}</span>
                  </div>
                  <div className="mt-1 text-[12.5px]">{d?.desc}</div>
                </div>
              )
            })}
          </div>
          <p className="pt-1 text-[12px] text-[#9AA8A0]">* มีเลข PR อย่างเดียวยัง<b>ไม่</b>ขยับสถานะ — สถานะขยับเมื่อมี PO / รับของแล้วเท่านั้น</p>
        </Section>

        {/* เปิดเรื่อง */}
        <Section icon={Plus} title="เปิดเรื่องใหม่">
          <ul className="ml-1 space-y-1.5">
            <li className="flex items-start gap-2"><Search size={14} className="mt-0.5 shrink-0 text-[#1B8C4B]" /><span><b>ช่องเลข PR</b> — พิมพ์บางส่วนแล้วระบบค้นจาก ATMS ให้เลือก · เลือกแล้ว<b>เติม "เรื่องที่ขอ" จากเหตุผลในการขอ + แผนกให้อัตโนมัติ</b> พร้อมการ์ด preview (คลัง/ยอด/PO/สถานะที่จะได้)</span></li>
            <li className="flex items-start gap-2"><PackageCheck size={14} className="mt-0.5 shrink-0 text-[#1B8C4B]" /><span>กรอก PR ที่<b>รับของครบแล้ว</b> → เรื่องขึ้นสถานะ ✅ ปิดงาน ทันที (บันทึกย้อนหลังได้)</span></li>
            <li className="flex items-start gap-2"><span className="mt-0.5 shrink-0">🔒</span><span><b>ผู้เปิดเรื่อง</b> ล็อกตามอีเมลที่ล็อกอิน (แก้ไม่ได้) — ระบบเก็บชื่อ + อีเมลใน log ทุกการกระทำ</span></li>
            <li className="flex items-start gap-2"><span className="mt-0.5 shrink-0">⚠</span><span><b>กติกา 1 เรื่อง : 1 PR</b> — เลข PR เดียวกันเปิดซ้ำไม่ได้ถ้าเรื่องเดิมยังไม่ปิด · ไม่มีเลข PR ก็เปิดเรื่องได้ มาผูกทีหลังได้</span></li>
          </ul>
        </Section>

        {/* รับเรื่อง */}
        <Section icon={UserCheck} title="การรับเรื่อง (ทีมจัดซื้อ)">
          <p>กดปุ่ม 🟡 <b>"รับเรื่อง"</b> ได้ 2 ที่: <b>ในตาราง</b> (คอลัมน์จัดซื้อ — เรื่องที่ยังไม่มีผู้รับ) หรือ<b>ในหน้าแก้ไข</b> (ปุ่มใหญ่มุมขวาล่าง)</p>
          <ul className="ml-1 space-y-1.5">
            <li className="flex items-start gap-2"><span className="mt-0.5 shrink-0">👤</span><span>ระบบบันทึก<b>ชื่อผู้กดจาก session เป็นผู้รับผิดชอบ</b>อัตโนมัติ — ไม่ต้องกรอกเอง · ใครกดก่อนได้เรื่องนั้น (กดซ้ำระบบแจ้งชื่อคนที่รับไปแล้ว)</span></li>
            <li className="flex items-start gap-2"><span className="mt-0.5 shrink-0">🎯</span><span>กรอก <b>ประมาณการเสร็จ</b> ในหน้าแก้ไขเพื่อให้ผู้ขอเห็นว่าจะได้เมื่อไร</span></li>
            <li className="flex items-start gap-2"><span className="mt-0.5 shrink-0">↔️</span><span>รับเรื่องได้ทุกสถานะที่ยังไม่ปิด — เรื่องที่ sync ไป PO แล้วก็รับได้ (สถานะไม่ถอยกลับ แค่บันทึกผู้รับ)</span></li>
          </ul>
        </Section>

        {/* Sync */}
        <Section icon={RefreshCw} title="การ sync กับระบบ PR">
          <ul className="ml-1 space-y-1.5">
            <li className="flex items-start gap-2"><RefreshCw size={14} className="mt-0.5 shrink-0 text-[#1B8C4B]" /><span>ทุกครั้งที่เปิดหน้า ระบบดึงสถานะล่าสุดของทุกเรื่องที่ผูก PR: <b>มี PO → 📦 เปิด PO-รอของ · มีใบรับของ (DD) → ✅ ปิดงาน</b> พร้อมอัปเดตการ์ดข้อมูล PR (PO / ยอด / วันคาดรับ / เหตุผลในการขอ)</span></li>
            <li className="flex items-start gap-2"><span className="mt-0.5 shrink-0">💬</span><span><b>เหตุผลในการขอ</b> ดึงมาจากหมายเหตุของ PR ให้อัตโนมัติ — เห็นทั้งในตารางและหน้าแก้ไข</span></li>
            <li className="flex items-start gap-2"><span className="mt-0.5 shrink-0">🔄</span><span>ข้อมูลส่วน "การติดตาม" ในหน้าแก้ไขเป็น<b>อ่านอย่างเดียว</b> — แก้ที่ระบบ ATMS แล้วระบบดึงมาเอง</span></li>
          </ul>
        </Section>

        {/* หน้า list */}
        <Section icon={MousePointerClick} title="หน้ารายการ — เครื่องมือ">
          <ul className="ml-1 space-y-1.5">
            <li className="flex items-start gap-2"><Search size={14} className="mt-0.5 shrink-0 text-[#1B8C4B]" /><span><b>ค้นหา + กรอง</b> — ค้นเรื่อง/PR/ผู้ขอ/ผู้รับ · กรองตาม<b>แผนกผู้ขอ</b> (พิมพ์ค้นหา) · chips สถานะคลิกกรองได้</span></li>
            <li className="flex items-start gap-2"><MousePointerClick size={14} className="mt-0.5 shrink-0 text-[#1B8C4B]" /><span><b>"⌄ อ่านทั้งหมด"</b> ใต้เรื่องที่ขอ — กางอ่านข้อความเต็ม (เรื่อง/เหตุผล/รายละเอียด/PO) ในตารางเลย ไม่ต้องเปิดหน้าแก้ไข · <b>คลิกแถว</b>เพื่อเปิดแก้ไข</span></li>
            <li className="flex items-start gap-2"><span className="mt-0.5 shrink-0">📊</span><span>แถบ progress เล็กใต้สถานะ = อยู่ขั้นไหนจาก 4 ขั้น · ในหน้าแก้ไขมี <b>stepper</b> แสดง flow เต็มพร้อมชื่อผู้รับ</span></li>
          </ul>
        </Section>

        {/* ความคิดเห็น + ประวัติ */}
        <Section icon={MessageSquare} title="ความคิดเห็น & ประวัติ">
          <ul className="ml-1 space-y-1.5">
            <li className="flex items-start gap-2"><MessageSquare size={14} className="mt-0.5 shrink-0 text-[#1B8C4B]" /><span><b>ความคิดเห็น / โน้ต</b> ในหน้าแก้ไข — คุยอัปเดตงานกันได้ ตอบกลับได้ แสดงชื่อ (อีเมล) + เวลา</span></li>
            <li className="flex items-start gap-2"><History size={14} className="mt-0.5 shrink-0 text-[#1B8C4B]" /><span><b>"ดูประวัติ"</b> — timeline ทุกเหตุการณ์: ใครเปิดเรื่อง/รับเรื่อง/แก้ไข/ปิดงาน เมื่อไร (ปิดอัตโนมัติขึ้นเป็น "ระบบ (sync)")</span></li>
            <li className="flex items-start gap-2"><span className="mt-0.5 shrink-0">🔒</span><span>เรื่องที่ปิดงานแล้ว ฟอร์มล็อกแก้ไม่ได้ — เหลือแค่เขียนความคิดเห็นเพิ่มได้</span></li>
          </ul>
        </Section>

        {/* ลิงก์ */}
        <div className="flex flex-wrap gap-2 pt-1">
          <Link href="/order-tracking" className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B8C4B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0F6A3C]"><ClipboardList size={15} /> ไปหน้าติดตามคำสั่งซื้อ</Link>
          <Link href="/pr" className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8E4] dark:border-white/10 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5">ติดตาม PR / รับสินค้า</Link>
        </div>
      </div>
    </div>
  )
}
