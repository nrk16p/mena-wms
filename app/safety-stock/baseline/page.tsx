"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowLeft, Database, CalendarRange, Layers, Calculator, BookOpen,
  ShieldCheck, TriangleAlert, ListChecks, HelpCircle,
} from "lucide-react"
import {
  DAYS_PER_MONTH, USAGE_LOOKBACK_MONTHS, LT_LOOKBACK_MONTHS, LT_MAX_DAYS,
  DEFAULT_WINDOW, WINDOW_MONTHS, Z_BY_SERVICE, DEFAULT_Z, WAREHOUSES, INVENTORY_ID,
  STATUS_META, MIN_VERDICT_META, derive,
  type SafetyStockPayload, type Status,
} from "@/lib/safety-stock-core"

/** ความครอบคลุมของ min/max ต่อคลัง — ตัวเลขจริงจากรอบซิงก์ล่าสุดที่ตรวจสอบตอนเขียนเอกสารนี้ (19 ส.ค. 2569)
 *  ไม่มี endpoint ที่คืนจำนวน SKU "ทั้งหมด" ต่อคลัง (เฉพาะที่ตั้ง min/max เท่านั้นที่เข้า safety_stock_snapshot)
 *  จึงบันทึกไว้ตรงนี้เป็นภาพนิ่ง แทนที่จะคำนวณสดจาก payload — ต้องอัปเดตเลขนี้เองถ้าอยากได้ค่าล่าสุดเป๊ะ */
const COVERAGE: { inventoryId: string; withMinMax: number; total: number }[] = [
  { inventoryId: "4", withMinMax: 4100, total: 9796 }, // ลาดกระบัง
  { inventoryId: "3", withMinMax: 497, total: 4998 },  // สระบุรี
  { inventoryId: "11", withMinMax: 1596, total: 1867 }, // ขอนแก่น
  { inventoryId: "24", withMinMax: 447, total: 775 },  // DIST
]
const COVERAGE_TOTAL = COVERAGE.reduce((s, c) => s + c.total, 0)
const COVERAGE_WITH = COVERAGE.reduce((s, c) => s + c.withMinMax, 0)
const pct = (n: number, d: number) => Math.round((n / d) * 1000) / 10

