"use client"

// แท็บรายการอะไหล่: แก้ราคา/หน่วย/ปิดใช้ (สร้างรายการใหม่ได้จากการรับเข้า)
import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { swalError, swalToast } from "@/lib/swal"
import { btnGhost, hubFetch, inputCls, tableWrap, th, thead, tr, type HubRow } from "./hub-shared"

function ItemRow({ r, canEdit, onSaved }: { r: HubRow; canEdit: boolean; onSaved: () => void }) {
  const [price, setPrice] = useState(r.price == null ? "" : String(r.price))
  const [unit, setUnit] = useState(r.unit)
  const [busy, setBusy] = useState(false)
  const dirty = price !== (r.price == null ? "" : String(r.price)) || unit !== r.unit

  async function save(extra: { active?: boolean } = {}) {
    const p = price.trim() === "" ? null : Number(price)
    if (p !== null && (!Number.isFinite(p) || p < 0)) return swalError("ราคาไม่ถูกต้อง")
    setBusy(true)
    try {
      await hubFetch("/api/store-withdraw/hub/master?type=items", { method: "PATCH", body: { inventoryId: r.inventoryId, vendorCode: r.vendorCode, skuId: r.skuId, price: p, unit: unit.trim(), ...extra } })
      swalToast("success", "บันทึกแล้ว"); onSaved()
    } catch (e) { swalError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ") }
    finally { setBusy(false) }
  }

  return (
    <tr className={`${tr} ${r.active ? "" : "opacity-50"}`}>
      <td className={th}>{r.vendorCode}</td>
      <td className={th}>{r.skuCode}</td>
      <td className={th}>{r.skuName}</td>
      <td className={th}><input aria-label={`หน่วย ${r.skuCode}`} disabled={!canEdit} className={`${inputCls} w-20`} value={unit} onChange={(e) => setUnit(e.target.value)} /></td>
      <td className={th}><input aria-label={`ราคา ${r.skuCode}`} disabled={!canEdit} inputMode="decimal" className={`${inputCls} w-28`} value={price} onChange={(e) => setPrice(e.target.value)} /></td>
      <td className={th}>{canEdit && (
        <span className="flex gap-1.5">
          <button type="button" disabled={busy || !dirty} onClick={() => save()} className={btnGhost}>บันทึก</button>
          <button type="button" disabled={busy} onClick={() => save({ active: !r.active })} className={btnGhost}>{r.active ? "ปิดใช้" : "เปิดใช้"}</button>
        </span>
      )}</td>
    </tr>
  )
}

export function HubItemsTab({ inventoryId, canEdit }: { inventoryId: number | null; canEdit: boolean }) {
  const [rows, setRows] = useState<HubRow[] | null>(null)
  const [q, setQ] = useState("")
  const [error, setError] = useState("")

  const load = useCallback(() => {
    if (!inventoryId) return
    hubFetch<{ rows: HubRow[] }>(`/api/store-withdraw/hub/master?type=items&inventoryId=${inventoryId}`)
      .then((j) => { setRows(j.rows); setError("") })
      .catch((e) => setError(e instanceof Error ? e.message : "โหลดรายการไม่สำเร็จ"))
  }, [inventoryId])
  useEffect(() => { load() }, [load])

  const k = q.trim().toLowerCase()
  const shown = (rows ?? []).filter((r) => !k || `${r.skuCode} ${r.skuName} ${r.vendorCode}`.toLowerCase().includes(k))

  return (
    <div className="space-y-3">
      <input aria-label="ค้นหา" className={`${inputCls} w-full sm:w-80`} placeholder="ค้นรหัส ชื่อ หรือ Sub" value={q} onChange={(e) => setQ(e.target.value)} />
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
      {!rows && !error && <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" />กำลังโหลด…</p>}
      {rows && shown.length === 0 && <p className="rounded-2xl border border-dashed border-[#E2E8E4] px-4 py-10 text-center text-sm text-gray-500 dark:border-white/10">ยังไม่มีรายการ เพิ่มได้จากการรับเข้า</p>}
      {shown.length > 0 && (
        <div className={tableWrap}>
          <table className="w-full text-left text-sm">
            <thead className={thead}><tr><th className={th}>Sub</th><th className={th}>รหัส</th><th className={th}>ชื่อ</th><th className={th}>หน่วย</th><th className={th}>ราคา</th><th className={th} /></tr></thead>
            <tbody>{shown.map((r) => <ItemRow key={`${r.vendorCode}|${r.skuId}|${r.price}|${r.unit}|${r.active}`} r={r} canEdit={canEdit} onSaved={load} />)}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
