"use client"

import React, { useState, useCallback, useEffect } from "react"
import {
  Search, Package, FileText, ShoppingCart, Truck,
  ArrowLeftRight, Loader2, AlertCircle, ChevronDown, ChevronRight,
} from "lucide-react"

// ── Types ─────────────────────────────────────────────────────────────────────

type Rec = Record<string, unknown>

type SearchResult = {
  query: string
  type: "WD" | "DD" | "MR" | "PO" | "PR" | "unknown"
  mr?: Rec | null
  mr_parts?: Rec[]
  dds?: Rec[]
  dd_items?: Rec[]
  dd?: Rec | null
  related_wds?: string[]
  wds?: string[]
  po?: Rec | null
  po_code?: string
  pr_code?: string
  pr_detail?: Rec | null
  pos?: Rec[]
  note?: string
  linked_mr_code?: string
}

type ChainSlot = {
  type: "PR" | "PO" | "DD" | "WD" | "MR"
  codes: string[]
  pending: boolean
  pendingReason?: "stock" | "not_indexed"
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, { bg: string; text: string; border: string; badge: string }> = {
  MR: { bg: "bg-purple-50 dark:bg-purple-900/20", text: "text-purple-800 dark:text-purple-300", border: "border-purple-200 dark:border-purple-700", badge: "bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300 border-purple-200 dark:border-purple-700" },
  WD: { bg: "bg-blue-50 dark:bg-blue-900/20",     text: "text-blue-800 dark:text-blue-300",     border: "border-blue-200 dark:border-blue-700",     badge: "bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-700" },
  DD: { bg: "bg-green-50 dark:bg-green-900/20",   text: "text-green-800 dark:text-green-300",   border: "border-green-200 dark:border-green-700",   badge: "bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 border-green-200 dark:border-green-700" },
  PO: { bg: "bg-amber-50 dark:bg-amber-900/20",   text: "text-amber-800 dark:text-amber-300",   border: "border-amber-200 dark:border-amber-700",   badge: "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-700" },
  PR: { bg: "bg-pink-50 dark:bg-pink-900/20",     text: "text-pink-800 dark:text-pink-300",     border: "border-pink-200 dark:border-pink-700",     badge: "bg-pink-100 dark:bg-pink-900/40 text-pink-800 dark:text-pink-300 border-pink-200 dark:border-pink-700" },
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  MR: <Truck className="w-3.5 h-3.5" />,
  WD: <ArrowLeftRight className="w-3.5 h-3.5" />,
  DD: <Package className="w-3.5 h-3.5" />,
  PO: <ShoppingCart className="w-3.5 h-3.5" />,
  PR: <FileText className="w-3.5 h-3.5" />,
}

const TYPE_LABELS: Record<string, string> = {
  MR: "ใบแจ้งซ่อม", WD: "ใบเบิก", DD: "ใบรับสินค้า", PO: "ใบสั่งซื้อ", PR: "ใบขอสั่งซื้อ",
}

const CHAIN_ORDER: Array<"PR" | "PO" | "DD" | "WD" | "MR"> = ["PR", "PO", "DD", "WD", "MR"]

const EXAMPLES = ["SBDD26060615", "SBWD26060650", "SBPO26060489", "SBMR26060269"]

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectType(q: string): "WD" | "DD" | "MR" | "PO" | "PR" | "unknown" {
  const u = q.toUpperCase()
  if (u.includes("WD")) return "WD"
  if (u.includes("DD")) return "DD"
  if (u.includes("MR")) return "MR"
  if (/PO\d/.test(u)) return "PO"
  if (/PR\d/.test(u)) return "PR"
  return "unknown"
}

function deriveChain(result: SearchResult): ChainSlot[] {
  // PR
  const prCodes = result.pr_code ? [result.pr_code] : []

  // PO — from pos array, po object, po_code, or DD's purchase_order
  const poCodes = [
    ...((result.pos || []).map(p => String(p.po_code || "")).filter(Boolean)),
    ...(result.po ? [String((result.po as Rec).po_code || "")] : []),
    ...(result.po_code ? [result.po_code] : []),
    ...(result.dds || []).map(d => String(d.purchase_order || "")).filter(Boolean),
    ...(result.dd ? [String((result.dd as Rec).purchase_order || "")].filter(Boolean) : []),
  ]
  const uniquePOs = [...new Set(poCodes.filter(Boolean))]

  // DD
  const ddCodes = [
    ...(result.dd ? [String((result.dd as Rec).deposit_code || "")] : []),
    ...(result.dds || []).map(d => String(d.deposit_code || "")).filter(Boolean),
  ]
  const uniqueDDs = [...new Set(ddCodes.filter(Boolean))]

  // WD — from explicit wds array OR from withdraw_ref on merged dds
  let wdCodes: string[] = []
  if (result.type === "WD") wdCodes = [result.query]
  else if (result.type === "DD") wdCodes = result.related_wds || []
  else {
    wdCodes = [
      ...(result.wds || []),
      ...(result.dds || []).map(d => String(d.withdraw_ref || "")).filter(Boolean),
    ]
  }
  const uniqueWDs = [...new Set(wdCodes.filter(Boolean))]

  // MR — use repair-analysis data if available, else fall back to linked_mr_code from หมายเหตุ
  const mrCode = result.mr
    ? String((result.mr as Rec).request_code || "")
    : (result.linked_mr_code || null)

  // Pending PR/PO on a repair-only chain means parts came from internal stock
  // (not applicable when PR/PO are actually present)
  const isRepairChain = (!!mrCode || !!result.wds?.length || result.type === "MR" || result.type === "WD")
    && prCodes.length === 0 && uniquePOs.length === 0

  return [
    { type: "PR", codes: prCodes,   pending: prCodes.length === 0,   pendingReason: prCodes.length === 0   ? (isRepairChain ? "stock" : "not_indexed") : undefined },
    { type: "PO", codes: uniquePOs, pending: uniquePOs.length === 0, pendingReason: uniquePOs.length === 0 ? (isRepairChain ? "stock" : "not_indexed") : undefined },
    { type: "DD", codes: uniqueDDs, pending: uniqueDDs.length === 0, pendingReason: uniqueDDs.length === 0 ? "not_indexed" : undefined },
    { type: "WD", codes: uniqueWDs, pending: uniqueWDs.length === 0, pendingReason: uniqueWDs.length === 0 ? "not_indexed" : undefined },
    { type: "MR", codes: mrCode ? [mrCode] : [], pending: !mrCode,   pendingReason: !mrCode ? "not_indexed" : undefined },
  ]
}

function fmtNum(n: unknown): string {
  const v = Number(n)
  if (!isNaN(v) && v) return v.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return String(n || "—")
}

// ── Small components ──────────────────────────────────────────────────────────

function TypeBadge({ type, size = "sm" }: { type: string; size?: "xs" | "sm" }) {
  const c = TYPE_COLORS[type]
  const pad = size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs"
  return (
    <span className={`inline-flex items-center gap-1 rounded font-bold uppercase border ${pad} ${c?.badge || ""}`}>
      {TYPE_ICONS[type]} {type}
    </span>
  )
}

function CodeButton({ code, type, active, onClick }: { code: string; type: string; active?: boolean; onClick: (c: string) => void }) {
  const c = TYPE_COLORS[type]
  return (
    <button
      onClick={() => onClick(code)}
      className={[
        "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-mono font-semibold transition-all",
        active
          ? `${c?.bg} ${c?.text} ${c?.border} ring-2 ring-offset-1 ring-current shadow-sm scale-[1.02]`
          : `bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:${c?.bg} hover:${c?.text} hover:${c?.border}`,
      ].join(" ")}
    >
      {TYPE_ICONS[type]}
      {code}
    </button>
  )
}

// ── Stats Bar ─────────────────────────────────────────────────────────────────

function StatsBar({ result }: { result: SearchResult }) {
  const counts: Partial<Record<string, number>> = {}
  if (result.mr) counts.MR = 1
  const wdCount = (result.wds || result.related_wds || (result.type === "WD" ? [result.query] : [])).length
  if (wdCount) counts.WD = wdCount
  const ddCount = (result.dds?.length || 0) + (result.dd ? 1 : 0)
  if (ddCount) counts.DD = ddCount
  const poCount = (result.pos?.length || 0) + (result.po ? 1 : 0) + (result.po_code ? 1 : 0)
  if (poCount) counts.PO = poCount
  if (result.pr_code) counts.PR = 1

  // total from mr_parts or dd_items
  const partsTotal = (result.mr_parts || []).reduce((s, r) => s + (Number(r.total) || 0), 0)
  const ddTotal = (result.dd_items || []).reduce((s, r) => s + (Number(r.total) || 0), 0)
  const total = partsTotal || ddTotal

  if (!Object.keys(counts).length) return null
  return (
    <div className="flex flex-wrap items-center gap-2 py-2 px-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
      {CHAIN_ORDER.map(t => counts[t] !== undefined && (
        <span key={t} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md border text-xs font-semibold ${TYPE_COLORS[t]?.badge}`}>
          {TYPE_ICONS[t]} {counts[t]} {t}
        </span>
      ))}
      {total > 0 && (
        <span className="ml-auto text-xs font-semibold text-gray-600 dark:text-gray-300">
          ฿{total.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
        </span>
      )}
    </div>
  )
}

// ── Chain Rail ────────────────────────────────────────────────────────────────

function ChainRail({ slots, selected, onSelect }: {
  slots: ChainSlot[]
  selected: string | null
  onSelect: (code: string) => void
}) {
  return (
    <div className="flex items-start gap-1 overflow-x-auto pb-1">
      {slots.map((slot, i) => (
        <React.Fragment key={slot.type}>
          {i > 0 && (
            <div className="flex items-center self-center shrink-0 px-1 text-gray-300 dark:text-gray-600">
              <ChevronRight className="w-4 h-4" />
            </div>
          )}
          <div className="flex flex-col gap-1 shrink-0">
            <span className="text-[10px] font-semibold uppercase text-gray-400 dark:text-gray-500 text-center px-1">
              {TYPE_LABELS[slot.type]}
            </span>
            {slot.pending ? (
              <div className={[
                "inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-dashed text-xs font-mono opacity-70",
                slot.pendingReason === "stock"
                  ? "border-teal-300 dark:border-teal-700 text-teal-600 dark:text-teal-400"
                  : "border-gray-300 dark:border-gray-600 text-gray-400",
              ].join(" ")}>
                {TYPE_ICONS[slot.type]}
                {slot.pendingReason === "stock" ? "เบิกจากคลัง" : "ยังไม่ได้ index"}
              </div>
            ) : (
              slot.codes.map(code => (
                <CodeButton
                  key={code}
                  code={code}
                  type={slot.type}
                  active={selected === code}
                  onClick={onSelect}
                />
              ))
            )}
          </div>
        </React.Fragment>
      ))}
    </div>
  )
}

// ── Collapsible Table ─────────────────────────────────────────────────────────

function CollapsibleTable({
  label, count, children,
}: { label: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  if (!count) return null
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        {label} ({count})
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  )
}

// ── Parts Tables ──────────────────────────────────────────────────────────────

function MRPartsTable({ parts }: { parts: Rec[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400">
            <th className="px-3 py-2 text-left font-medium">กลุ่ม</th>
            <th className="px-3 py-2 text-left font-medium">อะไหล่</th>
            <th className="px-3 py-2 text-right font-medium">Qty</th>
            <th className="px-3 py-2 text-right font-medium">Unit Price</th>
            <th className="px-3 py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
          {parts.map((it, i) => (
            <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
              <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400">{String(it.parts_group || "")}</td>
              <td className="px-3 py-1.5 text-gray-800 dark:text-gray-200 font-mono">{String(it.part || "")}</td>
              <td className="px-3 py-1.5 text-right">{String(it.qty || "")}</td>
              <td className="px-3 py-1.5 text-right">{fmtNum(it.unit_price)}</td>
              <td className="px-3 py-1.5 text-right font-medium">{fmtNum(it.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DDItemsTable({ items }: { items: Rec[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400">
            <th className="px-3 py-2 text-left font-medium">กลุ่ม</th>
            <th className="px-3 py-2 text-left font-medium">สินค้า</th>
            <th className="px-3 py-2 text-left font-medium">Serial No.</th>
            <th className="px-3 py-2 text-right font-medium">Qty</th>
            <th className="px-3 py-2 text-right font-medium">Unit Price</th>
            <th className="px-3 py-2 text-right font-medium">Total</th>
            <th className="px-3 py-2 text-left font-medium">Remark</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
          {items.map((it, i) => (
            <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
              <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400">{String(it.parts_group || "")}</td>
              <td className="px-3 py-1.5 text-gray-800 dark:text-gray-200 font-mono">{String(it.item || "")}</td>
              <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400 font-mono text-[10px]">{String(it.serial_no || "")}</td>
              <td className="px-3 py-1.5 text-right">{String(it.qty || "")}</td>
              <td className="px-3 py-1.5 text-right">{fmtNum(it.unit_price)}</td>
              <td className="px-3 py-1.5 text-right font-medium">{fmtNum(it.total)}</td>
              <td className="px-3 py-1.5 text-gray-400 dark:text-gray-500 max-w-[160px] truncate">{String(it.remark || "")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: unknown }) {
  if (!value) return null
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">{label}</span>
      <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{String(value)}</span>
    </div>
  )
}

function DetailCard({ type, code, children }: { type: string; code: string; children?: React.ReactNode }) {
  const c = TYPE_COLORS[type]
  return (
    <div className={`rounded-2xl border ${c?.border} ${c?.bg} p-5 h-full`}>
      <div className="flex items-center gap-2 mb-4">
        <TypeBadge type={type} />
        <span className="text-[11px] text-gray-400 dark:text-gray-500">{TYPE_LABELS[type]}</span>
      </div>
      <div className="font-mono font-bold text-lg text-gray-900 dark:text-white mb-4">{code}</div>
      {children}
    </div>
  )
}

function MRDetail({ mr, parts }: { mr: Rec; parts: Rec[] }) {
  const code = String(mr.request_code || "")
  return (
    <DetailCard type="MR" code={code}>
      <div className="grid grid-cols-2 gap-3 mb-2">
        <InfoRow label="ทะเบียน"   value={mr.plate_no} />
        <InfoRow label="สาขา"      value={mr.branch} />
        <InfoRow label="วันแจ้งซ่อม" value={mr.reported_at} />
        <InfoRow label="ช่าง"      value={mr.mechanic} />
        <InfoRow label="ประเภท"    value={mr.owner_type} />
        <InfoRow label="ขั้นตอน"   value={mr.step} />
        <InfoRow label="เลขไมล์"   value={mr.mileage_at_report} />
      </div>
      <CollapsibleTable label="อะไหล่" count={parts.length}>
        <MRPartsTable parts={parts} />
      </CollapsibleTable>
    </DetailCard>
  )
}

function DDDetail({ dd, items, onSearch }: { dd: Rec; items: Rec[]; onSearch: (c: string) => void }) {
  const code = String(dd.deposit_code || "")
  return (
    <DetailCard type="DD" code={code}>
      <div className="grid grid-cols-2 gap-3 mb-2">
        <InfoRow label="คลัง"      value={dd.warehouse} />
        <InfoRow label="รับเมื่อ"  value={dd.received_at} />
        <InfoRow label="ผู้รับ"    value={dd.user} />
        <InfoRow label="ยอดรวม"    value={dd.amount} />
        <InfoRow label="ซัพพลายเออร์" value={dd.supplier} />
      </div>
      {!!dd.withdraw_ref && (
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">อ้างอิง WD</span>
          <button onClick={() => onSearch(String(dd.withdraw_ref))} className={`text-xs font-mono font-semibold px-2 py-0.5 rounded border ${TYPE_COLORS.WD.badge}`}>
            {String(dd.withdraw_ref)}
          </button>
        </div>
      )}
      {!!dd.purchase_order && (
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">อ้างอิง PO</span>
          <button onClick={() => onSearch(String(dd.purchase_order))} className={`text-xs font-mono font-semibold px-2 py-0.5 rounded border ${TYPE_COLORS.PO.badge}`}>
            {String(dd.purchase_order)}
          </button>
        </div>
      )}
      <CollapsibleTable label="รายการสินค้า" count={items.length}>
        <DDItemsTable items={items} />
      </CollapsibleTable>
    </DetailCard>
  )
}

function WDDetail({ code, mr, dds, items, onSearch }: {
  code: string; mr: Rec | null; dds: Rec[]; items: Rec[]; onSearch: (c: string) => void
}) {
  return (
    <DetailCard type="WD" code={code}>
      {mr && (
        <div className="mb-3">
          <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 block mb-1">ใบแจ้งซ่อม</span>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <button onClick={() => onSearch(String(mr.request_code))} className={`text-xs font-mono font-semibold px-2 py-0.5 rounded border ${TYPE_COLORS.MR.badge}`}>
                {String(mr.request_code)}
              </button>
            </div>
            <InfoRow label="ทะเบียน" value={mr.plate_no} />
            <InfoRow label="สาขา"    value={mr.branch} />
            <InfoRow label="ช่าง"    value={mr.mechanic} />
          </div>
        </div>
      )}
      {dds.length > 0 && (
        <div className="mt-2">
          <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 block mb-2">ใบรับสินค้า ({dds.length})</span>
          <div className="space-y-2">
            {dds.map((dd, i) => {
              const ddItems = items.filter(it => it.deposit_id === dd.deposit_id)
              return (
                <div key={i} className={`rounded-lg border p-3 ${TYPE_COLORS.DD.border} ${TYPE_COLORS.DD.bg}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <button onClick={() => onSearch(String(dd.deposit_code))} className={`text-xs font-mono font-semibold px-2 py-0.5 rounded border ${TYPE_COLORS.DD.badge}`}>
                      {String(dd.deposit_code)}
                    </button>
                    <span className="text-xs text-gray-500">{String(dd.received_at || "")}</span>
                  </div>
                  <CollapsibleTable label="รายการสินค้า" count={ddItems.length}>
                    <DDItemsTable items={ddItems} />
                  </CollapsibleTable>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {dds.length === 0 && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">ยังไม่มีใบรับสินค้า (DD) ที่อ้างอิง WD นี้</p>
      )}
    </DetailCard>
  )
}

function PODetail({ code, dds, items, onSearch }: { code: string; dds: Rec[]; items: Rec[]; onSearch: (c: string) => void }) {
  return (
    <DetailCard type="PO" code={code}>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">พบ DD รับสินค้า: {dds.length} ใบ</p>
      {dds.map((dd, i) => {
        const ddItems = items.filter(it => it.deposit_id === dd.deposit_id)
        return (
          <div key={i} className={`rounded-lg border p-3 mb-2 ${TYPE_COLORS.DD.border} ${TYPE_COLORS.DD.bg}`}>
            <div className="flex items-center gap-2 mb-1">
              <button onClick={() => onSearch(String(dd.deposit_code))} className={`text-xs font-mono font-semibold px-2 py-0.5 rounded border ${TYPE_COLORS.DD.badge}`}>
                {String(dd.deposit_code)}
              </button>
              <span className="text-xs text-gray-500">{String(dd.received_at || "")}</span>
            </div>
            <CollapsibleTable label="รายการสินค้า" count={ddItems.length}>
              <DDItemsTable items={ddItems} />
            </CollapsibleTable>
          </div>
        )
      })}
    </DetailCard>
  )
}

function PRDetail({ code, pr_detail, pos, dds, items, note, onSearch }: {
  code: string; pr_detail?: Rec | null; pos: Rec[]; dds: Rec[]; items: Rec[]; note?: string; onSearch: (c: string) => void
}) {
  return (
    <DetailCard type="PR" code={code}>
      {note && <p className="text-xs text-amber-600 dark:text-amber-400 mb-3 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-700">{note}</p>}

      {/* PR header from purchase_requests */}
      {pr_detail && (
        <div className="mb-4 space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <InfoRow label="วันที่"      value={pr_detail["วันที่"]} />
            <InfoRow label="แผนก"       value={pr_detail["แผนก"]} />
            <InfoRow label="ผู้ขอซื้อ"  value={pr_detail["ผู้ขอซื้อ"]} />
            <InfoRow label="คลังสินค้า" value={pr_detail["คลังสินค้า"]} />
            <InfoRow label="ทะเบียน"    value={pr_detail["ทะเบียน"]} />
            <InfoRow label="ยอดรวม"     value={pr_detail["รวม"]} />
          </div>
          {!!pr_detail["หมายเหตุ"] && (
            <div className="mt-2 px-3 py-2 rounded-lg bg-pink-50 dark:bg-pink-900/20 border border-pink-200 dark:border-pink-700">
              <span className="text-[10px] font-medium uppercase tracking-wide text-pink-400 dark:text-pink-500 block mb-0.5">หมายเหตุ</span>
              <span className="text-sm text-pink-800 dark:text-pink-200">{String(pr_detail["หมายเหตุ"])}</span>
            </div>
          )}
          {!!(pr_detail["ผู้อนุมัติระดับที่ 1"] || pr_detail["ผู้อนุมัติระดับที่ 2"]) && (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <InfoRow label="อนุมัติ ลv.1" value={pr_detail["ผู้อนุมัติระดับที่ 1"]} />
              <InfoRow label="อนุมัติ ลv.2" value={pr_detail["ผู้อนุมัติระดับที่ 2"]} />
            </div>
          )}
        </div>
      )}

      {pos.length > 0 ? (
        <div>
          <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 block mb-2">ใบสั่งซื้อ ({pos.length})</span>
          {pos.map((po, i) => (
            <div key={i} className={`rounded-lg border p-3 mb-2 ${TYPE_COLORS.PO.border} ${TYPE_COLORS.PO.bg}`}>
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={() => onSearch(String(po.po_code))} className={`text-xs font-mono font-semibold px-2 py-0.5 rounded border ${TYPE_COLORS.PO.badge}`}>
                  {String(po.po_code)}
                </button>
                {!!po.supplier && <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[200px]">{String(po.supplier)}</span>}
                {!!po.status && <span className="text-xs text-gray-400 dark:text-gray-500">{String(po.status)}</span>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-400 dark:text-gray-500">ยังไม่มีข้อมูล PO ที่เชื่อมกับ PR นี้</p>
      )}
      {dds.length > 0 && (
        <div className="mt-3">
          <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500 block mb-2">ใบรับสินค้า ({dds.length})</span>
          {dds.map((dd, i) => {
            const ddItems = items.filter(it => it.deposit_id === dd.deposit_id)
            return (
              <div key={i} className={`rounded-lg border p-3 mb-2 ${TYPE_COLORS.DD.border} ${TYPE_COLORS.DD.bg}`}>
                <button onClick={() => onSearch(String(dd.deposit_code))} className={`text-xs font-mono font-semibold px-2 py-0.5 rounded border ${TYPE_COLORS.DD.badge}`}>
                  {String(dd.deposit_code)}
                </button>
                <CollapsibleTable label="รายการสินค้า" count={ddItems.length}>
                  <DDItemsTable items={ddItems} />
                </CollapsibleTable>
              </div>
            )
          })}
        </div>
      )}
    </DetailCard>
  )
}

// ── Detail Panel Router ───────────────────────────────────────────────────────

function DetailPanel({ result, selected, onSearch }: {
  result: SearchResult
  selected: string
  onSearch: (c: string) => void
}) {
  const type = detectType(selected)

  if (type === "MR") {
    if (!result.mr) return (
      <div className="flex items-center justify-center h-32 text-sm text-gray-400 dark:text-gray-500">
        ยังไม่พบข้อมูล MR: {selected}
      </div>
    )
    return <MRDetail mr={result.mr} parts={result.mr_parts || []} />
  }

  if (type === "DD") {
    const dd = result.dd || (result.dds || []).find(d => String(d.deposit_code) === selected)
    if (!dd) return <div className="text-sm text-gray-400 dark:text-gray-500">ไม่พบข้อมูล DD: {selected}</div>
    const items = (result.dd_items || []).filter(it => it.deposit_id === dd.deposit_id)
    return <DDDetail dd={dd} items={items} onSearch={onSearch} />
  }

  if (type === "WD") {
    const relDDs = (result.dds || []).filter(d => String(d.withdraw_ref) === selected)
    const relItems = (result.dd_items || []).filter(it =>
      relDDs.some(d => d.deposit_id === it.deposit_id)
    )
    return <WDDetail code={selected} mr={result.mr || null} dds={relDDs} items={relItems} onSearch={onSearch} />
  }

  if (type === "PO") {
    return <PODetail code={selected} dds={result.dds || []} items={result.dd_items || []} onSearch={onSearch} />
  }

  if (type === "PR") {
    return <PRDetail code={selected} pr_detail={result.pr_detail} pos={result.pos || []} dds={result.dds || []} items={result.dd_items || []} note={result.note} onSearch={onSearch} />
  }

  return <div className="text-sm text-gray-400 dark:text-gray-500">ไม่รู้จักรหัส: {selected}</div>
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProcurementSearchPage() {
  const [input, setInput]     = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState<SearchResult | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>([])

  const search = useCallback(async (q: string) => {
    const code = q.trim().toUpperCase()
    if (!code) return
    setLoading(true)
    setError(null)
    setResult(null)
    setSelected(code)
    setInput(code)
    try {
      const res = await fetch(`/api/procurement-search?q=${encodeURIComponent(code)}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setResult(data)
      setHistory(prev => [code, ...prev.filter(h => h !== code)].slice(0, 10))
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  // Reset selected to searched code when result changes
  useEffect(() => { if (result) setSelected(result.query) }, [result])

  const chain = result ? deriveChain(result) : []

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Procurement Search</h1>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
          ค้นหาห่วงโซ่จัดซื้อ · PR → PO → DD → WD → MR
        </p>
      </div>

      {/* Search bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={input}
            onChange={e => setInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === "Enter" && search(input)}
            placeholder="SBMR… / SBWD… / SBDD… / SBPO… / SBPR…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={() => search(input)}
          disabled={loading}
          className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-2 transition-colors"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          ค้นหา
        </button>
      </div>

      {/* Examples + History */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-[11px] text-gray-400">ตัวอย่าง:</span>
        {EXAMPLES.map(ex => {
          const t = detectType(ex)
          const c = TYPE_COLORS[t]
          return (
            <button key={ex} onClick={() => search(ex)}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs font-mono font-semibold hover:opacity-80 transition-opacity ${c?.badge}`}>
              {TYPE_ICONS[t]} {ex}
            </button>
          )
        })}
      </div>
      {history.length > 1 && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[11px] text-gray-400">ล่าสุด:</span>
          {history.slice(1).map(h => {
            const t = detectType(h)
            const c = TYPE_COLORS[t]
            return (
              <button key={h} onClick={() => search(h)}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs font-mono font-semibold hover:opacity-80 transition-opacity ${c?.badge}`}>
                {TYPE_ICONS[t]} {h}
              </button>
            )
          })}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          กำลังค้นหา...
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <div className="space-y-4">
          {/* Stats bar */}
          <StatsBar result={result} />

          {/* Chain rail */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-3">
              ห่วงโซ่เชื่อมโยง — คลิกเลือกเพื่อดูรายละเอียด
            </p>
            <ChainRail slots={chain} selected={selected} onSelect={setSelected} />
          </div>

          {/* Two-pane: tree (left) + detail (right) */}
          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 items-start">
            {/* Left: chain tree */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-3">
                รายการโหนด
              </p>
              {chain.map(slot => (
                <div key={slot.type}>
                  <div className="flex items-center gap-1.5 px-2 py-1">
                    <TypeBadge type={slot.type} size="xs" />
                  </div>
                  {slot.pending ? (
                    <div className={[
                      "ml-4 px-2 py-1 text-xs italic",
                      slot.pendingReason === "stock"
                        ? "text-teal-500 dark:text-teal-500"
                        : "text-gray-400 dark:text-gray-600",
                    ].join(" ")}>
                      {slot.pendingReason === "stock" ? "เบิกจากคลัง" : "ยังไม่ได้ index"}
                    </div>
                  ) : (
                    slot.codes.map(code => (
                      <button
                        key={code}
                        onClick={() => setSelected(code)}
                        className={[
                          "w-full text-left ml-4 px-2 py-1.5 rounded-lg text-xs font-mono transition-all",
                          selected === code
                            ? `font-semibold ${TYPE_COLORS[slot.type]?.text} ${TYPE_COLORS[slot.type]?.bg}`
                            : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50",
                        ].join(" ")}
                      >
                        {selected === code && <span className="mr-1">›</span>}
                        {code}
                      </button>
                    ))
                  )}
                </div>
              ))}
            </div>

            {/* Right: detail panel */}
            <div>
              {selected
                ? <DetailPanel result={result} selected={selected} onSearch={search} />
                : <div className="flex items-center justify-center h-40 rounded-xl border border-dashed border-gray-200 dark:border-gray-700 text-sm text-gray-400 dark:text-gray-500">
                    เลือกโหนดในห่วงโซ่เพื่อดูรายละเอียด
                  </div>
              }
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
