"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Download, Search } from "lucide-react"
import * as XLSX from "xlsx"
import { swalError, swalToast } from "@/lib/swal"
import { BucketBadge, DeadstockShell, RepurchaseBadge, StatusBadge, SummaryCards, baht, mitr, thaiDate, useDeadstock } from "@/components/deadstock-shared"
import { AGE_BUCKETS, ACTION_LABEL, DEADSTOCK_ACTIONS, layerKey, type ActionKey } from "@/lib/deadstock-core"

const BUCKET_LABEL = Object.fromEntries(AGE_BUCKETS.map((b) => [b.key, b])) as Record<string, (typeof AGE_BUCKETS)[number]>

/** ป้ายของแถวที่หาชื่อผู้ขอซื้อไม่ได้ — ใช้เป็นทั้งตัวเลือกในตัวกรองและข้อความในเซลล์ */
const NO_REQUESTER = "(ไม่รู้ผู้ขอ)"

/** บรรทัดรองในเซลล์ — ตัวประกอบที่ยุบเข้ามาอยู่ใต้ตัวหลัก ต้องอ่านออกแต่ไม่แย่งสายตา */
const sub: React.CSSProperties = { fontSize: 10.5, color: "#9CA3AF", marginTop: 1 }

/** โครงคอลัมน์ของตาราง — ยุบจาก 16 เหลือ 8 โดยจับข้อมูลที่คนอ่านคู่กันอยู่แล้วไว้ในเซลล์เดียว
 *  (ตัวหลักบรรทัดบน ตัวประกอบบรรทัดล่างสีจาง — แพตเทิร์นเดียวกับตารางหน้า /safety-stock)
 *  ข้อมูลไม่ได้หายไปไหนสักช่อง และไฟล์ Excel ยังส่งออกแยกคอลัมน์ครบเหมือนเดิมทุกช่อง
 *  "อายุค้าง" กับ "สถานะ" เดิมเป็นข้อมูลตัวเดียวกัน (คำนวณจาก bucket ทั้งคู่) จึงรวมเป็นช่องเดียว */
const PENDING_COLS: { key: string; label: string; right?: boolean; title?: string }[] = [
  { key: "dd",     label: "ใบ DD",           title: "เลขใบรับของ และวันที่รับเข้าคลัง" },
  { key: "car",    label: "รถ",              title: "ทะเบียนรถ และเบอร์รถที่ระบุไว้ในหมายเหตุใบขอซื้อ — บางใบเขียนไม่ครบช่อง จะขึ้นขีด" },
  { key: "who",    label: "ผู้ขอซื้อ",        title: "คนที่เปิดใบขอซื้อ (จากหัวใบ PR ใน ATMS) และเลขใบ PR — ใช้ตามกลับไปถามเหตุผลที่สั่ง" },
  { key: "item",   label: "สินค้า",           title: "ชื่อสินค้า · รหัสสินค้า · กลุ่มสินค้า" },
  { key: "value",  label: "มูลค่า / คงเหลือ", right: true, title: "มูลค่าของที่ยังค้างอยู่ในคลัง และจำนวนคงเหลือ" },
  { key: "age",    label: "อายุค้าง",         right: true, title: "จำนวนวันตั้งแต่รับเข้าโดยยังไม่ถูกเบิก และช่วงอายุที่ตกอยู่" },
  { key: "repeat", label: "ซื้อซ้ำ",          right: true,
    title: "DD = จำนวนใบรับของรหัสเดียวกันที่รับเข้ามาหลังใบนี้ (นับเฉพาะใบที่ผูกทะเบียนรถ) — ซื้อไปแล้ว เงินออกแล้ว\nPR = จำนวนของรหัสเดียวกันที่สั่งแล้วแต่ยังไม่รับเข้า — ยังชะลอหรือยกเลิกทัน\nPR นับเฉพาะใบที่ซื้อเข้าสต๊อก อายุไม่เกิน 90 วัน หักส่วนที่รับไปแล้ว ไม่รวมอะไหล่ลงคัน (เกณฑ์เดียวกับหน้า /safety-stock)" },
  { key: "action", label: "การจัดการ",        right: true },
]

