"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Database, CalendarRange, Link2, Calculator, BookOpen, ShieldCheck, Lightbulb } from "lucide-react"

type MonthRow = { month: string; count: number }

const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]

function monthLabel(month: string): string {
  const [y, m] = month.split("-")
  return `${TH_MONTHS[+m - 1]} ${(+y + 543) % 100}`
}

function Card({ icon: Icon, no, title, children }: {
  icon: React.ElementType; no?: string; title: string; children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5">
      <div className="flex items-center gap-2.5 mb-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f0fdf4] dark:bg-[#1B8C4B]/10 text-[#1B8C4B]">
          <Icon size={16} />
        </span>
        <p className="text-sm font-bold text-gray-900 dark:text-white">
          {no && <span className="text-[#1B8C4B] mr-1.5">{no}</span>}{title}
        </p>
      </div>
      <div className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed space-y-2">{children}</div>
    </div>
  )
}

function QA({ q, a }: { q: string; a: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-white/[0.03] p-3.5">
      <p className="text-[13px] font-semibold text-gray-800 dark:text-gray-200 mb-1">Q: {q}</p>
      <p className="text-[13px] text-gray-600 dark:text-gray-400 leading-relaxed">A: {a}</p>
    </div>
  )
}

export default function AtmsNewSkuBaselinePage() {
  const [monthly, setMonthly] = useState<MonthRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/atms-sku-report")
      .then((r) => r.json())
      .then((d) => setMonthly(d.monthly ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const stat = useMemo(() => {
    const now = new Date()
    const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
    const last12 = monthly.filter((r) => r.month < curKey).slice(-12)
    if (last12.length === 0) return null
    const vals = last12.map((r) => r.count)
    const avg  = vals.reduce((s, v) => s + v, 0) / vals.length
    const sd   = Math.sqrt(vals.reduce((s, v) => s + (v - avg) ** 2, 0) / vals.length)
    return {
      last12,
      total: monthly.reduce((s, r) => s + r.count, 0),
      firstMonth: monthly[0]?.month,
      monthCount: monthly.length,
      avg: Math.round(avg),
      sd: Math.round(sd * 10) / 10,
      lcl: Math.max(0, Math.round(avg - sd)),
      ucl: Math.round(avg + sd),
      min: Math.min(...vals),
      max: Math.max(...vals),
    }
  }, [monthly])

  return (
    <div className="max-w-5xl">
      <Link
        href="/atms-new-sku-report"
        className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-[#1B8C4B] transition-colors mb-3"
      >
        <ArrowLeft size={12} /> กลับไปหน้ารายงาน
      </Link>
      <h1 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">
        นิยามตัวชี้วัด &amp; Baseline — รหัสสินค้าใหม่ (New SKU)
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        เอกสารกำกับตัวชี้วัดการสร้างรหัสสินค้าใหม่ ATMS × Mena-WMS สำหรับการจัดทำ Baseline และการควบคุมคุณภาพข้อมูล
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
        {/* 1. แหล่งที่มา */}
        <Card icon={Database} no="1." title="แหล่งที่มาของข้อมูล (Data Source)">
          <p>
            <span className="font-semibold text-gray-800 dark:text-gray-200">ระบบ ATMS</span> — โมดูลคลังสินค้า{" "}
            <a href="https://www.mena-atms.com/inv/sku/index" target="_blank" rel="noreferrer" className="text-[#1B8C4B] hover:underline break-all">
              mena-atms.com/inv/sku/index
            </a>{" "}
            โดยอ้างอิงเหตุการณ์ &quot;เพิ่มรหัสสินค้า&quot; จาก Activity Log ของระบบ (บันทึกอัตโนมัติทุกครั้งที่มีการสร้างรหัส)
          </p>
          <p>
            <span className="font-semibold text-gray-800 dark:text-gray-200">ระบบ Mena-WMS</span> — ระบบจัดการฐานข้อมูลใหม่
            สำหรับการจัดการรหัสสินค้าและราคากลาง
          </p>
        </Card>

        {/* 2. As-Is */}
        <Card icon={CalendarRange} no="2." title="การเก็บข้อมูลก่อนการปรับปรุง (As-Is Data Collection)">
          <p>
            เก็บข้อมูลย้อนหลัง<span className="font-semibold text-gray-800 dark:text-gray-200">ตั้งแต่เดือนแรกที่มีการบันทึก
            ({stat ? monthLabel(stat.firstMonth!) : "ธ.ค. 58"} / ธ.ค. 2015) จนถึงปัจจุบัน</span>
            {stat && <> รวม {stat.monthCount} เดือน จำนวน {stat.total.toLocaleString()} รหัส (ไม่นับซ้ำ)</>}
          </p>
          <p>
            วัดผลได้เป็นจำนวนรหัสใหม่ต่อเดือน — ความถี่การเก็บอัตโนมัติรายวันผ่านระบบ (ตรวจสอบย้อนหลัง 7 วันทุกรอบ
            เพื่อป้องกันข้อมูลตกหล่นจากระบบขัดข้อง)
          </p>
        </Card>

        {/* 3. ความเกี่ยวข้อง */}
        <Card icon={Link2} no="3." title="ความเกี่ยวข้องของข้อมูล (Data Relevance)">
          <p>
            ทุกรหัสสินค้าใหม่ที่ถูกสร้างใน ATMS <span className="font-semibold text-gray-800 dark:text-gray-200">ต้องถูกสร้างใน
            Mena-WMS ครบถ้วนแบบ 1 : 1</span> — จำนวนรหัสใหม่ของทั้งสองระบบต้องเท่ากันทุกเดือน เพื่อไม่ให้ข้อมูลตกหล่น
          </p>
          <p>
            ข้อมูลชุดนี้เป็นฐานของการจัดทำ<span className="font-semibold text-gray-800 dark:text-gray-200">ราคากลาง
            (Price Benchmark)</span> และการยกระดับความถูกต้องของฐานข้อมูลอะไหล่ทั้งองค์กร
          </p>
        </Card>

        {/* 4. สูตร Baseline */}
        <Card icon={Calculator} no="4." title="สูตรการคำนวณ Baseline">
          {loading || !stat ? (
            <p className="text-gray-400">กำลังคำนวณจากข้อมูลจริง...</p>
          ) : (
            <>
              <div className="rounded-lg bg-gray-50 dark:bg-white/[0.03] p-3 font-mono text-[12.5px] space-y-1">
                <p>Baseline (X̄) = Σ รหัสใหม่ 12 เดือนล่าสุด ÷ 12 = <span className="font-bold text-[#1B8C4B]">{stat.avg} รหัส/เดือน</span></p>
                <p>ส่วนเบี่ยงเบนมาตรฐาน (SD) = {stat.sd}</p>
                <p>เกณฑ์ขั้นต่ำ (X̄ − 1SD) = <span className="font-bold text-amber-600">{stat.lcl} รหัส/เดือน</span></p>
                <p>เกณฑ์เฝ้าระวังขาขึ้น (X̄ + 1SD) = {stat.ucl} รหัส/เดือน</p>
              </div>
              <p>
                อิงข้อมูลจริง 12 เดือนล่าสุดที่จบเดือนแล้ว ({monthLabel(stat.last12[0].month)} – {monthLabel(stat.last12[stat.last12.length - 1].month)},
                ต่ำสุด {stat.min} / สูงสุด {stat.max}) — <span className="font-semibold text-gray-800 dark:text-gray-200">
                แต่ละเดือนควรมีรหัสใหม่อย่างน้อย ~{stat.lcl} รหัส</span> หากต่ำกว่านี้ควรตรวจสอบว่ามีการบันทึกตกหล่นหรือไม่
              </p>
              <p className="rounded-lg bg-[#f0fdf4] dark:bg-[#1B8C4B]/10 p-3 text-[12.5px]">
                <span className="font-bold text-[#0F6A3C] dark:text-[#1B8C4B]">KPI ความครบถ้วน</span> = (จำนวนรหัสใหม่ใน Mena-WMS ÷ จำนวนรหัสใหม่ใน ATMS) × 100
                — เป้าหมาย <span className="font-bold">100%</span> (ผลต่างต้องเท่ากับ 0 ทุกเดือน)
              </p>
            </>
          )}
        </Card>
      </div>

      {/* นิยามการวัด */}
      <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5 mb-5">
        <div className="flex items-center gap-2.5 mb-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f0fdf4] dark:bg-[#1B8C4B]/10 text-[#1B8C4B]">
            <BookOpen size={16} />
          </span>
          <p className="text-sm font-bold text-gray-900 dark:text-white">นิยามการวัด (Measurement Definition)</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <QA
            q="ทุกคนในองค์กรเข้าใจสิ่งที่กำลังจะวัดหรือไม่ ? นิยามคืออะไร ?"
            a={<>เข้าใจตรงกันด้วยนิยามชัดเจน — <span className="font-semibold">&quot;รหัสสินค้าใหม่ (New SKU)&quot; คือรหัสที่ถูกสร้างครั้งแรกในระบบ ATMS</span> โดยการวัดนี้มีเป้าหมายเพื่อพัฒนาการจัดเก็บข้อมูลสำหรับจัดทำราคากลาง (Price Benchmark) และทำให้ฐานข้อมูลถูกต้องแม่นยำยิ่งขึ้น</>}
          />
          <QA
            q="ทำไมถึงต้องเก็บข้อมูลนี้ ?"
            a="เพื่อไม่ให้รหัสสินค้าใหม่ตกหล่นจากฐานข้อมูล — ทุกรหัสที่เกิดใน ATMS ต้องเข้าสู่ Mena-WMS ครบถ้วน มิฉะนั้นการวิเคราะห์ราคากลางและการควบคุมการจัดซื้อจะคลาดเคลื่อน"
          />
          <QA
            q="ข้อมูลที่รวบรวมวัดได้อย่างไร ?"
            a="วัดโดยการเปรียบเทียบจำนวนรหัสใหม่รายเดือนระหว่าง Mena-WMS กับ ATMS (ระบบซิงค์อัตโนมัติและแสดงผลบนหน้ารายงาน) — ผลต่างต้องเท่ากับ 0"
          />
          <QA
            q="เมื่อได้ข้อมูลการวัดนี้มาแล้ว จะทำอะไรต่อ ?"
            a="ใช้ตรวจสอบและควบคุม (Monitoring & Control) การสร้างรหัสสินค้า เพื่อลดข้อผิดพลาด — หากเดือนใดจำนวนต่ำกว่าเกณฑ์ขั้นต่ำ หรือสองระบบไม่ตรงกัน จะเข้าตรวจสอบหาสาเหตุและแก้ไขทันที"
          />
        </div>
      </div>

      {/* ความน่าเชื่อถือ */}
      <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5 mb-5">
        <div className="flex items-center gap-2.5 mb-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#f0fdf4] dark:bg-[#1B8C4B]/10 text-[#1B8C4B]">
            <ShieldCheck size={16} />
          </span>
          <p className="text-sm font-bold text-gray-900 dark:text-white">ความน่าเชื่อถือและเจ้าของข้อมูล (Data Trust &amp; Ownership)</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <QA
            q="ข้อมูลนี้ได้มาจากที่ไหน ?"
            a="ระบบ ATMS (Activity Log) และระบบ Mena-WMS (ฐานข้อมูล MongoDB) — เชื่อมต่อกันด้วยการซิงค์อัตโนมัติรายวัน"
          />
          <QA
            q="ข้อมูลเชื่อถือได้มากน้อยแค่ไหน ? มาจากหลักฐานอะไร ?"
            a="เชื่อถือได้สูงทั้งสองระบบ — เป็นข้อมูลที่ระบบบันทึกอัตโนมัติ (System-generated) ไม่มีการกรอกมือ ทุกเหตุการณ์มีหลักฐานใน Activity Log (ผู้สร้าง, เวลา, รายละเอียดรหัส) และการซิงค์มี log ตรวจสอบย้อนหลังได้"
          />
          <QA
            q="ใครเป็นเจ้าของข้อมูล ?"
            a="ทีมจัดซื้อและยานยนต์ (Procurement & Automotive) — เป็นผู้สร้างรหัส ดูแลความถูกต้อง และใช้ประโยชน์จากรายงานนี้โดยตรง"
          />
        </div>
      </div>

      {/* ข้อเสนอแนะ */}
      <div className="rounded-xl border border-dashed border-[#1B8C4B]/40 bg-[#f0fdf4]/50 dark:bg-[#1B8C4B]/5 p-5">
        <div className="flex items-center gap-2.5 mb-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1B8C4B] text-white">
            <Lightbulb size={16} />
          </span>
          <p className="text-sm font-bold text-gray-900 dark:text-white">ข้อเสนอแนะการพัฒนาต่อ (Next Steps)</p>
        </div>
        <ul className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed space-y-1.5 list-disc pl-5">
          <li>แจ้งเตือนอัตโนมัติ (อีเมล/LINE) เมื่อจำนวนรหัสใหม่รายเดือนต่ำกว่าเกณฑ์ขั้นต่ำ หรือเมื่อยอด Mena-WMS ≠ ATMS</li>
          <li>เพิ่ม Control Chart (X̄ ± SD) บนหน้ารายงาน เพื่อเห็นเดือนที่ผิดปกติได้ทันที</li>
          <li>ทบทวน Baseline ทุก 6 เดือน หรือเมื่อมีการเปลี่ยนแปลงเชิงโครงสร้าง (เปิดคลังใหม่, เปลี่ยนนโยบายจัดซื้อ)</li>
          <li>ขยายการวัดไปถึงคุณภาพของรหัส เช่น ความครบถ้วนของ Oracle Code, กลุ่มสินค้า, ยี่ห้อ ในแต่ละรหัสใหม่</li>
        </ul>
      </div>
    </div>
  )
}
