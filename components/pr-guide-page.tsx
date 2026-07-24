import {
  FileText, GitCompare, Truck, Table as TableIcon, Search, MousePointerClick,
  ClipboardCheck, Clock, Database, ExternalLink, Layers,
} from "lucide-react"

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

const STAGES = [
  { label: "เปิด PR",        color: "#64748B", cond: "มี PR แต่ยังไม่มี PO" },
  { label: "เปิด PO · ยอดครบ", color: "#1D4ED8", cond: "มี PO แล้ว · ยอด + รายการสินค้าตรงกัน (แต่ยังไม่มีวันกำหนดส่ง)" },
  { label: "เปิด PO · ไม่ครบ", color: "#E8A317", cond: "มี PO แต่ยอด/รายการไม่ตรง — ต้องตรวจสอบ" },
  { label: "กำหนดส่งสินค้า",  color: "#15803D", cond: "ครบแล้ว + มีวันกำหนดส่ง + ยังไม่เกินกำหนด" },
  { label: "เกินกำหนด",       color: "#DC2626", cond: "มีวันกำหนดส่งแล้ว แต่เลยวันมาแล้ว" },
]

const ITEM_STATUS = [
  { label: "ตรง", color: "#15803D", desc: "จำนวน + ยอด ตรงกันทั้ง PR และ PO" },
  { label: "จำนวนต่าง", color: "#DC2626", desc: "จำนวนสินค้าไม่ตรง" },
  { label: "ราคาต่าง", color: "#B07D12", desc: "จำนวนตรงแต่ยอดเงินต่าง" },
  { label: "ขาดใน PO", color: "#DC2626", desc: "มีใน PR แต่ไม่มีใน PO" },
  { label: "เกินใน PO", color: "#1D4ED8", desc: "มีใน PO แต่ไม่มีใน PR" },
]

