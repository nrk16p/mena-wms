import Link from "next/link"
import {
  Wrench, Table as TableIcon, Columns3, Plus, Search, Filter, Clock, Timer,
  MessageSquare, History, Link2, Factory, Flag, Truck, FileText, MousePointerClick,
} from "lucide-react"
import {
  REPAIR_STATUSES,
  REPAIR_STATUS_REQUIRED_FIELD,
  REPAIR_STATUS_SLA_DAYS,
  REPAIR_SLA_FROM_DUE,
} from "@/lib/repair-external"

const COLORS: Record<string, string> = {
  "รอรถเข้า": "#9ca3af", "รถเข้าอู่ซ่อม": "#3b82f6", "รอใบเสนอราคา": "#06b6d4",
  "รออนุมัติ": "#eab308", "ซ่อมไม่มีกำหนด": "#f97316", "ซ่อมมีกำหนดเสร็จ": "#14b8a6", "รถเสร็จ": "#22c55e",
}

function Section({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10] p-5">
      <h2 className="mb-3 flex items-center gap-2 text-[15px] font-bold text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1B8C4B]/10 text-[#1B8C4B]"><Icon size={16} /></span>
        {title}
      </h2>
      <div className="space-y-2 text-[13px] leading-relaxed text-[#4B5F54] dark:text-gray-300">{children}</div>
    </section>
  )
}