type ActionEntry = { action: ActionKey | ""; note: string; by: string; byEmail: string; at: string }

const ACTION_STYLE: Record<string, { bg: string; fg: string; ring: string }> = {
  wrong_spec: { bg: "#FEF3C7", fg: "#92400E", ring: "#FDE68A" },
  return_vendor: { bg: "#DBEAFE", fg: "#1E40AF", ring: "#BFDBFE" },
  to_stock: { bg: "#EDE9FE", fg: "#5B21B6", ring: "#DDD6FE" },
  move_truck: { bg: "#D1FAE5", fg: "#065F46", ring: "#A7F3D0" },
  for_sale: { bg: "#FFE4E6", fg: "#9F1239", ring: "#FECDD3" },
  // โทนเทา แยกจากสี่สีบนที่เป็น "จะทำอะไรกับของ" — อันนี้แปลว่าของไม่ได้ค้างจริง แค่เอกสารไม่ครบ
  used_no_wd: { bg: "#E2E8F0", fg: "#334155", ring: "#CBD5E1" },
}

/** ป้ายการจัดการ — เลือกแล้วบันทึกทันที ถ้าเซิร์ฟเวอร์ปฏิเสธจะคืนค่าเดิมให้เห็น */
function ActionSelect({
  value,
  saving,
  onChange,
}: {
  value: ActionEntry | undefined
  saving: boolean
  onChange: (next: ActionKey | "") => void
}) {
  const cur = value?.action ?? ""
  const s = cur ? ACTION_STYLE[cur] : null
  const title = value?.by ? `${ACTION_LABEL[cur] ?? "-"} · โดย ${value.by} เมื่อ ${new Date(value.at).toLocaleString("th-TH")}` : "ยังไม่ได้เลือก"
  return (
    <select
      value={cur}
      disabled={saving}
      onChange={(e) => onChange(e.target.value as ActionKey | "")}
      title={title}
      style={{
        padding: "3px 8px",
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 700,
        cursor: saving ? "wait" : "pointer",
        opacity: saving ? 0.5 : 1,
        maxWidth: 150,
        background: s ? s.bg : "#fff",
        color: s ? s.fg : "#9CA3AF",
        border: `1px solid ${s ? s.ring : "#E5E7EB"}`,
      }}
    >
      <option value="">— เลือก —</option>
      {DEADSTOCK_ACTIONS.map((a) => (
        <option key={a.key} value={a.key}>
          {a.label}
        </option>
      ))}
    </select>
  )
}

type GroupBar = { name: string; value: number; count: number; staleValue: number }

/** แท่งแนวนอน เรียงมูลค่ามากไปน้อย — ส่วนแดง = ค้างเกินเกณฑ์ (ภาษาสีเดียวกับกราฟหน้ารายเดือน)
 *  คลิกแท่งเพื่อกรองกลุ่มนั้น คลิกซ้ำเพื่อยกเลิก */