export function PrGuidePage() {
  return (
    <div className="mx-auto max-w-[860px] px-4 py-6" style={sansThai}>
      {/* Header */}
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#1B8C4B]/10 text-[#1B8C4B]">
          <FileText size={22} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-[#14271C] dark:text-white" style={mitr}>คู่มือการใช้งาน · จัดการติดตามสินค้า (PR)</h1>
          <p className="text-xs text-[#9AA8A0]">ติดตามใบขอซื้อ (PR) ที่อนุมัติแล้ว ตั้งแต่เปิด PO จนรับสินค้า</p>
        </div>
      </div>

      <div className="space-y-4">
        {/* ภาพรวม */}
        <Section icon={FileText} title="ภาพรวม">
          <p>หน้านี้แสดง <b>PR ที่อนุมัติแล้ว แต่ยัง “ไม่มีการรับของ” (ไม่มี DD/ใบฝากของ)</b> — คือของที่สั่งซื้อแล้วยังมาไม่ถึง เพื่อติดตามให้ครบวงจร:</p>
          <p className="rounded-lg bg-[#F6FAF7] dark:bg-white/5 px-3 py-2 font-medium text-[#14271C] dark:text-gray-200">
            เปิด PR → เปิด PO (ตรวจยอด/รายการ) → กำหนดวันรับของ → รับของครบ (หลุดจากหน้านี้)
          </p>
          <p>เมื่อ PR ใดมีการ <b>รับของ (DD)</b> แล้ว จะหลุดออกจากหน้านี้อัตโนมัติ (ถือว่าจบงาน)</p>
        </Section>

        {/* สถานะการติดตาม */}
        <Section icon={Truck} title="สถานะการติดตาม (แถบ funnel ด้านบน)">
          <p>งานไหลจากซ้ายไปขวา · คลิกที่ขั้นใดขั้นหนึ่งเพื่อกรองเฉพาะขั้นนั้น:</p>
          <div className="mt-1 overflow-hidden rounded-xl border border-[#EEF2F0] dark:border-white/8">
            {STAGES.map((s, i) => (
              <div key={s.label} className={`flex items-start gap-3 px-3.5 py-2.5 ${i > 0 ? "border-t border-[#F1F5F2] dark:border-white/5" : ""}`}>
                <span className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: s.color }}>{s.label}</span>
                <span className="text-[12.5px]">{s.cond}</span>
              </div>
            ))}
          </div>
          <p className="pt-1 text-[12px] text-[#9AA8A0]">* “ครบ/ไม่ครบ” ตัดสินจากการเทียบ <b>รายการสินค้าราย SKU</b> (จำนวน + ยอด) ระหว่าง PR กับ PO</p>
        </Section>

        {/* การเทียบ PR ↔ PO */}
        <Section icon={GitCompare} title="การเทียบ PR ↔ PO">
          <p><b>1) เทียบยอดรวม</b> — ขึ้นกับกฎ VAT ของสาขา:</p>
          <ul className="ml-1 space-y-1">
            <li className="flex items-start gap-2"><span className="mt-0.5 shrink-0">•</span><span><b>DIST / สระบุรี</b> — PR รวม VAT แล้ว → คาดว่า <b>ยอด PR = ยอด PO</b></span></li>
            <li className="flex items-start gap-2"><span className="mt-0.5 shrink-0">•</span><span><b>สาขาอื่นทั้งหมด</b> — PR ไม่รวม VAT → คาดว่า <b>ยอด PO = ยอด PR + 7%</b></span></li>
          </ul>
          <p className="pt-1"><b>2) เทียบรายการสินค้า (ราย SKU)</b> — join ด้วยรหัสสินค้า แล้วบอกสถานะแต่ละรายการ:</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {ITEM_STATUS.map((it) => (
              <span key={it.label} className="inline-flex items-center gap-1.5 rounded-lg border border-[#EEF2F0] dark:border-white/10 px-2 py-1 text-[11.5px]" title={it.desc}>
                <span className="h-2 w-2 rounded-full" style={{ background: it.color }} />{it.label}
              </span>
            ))}
          </div>
          <p className="pt-1 text-[12px] text-[#9AA8A0]">ดูรายละเอียดการเทียบราย SKU ได้ในหน้า detail (คลิกที่แถว)</p>
        </Section>

        {/* กำหนดส่ง + เกินกำหนด */}
        <Section icon={Clock} title="กำหนดส่งสินค้า · เกินกำหนด">
          <p>ในหน้า detail ช่อง <b>“กำหนดส่งสินค้า”</b> คือวันที่คาดว่าจะได้รับสินค้า:</p>
          <ul className="ml-1 space-y-1">
            <li className="flex items-start gap-2"><span className="mt-0.5 shrink-0">📅</span><span><b>ค่าตั้งต้นดึงจาก PO อัตโนมัติ</b> — แก้ทับได้ (กดบันทึก) · ปุ่ม “ล้างเป็นค่า PO” คืนค่าเดิม</span></li>
            <li className="flex items-start gap-2"><span className="mt-0.5 shrink-0">🟢</span><span><b>ยังไม่เกิน</b> — บอก “เหลืออีก N วัน”</span></li>
            <li className="flex items-start gap-2"><span className="mt-0.5 shrink-0">🔴</span><span><b>เกินกำหนด</b> — บอก “เกิน N วัน” (เทียบกับวันนี้ ตามเวลาไทย)</span></li>
          </ul>
          <p className="pt-1 text-[12px] text-[#9AA8A0]">การ์ด <b>เกินกำหนด</b> ในตารางแสดงจำนวนวันที่เกินในคอลัมน์สถานะ</p>
        </Section>

        {/* ตาราง */}
        <Section icon={TableIcon} title="ตารางรายการ">
          <ul className="ml-1 space-y-1.5">
            <li className="flex items-start gap-2"><Clock size={14} className="mt-0.5 shrink-0 text-[#1B8C4B]" /><span><b>อายุงาน</b> — จำนวนวันตั้งแต่เปิด PR ถึงวันนี้ · สี <span className="font-semibold text-[#1B8C4B]">เขียว &lt;8</span> · <span className="font-semibold text-[#B07D12]">เหลือง 8–14</span> · <span className="font-semibold text-[#DC2626]">แดง 15+</span></span></li>
            <li className="flex items-start gap-2"><ClipboardCheck size={14} className="mt-0.5 shrink-0 text-[#1B8C4B]" /><span><b>ยอด PR / ยอด PO</b> + <b>สถานะ</b> (ขั้น funnel) + จำนวนวันเกิน/เหลือ</span></li>
            <li className="flex items-start gap-2"><Search size={14} className="mt-0.5 shrink-0 text-[#1B8C4B]" /><span><b>ค้นหา</b> (PR/ทะเบียน/ผู้ขอซื้อ/PO/หมายเหตุ) + <b>กรอง</b> คลัง/แผนก</span></li>
            <li className="flex items-start gap-2"><MousePointerClick size={14} className="mt-0.5 shrink-0 text-[#1B8C4B]" /><span><b>คลิกที่แถว</b> เพื่อเปิดรายละเอียด</span></li>
          </ul>
        </Section>

        {/* หน้า detail */}
        <Section icon={Layers} title="หน้ารายละเอียด (คลิกแถว)">
          <ul className="ml-1 space-y-1.5">
            <li className="flex items-start gap-2"><ExternalLink size={14} className="mt-0.5 shrink-0 text-[#1B8C4B]" /><span><b>รหัส PR / PO</b> เป็นลิงก์ ↗ เปิดหน้าจริงบน ATMS (ต้อง login ATMS ในเบราว์เซอร์)</span></li>
            <li className="flex items-start gap-2"><GitCompare size={14} className="mt-0.5 shrink-0 text-[#1B8C4B]" /><span><b>เทียบยอด PR ↔ PO</b> + <b>เทียบรายการสินค้า (ราย SKU)</b></span></li>
            <li className="flex items-start gap-2"><Truck size={14} className="mt-0.5 shrink-0 text-[#1B8C4B]" /><span><b>ติดตามสินค้า</b> — 3 สเต็ป + ช่องกำหนดวันรับของ</span></li>
            <li className="flex items-start gap-2"><FileText size={14} className="mt-0.5 shrink-0 text-[#1B8C4B]" /><span><b>รายการ PO</b> (วันที่/ซัพพลายเออร์/ยอด/สถานะรับ) + หมายเหตุเต็ม</span></li>
          </ul>
        </Section>

        {/* ข้อมูล */}
        <Section icon={Database} title="ข้อมูลมาจากไหน · อัปเดตบ่อยแค่ไหน">
          <p>ข้อมูล PR / PO / การรับของ / รายการสินค้า <b>ดึงจากระบบ ATMS</b> (mena-atms.com) มาเก็บที่ฐานข้อมูล แล้วหน้านี้อ่านจากฐานข้อมูลอีกที</p>
          <p>มีระบบ <b>ดึงข้อมูลอัตโนมัติ</b> เป็นรอบ — ดังนั้นข้อมูลจะใหม่เท่ารอบดึงล่าสุด (ไม่ใช่เรียลไทม์ทันที) · หากเพิ่งทำรายการใน ATMS อาจต้องรอรอบถัดไป</p>
        </Section>
      </div>
    </div>
  )
}
