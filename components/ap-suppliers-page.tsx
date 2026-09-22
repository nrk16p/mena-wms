"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Landmark, Search, RefreshCw, AlertTriangle } from "lucide-react"
import { swalError, swalToast } from "@/lib/swal"
import { CREDIT_TERMS } from "@/lib/ap-tracking"
import { AP_TEMPLATE_DOCS, templateDocLabel, type ApDocTemplate, type ApTplDocKey } from "@/lib/ap-doc-template"
import { ApDocTemplateShareDialog } from "./ap-doc-template-share"
import { CARD, NUM, mitr } from "./ap-style"

type Supplier = {
  name: string
  creditTerm: string          // ค่าที่ใช้จริง = override || atmsTerm
  override?: string           // คนตั้งทับไว้เอง (ว่าง = ใช้ของ ATMS)
  atmsTerm?: string           // ค่าจาก master ซัพพลายเออร์ของ ATMS
  atmsCode?: string; atmsType?: string; atmsBranch?: string
  ddCount?: number; lastDdAt?: string
  syncedAt?: string; updatedBy?: string
}
type Filter = "active" | "noTerm" | "noTpl" | "override" | "all"

// trim + ยุบช่องว่างซ้ำ + lowercase สำหรับเทียบชื่อซ้ำ
const normName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase()
const s = (v: unknown) => (v == null ? "" : String(v)).trim()

const thaiDateTime = (iso: string) => {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("th-TH", {
    day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok",
  })
}