function GroupBarChart({
  rows,
  staleDays,
  selected,
  onSelect,
}: {
  rows: GroupBar[]
  staleDays: number
  selected: string
  onSelect: (name: string) => void
}) {
  const [showAll, setShowAll] = useState(false)
  if (rows.length === 0) return null

  const max = Math.max(...rows.map((r) => r.value), 1)
  const shown = showAll ? rows : rows.slice(0, 10)
  const total = rows.reduce((s, r) => s + r.value, 0)

  return (
    <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "16px 18px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <h2 style={{ ...mitr, fontSize: 15, fontWeight: 700, margin: 0 }}>มูลค่าค้างตามกลุ่มสินค้า</h2>
        <span style={{ fontSize: 12.5, color: "#6B7280" }}>
          {rows.length} กลุ่ม · รวม {baht(total)}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#6B7280" }}>
          <i style={{ display: "inline-block", width: 10, height: 10, background: "#DC2626", borderRadius: 2, marginRight: 5 }} />
          ค้างเกิน {staleDays} วัน
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {shown.map((r) => {
          const active = selected === r.name
          const w = (r.value / max) * 100
          const staleW = r.value > 0 ? (r.staleValue / r.value) * 100 : 0
          return (
            <button
              key={r.name}
              onClick={() => onSelect(r.name)}
              title={`${r.name} — ${baht(r.value)} · ${r.count} รายการ · ค้างเกิน ${staleDays} วัน ${baht(r.staleValue)}`}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(120px, 168px) 1fr minmax(96px, auto)",
                alignItems: "center",
                gap: 10,
                border: "none",
                background: active ? "#F3F4F6" : "transparent",
                borderRadius: 8,
                padding: "3px 6px",
                cursor: "pointer",
                textAlign: "left",
                width: "100%",
              }}
            >
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: active ? 700 : 500,
                  color: "#374151",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {r.name}
              </span>
              <span style={{ display: "block", height: 18, background: "#F3F4F6", borderRadius: 4, overflow: "hidden" }}>
                <span style={{ display: "block", width: `${w}%`, height: "100%", background: "#D1D5DB", borderRadius: 4 }}>
                  <span style={{ display: "block", width: `${staleW}%`, height: "100%", background: "#DC2626", borderRadius: 4 }} />
                </span>
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "#111827", textAlign: "right", whiteSpace: "nowrap" }}>
                {baht(r.value)} <span style={{ color: "#9CA3AF", fontWeight: 500 }}>({r.count})</span>
              </span>
            </button>
          )
        })}
      </div>

      {rows.length > 10 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          style={{
            marginTop: 10,
            padding: "5px 12px",
            borderRadius: 8,
            border: "1px solid #E5E7EB",
            background: "#fff",
            fontSize: 12.5,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {showAll ? "ย่อ" : `ดูทั้งหมด (${rows.length} กลุ่ม)`}
        </button>
      )}
    </div>
  )
}

