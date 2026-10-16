"use client"
// components/pc-provisional-vendor.tsx
// เจ้าใหม่ที่ยังไม่ขึ้นทะเบียนในใบเทียบราคา — 2 กล่อง:
//   NewVendorDialog  : พิมพ์ชื่อชั่วคราว (เตือนชื่อใกล้เคียงก่อนสร้าง กันชื่อซ้ำสะกดต่าง)
//   LinkAtmsDialog   : ผูกชื่อชั่วคราว → ซัพพลายเออร์ตัวจริงใน atms.supplier_master ก่อนปิดใบ
// ทั้งคู่คุยกับ /api/vendors/provisional · รายชื่อ ATMS มาจาก /api/garages/atms (ชุดเดียวกับ Mena-Next)
import { useEffect, useMemo, useState } from "react"
import { X, Loader2, AlertTriangle, Link2, Search } from "lucide-react"
import { swalError } from "@/lib/swal"

export type AtmsPick = { atmsId: number; name: string; type: string }
type Similar = { source: "avl" | "atms" | "provisional"; name: string; atmsId?: number }

const SOURCE_TH: Record<Similar["source"], string> = {
  avl: "อยู่ใน AVL แล้ว", atms: "ขึ้นทะเบียน ATMS แล้ว", provisional: "เคยตั้งชื่อชั่วคราวไว้",
}
const fieldCls = "w-full rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1117] px-3 py-2 text-sm focus:border-[#1B8C4B] focus:outline-none"
const labelCls = "mb-1 block text-xs text-gray-500 dark:text-gray-400"

