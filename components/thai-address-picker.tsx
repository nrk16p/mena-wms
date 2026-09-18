"use client"
// ช่องที่อยู่แบบแยก สำหรับหน้าอู่ (public, มือถือก่อน · สไตล์ inline ชุดเดียวกับ rfq-vendor-shared)
// autocomplete ทุกช่อง (ผู้ใช้ขอ 2026-09-18): พิมพ์ จังหวัด / อำเภอ / ตำบล / รหัสไปรษณีย์ ช่องไหนก็ได้ แล้วแตะรายการที่แนะนำ
// เลือกตำบลหรือรหัสไปรษณีย์ = เติมครบ 4 ช่อง · เลือกอำเภอ = เติมจังหวัดให้ · ช่องเก็บเฉพาะค่าที่เลือกจากรายการ
// (พิมพ์ค้างแล้วออกจากช่อง = คืนค่าเดิม · ลบจนว่างแล้วออก = ล้างช่องนั้นและช่องระดับล่าง)
import { useEffect, useId, useMemo, useState, type CSSProperties, type FocusEvent, type KeyboardEvent } from "react"
import {
  loadThaiAddress, listSubdistricts, suggestAddress, zipOf,
  type AddressField, type AddressSuggestion, type ProvinceNode, type ThaiAddressParts,
} from "@/lib/thai-address"
import { V } from "@/components/rfq-vendor-shared"

const BKK = "กรุงเทพมหานคร"
const grid: CSSProperties = { position: "relative", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginTop: 10 }

/** ลบช่องนี้จนว่าง → ช่องระดับล่างที่พึ่งมันต้องว่างตาม */
const CLEAR: Record<AddressField, Partial<ThaiAddressParts>> = {
  province: { province: "", district: "", subdistrict: "", postalCode: "" },
  district: { district: "", subdistrict: "", postalCode: "" },
  subdistrict: { subdistrict: "", postalCode: "" },
  postalCode: { postalCode: "" },
}

function label(s: AddressSuggestion) {
  const bkk = s.province === BKK
  const prov = bkk ? s.province : `จ.${s.province}`
  if (s.subdistrict !== undefined) return `${bkk ? "แขวง" : "ต."}${s.subdistrict} › ${bkk ? "เขต" : "อ."}${s.district} › ${prov}`
  if (s.district !== undefined) return `${bkk ? "เขต" : "อ."}${s.district} › ${prov}`
  return s.province
}

