"use client"

// แท็บ Sub: เพิ่ม/ปิด Sub + ตั้งคลัง Hub ใน ATMS ต่อคลัง (hub_sites)
import { useCallback, useEffect, useState } from "react"
import { swalError, swalToast } from "@/lib/swal"
import { btnCls, btnGhost, hubFetch, inputCls, tableWrap, th, thead, tr, type HubSite, type HubVendor, type InvOpt } from "./hub-shared"

function SiteRow({ inv, site, canEdit, onSaved }: { inv: InvOpt; site?: HubSite; canEdit: boolean; onSaved: () => void }) {
  const [atms, setAtms] = useState(site ? String(site.atmsHubInventoryId) : "")
  const [active, setActive] = useState(site?.active ?? true)
  const [busy, setBusy] = useState(false)
  async function save() {
    const n = Number(atms)
    if (!Number.isInteger(n) || n <= 0) return swalError("เลขคลังใน ATMS ต้องเป็นจำนวนเต็มมากกว่า 0")
    setBusy(true)
    try {
      await hubFetch("/api/store-withdraw/hub/master?type=sites", { method: "PUT", body: { inventoryId: inv.id, atmsHubInventoryId: n, active } })
      swalToast("success", "บันทึกแล้ว"); onSaved()
    } catch (e) { swalError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ") }
    finally { setBusy(false) }
  }
  return (
    <tr className={tr}>
      <td className={th}>{inv.name}</td>
      <td className={th}><input aria-label={`เลขคลัง Hub ใน ATMS ของ ${inv.name}`} disabled={!canEdit} inputMode="numeric" className={`${inputCls} w-28`} value={atms} onChange={(e) => setAtms(e.target.value)} /></td>
      <td className={th}><label className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" disabled={!canEdit} checked={active} onChange={(e) => setActive(e.target.checked)} />เปิดใช้</label></td>
      <td className={th}>{canEdit && <button type="button" disabled={busy} onClick={save} className={btnGhost}>บันทึก</button>}</td>
    </tr>
  )
}

export function HubVendorsTab({ invs, canEdit }: { invs: InvOpt[]; canEdit: boolean }) {
  const [vendors, setVendors] = useState<HubVendor[]>([])
  const [sites, setSites] = useState<HubSite[]>([])
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    Promise.all([
      hubFetch<{ rows: HubVendor[] }>("/api/store-withdraw/hub/master?type=vendors"),
      hubFetch<{ rows: HubSite[] }>("/api/store-withdraw/hub/master?type=sites"),
    ]).then(([v, s]) => { setVendors(v.rows); setSites(s.rows) })
      .catch((e) => swalError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ"))
  }, [])
  useEffect(() => { load() }, [load])

  async function addVendor() {
    if (!code.trim() || !name.trim()) return swalError("ใส่รหัส Sub และชื่อให้ครบ")
    setBusy(true)
    try { await hubFetch("/api/store-withdraw/hub/master?type=vendors", { body: { code: code.trim(), name: name.trim() } }); swalToast("success", "เพิ่ม Sub แล้ว"); setCode(""); setName(""); load() }
    catch (e) { swalError(e instanceof Error ? e.message : "เพิ่มไม่สำเร็จ") }
    finally { setBusy(false) }
  }
  async function toggle(v: HubVendor) {
    try { await hubFetch("/api/store-withdraw/hub/master?type=vendors", { method: "PATCH", body: { code: v.code, active: !v.active } }); load() }
    catch (e) { swalError(e instanceof Error ? e.message : "ทำรายการไม่สำเร็จ") }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-[#14271C] dark:text-white">Sub</h2>
        {canEdit && (
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void addVendor() }}>
            <label className="text-xs text-gray-500">รหัส Sub<input aria-label="รหัส Sub" className={`${inputCls} mt-1 block w-36`} value={code} onChange={(e) => setCode(e.target.value)} /></label>
            <label className="text-xs text-gray-500">ชื่อ<input aria-label="ชื่อ Sub" className={`${inputCls} mt-1 block w-64`} value={name} onChange={(e) => setName(e.target.value)} /></label>
            <button type="submit" disabled={busy} className={btnCls}>เพิ่ม Sub</button>
          </form>
        )}
        {vendors.length === 0 ? <p className="text-sm text-gray-500">ยังไม่มี Sub</p> : (
          <div className={tableWrap}>
            <table className="w-full text-left text-sm">
              <thead className={thead}><tr><th className={th}>รหัส</th><th className={th}>ชื่อ</th><th className={th}>สถานะ</th><th className={th} /></tr></thead>
              <tbody>{vendors.map((v) => (
                <tr key={v.code} className={`${tr} ${v.active ? "" : "opacity-50"}`}>
                  <td className={th}>{v.code}</td><td className={th}>{v.name}</td><td className={th}>{v.active ? "เปิดใช้" : "ปิดแล้ว"}</td>
                  <td className={th}>{canEdit && <button type="button" onClick={() => toggle(v)} className={btnGhost}>{v.active ? "ปิดใช้" : "เปิดใช้"}</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-[#14271C] dark:text-white">คลัง Hub ใน ATMS</h2>
          <p className="text-xs text-gray-500">เลขคลังใน ATMS ที่ใช้ตัด WD ของ Hub</p>
        </div>
        <div className={tableWrap}>
          <table className="w-full text-left text-sm">
            <thead className={thead}><tr><th className={th}>คลัง</th><th className={th}>เลขคลัง Hub ใน ATMS</th><th className={th}>สถานะ</th><th className={th} /></tr></thead>
            <tbody>{invs.map((i) => { const s = sites.find((x) => x.inventoryId === i.id); return <SiteRow key={`${i.id}|${s?.atmsHubInventoryId}|${s?.active}`} inv={i} site={s} canEdit={canEdit} onSaved={load} /> })}</tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