const num = (n: number, digits = 2) => n.toLocaleString("th-TH", { maximumFractionDigits: digits })
const thaiDateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("th-TH", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "—"

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

const STATUS_TONE_CLASS: Record<string, string> = {
  zinc: "bg-zinc-100 text-zinc-700 dark:bg-white/10 dark:text-zinc-300",
  orange: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  emerald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
}

/** สิ่งที่ทีม store ต้องทำเมื่อเจอแต่ละสถานะ — คนละคอลัมน์กับ `hint` ใน STATUS_META ซึ่งอธิบาย "ความหมาย" */
const STATUS_ACTION: Record<Status, string> = {
  out: "สั่งด่วนที่สุด — ของหมดแล้วแต่ยังมีคนเบิกใช้อยู่ หน้างานเสี่ยงหยุดรองาน",
  below_rop: "สั่งวันนี้ — คงเหลือต่ำกว่าจุดสั่งซื้อ (ROP) แล้ว รอช้าไปวันเดียวก็เสี่ยงของขาดก่อนของใหม่มาถึง",
  below_min: "ยังไม่ต้องสั่งด่วน แต่ต่ำกว่า min ที่ตั้งไว้ใน ATMS แล้ว — เฝ้าดูใกล้ชิดกว่าปกติ",
  over_max: "ตรวจว่าซื้อเกินมาจริงหรือ max ตั้งไว้ต่ำเกินความจริง — เป็นเงินจมโดยไม่จำเป็น",
  no_usage: "ทบทวนว่าควรเลิกตั้ง min/max หรือไม่ — ตั้งไว้แต่ไม่มีการเบิกเลยตลอด 12 เดือน",
  ok: "ไม่ต้องทำอะไร อยู่ในช่วงที่เหมาะสมแล้ว",
}

function Card({ icon: Icon, no, title, children }: {
  icon: React.ElementType; no?: string; title: string; children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5">
      <div className="flex items-center gap-2.5 mb-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600">
          <Icon size={16} />
        </span>
        <p className="text-sm font-bold text-gray-900 dark:text-white">
          {no && <span className="text-emerald-600 mr-1.5">{no}</span>}{title}
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

/** ขั้นคำนวณเดียว — เลขซ้าย (สูตรเป็นสัญลักษณ์) เลขขวา (แทนค่าจริงจากรหัสตัวอย่าง) */
function FormulaStep({ no, title, formula, plug, result, note }: {
  no: number; title: string; formula: string; plug: string; result: string; note?: string
}) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-white/8 p-3.5">
      <p className="text-[13px] font-bold text-gray-800 dark:text-gray-200 mb-1.5">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white text-[11px] font-bold mr-1.5">{no}</span>
        {title}
      </p>
      <p className="font-mono text-[12px] text-gray-500 dark:text-gray-400 mb-1">{formula}</p>
      <p className="font-mono text-[12.5px] text-gray-800 dark:text-gray-200">{plug} = <span className="font-bold text-emerald-700 dark:text-emerald-400">{result}</span></p>
      {note && <p className="text-[11.5px] text-gray-500 dark:text-gray-500 mt-1.5">{note}</p>}
    </div>
  )
}

export default function SafetyStockBaselinePage() {
  const [data, setData] = useState<SafetyStockPayload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/safety-stock?inventory=${INVENTORY_ID}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setData(d) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const win = DEFAULT_WINDOW
  const z = DEFAULT_Z

  // เลือกรหัสตัวอย่างจากข้อมูลจริง — เลือกที่ lead time มาจากรายรหัสเอง (ไม่ใช่ค่ากลางทั้งคลัง) และมีการเบิกจริง
  // ให้เห็นการคำนวณครบทุกขั้น ไม่ใช่รหัสที่ตกกรณีขอบ (edge case) ตั้งแต่ต้น
  const example = useMemo(() => {
    if (!data || data.rows.length === 0) return null
    const rows = data.rows
    const row =
      rows.find((r) => r.leadTimeSource === "sku" && r.usage[win] > 0 && r.minQty > 0 && r.stockQty > 0) ??
      rows.find((r) => r.leadTimeSource === "sku" && r.usage[win] > 0) ??
      rows.find((r) => r.usage[win] > 0) ??
      rows[0]
    return { row, d: derive(row, win, z) }
  }, [data, win, z])

  const staleDays = data?.latestMovementDate ? daysSince(data.latestMovementDate) : null
  const isStale = staleDays !== null && staleDays > 2

  return (
    <div className="p-5 md:p-6 max-w-[1400px] mx-auto">
      <Link
        href="/safety-stock"
        className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-emerald-600 transition-colors mb-3"
      >
        <ArrowLeft size={12} /> กลับไปหน้าจุดสั่งซื้อ
      </Link>
      <h1 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">
        นิยามตัวชี้วัด — จุดสั่งซื้อ (Safety Stock)
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        เอกสารกำกับตัวชี้วัดจุดสั่งซื้อ ครอบคลุมทั้ง 4 คลัง (ลาดกระบัง สระบุรี ขอนแก่น DIST) — อธิบายที่มาตัวเลข สูตรคำนวณ
        และข้อจำกัดที่ต้องรู้ก่อนใช้ตัดสินใจสั่งของ
      </p>

      {/* แถบความสด — ใช้ข้อมูลจริงจากคลังลาดกระบัง ให้เห็นของจริงว่าต้องเช็คแถบนี้เสมอ (ข้อจำกัด 4) */}
      {isStale && data && (
        <div className="mb-5 flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-[12.5px] font-semibold text-white">
          <TriangleAlert size={15} className="shrink-0" />
          ข้อมูลการเคลื่อนไหวล่าสุด (คลังลาดกระบัง) คือ {thaiDateTime(data.latestMovementDate)} ({staleDays} วันที่แล้ว) — ก่อนตัดสินใจสั่งของ ให้ตรวจแถบนี้ที่หน้า
          {" "}<Link href="/safety-stock" className="underline">/safety-stock</Link> ก่อนเสมอ
        </div>
      )}

      {/* ── 4 การ์ดบนสุด ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 mb-5">
        <Card icon={Database} no="1." title="ที่มาของแต่ละตัวเลข">
          <p>
            <span className="font-semibold text-gray-800 dark:text-gray-200">คงเหลือ (on-hand)</span> มาจากระบบ{" "}
            <span className="font-semibold">ATMS</span> ณ เวลาที่ sync ล่าสุด — ไม่ใช่การนับของจริงในชั้นวาง
          </p>
          <p>
            <span className="font-semibold text-gray-800 dark:text-gray-200">ยอดเบิก</span> มาจาก{" "}
            <span className="font-mono text-xs">atms.stockmovement_v5</span> ย้อนหลัง {USAGE_LOOKBACK_MONTHS} เดือน
          </p>
          <p>
            <span className="font-semibold text-gray-800 dark:text-gray-200">Lead Time</span> คำนวณจากคู่ใบขอสั่งซื้อ (PR) →
            วันที่รับของจริงใน v5 ย้อนหลัง {LT_LOOKBACK_MONTHS} เดือน — คู่ที่ห่างกันเกิน {LT_MAX_DAYS} วันถือว่าข้อมูลเพี้ยน ตัดทิ้ง
          </p>
        </Card>

        <Card icon={CalendarRange} no="2." title="รอบซิงก์ข้อมูล">
          <p>
            รันวันละครั้ง ต่อท้าย cron แจ้ง SKU ใหม่เดิม (<span className="font-mono text-xs">atms-sku-report</span>)
            เวลา 10:00 น. ไทย — หลัง pipeline <span className="font-mono text-xs">stockmovement_v5</span> เขียนเสร็จราว 09:25 น.
          </p>
          <p>
            ลำดับ: sync min/max จาก ATMS ก่อน แล้วค่อยสร้าง snapshot ต่อ — ยิงเรียงกันในการเรียกครั้งเดียว
            ไม่ยิงคู่ขนาน เพื่อไม่ให้ ATMS ล่ม (เคยวัดจริงว่ายิงถี่ทำให้ error rate พุ่งถึง 40% ใน 35 นาที)
          </p>
          <p className="text-amber-700 dark:text-amber-400 font-semibold">
            pipeline ต้นทางเคยตายเงียบมาแล้ว 2 ครั้ง — ดูแถบวันที่ด้านบนเสมอก่อนตัดสินใจ
          </p>
        </Card>

        <Card icon={Layers} no="3." title="ความครอบคลุม (min/max)">
          <p>
            ครอบคลุม <span className="font-semibold text-gray-800 dark:text-gray-200">{COVERAGE_WITH.toLocaleString()} จาก {COVERAGE_TOTAL.toLocaleString()} SKU
            ทั้ง 4 คลัง ({pct(COVERAGE_WITH, COVERAGE_TOTAL)}%)</span> — เฉพาะรหัสที่ตั้ง min หรือ max ไว้ใน ATMS แล้วเท่านั้น
          </p>
          <div className="space-y-1 text-[12.5px]">
            {COVERAGE.map((c) => {
              const w = WAREHOUSES.find((x) => x.id === c.inventoryId)
              return (
                <div key={c.inventoryId} className="flex justify-between">
                  <span>{w?.name ?? c.inventoryId}</span>
                  <span className="font-mono">{c.withMinMax.toLocaleString()} / {c.total.toLocaleString()} ({pct(c.withMinMax, c.total)}%)</span>
                </div>
              )
            })}
          </div>
        </Card>

        <Card icon={Calculator} no="4." title="สรุปสูตรย่อ">
          <p className="font-mono text-[11.5px] leading-relaxed">
            ADU = ยอดเบิก ÷ (เดือน × {DAYS_PER_MONTH.toFixed(2)})<br />
            SD วัน = SD(ยอดเบิกรายเดือน) ÷ √{DAYS_PER_MONTH.toFixed(2)}<br />
            SS = z × SD วัน × √LT<br />
            ROP = ADU × LT + SS<br />
            คงเหลือพอกี่วัน = คงเหลือ ÷ ADU<br />
            แนะนำสั่ง = ปัดขึ้น(เป้าหมาย − คงเหลือ)
          </p>
          <p className="text-[11.5px]">ดูรายละเอียดพร้อมตัวอย่างคำนวณจริงด้านล่าง</p>
        </Card>
      </div>

      {/* ── สูตรทั้ง 6 ตัว พร้อมตัวอย่างคำนวณจริง ── */}
      <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5 mb-5">
        <div className="flex items-center gap-2.5 mb-1">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600">
            <BookOpen size={16} />
          </span>
          <p className="text-sm font-bold text-gray-900 dark:text-white">สูตรทั้ง 6 ตัว พร้อมตัวอย่างคำนวณจริง</p>
        </div>
        <p className="text-xs text-gray-500 mb-4 pl-[42px]">
          เดินสูตรทีละขั้นด้วยรหัสจริงจากคลังลาดกระบัง หน้าต่างเวลา {WINDOW_MONTHS[win]} เดือน (ค่าเริ่มต้น) service level 95%
          (z = {Z_BY_SERVICE[95]}) — ตัวเลขทุกตัวคำนวณสดจากฟังก์ชันเดียวกับที่หน้า /safety-stock ใช้จริง
        </p>

        {loading && !example && <p className="text-sm text-gray-400 pl-[42px]">กำลังดึงตัวอย่างจากข้อมูลจริง...</p>}

        {example && (
          <>
            <div className="mb-4 pl-[42px] flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-mono text-sm font-bold text-gray-900 dark:text-white">{example.row.code}</span>
              <span className="text-sm text-gray-700 dark:text-gray-300">{example.row.name}</span>
              <span className="text-xs text-gray-400">
                {example.row.group} · หน่วย {example.row.unit} · min {num(example.row.minQty)} · max {num(example.row.maxQty)} · คงเหลือ {num(example.row.stockQty)}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              <FormulaStep
                no={1}
                title="ADU — ยอดเบิกเฉลี่ยต่อวัน"
                formula="ADU = ยอดเบิกรวมในหน้าต่าง ÷ (จำนวนเดือน × 365/12)"
                plug={`${num(example.row.usage[win])} ${example.row.unit} ÷ (${WINDOW_MONTHS[win]} × ${DAYS_PER_MONTH.toFixed(2)})`}
                result={`${num(example.d.adu, 3)} ${example.row.unit}/วัน`}
              />
              <FormulaStep
                no={2}
                title="SD รายวัน — ความผันผวนของการเบิก"
                formula="SD วัน = SD(ยอดเบิกรายเดือน) ÷ √(365/12)"
                plug={`SD ของยอดเบิก ${WINDOW_MONTHS[win]} เดือนล่าสุด ÷ √${DAYS_PER_MONTH.toFixed(2)}`}
                result={`${num(example.d.sdDaily, 3)} ${example.row.unit}/วัน`}
                note="ใช้ SD ของยอดรายเดือนแล้วแปลงเป็นรายวัน — ถ้าใช้รายวันตรงๆ วันที่ไม่มีการเบิกจะทำให้ SD บวมเกินจริง"
              />
              <FormulaStep
                no={3}
                title="Safety Stock (SS) — สต๊อกกันชน"
                formula="SS = z × SD วัน × √LT"
                plug={`${Z_BY_SERVICE[95]} × ${num(example.d.sdDaily, 3)} × √${example.row.leadTimeDays}`}
                result={`${num(example.d.safetyStock)} ${example.row.unit}`}
              />
              <FormulaStep
                no={4}
                title="จุดสั่งซื้อ (ROP)"
                formula="ROP = ADU × LT + SS"
                plug={`${num(example.d.adu, 3)} × ${example.row.leadTimeDays} + ${num(example.d.safetyStock)}`}
                result={`${num(example.d.reorderPoint)} ${example.row.unit}`}
              />
              <FormulaStep
                no={5}
                title="คงเหลือพอใช้อีกกี่วัน"
                formula="Days of Supply = คงเหลือ ÷ ADU"
                plug={`${num(example.row.stockQty)} ÷ ${num(example.d.adu, 3)}`}
                result={example.d.daysOfSupply === null ? "คำนวณไม่ได้ (ไม่มีการเบิก)" : `${num(example.d.daysOfSupply)} วัน`}
              />
              <FormulaStep
                no={6}
                title="ปริมาณแนะนำให้สั่ง"
                formula="แนะนำสั่ง = ปัดขึ้น(เป้าหมาย − คงเหลือ), เป้าหมาย = max ถ้าตั้งไว้ ไม่งั้น ROP + ADU×LT"
                plug={`เป้าหมาย ${num(example.row.maxQty > 0 ? example.row.maxQty : example.d.reorderPoint + example.d.adu * example.row.leadTimeDays)} − คงเหลือ ${num(example.row.stockQty)}`}
                result={`${num(example.d.suggestQty)} ${example.row.unit}`}
              />
            </div>

            <p className="mt-3 pl-[42px] text-[12px] text-gray-500">
              สรุปรหัสนี้: สถานะ <span className="font-semibold text-gray-700 dark:text-gray-300">{STATUS_META.find((s) => s.key === example.d.status)?.th}</span> ·
              ตรวจ min <span className="font-semibold text-gray-700 dark:text-gray-300">{MIN_VERDICT_META[example.d.minVerdict].th}</span> ·
              ที่มา Lead Time: {example.row.leadTimeSource === "sku" ? `รายรหัส (${example.row.leadTimeSamples} ครั้ง)` : example.row.leadTimeSource === "group" ? "ค่ากลางกลุ่มสินค้า" : "ค่ากลางทั้งคลัง"}
            </p>
          </>
        )}
      </div>

      {/* ── ตารางสถานะ 6 แบบ ── */}
      <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5 mb-5">
        <div className="flex items-center gap-2.5 mb-1">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600">
            <Layers size={16} />
          </span>
          <p className="text-sm font-bold text-gray-900 dark:text-white">ตารางสถานะ 6 แบบ</p>
        </div>
        <p className="text-xs text-gray-500 mb-4 pl-[42px]">
          เรียงตามความเร่งด่วนที่ทีม store ต้องลงมือ — ใช้ชุดเดียวกันทั้งตาราง ตัวกรอง และการ์ดสรุปที่หน้า /safety-stock
        </p>
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-white/8">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-white/[0.03] text-left">
                <th className="px-3 py-2 font-bold text-gray-700 dark:text-gray-300 whitespace-nowrap">สถานะ</th>
                <th className="px-3 py-2 font-bold text-gray-700 dark:text-gray-300">ความหมาย</th>
                <th className="px-3 py-2 font-bold text-gray-700 dark:text-gray-300">ต้องทำอะไร</th>
              </tr>
            </thead>
            <tbody className="text-gray-600 dark:text-gray-400">
              {STATUS_META.map((s, i) => (
                <tr key={s.key} className="border-t border-gray-100 dark:border-white/5 align-top">
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ${STATUS_TONE_CLASS[s.tone]}`}>
                      {i + 1}. {s.th}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 leading-relaxed min-w-[220px]">{s.hint}</td>
                  <td className="px-3 py-2.5 leading-relaxed min-w-[260px] font-medium text-gray-700 dark:text-gray-300">{STATUS_ACTION[s.key]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── ทำไม no_usage ต้องมาก่อน ── */}
      <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5 mb-5">
        <div className="flex items-center gap-2.5 mb-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600">
            <ListChecks size={16} />
          </span>
          <p className="text-sm font-bold text-gray-900 dark:text-white">ทำไม &quot;ตั้งไว้แต่ไม่ใช้&quot; (no_usage) ต้องเช็คก่อนเสมอ</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <QA
            q="ทำไมเช็คก่อนสถานะอื่นทั้งหมด ?"
            a="ADU, SD, Safety Stock และ ROP ทุกตัวคำนวณจากยอดเบิกทั้งสิ้น — ถ้ารหัสไหนไม่มีการเบิกเลยใน 12 เดือน ตัวเลขเหล่านี้เป็นศูนย์หมด ปล่อยให้ไหลไปเช็คเงื่อนไขอื่นก่อนจะทำให้ตกไปติด below_min ผิดที่ทันที"
          />
          <QA
            q="ปนกันแล้วเป็นปัญหาอย่างไร ?"
            a={<>&quot;ต่ำกว่า min&quot; บอกให้ <span className="font-semibold">สั่งของเพิ่ม</span> ส่วน &quot;ตั้งไว้แต่ไม่ใช้&quot; บอกให้ <span className="font-semibold">พิจารณาเลิกตั้ง min/max</span> — เป็นการกระทำคนละทางกันโดยสิ้นเชิง ถ้าปนกันทีมจัดซื้ออาจสั่งของที่ไม่มีใครใช้เข้าคลังเพิ่มโดยไม่รู้ตัว</>}
          />
        </div>
      </div>

      {/* ── ตรวจ min (bonus) ── */}
      <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-5 mb-5">
        <div className="flex items-center gap-2.5 mb-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600">
            <HelpCircle size={16} />
          </span>
          <p className="text-sm font-bold text-gray-900 dark:text-white">คอลัมน์ &quot;ตรวจ min&quot; คืออะไร</p>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          เทียบ min ที่ตั้งไว้ใน ATMS กับ ROP ที่คำนวณได้ — ช่วยดูว่า min เดิมยังเหมาะกับพฤติกรรมการเบิกปัจจุบันหรือไม่
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {(Object.keys(MIN_VERDICT_META) as (keyof typeof MIN_VERDICT_META)[]).map((k) => (
            <div key={k} className="rounded-lg bg-gray-50 dark:bg-white/[0.03] p-3">
              <p className="text-[12.5px] font-bold text-gray-800 dark:text-gray-200">{MIN_VERDICT_META[k].th}</p>
              <p className="text-[11.5px] text-gray-500 mt-0.5 leading-relaxed">{MIN_VERDICT_META[k].hint}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── ข้อจำกัดที่ต้องบอกตรงๆ ── */}
      <div className="rounded-xl border border-dashed border-amber-400/50 bg-amber-50/50 dark:bg-amber-500/5 p-5">
        <div className="flex items-center gap-2.5 mb-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white">
            <ShieldCheck size={16} />
          </span>
          <p className="text-sm font-bold text-gray-900 dark:text-white">ข้อจำกัดที่ต้องบอกตรงๆ</p>
        </div>
        <ul className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed space-y-3 list-disc pl-5">
          <li>
            <span className="font-semibold">min/max ครอบคลุมเฉพาะบางส่วนของ SKU แต่ละคลัง</span> — รวมทั้ง 4 คลัง {COVERAGE_WITH.toLocaleString()}
            {" "}จาก {COVERAGE_TOTAL.toLocaleString()} SKU (≈{pct(COVERAGE_WITH, COVERAGE_TOTAL)}%): ลาดกระบัง 4,100/9,796 (≈42%) ·
            สระบุรี 497/4,998 (≈10%) · ขอนแก่น 1,596/1,867 (≈85%) · DIST 447/775 (≈58%) — ส่วนที่เหลือยังไม่ได้ตั้ง min/max
            จึง<span className="font-semibold">ไม่ปรากฏในหน้านี้เลย</span> ไม่ใช่ว่าไม่มีปัญหา
          </li>
          <li>
            <span className="font-semibold">Lead Time ที่มาจาก &quot;ค่ากลางทั้งคลัง&quot; เป็นการเดา</span> — ใช้ตอนไม่มีข้อมูล PR→รับของ
            พอทั้งรายรหัสและรายกลุ่ม ใช้ประกอบการตัดสินใจได้ แต่<span className="font-semibold">ห้ามใช้ตัดสินว่า min เหมาะสมหรือไม่</span>
            {" "}(คอลัมน์ &quot;ตรวจ min&quot; จะขึ้น &quot;ประเมินไม่ได้&quot; โดยอัตโนมัติในกรณีนี้)
          </li>
          <li>
            <span className="font-semibold">ยอดคงเหลือเป็นตัวเลขจาก ATMS ณ เวลาที่ sync</span> ไม่ใช่การนับของจริงในชั้นวาง —
            ถ้าของหน้างานกับตัวเลขในระบบไม่ตรงกัน ให้เชื่อของจริงและแจ้งปรับปรุงข้อมูลใน ATMS
          </li>
          <li>
            <span className="font-semibold">ข้อมูลการเคลื่อนไหวอัปเดตวันละครั้ง</span> และ pipeline ต้นทาง (
            <span className="font-mono text-xs">stockmovement_v5</span>) เคยตายเงียบมาแล้ว 2 ครั้ง —{" "}
            <span className="font-semibold">ให้ดูแถบวันที่ที่หน้า /safety-stock เสมอ</span> ก่อนใช้ตัวเลขตัดสินใจสั่งของ
          </li>
        </ul>
      </div>
    </div>
  )
}
