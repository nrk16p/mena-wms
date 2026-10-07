"use client"

// หน้า /garages — จับคู่ "ชื่ออู่ที่ตั้งเอง" ในใบงานเก่า กับซัพพลายเออร์ใน ATMS (ชุดเดียวกับ Mena-Next)
// แถวละ 1 ชื่อเดิม · ระบบเดาคู่ให้ (ตรงตัว / เคยยืนยัน / Mena-Next ของคันเดียวกัน / ชื่อคล้าย) · คนกดยืนยันเท่านั้นถึงเขียน
// ชื่อรวมหลายอู่ (เช่น "อู่ A และ อู่ B") → เลือกทีละใบได้ · ทุกการจับคู่กดย้อนกลับได้จากประวัติด้านล่าง
import { useState, useEffect, useCallback, useMemo } from "react"
import { Search, Factory, Check, Undo2, ChevronDown, ChevronRight } from "lucide-react"
import { swalConfirm, swalToast, swalError } from "@/lib/swal"
import { GarageCombobox, type Garage } from "@/components/garage-combobox"

type MapRecord = { coll: "repair" | "plan"; id: string; plate: string; fleetNo: string; mrNo: string; status: string; date: string }
type Suggestion = { atmsId: number; name: string; type: string; why: "exact" | "alias" | "next" | "similar"; votes?: number }
type Row = { name: string; count: number; open: number; records: MapRecord[]; suggestions: Suggestion[] }
type Hist = { id: string; name: string; atmsName: string; scope: string; count: number; by: string; at: string; undoneAt: string | null }

