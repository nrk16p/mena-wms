"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Database, CalendarRange, Link2, Calculator, BookOpen, ShieldCheck, Lightbulb, Download } from "lucide-react"

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
  const [savingPng, setSavingPng] = useState(false)
  const slideRef = useRef<HTMLDivElement>(null)

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

  const savePng = async () => {
    const el = slideRef.current
    if (!el || savingPng) return
    setSavingPng(true)
    try {
      const { toBlob } = await import("html-to-image")
      const opts = {
        pixelRatio: 2,
        backgroundColor: "#ffffff",
        // system fonts only — skipping web-font embedding avoids CORS SecurityError and speeds capture
        skipFonts: true,
      }
      // WebKit/Safari: first capture can come back blank — warm up, then capture
      await toBlob(el, opts)
      const blob = await toBlob(el, opts)
      if (!blob) throw new Error("capture returned empty image")
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.download = `atms-new-sku-baseline-${new Date().toISOString().slice(0, 10)}.png`
      a.href = url
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      console.error("save png failed", e)
      alert(`บันทึก PNG ไม่สำเร็จ: ${e instanceof Error ? e.message : e}`)
    } finally {
      setSavingPng(false)
    }
  }

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

      {/* ── Presentation slide (16:9 PNG export) ── */}
      <div className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            สไลด์สำหรับรายงาน (16:9)
          </p>
          <button
            onClick={savePng}
            disabled={savingPng || loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B8C4B] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#0F6A3C] disabled:opacity-50 transition-colors"
          >
            <Download size={14} />
            {savingPng ? "กำลังบันทึก..." : "Export PNG"}
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-white/8">
          {/* fixed 1280×720 → PNG 2560×1440; light theme only */}
          <div ref={slideRef} className="w-[1280px] aspect-video shrink-0 bg-white p-10 flex flex-col">
            {/* Header */}
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-3xl font-bold text-gray-900 leading-tight">
                  นิยามตัวชี้วัด &amp; Baseline — รหัสสินค้าใหม่ (New SKU)
                </h2>
                <p className="text-lg text-gray-500 mt-1.5">ATMS × Mena-WMS • การควบคุมความครบถ้วนของฐานข้อมูลเพื่อจัดทำราคากลาง</p>
              </div>
              {stat && (
                <div className="flex gap-3 shrink-0">
                  <div className="rounded-xl border border-gray-200 bg-gray-50 px-6 py-3 text-center">
                    <p className="text-sm font-semibold text-gray-400">Baseline</p>
                    <p className="text-3xl font-bold text-gray-900 tabular-nums">{stat.avg}</p>
                    <p className="text-sm text-gray-400">รหัส/เดือน</p>
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-3 text-center">
                    <p className="text-sm font-semibold text-amber-600">ขั้นต่ำ</p>
                    <p className="text-3xl font-bold text-amber-600 tabular-nums">{stat.lcl}</p>
                    <p className="text-sm text-gray-400">รหัส/เดือน</p>
                  </div>
                  <div className="rounded-xl border border-[#1B8C4B]/30 bg-[#f0fdf4] px-6 py-3 text-center">
                    <p className="text-sm font-semibold text-[#1B8C4B]">ความครบถ้วน</p>
                    <p className="text-3xl font-bold text-[#0F6A3C] tabular-nums">100%</p>
                    <p className="text-sm text-gray-400">WMS = ATMS</p>
                  </div>
                </div>
              )}
            </div>

            {/* 4 numbered cards */}
            <div className="grid grid-cols-4 gap-4 mb-5">
              <div className="rounded-xl border border-gray-200 p-4">
                <p className="text-base font-bold text-gray-900 mb-1.5"><span className="text-[#1B8C4B]">1.</span> แหล่งที่มาของข้อมูล</p>
                <p className="text-[15px] text-gray-600 leading-relaxed">
                  <span className="font-semibold text-gray-800">ATMS</span> — Activity Log การเพิ่มรหัสสินค้า (mena-atms.com)<br />
                  <span className="font-semibold text-gray-800">Mena-WMS</span> — ระบบจัดการฐานข้อมูลใหม่สำหรับรหัสสินค้าและราคากลาง
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 p-4">
                <p className="text-base font-bold text-gray-900 mb-1.5"><span className="text-[#1B8C4B]">2.</span> การเก็บข้อมูล (As-Is)</p>
                <p className="text-[15px] text-gray-600 leading-relaxed">
                  ย้อนหลังตั้งแต่ <span className="font-semibold text-gray-800">ธ.ค. 2015 – ปัจจุบัน</span>
                  {stat && <> รวม {stat.monthCount} เดือน {stat.total.toLocaleString()} รหัส</>} วัดผลเป็นจำนวนรหัสใหม่ต่อเดือน
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 p-4">
                <p className="text-base font-bold text-gray-900 mb-1.5"><span className="text-[#1B8C4B]">3.</span> ความเกี่ยวข้องของข้อมูล</p>
                <p className="text-[15px] text-gray-600 leading-relaxed">
                  รหัสใหม่ใน ATMS ต้องถูกสร้างใน Mena-WMS <span className="font-semibold text-gray-800">ครบถ้วน 1 : 1</span> เพื่อไม่ให้ข้อมูลตกหล่น — เป็นฐานของราคากลาง
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 p-4">
                <p className="text-base font-bold text-gray-900 mb-1.5"><span className="text-[#1B8C4B]">4.</span> สูตร Baseline</p>
                {stat && (
                  <p className="text-[15px] text-gray-600 leading-relaxed">
                    X̄ = Σ 12 เดือนล่าสุด ÷ 12 = <span className="font-bold text-[#1B8C4B]">{stat.avg}</span><br />
                    ขั้นต่ำ = X̄ − 1SD = <span className="font-bold text-amber-600">{stat.lcl} รหัส/เดือน</span><br />
                    ความครบถ้วน = WMS ÷ ATMS × 100 = <span className="font-bold text-[#0F6A3C]">100%</span>
                  </p>
                )}
              </div>
            </div>

            {/* Definition + trust */}
            <div className="flex-1 grid grid-cols-2 gap-4 min-h-0">
              <div className="rounded-xl bg-gray-50 p-4">
                <p className="text-base font-bold text-gray-900 mb-2">นิยามการวัด (Measurement Definition)</p>
                <ul className="text-[15px] text-gray-600 leading-relaxed space-y-1.5">
                  <li><span className="font-semibold text-gray-800">วัดอะไร:</span> &quot;รหัสสินค้าใหม่&quot; = รหัสที่ถูกสร้างครั้งแรกใน ATMS — นิยามเดียวกันทั้งองค์กร</li>
                  <li><span className="font-semibold text-gray-800">ทำไมต้องเก็บ:</span> ป้องกันรหัสใหม่ตกหล่นจากฐานข้อมูลราคากลาง</li>
                  <li><span className="font-semibold text-gray-800">วัดอย่างไร:</span> เปรียบเทียบจำนวนรหัสใหม่รายเดือน Mena-WMS กับ ATMS (ผลต่าง = 0)</li>
                  <li><span className="font-semibold text-gray-800">ใช้ทำอะไรต่อ:</span> ตรวจสอบและควบคุมเพื่อลดข้อผิดพลาด — ต่ำกว่าเกณฑ์ = เข้าตรวจสอบทันที</li>
                </ul>
              </div>
              <div className="rounded-xl bg-gray-50 p-4">
                <p className="text-base font-bold text-gray-900 mb-2">ความน่าเชื่อถือและเจ้าของข้อมูล</p>
                <ul className="text-[15px] text-gray-600 leading-relaxed space-y-1.5">
                  <li><span className="font-semibold text-gray-800">ที่มา:</span> ระบบ ATMS และ Mena-WMS — ซิงค์อัตโนมัติรายวัน</li>
                  <li><span className="font-semibold text-gray-800">ความน่าเชื่อถือ:</span> สูงทั้งสองระบบ — ข้อมูล System-generated ไม่มีการกรอกมือ ทุกเหตุการณ์มีหลักฐานใน Activity Log (ผู้สร้าง / เวลา / รายละเอียด)</li>
                  <li><span className="font-semibold text-gray-800">เจ้าของข้อมูล:</span> ทีมจัดซื้อและยานยนต์ (Procurement &amp; Automotive)</li>
                </ul>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-gray-100 pt-3 mt-4">
              <p className="text-sm text-gray-400">ที่มา: ATMS activity log × Mena-WMS • เอกสารกำกับตัวชี้วัด</p>
              <p className="text-sm text-gray-400">
                สร้างเมื่อ {new Date().toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" })}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