export function ThaiAddressPicker({ value, onChange, disabled }: {
  value: ThaiAddressParts
  onChange: (patch: Partial<ThaiAddressParts>) => void
  disabled?: boolean
}) {
  const [data, setData] = useState<ProvinceNode[] | null>(null)
  const [active, setActive] = useState<AddressField | null>(null)
  const [draft, setDraft] = useState("")
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const [top, setTop] = useState(0)
  const listId = useId()
  useEffect(() => { loadThaiAddress().then(setData).catch(() => setData([])) }, [])

  const loading = !data
  const bkk = value.province === BKK
  // ตำบลที่ต้นทางไม่มีรหัสไปรษณีย์ (เกาะ) → ให้พิมพ์รหัส 5 หลักเองได้
  const autoZip = useMemo(() => zipOf(data ? listSubdistricts(data, value.province, value.district).find((t) => t.n === value.subdistrict) : undefined), [data, value.province, value.district, value.subdistrict])
  const list = useMemo(() => (data && active && open ? suggestAddress(data, active, draft, value) : []), [data, active, open, draft, value])

  function pick(s: AddressSuggestion) {
    if (s.subdistrict !== undefined) onChange({ province: s.province, district: s.district, subdistrict: s.subdistrict, postalCode: s.postalCode ?? "" })
    else if (s.district !== undefined) { if (s.province !== value.province || s.district !== value.district) onChange({ province: s.province, district: s.district, subdistrict: "", postalCode: "" }) }
    else if (s.province !== value.province) onChange({ ...CLEAR.province, province: s.province })
    if (active) setDraft(String(s[active] ?? ""))
    setOpen(false)
  }
  function onFocus(field: AddressField, e: FocusEvent<HTMLInputElement>) {
    // วางรายการใต้ช่องที่กำลังพิมพ์ แต่กว้างเต็มกริด (ช่องบนมือถือแคบเกินจะอ่านชื่อ ตำบล › อำเภอ › จังหวัด)
    setTop(e.currentTarget.offsetTop + e.currentTarget.offsetHeight + 4)
    setActive(field); setDraft(value[field] ?? ""); setHi(0); setOpen(true)
    e.currentTarget.select()
  }
  function onBlur(field: AddressField) {
    const t = draft.trim()
    if (field === "postalCode" && /^\d{5}$/.test(t) && value.subdistrict && !autoZip) onChange({ postalCode: t })
    else if (!t && value[field]) onChange(field === "postalCode" && autoZip ? {} : CLEAR[field])
    setActive(null); setOpen(false)
  }
  function onKey(field: AddressField, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, Math.max(list.length - 1, 0))) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)) }
    else if (e.key === "Enter" && open && list[hi]) { e.preventDefault(); pick(list[hi]) }
    else if (e.key === "Escape") { setOpen(false); setDraft(value[field] ?? "") }
  }

  const field = (f: AddressField, title: string, placeholder: string) => (
    <div>
      <label style={V.label}>{title}</label>
      <input
        style={V.input} disabled={disabled || loading} autoComplete="off" inputMode={f === "postalCode" ? "numeric" : undefined}
        maxLength={f === "postalCode" ? 5 : 80} placeholder={loading ? "กำลังโหลด…" : placeholder}
        value={active === f ? draft : value[f] ?? ""}
        onFocus={(e) => onFocus(f, e)} onBlur={() => onBlur(f)} onKeyDown={(e) => onKey(f, e)}
        onChange={(e) => { setDraft(f === "postalCode" ? e.target.value.replace(/\D/g, "") : e.target.value); setHi(0); setOpen(true) }}
        role="combobox" aria-controls={listId} aria-expanded={active === f && open && list.length > 0} aria-autocomplete="list"
      />
    </div>
  )
  const typed = draft.trim().length >= (active === "postalCode" ? 3 : 2)

  return (
    <div>
      <label style={{ ...V.label, marginTop: 10 }}>บ้านเลขที่ / หมู่ / ซอย / ถนน</label>
      <input style={V.input} value={value.addressDetail ?? ""} disabled={disabled} maxLength={200} onChange={(e) => onChange({ addressDetail: e.target.value })} placeholder="เช่น 99/1 หมู่ 2 ซ.สุขใจ ถ.สุขุมวิท" />
      {!disabled && <div style={{ ...V.muted, marginTop: 10 }}>พิมพ์ช่องไหนก็ได้ แล้วแตะรายการที่แนะนำ — เลือก{bkk ? "แขวง" : "ตำบล"}หรือรหัสไปรษณีย์ ระบบเติมให้ครบทุกช่อง</div>}
      <div style={grid}>
        {field("province", "จังหวัด", "พิมพ์ชื่อจังหวัด")}
        {field("district", bkk ? "เขต" : "อำเภอ", bkk ? "พิมพ์ชื่อเขต" : "พิมพ์ชื่ออำเภอ")}
        {field("subdistrict", bkk ? "แขวง" : "ตำบล", bkk ? "พิมพ์ชื่อแขวง" : "พิมพ์ชื่อตำบล")}
        {field("postalCode", "รหัสไปรษณีย์", value.subdistrict && !autoZip ? "พิมพ์รหัส 5 หลัก" : "เช่น 10600")}
        {active && open && (list.length > 0 || typed) && (
          <div id={listId} role="listbox" style={{ position: "absolute", left: 0, right: 0, top, zIndex: 30, background: "#fff", border: "1px solid #D5E2DA", borderRadius: 10, boxShadow: "0 8px 24px rgba(20,39,28,.12)", overflow: "hidden", maxHeight: 320, overflowY: "auto" }}>
            {list.length === 0 && <div style={{ ...V.muted, padding: "10px 12px" }}>ไม่พบ — ลองพิมพ์ให้สั้นลง</div>}
            {list.map((s, i) => (
              <button
                key={`${s.province}|${s.district ?? ""}|${s.subdistrict ?? ""}`} type="button" role="option" aria-selected={i === hi}
                onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)} onMouseEnter={() => setHi(i)}
                style={{ ...V.btn, display: "flex", gap: 8, width: "100%", textAlign: "left", border: "none", borderBottom: "1px solid #EEF3F0", borderRadius: 0, fontWeight: 400, fontSize: 14.5, minHeight: 44, background: i === hi ? "#EEF6F1" : "#fff" }}
              >
                <span style={{ flex: 1 }}>{label(s)}</span>
                {s.postalCode && <span style={{ color: "#7C8B82", fontVariantNumeric: "tabular-nums" }}>{s.postalCode}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