export function RepairGuidePage() {
  return (
    <div className="mx-auto max-w-[860px] px-4 py-6" style={{ fontFamily: "'IBM Plex Sans Thai', sans-serif" }}>
      {/* Header */}
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#1B8C4B]/10 text-[#1B8C4B]">
          <FileText size={22} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>
            คู่มือการใช้งาน · รถซ่อมอู่นอก
          </h1>
          <p className="text-xs text-[#9AA8A0]">ระบบติดตามงานซ่อมรถที่ส่งอู่ภายนอก — ตั้งแต่รับแจ้ง จนซ่อมเสร็จ</p>
        </div>
      </div>

      <div className="space-y-4">
        {/* ภาพรวม */}
        <Section icon={Wrench} title="ภาพรวม">
          <p>ระบบนี้ใช้ติดตามงานซ่อมรถที่ส่งอู่ภายนอก แบ่งเป็น 2 หน้า:</p>
          <ul className="ml-1 space-y-1">
            <li className="flex items-start gap-2"><Wrench size={14} className="mt-0.5 shrink-0 text-[#1B8C4B]" /><span><b>รถซ่อมอู่นอก</b> — งานที่<b>กำลังดำเนินการ</b> (ยังไม่เสร็จ)</span></li>
            <li className="flex items-start gap-2"><Flag size={14} className="mt-0.5 shrink-0 text-[#22c55e]" /><span><b>รถซ่อมเสร็จ</b> — งานที่ปิดแล้ว (สถานะ "รถเสร็จ") จะย้ายมาที่นี่อัตโนมัติ</span></li>
          </ul>
          <p className="flex flex-wrap items-center gap-2 pt-1">มี 2 มุมมอง สลับได้ที่มุมขวาบน:
            <span className="inline-flex items-center gap-1 rounded-md bg-[#F6FAF7] dark:bg-white/5 px-2 py-0.5 text-xs"><TableIcon size={13} /> ตาราง</span>
            <span className="inline-flex items-center gap-1 rounded-md bg-[#F6FAF7] dark:bg-white/5 px-2 py-0.5 text-xs"><Columns3 size={13} /> บอร์ด (Kanban)</span>
          </p>
        </Section>

        {/* Workflow สถานะ */}
        <Section icon={Timer} title="ขั้นตอนงาน (Workflow) & เกณฑ์ค้างงาน (SLA)">
          <p>งานไหลตามสถานะด้านล่าง — <b>เปลี่ยนสถานะบางอันต้องกรอกข้อมูลก่อน</b> ระบบจะบังคับให้กรอก และเตือนเมื่อ<b>ค้างเกินกำหนด</b>:</p>
          <div className="overflow-x-auto">
            <table className="mt-1 w-full min-w-[520px] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-[#EEF2F0] dark:border-white/8 text-left text-[11px] uppercase text-[#9AA8A0]">
                  <th className="py-2 pr-3 font-semibold">สถานะ</th>
                  <th className="py-2 pr-3 font-semibold">ต้องกรอก</th>
                  <th className="py-2 font-semibold">SLA (ไม่ควรค้างเกิน)</th>
                </tr>
              </thead>
              <tbody>
                {REPAIR_STATUSES.map((s) => {
                  const req = REPAIR_STATUS_REQUIRED_FIELD[s.value]
                  const sla = REPAIR_STATUS_SLA_DAYS[s.value]
                  return (
                    <tr key={s.value} className="border-b border-[#F1F5F2] dark:border-white/5">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full" style={{ background: COLORS[s.value] }} />
                          {s.emoji} {s.value}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-[#5B7568] dark:text-gray-400">{req ? req.label : "—"}</td>
                      <td className="py-2 text-[#5B7568] dark:text-gray-400">
                        {sla ? <>2 วัน{REPAIR_SLA_FROM_DUE.has(s.value) ? " (นับจากวันกำหนดเสร็จ)" : ""}</> : "ไม่จำกัด"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="pt-1 text-[12px] text-[#9AA8A0]">* สถานะปกติวัดค้างจาก <b>วันที่เข้าสถานะ</b> · "ซ่อมมีกำหนดเสร็จ" วัดจาก <b>วันกำหนดเสร็จ</b></p>
        </Section>

        {/* เพิ่ม/แก้ไข */}
        <Section icon={Plus} title="เพิ่ม / แก้ไขรายการ (ฟอร์ม 3 ขั้นตอน)">
          <ol className="ml-1 space-y-1.5">
            <li className="flex gap-2"><b className="text-[#1B8C4B]">1.</b><span><b>ข้อมูลรถ</b> — พิมพ์ <b>ทะเบียนรถ</b> แล้วเลือก ระบบจะ<b>เติมเบอร์รถ / ฟลีท / แพล้นท์อัตโนมัติ</b> · แนบรูป/เอกสารได้</span></li>
            <li className="flex gap-2"><b className="text-[#1B8C4B]">2.</b><span><b>งานซ่อม</b> — รายละเอียดอาการ, อู่, วันที่รถเข้าอู่</span></li>
            <li className="flex gap-2"><b className="text-[#1B8C4B]">3.</b><span><b>สถานะ · เอกสาร</b> — สถานะ, รหัส PR/PO, วันกำหนดเสร็จ, ราคาซ่อม, รับประกัน, หมายเหตุ</span></li>
          </ol>
          <p className="flex items-start gap-2 rounded-lg bg-[#FDF3DD] px-3 py-2 text-[12px] text-[#B07D12]">
            <Clock size={14} className="mt-0.5 shrink-0" />
            ถ้าเลือกสถานะที่ต้องกรอกฟิลด์ (เช่น "รออนุมัติ" ต้องมีรหัส PO) ช่องนั้นจะ<b>ไฮไลต์สีเหลือง</b>และ<b>บันทึกไม่ได้</b>จนกว่าจะกรอก
          </p>
        </Section>

        {/* มุมมองตาราง */}
        <Section icon={TableIcon} title="มุมมองตาราง">
          <ul className="ml-1 space-y-1.5">
            <li className="flex items-start gap-2"><Filter size={14} className="mt-0.5 shrink-0 text-[#1B8C4B]" /><span><b>การ์ดสรุปด้านบน</b> — ค่าเฉลี่ยวันซ่อม, เลยกำหนด, การกระจายตามวันซ่อม</span></li>
            <li className="flex items-start gap-2"><Search size={14} className="mt-0.5 shrink-0 text-[#1B8C4B]" /><span><b>ค้นหา + ตัวกรอง</b> — ค้นหา MR/ทะเบียน/อาการ/PR/PO · กรองตาม อู่ / สร้างโดย / แก้ไขโดย (พิมพ์ค้นหาได้)</span></li>
            <li className="flex items-start gap-2"><MousePointerClick size={14} className="mt-0.5 shrink-0 text-[#1B8C4B]" /><span><b>ชิปสถานะ</b> — คลิกเพื่อกรองตามสถานะ · <b>คลิกทั้งแถว</b>เพื่อเปิดแก้ไข</span></li>
            <li className="flex items-start gap-2"><Clock size={14} className="mt-0.5 shrink-0 text-[#1B8C4B]" /><span><b>คอลัมน์อายุงาน</b> — จำนวนวันตั้งแต่รับแจ้ง · แถวที่ค้าง ≥ 15 วันพื้นจะเป็นสีอ่อน</span></li>
            <li className="flex items-start gap-2"><Link2 size={14} className="mt-0.5 shrink-0 text-[#1B8C4B]" /><span><b>คลิกเลข MR / PR / PO</b> เพื่อ<b>คัดลอก</b>ได้ทันที</span></li>
          </ul>
        </Section>

        {/* มุมมองบอร์ด */}
        <Section icon={Columns3} title="มุมมองบอร์ด (Kanban)">
          <ul className="ml-1 space-y-1.5">
            <li className="flex items-start gap-2"><Columns3 size={14} className="mt-0.5 shrink-0 text-[#1B8C4B]" /><span>คอลัมน์ = สถานะ · การ์ด = รายการซ่อม (มีแถบความคืบหน้า, อายุงาน, ต้นทุน)</span></li>
            <li className="flex items-start gap-2"><MousePointerClick size={14} className="mt-0.5 shrink-0 text-[#1B8C4B]" /><span><b>ลากการ์ดข้ามคอลัมน์</b> = เปลี่ยนสถานะ — ถ้าสถานะปลายทางต้องกรอกฟิลด์ จะเด้งฟอร์มให้กรอกก่อน</span></li>
          </ul>
        </Section>

        {/* SLA + เครื่องมือ */}
        <Section icon={Timer} title="ติดตามงานค้าง & เครื่องมือ">
          <ul className="ml-1 space-y-1.5">
            <li className="flex items-start gap-2"><span className="mt-0.5 shrink-0">⏱️</span><span><b>ปุ่ม "ค้างเกินกำหนด"</b> (สีแดง ที่แถบสถานะ) — คลิกเพื่อดูเฉพาะรายการที่ค้างเกิน SLA</span></li>
            <li className="flex items-start gap-2"><MessageSquare size={14} className="mt-0.5 shrink-0 text-[#1B8C4B]" /><span><b>ความคิดเห็น / โน้ต</b> — เขียนโน้ต ตอบกลับได้ (มีในหน้าแก้ไข และปุ่ม 💬 ในตาราง)</span></li>
            <li className="flex items-start gap-2"><History size={14} className="mt-0.5 shrink-0 text-[#1B8C4B]" /><span><b>ประวัติการแก้ไข</b> (ปุ่มนาฬิกา) — ดูว่าใครแก้อะไร เมื่อไหร่ เปลี่ยนสถานะจาก→เป็น</span></li>
            <li className="flex items-start gap-2"><Link2 size={14} className="mt-0.5 shrink-0 text-[#1B8C4B]" /><span><b>คัดลอกลิงก์</b> (ในหน้าแก้ไข) — ส่งลิงก์ให้เพื่อนเปิดรายการนั้นได้ตรงๆ</span></li>
          </ul>
        </Section>

        {/* จัดการอู่ */}
        <Section icon={Factory} title="จัดการอู่ (Master)">
          <p>หน้า <Link href="/garages" className="font-medium text-[#1B8C4B] hover:underline">จัดการอู่</Link> ใช้ดู/เพิ่ม/แก้ชื่อ/ลบรายชื่ออู่ · แก้ชื่ออู่แล้ว<b>รายการซ่อมที่ใช้อู่นั้นจะอัปเดตตามอัตโนมัติ</b> · มีตัวเลขบอกว่าอู่ไหนถูกใช้กี่รายการ</p>
        </Section>

        {/* ทางลัด */}
        <div className="flex flex-wrap gap-2 pt-1">
          <Link href="/repair-external" className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B8C4B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0F6A3C]"><Wrench size={15} /> ไปหน้ารถซ่อมอู่นอก</Link>
          <Link href="/repair-external/completed" className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8E4] dark:border-white/10 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5"><Flag size={15} /> รถซ่อมเสร็จ</Link>
          <Link href="/garages" className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8E4] dark:border-white/10 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5"><Factory size={15} /> จัดการอู่</Link>
        </div>
      </div>
    </div>
  )
}