function Shell({ title, hint, onClose, children }: { title: string; hint?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[8vh]">
      <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-5 shadow-xl dark:border-white/10 dark:bg-[#12151c]">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">{title}</h3>
            {hint && <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="ปิด" className="rounded-md p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** จองชื่อชั่วคราวให้ช่อง Supplier — onDone ส่งชื่อ+ผู้ติดต่อกลับไปใส่ในใบ */
export function NewVendorDialog({ docNo, onDone, onClose }: {
  docNo: string
  onDone: (v: { name: string; contact: { person?: string; phone?: string; taxId?: string } }) => void
  onClose: () => void
}) {
  const [name, setName] = useState("")
  const [kind, setKind] = useState("")
  const [person, setPerson] = useState("")
  const [phone, setPhone] = useState("")
  const [taxId, setTaxId] = useState("")
  const [similar, setSimilar] = useState<Similar[] | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (force: boolean) => {
    const n = name.replace(/\s+/g, " ").trim()
    if (n.length < 2) { swalError("ต้องระบุชื่อผู้ขาย/อู่ อย่างน้อย 2 ตัวอักษร"); return }
    setBusy(true)
    try {
      const res = await fetch("/api/vendors/provisional", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n, kind, contact: { person, phone, taxId }, docNo, force }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.status === 409 && Array.isArray(d?.similar)) { setSimilar(d.similar as Similar[]); return }
      if (!res.ok) throw new Error(d?.error ?? "บันทึกชื่อชั่วคราวไม่สำเร็จ")
      onDone({ name: n, contact: { ...(person ? { person } : {}), ...(phone ? { phone } : {}), ...(taxId ? { taxId } : {}) } })
    } catch (e) {
      swalError(e instanceof Error ? e.message : "บันทึกชื่อชั่วคราวไม่สำเร็จ")
    } finally { setBusy(false) }
  }

  return (
    <Shell title="เจ้าใหม่ (ชื่อชั่วคราว)" onClose={onClose}
      hint="ใช้ขอราคาได้ทันที — ถ้าเจ้านี้ชนะ ต้องขึ้นทะเบียนใน ATMS แล้วกดผูกทะเบียนก่อนปิดใบ">
      <div className="space-y-3">
        <div>
          <label className={labelCls}>ชื่อผู้ขาย / อู่ <span className="text-red-500">*</span></label>
          <input value={name} onChange={(e) => { setName(e.target.value); setSimilar(null) }} className={fieldCls} placeholder="เช่น อู่สมชายการช่าง" autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>ประเภท</label>
            <input value={kind} onChange={(e) => setKind(e.target.value)} className={fieldCls} placeholder="อู่ / อะไหล่ / ยาง" />
          </div>
          <div>
            <label className={labelCls}>เลขผู้เสียภาษี</label>
            <input value={taxId} onChange={(e) => setTaxId(e.target.value)} className={fieldCls} placeholder="13 หลัก (ถ้ามี)" />
          </div>
          <div>
            <label className={labelCls}>ผู้ติดต่อ</label>
            <input value={person} onChange={(e) => setPerson(e.target.value)} className={fieldCls} placeholder="ชื่อผู้ติดต่อ" />
          </div>
          <div>
            <label className={labelCls}>เบอร์โทร</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={fieldCls} placeholder="08x-xxx-xxxx" />
          </div>
        </div>

        {similar && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-900/20">
            <div className="mb-1.5 flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-200">
              <AlertTriangle size={14} />มีชื่อใกล้เคียงอยู่แล้ว
            </div>
            <ul className="mb-2 space-y-1 text-xs">
              {similar.map((s, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span className="truncate">{s.name}</span>
                  <span className="shrink-0 rounded bg-white/70 px-1.5 py-0.5 text-[10px] text-amber-800 dark:bg-black/20 dark:text-amber-200">{SOURCE_TH[s.source]}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-amber-800 dark:text-amber-200">
              ถ้าเป็นเจ้าเดียวกัน ให้ปิดกล่องนี้แล้วเลือกจากรายชื่อ (AVL) แทน — ถ้าเป็นเจ้าใหม่จริง กดยืนยันด้านล่าง
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">ยกเลิก</button>
          <button type="button" onClick={() => void submit(!!similar)} disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-[#1B8C4B] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#157a40] disabled:opacity-50">
            {busy && <Loader2 size={14} className="animate-spin" />}{similar ? "ยืนยันว่าเป็นเจ้าใหม่" : "ใช้ชื่อนี้"}
          </button>
        </div>
      </div>
    </Shell>
  )
}

/** ผูกชื่อชั่วคราวกับซัพพลายเออร์ตัวจริงใน ATMS — onDone คืนชื่อมาตรฐานไปเขียนทับชื่อในใบ */
export function LinkAtmsDialog({ name, onDone, onClose }: {
  name: string
  onDone: (v: AtmsPick) => void
  onClose: () => void
}) {
  const [list, setList] = useState<AtmsPick[] | null>(null)
  const [q, setQ] = useState(name)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let off = false
    fetch("/api/garages/atms")
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d?.error ?? "โหลดรายชื่อ ATMS ไม่สำเร็จ"); return d.garages as AtmsPick[] })
      .then((g) => { if (!off) setList(g) })
      .catch((e) => { if (!off) { swalError(e instanceof Error ? e.message : String(e)); setList([]) } })
    return () => { off = true }
  }, [])

  const shown = useMemo(() => {
    const k = q.replace(/\s+/g, " ").trim().toLowerCase()
    const all = list ?? []
    return (k ? all.filter((g) => g.name.toLowerCase().includes(k)) : all).slice(0, 60)
  }, [list, q])

  const pick = async (g: AtmsPick) => {
    setBusy(true)
    try {
      const res = await fetch("/api/vendors/provisional", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, atmsId: g.atmsId }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d?.error ?? "ผูกทะเบียนไม่สำเร็จ")
      onDone({ atmsId: g.atmsId, name: String(d.atmsName || g.name), type: String(d.type || g.type || "") })
    } catch (e) {
      swalError(e instanceof Error ? e.message : "ผูกทะเบียนไม่สำเร็จ")
    } finally { setBusy(false) }
  }

  return (
    <Shell title={`ผูกทะเบียน: ${name}`} onClose={onClose}
      hint="เลือกซัพพลายเออร์ตัวจริงใน ATMS (ชุดเดียวกับ Mena-Next) — ถ้ายังไม่มี ต้องขึ้นทะเบียนใน ATMS ก่อน แล้วกลับมากดผูก">
      <div className="relative mb-2">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อใน ATMS" className={fieldCls + " pl-8"} autoFocus />
      </div>
      <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-white/10">
        {list === null && <div className="flex items-center gap-2 p-3 text-sm text-gray-400"><Loader2 size={14} className="animate-spin" />กำลังโหลดรายชื่อ ATMS…</div>}
        {list !== null && shown.length === 0 && (
          <div className="p-4 text-center text-sm text-gray-400">ไม่พบชื่อนี้ใน ATMS — ขึ้นทะเบียนใน ATMS ก่อน แล้วกลับมากดผูก</div>
        )}
        {shown.map((g) => (
          <button key={g.atmsId} type="button" disabled={busy} onClick={() => void pick(g)}
            className="flex w-full items-center justify-between gap-2 border-b border-gray-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-emerald-50 disabled:opacity-50 dark:border-white/5 dark:hover:bg-emerald-900/20">
            <span className="truncate">{g.name}</span>
            <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-gray-400">
              {g.type || "—"}<Link2 size={13} />
            </span>
          </button>
        ))}
      </div>
    </Shell>
  )
}