const WHY: Record<Suggestion["why"], { label: string; cls: string }> = {
  exact:   { label: "ชื่อตรง ATMS",          cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
  alias:   { label: "เคยยืนยันแล้ว",          cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
  next:    { label: "Mena-Next งานเดียวกัน (MR)", cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" },
  similar: { label: "ชื่อคล้าย",              cls: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300" },
}

const inputCls =
  "w-full rounded-[11px] border border-[#E2E8E4] dark:border-white/10 bg-white dark:bg-[#0f1117] px-3.5 py-2.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-[#1B8C4B] focus:outline-none focus:ring-1 focus:ring-[#1B8C4B]"

const fmtAt = (s: string) => {
  const d = new Date(s)
  return isNaN(+d) ? s : d.toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

export function GarageMappingPage() {
  const [rows, setRows]       = useState<Row[]>([])
  const [hist, setHist]       = useState<Hist[]>([])
  const [atms, setAtms]       = useState<Garage[]>([])
  const [nextOk, setNextOk]   = useState(true)
  const [loading, setLoading] = useState(true)
  const [q, setQ]             = useState("")
  const [busy, setBusy]       = useState("")
  // ตัวเลือกต่อแถว: atmsId ที่เลือก (ค่าเริ่ม = คำแนะนำอันดับแรก) · แถวที่กางดูทีละใบ + ใบที่ติ๊ก
  const [pick, setPick]       = useState<Record<string, number>>({})
  const [open, setOpen]       = useState<Record<string, boolean>>({})
  const [checked, setChecked] = useState<Record<string, Set<string>>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const m = await fetch("/api/garages/mapping").then((r) => r.json())
      if (!m?.ok) throw new Error(m?.error || "โหลดไม่สำเร็จ")
      setRows(m.rows); setHist(m.history); setNextOk(!!m.nextOk)
    } catch (e) {
      swalError(e instanceof Error ? e.message : "โหลดไม่สำเร็จ")
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])
  // รายชื่อ ATMS ทั้งหมด (สำหรับ "เลือกอู่อื่น") — โหลดครั้งเดียว
  useEffect(() => {
    fetch("/api/garages/atms").then((r) => r.json())
      .then((a) => { if (a?.garages) setAtms(a.garages.map((g: { atmsId: number; name: string; type: string }) => ({ _id: String(g.atmsId), name: g.name, type: g.type }))) })
      .catch(() => {})
  }, [])

  const chosen = (r: Row): number => pick[r.name] ?? r.suggestions[0]?.atmsId ?? 0
  const nameOf = (id: number) => atms.find((g) => Number(g._id) === id)?.name ?? rows.flatMap((r) => r.suggestions).find((s) => s.atmsId === id)?.name ?? ""
  const rowKey = (t: MapRecord) => `${t.coll}:${t.id}`

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase()
    return k ? rows.filter((r) => r.name.toLowerCase().includes(k) || r.suggestions.some((s) => s.name.toLowerCase().includes(k))) : rows
  }, [rows, q])
  const exactRows = rows.filter((r) => r.suggestions[0]?.why === "exact" || r.suggestions[0]?.why === "alias")
  const totalRecs = rows.reduce((n, r) => n + r.count, 0)
  const openRecs  = rows.reduce((n, r) => n + r.open, 0)

  async function post(name: string, atmsId: number, targets?: { coll: string; id: string }[]) {
    const res = await fetch("/api/garages/mapping", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, atmsId, ...(targets ? { targets } : {}) }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok || !d.ok) throw new Error(d.error || "จับคู่ไม่สำเร็จ")
    return d as { updated: number; atmsName: string }
  }

  async function confirmRow(r: Row) {
    const id = chosen(r)
    if (!id) { swalError("ยังไม่ได้เลือกอู่ใน ATMS"); return }
    const sel = checked[r.name]
    const targets = open[r.name] && sel?.size ? r.records.filter((t) => sel.has(rowKey(t))).map((t) => ({ coll: t.coll, id: t.id })) : undefined
    const n = targets?.length ?? r.count
    const ok = await swalConfirm(`จับคู่ ${n} ใบงาน?`, `"${r.name}" → "${nameOf(id)}"${targets ? " (เฉพาะใบที่ติ๊ก)" : ""} · ย้อนกลับได้จากประวัติด้านล่าง`)
    if (!ok.isConfirmed) return
    setBusy(r.name)
    try {
      const d = await post(r.name, id, targets)
      swalToast("success", `จับคู่ ${d.updated} ใบ → ${d.atmsName}`)
      setChecked((c) => ({ ...c, [r.name]: new Set() }))
      await load()
    } catch (e) {
      swalError(e instanceof Error ? e.message : "จับคู่ไม่สำเร็จ")
    } finally {
      setBusy("")
    }
  }

  // ชื่อที่สะกดตรง ATMS อยู่แล้ว (หรือเคยยืนยันแล้ว) — แค่ผูกรหัส ไม่เปลี่ยนชื่อที่เห็น
  async function confirmExact() {
    if (!exactRows.length) return
    const ok = await swalConfirm(`ผูกรหัส ATMS ${exactRows.length} ชื่อ?`, "ชื่อเหล่านี้ตรงกับ ATMS อยู่แล้ว (หรือเคยยืนยันจับคู่แล้ว) — ผูกรหัสให้ทุกใบงานที่ใช้ชื่อนี้")
    if (!ok.isConfirmed) return
    setBusy("__exact")
    let done = 0
    try {
      for (const r of exactRows) { await post(r.name, r.suggestions[0].atmsId); done++ }
      swalToast("success", `ผูกรหัสแล้ว ${done} ชื่อ`)
    } catch (e) {
      swalError(`ผูกได้ ${done} ชื่อ แล้วติดปัญหา: ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy("")
      await load()
    }
  }

  async function undo(h: Hist) {
    const ok = await swalConfirm("ย้อนการจับคู่นี้?", `"${h.atmsName}" → กลับเป็น "${h.name}" (${h.count} ใบ) · ใบที่มีคนแก้อู่ต่อไปแล้วจะไม่ถูกแตะ`)
    if (!ok.isConfirmed) return
    setBusy("undo:" + h.id)
    try {
      const res = await fetch(`/api/garages/mapping?id=${encodeURIComponent(h.id)}`, { method: "DELETE" })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || !d.ok) throw new Error(d.error || "ย้อนไม่สำเร็จ")
      swalToast("success", `ย้อนแล้ว ${d.reverted} ใบ`)
      await load()
    } catch (e) {
      swalError(e instanceof Error ? e.message : "ย้อนไม่สำเร็จ")
    } finally {
      setBusy("")
    }
  }

  const toggleRec = (r: Row, t: MapRecord) => setChecked((c) => {
    const s = new Set(c[r.name] ?? [])
    if (s.has(rowKey(t))) s.delete(rowKey(t)); else s.add(rowKey(t))
    return { ...c, [r.name]: s }
  })

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1B8C4B]/10 text-[#1B8C4B]">
          <Factory size={20} />
        </div>
        <div>
          <h1 className="text-lg font-bold text-[#14271C] dark:text-white" style={{ fontFamily: "'Mitr', sans-serif" }}>
            จับคู่อู่กับ ATMS
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            ชื่ออู่ในใบงานใช้ชื่อซัพพลายเออร์ใน ATMS เท่านั้น (ชุดเดียวกับ Mena-Next) · หน้านี้ไว้แปลงชื่อที่ตั้งเองในใบงานเก่า
          </p>
        </div>
      </div>

      {/* สรุป */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["ชื่อที่ยังไม่ผูก ATMS", rows.length, "#14271C"],
          ["ใบงานที่ใช้ชื่อเหล่านี้", totalRecs, "#14271C"],
          ["ในนั้นยังเปิดอยู่", openRecs, openRecs ? "#C2410C" : "#1B8C4B"],
          ["ชื่อตรง ATMS อยู่แล้ว", exactRows.length, "#1B8C4B"],
        ].map(([l, v, c]) => (
          <div key={String(l)} className="rounded-[14px] border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10] px-4 py-3">
            <p className="text-[11px] text-[#9AA8A0]">{l}</p>
            <p className="text-xl font-bold" style={{ color: String(c) }}>{loading ? "…" : v}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อเดิม / ชื่อ ATMS..." className={inputCls + " pl-9"} />
        </div>
        {exactRows.length > 0 && (
          <button onClick={() => void confirmExact()} disabled={!!busy}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[11px] bg-[#1B8C4B] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0F6A3C] disabled:opacity-50">
            <Check size={16} /> {busy === "__exact" ? "กำลังผูก..." : `ผูกชื่อที่ตรง ATMS ทั้งหมด (${exactRows.length})`}
          </button>
        )}
      </div>
      {!nextOk && <p className="mb-3 text-[12px] text-amber-600">ดึง Mena-Next ไม่สำเร็จ — รอบนี้ไม่มีคำแนะนำจากรถคันเดียวกัน</p>}

      <div className="overflow-hidden rounded-[16px] border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10]">
        {loading ? (
          <div className="px-4 py-12 text-center text-sm text-gray-400">กำลังโหลด...</div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-gray-400">{q ? "ไม่พบตามคำค้น" : "ทุกใบงานผูกกับ ATMS แล้ว 🎉"}</div>
        ) : filtered.map((r) => {
          const sel = chosen(r)
          const isOpen = !!open[r.name]
          const nChecked = checked[r.name]?.size ?? 0
          return (
            <div key={r.name} className="border-b border-[#F1F5F2] dark:border-white/5 px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <button onClick={() => setOpen((o) => ({ ...o, [r.name]: !o[r.name] }))} className="text-gray-400 hover:text-gray-600" title="ดู/เลือกทีละใบ">
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                <span className="text-sm font-semibold text-[#14271C] dark:text-white">{r.name}</span>
                <span className="rounded-full bg-[#F0FDF4] dark:bg-[#1B8C4B]/10 px-2 py-0.5 text-xs font-medium text-[#1B8C4B]">{r.count} ใบ</span>
                {r.open > 0 && <span className="rounded-full bg-orange-50 dark:bg-orange-900/20 px-2 py-0.5 text-xs font-medium text-orange-700 dark:text-orange-300">เปิดอยู่ {r.open}</span>}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-7">
                <span className="text-[11px] text-[#9AA8A0]">→ ATMS:</span>
                {r.suggestions.map((s) => (
                  <button key={s.atmsId} onClick={() => setPick((p) => ({ ...p, [r.name]: s.atmsId }))}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-left text-[12px] ${sel === s.atmsId ? "border-[#1B8C4B] bg-[#F0FDF4] text-[#14532D] dark:bg-[#1B8C4B]/15 dark:text-emerald-200" : "border-[#E2E8E4] text-gray-700 hover:border-[#1B8C4B]/50 dark:border-white/10 dark:text-gray-300"}`}>
                    {sel === s.atmsId && <Check size={12} className="text-[#1B8C4B]" />}
                    {s.name}
                    <span className={`rounded px-1 text-[10px] ${WHY[s.why].cls}`}>{WHY[s.why].label}{s.votes ? ` ${s.votes}` : ""}</span>
                    {s.type && s.type !== "อู่" && <span className="rounded bg-gray-100 px-1 text-[10px] text-gray-500 dark:bg-white/10">{s.type}</span>}
                  </button>
                ))}
                <div className="w-full sm:w-[300px]">
                  <GarageCombobox value={sel && !r.suggestions.some((s) => s.atmsId === sel) ? nameOf(sel) : ""} garages={atms}
                    onChange={(name) => { const g = atms.find((x) => x.name === name); if (g) setPick((p) => ({ ...p, [r.name]: Number(g._id) })) }}
                    noCreate placeholder={r.suggestions.length ? "เลือกอู่อื่นใน ATMS..." : "เลือกอู่ใน ATMS..."}
                    emptyHint="ไม่มีใน ATMS — ให้จัดซื้อเพิ่มซัพพลายเออร์ใน ATMS ก่อน" />
                </div>
                <button onClick={() => void confirmRow(r)} disabled={!sel || !!busy}
                  className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-lg bg-[#1B8C4B] px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#0F6A3C] disabled:opacity-50">
                  <Check size={14} /> {busy === r.name ? "กำลังบันทึก..." : isOpen && nChecked ? `ยืนยัน ${nChecked} ใบที่ติ๊ก` : `ยืนยันทั้ง ${r.count} ใบ`}
                </button>
              </div>
              {isOpen && (
                <div className="mt-2 space-y-0.5 pl-7">
                  <p className="text-[11px] text-[#9AA8A0]">ติ๊กเฉพาะใบที่เป็นอู่นี้ (เช่นชื่อที่รวมหลายอู่) — ไม่ติ๊กเลย = ทุกใบ</p>
                  {r.records.map((t) => (
                    <label key={rowKey(t)} className="flex cursor-pointer flex-wrap items-center gap-x-2.5 rounded-md px-2 py-1 text-[12px] hover:bg-[#F6FAF7] dark:hover:bg-white/5">
                      <input type="checkbox" checked={!!checked[r.name]?.has(rowKey(t))} onChange={() => toggleRec(r, t)} />
                      <b className="min-w-[52px]">{t.fleetNo || "—"}</b>
                      <span>{t.plate}</span>
                      <span className="opacity-60">{t.mrNo || (t.coll === "plan" ? "แผนซ่อม" : "ไม่มี MR")}</span>
                      <span className="opacity-60">{t.date}</span>
                      <span className="rounded bg-gray-100 px-1.5 text-[11px] text-gray-600 dark:bg-white/10 dark:text-gray-300">{t.status}</span>
                      {t.coll === "repair" && <a href={`/repair-external?id=${t.id}`} target="_blank" rel="noreferrer" className="text-[#1B8C4B] underline" onClick={(e) => e.stopPropagation()}>เปิด</a>}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ประวัติ + ย้อนกลับ */}
      {hist.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-[13px] font-bold text-[#14271C] dark:text-white">ประวัติการจับคู่ล่าสุด</h2>
          <div className="overflow-hidden rounded-[14px] border border-[#EEF2F0] dark:border-white/8 bg-white dark:bg-[#151a10]">
            {hist.map((h) => (
              <div key={h.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-[#F1F5F2] dark:border-white/5 px-4 py-2 text-[12px]">
                <span className={h.undoneAt ? "line-through opacity-50" : ""}>
                  <b>{h.name}</b> → {h.atmsName} <span className="opacity-60">({h.count} ใบ{h.scope === "records" ? " · เลือกทีละใบ" : ""})</span>
                </span>
                <span className="opacity-50">{h.by} · {fmtAt(h.at)}</span>
                {h.undoneAt ? (
                  <span className="ml-auto text-[11px] opacity-50">ย้อนแล้ว</span>
                ) : (
                  <button onClick={() => void undo(h)} disabled={!!busy}
                    className="ml-auto inline-flex items-center gap-1 rounded-md border border-[#E2E8E4] px-2 py-0.5 text-[11.5px] text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-white/10 dark:text-gray-300">
                    <Undo2 size={12} /> {busy === "undo:" + h.id ? "..." : "ย้อนกลับ"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