export function ApSuppliersPage() {
  // null = ยังไม่โหลดเสร็จ (แยกจาก [] = โหลดแล้วแต่ไม่มีข้อมูล) — ตารางจึงขึ้น "กำลังโหลด"
  // แทนที่จะแวบเป็น "ไม่พบซัพพลายเออร์" ก่อนข้อมูลมาถึง
  const [items, setItems]   = useState<Supplier[] | null>(null)
  const [syncedAt, setSync] = useState("")
  const [q, setQ]           = useState("")
  const [filter, setFilter] = useState<Filter>("active")
  const [newName, setNewName] = useState("")
  // แม่แบบเอกสารประกบชุด — จับคู่กับแถวด้วยรหัส ATMS ก่อน ถอยไปใช้ชื่อ (เหมือน findTemplateForSupplier ฝั่ง API)
  const [templates, setTemplates] = useState<ApDocTemplate[]>([])
  const [editing, setEditing] = useState<{ name: string; docs: ApTplDocKey[] } | null>(null)
  const [sharing, setSharing] = useState<Supplier | null>(null)

  // ลิงก์จากโมดัลใบ DD ส่งชื่อผู้ขายมาใน ?q= — อ่านหลัง mount (อ่านตอน render แรกจะ hydrate ไม่ตรงกับเซิร์ฟเวอร์)
  useEffect(() => {
    const q0 = new URLSearchParams(window.location.search).get("q")
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (q0) { setQ(q0); setFilter("all") }
  }, [])

  const load = useCallback(async () => {
    try {
      const [res, tRes] = await Promise.all([fetch("/api/ap-suppliers"), fetch("/api/ap-doc-templates")])
      const d   = await res.json()
      if (!res.ok) throw new Error(d?.error ?? "โหลดไม่สำเร็จ")
      setItems(d.items ?? [])
      setSync(s(d.syncedAt))
      const td = await tRes.json().catch(() => ({}))
      if (tRes.ok) setTemplates((td.items ?? []) as ApDocTemplate[])
    } catch (e) {
      setItems((xs) => xs ?? [])
      swalError(`โหลดไม่สำเร็จ${e instanceof Error && e.message ? ` · ${e.message}` : ""}`)
    }
  }, [])
  useEffect(() => { load() }, [load])

  // บันทึกแบบ optimistic — ล้มแล้วต้องย้อนกลับเองได้ ไม่พึ่ง load() ที่อาจล้มตาม
  const save = async (name: string, override: string) => {
    const existing = (items ?? []).find((x) => x.name === name)
    const effective = override || s(existing?.atmsTerm)
    setItems((xs) => existing
      ? (xs ?? []).map((x) => (x.name === name ? { ...x, override, creditTerm: effective } : x))
      : [...(xs ?? []), { name, creditTerm: effective, override }].sort((a, b) => a.name.localeCompare(b.name)))
    try {
      const res = await fetch("/api/ap-suppliers", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, creditTerm: override }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? "บันทึกไม่สำเร็จ")
      swalToast("success", override
        ? `ตั้งทับ ${name} · ${override}`
        : `${name} · กลับไปใช้ค่าจาก ATMS (${s(existing?.atmsTerm) || "ไม่ระบุ"})`)
    } catch (e) {
      swalError(`บันทึกไม่สำเร็จ${e instanceof Error && e.message ? ` · ${e.message}` : ""}`)
      setItems((xs) => existing
        ? (xs ?? []).map((x) => (x.name === name ? existing : x))
        : (xs ?? []).filter((x) => x.name !== name))
      load()
    }
  }

  const tplByCode = useMemo(() => new Map(templates.filter((x) => x.code).map((x) => [x.code, x])), [templates])
  const tplByName = useMemo(() => new Map(templates.map((x) => [x.name, x])), [templates])
  const tplOf = useCallback((x: Supplier): ApDocTemplate | undefined =>
    (s(x.atmsCode) ? tplByCode.get(s(x.atmsCode)) : undefined) ?? tplByName.get(x.name), [tplByCode, tplByName])
  const hasTpl = useCallback((x: Supplier) => (tplOf(x)?.docs.length ?? 0) > 0, [tplOf])

  const saveTemplate = async (x: Supplier, docs: ApTplDocKey[]) => {
    const code = s(x.atmsCode)
    const prev = templates
    const next: ApDocTemplate = { code, name: x.name, docs, source: "manual" }
    setTemplates((ts) => [...ts.filter((t) => (code ? t.code !== code : !(t.code === "" && t.name === x.name))), next])
    setEditing(null)
    try {
      const res = await fetch("/api/ap-doc-templates", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name: x.name, docs }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? "บันทึกไม่สำเร็จ")
      swalToast("success", docs.length ? `บันทึกแม่แบบ ${x.name} · ${docs.length} ชนิด` : `${x.name} · ไม่มีแม่แบบ`)
    } catch (e) {
      setTemplates(prev)
      swalError(`บันทึกแม่แบบไม่สำเร็จ${e instanceof Error && e.message ? ` · ${e.message}` : ""}`)
    }
  }

  const rows = useMemo(() => items ?? [], [items])
  const counts = useMemo(() => ({
    all:      rows.length,
    active:   rows.filter((x) => (x.ddCount ?? 0) > 0).length,
    noTerm:   rows.filter((x) => (x.ddCount ?? 0) > 0 && !x.creditTerm).length,
    noTpl:    rows.filter((x) => (x.ddCount ?? 0) > 0 && !hasTpl(x)).length,
    override: rows.filter((x) => x.override && x.override !== s(x.atmsTerm)).length,
  }), [rows, hasTpl])

  const shown = useMemo(() => {
    let xs = rows
    if (filter === "active")   xs = xs.filter((x) => (x.ddCount ?? 0) > 0)
    if (filter === "noTerm")   xs = xs.filter((x) => (x.ddCount ?? 0) > 0 && !x.creditTerm)
    if (filter === "noTpl")    xs = xs.filter((x) => (x.ddCount ?? 0) > 0 && !hasTpl(x))
    if (filter === "override") xs = xs.filter((x) => x.override && x.override !== s(x.atmsTerm))
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      xs = xs.filter((x) => rx.test(x.name) || rx.test(s(x.atmsCode)) || rx.test(s(x.atmsType)))
    }
    // เจ้าที่มีใบเยอะสุดขึ้นก่อน — คนเปิดหน้านี้มาแก้ของที่กระทบเงินมากที่สุด
    return [...xs].sort((a, b) => (b.ddCount ?? 0) - (a.ddCount ?? 0) || a.name.localeCompare(b.name))
  }, [rows, q, filter, hasTpl])

  const CHIPS: { k: Filter; label: string; n: number }[] = [
    { k: "active",   label: "มีใบ DD",          n: counts.active },
    { k: "noTerm",   label: "ยังไม่มีเทอม",     n: counts.noTerm },
    { k: "noTpl",    label: "ยังไม่มีแม่แบบเอกสาร", n: counts.noTpl },
    { k: "override", label: "ตั้งทับ ATMS",     n: counts.override },
    { k: "all",      label: "ทั้งหมด",          n: counts.all },
  ]

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Landmark className="w-6 h-6 text-emerald-600" />
        <h1 className="text-lg font-bold text-[#14271C] dark:text-white" style={mitr}>เครดิตเทอมเจ้าหนี้</h1>
        <span className="text-xs text-gray-500">{counts.all} ราย</span>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-gray-500">
          <RefreshCw className="w-3.5 h-3.5" />
          sync จาก ATMS ล่าสุด {thaiDateTime(syncedAt)}
        </span>
      </div>

      <div className={`${CARD} p-3 text-xs text-gray-600 dark:text-gray-300 leading-relaxed`}>
        เทอมมาจาก master ซัพพลายเออร์ของ ATMS โดยอัตโนมัติ — แก้ตรงนี้เมื่อต้อง <b>ตั้งทับ</b> เท่านั้น
        (เลือก &ldquo;ใช้ค่าจาก ATMS&rdquo; เพื่อคืนค่าเดิม)
        <br />
        วันครบกำหนดของ<b>ใบ DD แต่ละใบ</b>ใช้ <code className="px-1 rounded bg-gray-100 dark:bg-white/10">ap term</code> บน PO
        ของใบนั้นก่อนเสมอ — ค่าตรงนี้เป็นตัวสำรองเมื่อใบไม่มี PO ผูก หรือ PO ไม่ได้ระบุเทอม
        <br />
        <b>เอกสารที่ต้องแนบ</b> = แม่แบบประกบชุดส่งบัญชีของผู้ขาย (นำเข้าจาก Excel แล้วแก้ต่อที่นี่ได้) —
        ขึ้นป้าย &ldquo;ต้องมี&rdquo; ในโมดัลใบ DD และทำรูปส่งผู้ขายได้ด้วยปุ่ม 🖼 · ไม่ได้บล็อกการส่งบัญชี
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {CHIPS.map((c) => (
          <button key={c.k} onClick={() => setFilter(c.k)}
            className={`rounded-full px-3 py-1.5 text-xs border transition ${
              filter === c.k
                ? "bg-emerald-600 text-white border-emerald-600"
                : "bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/10"
            }`}>
            {c.label} <span className={NUM}>{c.n}</span>
          </button>
        ))}
        <div className="relative ml-auto">
          <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อ / รหัส / ประเภท"
            className="rounded-lg border pl-8 pr-3 py-1.5 text-sm w-72 bg-white dark:bg-white/5" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="เพิ่มซัพพลายเออร์ที่ไม่มีใน ATMS"
          className="rounded-lg border px-3 py-1.5 text-sm w-80 bg-white dark:bg-white/5" />
        <button onClick={() => {
          const n = newName.trim()
          if (!n) return
          const dup = rows.find((x) => normName(x.name) === normName(n))
          if (dup) {
            swalToast("info", `มีซัพพลายเออร์ "${dup.name}" อยู่แล้ว — แก้เครดิตเทอมที่แถวนั้นแทน`)
            setNewName("")
            return
          }
          save(n, "30D")
          setNewName("")
        }}
          className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-white/5">เพิ่ม (30D)</button>
      </div>

      <div className={`${CARD} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-white/5 text-xs text-gray-600 dark:text-gray-300">
              <tr>
                <th className="px-3 py-2 text-left">ซัพพลายเออร์</th>
                <th className="px-3 py-2 text-right w-24">ใบ DD</th>
                <th className="px-3 py-2 text-left w-28">ATMS</th>
                <th className="px-3 py-2 text-left w-52">ใช้จริง</th>
                <th className="px-3 py-2 text-left w-80">เอกสารที่ต้องแนบ</th>
                <th className="px-3 py-2 text-left w-44">แก้ไขล่าสุดโดย</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((x) => {
                const atms = s(x.atmsTerm)
                const ov   = s(x.override)
                const drift = ov && ov !== atms
                return (
                  <tr key={x.name} className="border-t dark:border-white/10 align-top">
                    <td className="px-3 py-2">
                      <div>{x.name}</div>
                      <div className="text-[11px] text-gray-400 mt-0.5">
                        {[s(x.atmsCode), s(x.atmsType), s(x.atmsBranch)].filter(Boolean).join(" · ") || "ไม่มีใน master ของ ATMS"}
                      </div>
                    </td>
                    <td className={`px-3 py-2 text-right ${NUM} text-gray-600 dark:text-gray-300`}>
                      {(x.ddCount ?? 0) || "—"}
                      {x.lastDdAt && <div className="text-[11px] text-gray-400">{x.lastDdAt}</div>}
                    </td>
                    <td className="px-3 py-2">
                      {atms
                        ? <span className="text-gray-600 dark:text-gray-300">{atms}</span>
                        : <span className="text-gray-400">ไม่ระบุ</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <select value={ov} onChange={(e) => save(x.name, e.target.value)}
                          className="rounded-lg border px-2 py-1 text-sm bg-white dark:bg-white/5">
                          <option value="">ใช้ค่าจาก ATMS{atms ? ` (${atms})` : ""}</option>
                          {CREDIT_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                        {drift && (
                          <span title={`ตั้งทับค่าของ ATMS (${atms || "ไม่ระบุ"})`}
                            className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="w-3.5 h-3.5" />ตั้งทับ
                          </span>
                        )}
                        {!x.creditTerm && (
                          <span className="text-[11px] text-rose-600 dark:text-rose-400">ยังไม่มีเทอม</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {editing?.name === x.name ? (
                        <div className="space-y-1.5">
                          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                            {AP_TEMPLATE_DOCS.map((d) => (
                              <label key={d.key} className="flex cursor-pointer items-center gap-1.5 text-xs">
                                <input type="checkbox" className="h-3.5 w-3.5 accent-emerald-600"
                                  checked={editing.docs.includes(d.key)}
                                  onChange={(e) => setEditing((ed) => ed && ({
                                    ...ed,
                                    docs: e.target.checked ? [...ed.docs, d.key] : ed.docs.filter((k) => k !== d.key),
                                  }))} />
                                {d.label}
                              </label>
                            ))}
                          </div>
                          <div className="flex gap-1.5">
                            <button onClick={() => saveTemplate(x, AP_TEMPLATE_DOCS.map((d) => d.key).filter((k) => editing.docs.includes(k)))}
                              className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs text-white hover:bg-emerald-700">บันทึก</button>
                            <button onClick={() => setEditing(null)}
                              className="rounded-lg border px-2.5 py-1 text-xs hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">ยกเลิก</button>
                          </div>
                        </div>
                      ) : (() => {
                        const tpl = tplOf(x)
                        const docs = tpl?.docs ?? []
                        return (
                          <div className="flex flex-wrap items-center gap-1">
                            {docs.map((k) => (
                              <span key={k} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                                {templateDocLabel(k)}
                              </span>
                            ))}
                            {!docs.length && <span className="text-[11px] text-gray-400">ยังไม่มีแม่แบบ</span>}
                            <button onClick={() => setEditing({ name: x.name, docs })}
                              className="rounded-lg border border-gray-200/80 px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">
                              {docs.length ? "แก้" : "ตั้งแม่แบบ"}
                            </button>
                            {docs.length > 0 && (
                              <button onClick={() => setSharing(x)} title="ทำรูปส่งผู้ขาย (PNG)"
                                className="rounded-lg border border-gray-200/80 px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">
                                🖼 รูป
                              </button>
                            )}
                            {tpl && (
                              <span className="w-full text-[10px] text-gray-400">
                                {tpl.source === "manual" ? `แก้ในเว็บ${tpl.updatedBy ? ` · ${tpl.updatedBy}` : ""}` : "จาก Excel"}
                              </span>
                            )}
                          </div>
                        )
                      })()}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">{s(x.updatedBy) || "—"}</td>
                  </tr>
                )
              })}
              {items !== null && shown.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-10 text-center text-gray-400">ไม่พบซัพพลายเออร์</td></tr>
              )}
              {items === null && (
                <tr><td colSpan={6} className="px-3 py-10 text-center text-gray-400">กำลังโหลด…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {sharing && (
        <ApDocTemplateShareDialog name={sharing.name} code={s(sharing.atmsCode)}
          docs={tplOf(sharing)?.docs ?? []} creditTerm={sharing.creditTerm}
          onClose={() => setSharing(null)} />
      )}
    </div>
  )
}
