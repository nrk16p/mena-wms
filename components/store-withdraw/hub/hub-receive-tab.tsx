"use client"

// แท็บรับเข้า: เลือก Sub + เลขเอกสารส่งของ + บรรทัดอะไหล่ → ยืนยัน
import { useEffect, useState } from "react"
import { Loader2, Trash2 } from "lucide-react"
import { swalError, swalToast } from "@/lib/swal"
import { SkuPicker, type SkuHit } from "../sku-picker"
import { btnCls, hubFetch, inputCls, tableWrap, th, thead, tr, type HubVendor } from "./hub-shared"

type Line = { skuId: number; skuCode: string; skuName: string; qty: string; price: string }

export function HubReceiveTab({ inventoryId, onDone }: { inventoryId: number | null; onDone: () => void }) {
  const [vendors, setVendors] = useState<HubVendor[]>([])
  const [vendorCode, setVendorCode] = useState("")
  const [refNo, setRefNo] = useState("")
  const [lines, setLines] = useState<Line[]>([])
  const [busy, setBusy] = useState(false)
  // เปลี่ยนคลังของหน้า = ล้างบรรทัดที่ยังไม่บันทึก (บรรทัดเดิมค้นมาจากคลังเก่า ห้ามไปรับเข้าคลังใหม่)
  const [linesInv, setLinesInv] = useState(inventoryId)
  if (linesInv !== inventoryId) {
    setLinesInv(inventoryId)
    setLines([])
  }

  useEffect(() => {
    hubFetch<{ rows: HubVendor[] }>("/api/store-withdraw/hub/master?type=vendors")
      .then((j) => setVendors(j.rows.filter((v) => v.active)))
      .catch((e) => swalError(e instanceof Error ? e.message : "โหลดรายชื่อ Sub ไม่สำเร็จ"))
  }, [])

  const add = (s: SkuHit) => setLines((ls) => (ls.some((l) => l.skuId === s.skuId) ? ls : [...ls, { skuId: s.skuId, skuCode: s.skuCode, skuName: s.skuName, qty: "", price: "" }]))
  const patch = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)))

  async function submit() {
    if (!inventoryId) return swalError("เลือกคลังก่อน")
    if (!vendorCode) return swalError("เลือก Sub ก่อน")
    if (!refNo.trim()) return swalError("ใส่เลขเอกสารส่งของก่อน")
    if (lines.length === 0) return swalError("ยังไม่มีรายการ ค้นอะไหล่แล้วเพิ่มก่อน")
    const body = []
    for (const l of lines) {
      const qty = Number(l.qty)
      if (!l.qty.trim() || !Number.isFinite(qty) || qty <= 0) return swalError(`ใส่จำนวนของ ${l.skuCode} ให้มากกว่า 0`)
      const price = l.price.trim() === "" ? null : Number(l.price)
      if (price !== null && (!Number.isFinite(price) || price < 0)) return swalError(`ราคาของ ${l.skuCode} ไม่ถูกต้อง`)
      body.push({ skuId: l.skuId, skuCode: l.skuCode, skuName: l.skuName, qty, price })
    }
    setBusy(true)
    try {
      await hubFetch("/api/store-withdraw/hub/receive", { body: { inventoryId, vendorCode, refNo: refNo.trim(), lines: body } })
      swalToast("success", `รับเข้าแล้ว ${body.length} รายการ`)
      setLines([]); setRefNo(""); onDone()
    } catch (e) { swalError(e instanceof Error ? e.message : "รับเข้าไม่สำเร็จ") }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-gray-500">Sub
          <select aria-label="Sub" className={`${inputCls} mt-1 w-full`} value={vendorCode} onChange={(e) => setVendorCode(e.target.value)}>
            <option value="">เลือก Sub</option>
            {vendors.map((v) => <option key={v.code} value={v.code}>{v.code} · {v.name}</option>)}
          </select></label>
        <label className="text-xs text-gray-500">เลขเอกสารส่งของ
          <input aria-label="เลขเอกสารส่งของ" className={`${inputCls} mt-1 w-full`} maxLength={40} value={refNo} onChange={(e) => setRefNo(e.target.value)} /></label>
      </div>
      {vendors.length === 0 && <p className="text-xs text-gray-500">ยังไม่มี Sub ที่เปิดใช้ เพิ่มได้ที่แท็บ Sub</p>}

      <SkuPicker inventoryId={inventoryId ?? undefined} onPick={add} />

      {lines.length > 0 && (
        <div className={tableWrap}>
          <table className="w-full text-left text-sm">
            <thead className={thead}><tr><th className={th}>รหัส</th><th className={th}>ชื่อ</th><th className={th}>จำนวน</th><th className={th}>ราคา</th><th className={th} /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.skuId} className={tr}>
                  <td className={th}>{l.skuCode}</td>
                  <td className={th}>{l.skuName}</td>
                  <td className={th}><input aria-label={`จำนวน ${l.skuCode}`} inputMode="decimal" className={`${inputCls} w-24`} value={l.qty} onChange={(e) => patch(i, { qty: e.target.value })} /></td>
                  <td className={th}><input aria-label={`ราคา ${l.skuCode}`} inputMode="decimal" className={`${inputCls} w-28`} placeholder="ไม่ใส่ก็ได้" value={l.price} onChange={(e) => patch(i, { price: e.target.value })} /></td>
                  <td className={th}><button type="button" aria-label={`เอา ${l.skuCode} ออก`} onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))} className="text-gray-400 hover:text-red-600"><Trash2 size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" disabled={busy} onClick={submit} className={btnCls}>{busy && <Loader2 size={14} className="animate-spin" />}ยืนยันรับเข้า</button>
    </div>
  )
}