export function DeadstockPendingPage() {
  const { data, error, loading, reload } = useDeadstock()
  const [q, setQ] = useState("")
  const [bucket, setBucket] = useState("")
  const [group, setGroup] = useState("")
  const [actionFilter, setActionFilter] = useState("")
  const [requester, setRequester] = useState("")

  // ป้ายการจัดการ — โหลดแยกจาก /api/deadstock เพราะตัวนั้น cache 1 ชม. แต่ป้ายต้องเห็นผลทันที
  const [actions, setActions] = useState<Record<string, ActionEntry>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/deadstock/action")
      .then((r) => r.json())
      .then((d) => { if (!cancelled && d?.actions) setActions(d.actions) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const saveAction = useCallback(async (key: string, next: ActionKey | "") => {
    const prev = actions[key]
    setSavingKey(key)
    // optimistic — คืนค่าเดิมถ้าบันทึกไม่ผ่าน
    setActions((m) => ({ ...m, [key]: { action: next, note: "", by: "", byEmail: "", at: new Date().toISOString() } }))
    try {
      const res = await fetch("/api/deadstock/action", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, action: next }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setActions((m) => ({ ...m, [key]: json.entry }))
      swalToast("success", next ? `บันทึก "${ACTION_LABEL[next]}" แล้ว` : "ล้างป้ายแล้ว")
    } catch (e) {
      setActions((m) => {
        const copy = { ...m }
        if (prev) copy[key] = prev
        else delete copy[key]
        return copy
      })
      swalError(`บันทึกไม่สำเร็จ: ${e instanceof Error ? e.message : e}`)
    } finally {
      setSavingKey(null)
    }
  }, [actions])

  const groups = useMemo(() => [...new Set(data?.pending.map((p) => p.itemGroup) ?? [])].sort(), [data])

  /** ผู้ขอซื้อพร้อมจำนวนใบ/มูลค่า เรียงมูลค่ามากไปน้อย — คนที่ปล่อยของค้างเยอะสุดอยู่บนสุด
   *  นับจากทั้งกอง ไม่อิงตัวกรองอื่น เพื่อให้ตัวเลขในวงเล็บไม่กระพริบตามตัวเองตอนเลือก */
  const requesters = useMemo(() => {
    const m = new Map<string, { n: number; value: number }>()
    for (const p of data?.pending ?? []) {
      const k = p.requester || NO_REQUESTER
      const c = m.get(k) ?? { n: 0, value: 0 }
      c.n++; c.value += p.value; m.set(k, c)
    }
    return [...m].sort((a, b) => b[1].value - a[1].value)
  }, [data])

  // กราฟอิงค้นหา + ช่วงอายุ แต่ไม่อิงตัวกรองกลุ่ม เพื่อให้กราฟทำหน้าที่เป็นตัวเลือกกลุ่มไปในตัว
  const chartRows = useMemo(() => {
    if (!data) return []
    const rx = q.trim() ? new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null
    return data.pending.filter(
      (p) =>
        (!bucket || p.bucket === bucket) &&
        // ผู้ขอซื้อกรองตรงนี้ (ไม่ใช่ชั้น rows) เพื่อให้กราฟกลุ่มสินค้าสะท้อนของ "คนที่เลือก" ด้วย
        (!requester || (p.requester || NO_REQUESTER) === requester) &&
        (!rx || rx.test(p.dd) || rx.test(p.plate) || rx.test(p.fleetNo ?? "") ||
          rx.test(p.prCode ?? "") || rx.test(p.requester ?? "") ||
          rx.test(p.itemCode) || rx.test(p.itemName))
    )
  }, [data, q, bucket, requester])

  const rows = useMemo(
    () =>
      chartRows.filter(
        (p) =>
          (!group || p.itemGroup === group) &&
          (!actionFilter ||
            (actionFilter === "__none" ? !actions[layerKey(p)]?.action : actions[layerKey(p)]?.action === actionFilter))
      ),
    [chartRows, group, actionFilter, actions]
  )

  /** ยอดต่อกลุ่มสินค้า เรียงมูลค่ามากไปน้อย + แยกส่วนที่ค้างเกินเกณฑ์ */
  const byGroup = useMemo(() => {
    const stale = data?.staleDays ?? 7
    const m = new Map<string, { name: string; value: number; count: number; staleValue: number }>()
    for (const p of chartRows) {
      let g = m.get(p.itemGroup)
      if (!g) m.set(p.itemGroup, (g = { name: p.itemGroup, value: 0, count: 0, staleValue: 0 }))
      g.value += p.value
      g.count += 1
      if (p.ageDays > stale) g.staleValue += p.value
    }
    return [...m.values()].sort((a, b) => b.value - a.value)
  }, [chartRows, data])

  const exportXlsx = () => {
    const ws = XLSX.utils.json_to_sheet(
      rows.map((r) => ({
        "ใบ DD": r.dd,
        วันที่รับ: thaiDate(r.date),
        ทะเบียนรถ: r.plate,
        เบอร์รถ: r.fleetNo ?? "",
        "ใบ PR": r.prCode ?? "",
        ผู้ขอซื้อ: r.requester ?? "",
        รหัสสินค้า: r.itemCode,
        ชื่อสินค้า: r.itemName,
        กลุ่มสินค้า: r.itemGroup,
        คงเหลือ: r.remaining,
        ราคาทุน: r.cost,
        มูลค่า: r.value,
        "อายุค้าง (วัน)": r.ageDays,
        สถานะ: BUCKET_LABEL[r.bucket]?.label ?? r.bucket,
        "สถานะ (ไทย)": BUCKET_LABEL[r.bucket]?.th ?? "",
        "ซื้อซ้ำหลังใบนี้ (ใบ)": r.newerCount,
        "กำลังสั่งอีก (เข้าสต๊อก)": r.onOrder?.qty ?? "",
        "ใบ PR ที่ค้าง": r.onOrder?.prCodes.join(", ") ?? "",
        "PR เก่าสุด (วัน)": r.onOrder?.oldestDays ?? "",
        การจัดการ: ACTION_LABEL[actions[layerKey(r)]?.action ?? ""] ?? "",
        "ผู้บันทึกการจัดการ": actions[layerKey(r)]?.by ?? "",
      }))
    )
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "ของค้าง")
    XLSX.writeFile(wb, `deadstock-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <DeadstockShell data={data} loading={loading} error={error} reload={reload}>
      {data && (
        <>
          <SummaryCards data={data} />

          <GroupBarChart
            rows={byGroup}
            staleDays={data.staleDays}
            selected={group}
            onSelect={(name) => setGroup((cur) => (cur === name ? "" : name))}
          />

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
            <div style={{ position: "relative" }}>
              <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: "#9CA3AF" }} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ค้นหา DD / ทะเบียน / เบอร์รถ / PR / ผู้ขอซื้อ / รหัส / ชื่อสินค้า"
                style={{ padding: "7px 12px 7px 30px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, width: 290 }}
              />
            </div>
            <select
              value={bucket}
              onChange={(e) => setBucket(e.target.value)}
              style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13 }}
            >
              <option value="">ทุกสถานะ</option>
              {AGE_BUCKETS.map((b) => {
                const n = data.summary.buckets.find((x) => x.key === b.key)?.count ?? 0
                return (
                  <option key={b.key} value={b.key}>
                    {b.label} · {b.range} ({n})
                  </option>
                )
              })}
            </select>
            <select
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13 }}
            >
              <option value="">ทุกกลุ่มสินค้า</option>
              {groups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <select
              value={requester}
              onChange={(e) => setRequester(e.target.value)}
              title="เลือกผู้ขอซื้อเพื่อดูเฉพาะของที่คนนั้นสั่งเข้ามาแล้วยังค้าง"
              style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, maxWidth: 260 }}
            >
              <option value="">ผู้ขอซื้อ: ทั้งหมด</option>
              {requesters.map(([name, c]) => (
                <option key={name} value={name}>
                  {name} ({c.n} ใบ · {baht(c.value)})
                </option>
              ))}
            </select>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13 }}
            >
              <option value="">การจัดการ: ทั้งหมด</option>
              <option value="__none">ยังไม่ได้เลือก</option>
              {DEADSTOCK_ACTIONS.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 13, color: "#6B7280" }}>
              แสดง {rows.length.toLocaleString()} / {data.pending.length.toLocaleString()} รายการ ·{" "}
              {baht(rows.reduce((s, r) => s + r.value, 0))}
            </span>
            <button
              onClick={exportXlsx}
              disabled={rows.length === 0}
              style={{
                marginLeft: "auto",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 14px",
                borderRadius: 8,
                border: "1px solid #E5E7EB",
                background: "#fff",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <Download size={14} /> Excel
            </button>
          </div>

          <div style={{ overflowX: "auto", border: "1px solid #E5E7EB", borderRadius: 12, background: "#fff" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#F9FAFB" }}>
                  {PENDING_COLS.map((c) => (
                    <th
                      key={c.key}
                      title={c.title}
                      style={{
                        padding: "10px 12px",
                        fontWeight: 700,
                        color: "#374151",
                        borderBottom: "1px solid #E5E7EB",
                        whiteSpace: "nowrap",
                        textAlign: c.right ? "right" : "left",
                      }}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.dd}|${r.itemCode}|${r.date}`} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    {/* ใบ DD — เลขใบ (ตัวหลัก) + วันที่รับ (บรรทัดรอง) */}
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap", verticalAlign: "top" }}>
                      <div style={{ fontFamily: "monospace" }}>{r.dd}</div>
                      <div style={sub}>รับ {thaiDate(r.date)}</div>
                    </td>

                    {/* รถ — ทะเบียน (ตัวหลัก) + เบอร์รถ (บรรทัดรอง) */}
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap", verticalAlign: "top" }}>
                      <div style={{ fontWeight: 600 }}>{r.plate || <span style={{ color: "#D1D5DB" }}>—</span>}</div>
                      <div style={sub}>{r.fleetNo ?? "—"}</div>
                    </td>

                    {/* ผู้ขอซื้อ — ชื่อคน (ตัวหลัก) + เลขใบ PR (บรรทัดรอง) ตามกลับไปถามได้จากสองอย่างนี้ */}
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap", verticalAlign: "top" }}>
                      <div>{r.requester ?? <span style={{ color: "#D1D5DB" }}>{NO_REQUESTER}</span>}</div>
                      <div style={{ ...sub, fontFamily: "monospace" }}>{r.prCode ?? "—"}</div>
                    </td>

                    {/* สินค้า — ชื่อ (ตัวหลัก) + รหัส · กลุ่ม (บรรทัดรอง) */}
                    <td style={{ padding: "9px 12px", minWidth: 240, verticalAlign: "top" }}>
                      <div>{r.itemName}</div>
                      <div style={sub}>
                        <span style={{ fontFamily: "monospace" }}>{r.itemCode}</span> · {r.itemGroup}
                      </div>
                    </td>

                    {/* มูลค่า (ตัวหลัก — ตัวเลขที่ใช้ตัดสินใจ) + คงเหลือ (บรรทัดรอง) */}
                    <td style={{ padding: "9px 12px", textAlign: "right", whiteSpace: "nowrap", verticalAlign: "top" }}>
                      <div style={{ fontWeight: 600 }}>{baht(r.value)}</div>
                      <div style={sub}>คงเหลือ {r.remaining.toLocaleString()}</div>
                    </td>

                    {/* อายุค้าง — จำนวนวัน (ตัวหลัก) + ช่วงอายุ (บรรทัดรอง) เดิมแยกเป็นสองคอลัมน์ทั้งที่มาจากค่าเดียวกัน */}
                    <td style={{ padding: "9px 12px", textAlign: "right", whiteSpace: "nowrap", verticalAlign: "top" }}>
                      <BucketBadge bucket={r.bucket} days={r.ageDays} />
                      <div style={{ marginTop: 3 }}><StatusBadge bucket={r.bucket} /></div>
                    </td>

                    {/* ซื้อซ้ำ — DD (ซื้อไปแล้ว) + PR (กำลังจะซื้อ ยังยกเลิกทัน) อยู่คู่กันเพราะอ่านคู่กันเสมอ */}
                    <td
                      style={{ padding: "9px 12px", textAlign: "right", whiteSpace: "nowrap", verticalAlign: "top" }}
                      title={r.onOrder
                        ? `PR ที่ยังไม่รับของ ${r.onOrder.prCount} ใบ · เก่าสุด ${r.onOrder.oldestDays} วัน\n${r.onOrder.prCodes.join(", ")}${r.onOrder.prCount > r.onOrder.prCodes.length ? " …" : ""}`
                        : "ไม่มีใบ PR ซื้อเข้าสต๊อกค้างอยู่สำหรับรหัสนี้"}
                    >
                      {r.newerCount > 0 || r.onOrder ? (
                        <>
                          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4 }}>
                            <span style={sub}>DD</span>
                            <RepurchaseBadge n={r.newerCount} />
                          </div>
                          {r.onOrder && (
                            <div style={{ marginTop: 2, fontWeight: 700, color: "#B45309" }}>
                              <span style={{ ...sub, marginRight: 4 }}>PR</span>+{r.onOrder.qty.toLocaleString()}
                            </div>
                          )}
                        </>
                      ) : (
                        <span style={{ color: "#D1D5DB" }}>—</span>
                      )}
                    </td>

                    <td style={{ padding: "9px 12px", textAlign: "right", verticalAlign: "top" }}>
                      <ActionSelect
                        value={actions[layerKey(r)]}
                        saving={savingKey === layerKey(r)}
                        onChange={(next) => saveAction(layerKey(r), next)}
                      />
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={PENDING_COLS.length} style={{ padding: 28, textAlign: "center", color: "#9CA3AF" }}>
                      ไม่พบรายการตามเงื่อนไข
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </DeadstockShell>
  )
}
