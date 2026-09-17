"use client"
// ช่องที่อยู่แบบแยก สำหรับหน้าอู่ (public, มือถือก่อน · สไตล์ inline ชุดเดียวกับ rfq-vendor-shared)
// เลือก จังหวัด → อำเภอ → ตำบล (แต่ละช่องกรองตามช่องก่อนหน้า) · รหัสไปรษณีย์เติมเองจากตำบล
// + ค้นหาเร็ว: พิมพ์ชื่อตำบลหรือรหัสไปรษณีย์ แล้วแตะผลลัพธ์ = เติมครบทุกช่อง
import { useEffect, useMemo, useState, type CSSProperties } from "react"
import {
  loadThaiAddress, listProvinces, listDistricts, listSubdistricts, searchThaiAddress, zipOf,
  type ProvinceNode, type ThaiAddressParts,
} from "@/lib/thai-address"
import { V } from "@/components/rfq-vendor-shared"

const select: CSSProperties = { ...V.input, appearance: "auto" }
const grid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginTop: 10 }

/** ใส่ค่าที่บันทึกไว้เป็นตัวเลือกด้วย แม้ไม่อยู่ในชุดข้อมูล — ไม่งั้น <select> จะแสดงว่างทั้งที่มีค่า */
const withCurrent = (list: string[], cur?: string) => (cur && !list.includes(cur) ? [cur, ...list] : list)

export function ThaiAddressPicker({ value, onChange, disabled }: {
  value: ThaiAddressParts
  onChange: (patch: Partial<ThaiAddressParts>) => void
  disabled?: boolean
}) {
  const [data, setData] = useState<ProvinceNode[] | null>(null)
  const [q, setQ] = useState("")
  useEffect(() => { loadThaiAddress().then(setData).catch(() => setData([])) }, [])

  const provinces = useMemo(() => withCurrent(data ? listProvinces(data) : [], value.province), [data, value.province])
  const districts = useMemo(() => withCurrent(data ? listDistricts(data, value.province) : [], value.district), [data, value.province, value.district])
  const tambons = useMemo(() => (data ? listSubdistricts(data, value.province, value.district) : []), [data, value.province, value.district])
  const tambonNames = useMemo(() => withCurrent(tambons.map((t) => t.n), value.subdistrict), [tambons, value.subdistrict])
  const hits = useMemo(() => (data ? searchThaiAddress(data, q) : []), [data, q])
  // ตำบลที่ต้นทางไม่มีรหัสไปรษณีย์ (เกาะ) หรือยังไม่เลือกตำบล → ให้พิมพ์รหัสเองได้
  const autoZip = zipOf(tambons.find((t) => t.n === value.subdistrict))
  const loading = !data

  return (
    <div>
      {!disabled && (
        <div style={{ position: "relative" }}>
          <label style={V.label}>🔎 ค้นหาเร็ว <span style={{ fontWeight: 400, color: "#7C8B82" }}>พิมพ์ชื่อตำบล หรือรหัสไปรษณีย์ แล้วแตะเลือก</span></label>
          <input style={V.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={loading ? "กำลังโหลดรายชื่อ…" : "เช่น หนองปรือ หรือ 20150"} disabled={loading} />
          {hits.length > 0 && (
            <div style={{ border: "1px solid #D5E2DA", borderRadius: 10, marginTop: 4, overflow: "hidden", background: "#fff" }}>
              {hits.map((h) => (
                <button
                  key={`${h.province}|${h.district}|${h.subdistrict}`}
                  type="button"
                  onClick={() => { onChange(h); setQ("") }}
                  style={{ ...V.btn, display: "block", width: "100%", textAlign: "left", border: "none", borderBottom: "1px solid #EEF3F0", borderRadius: 0, fontWeight: 400, fontSize: 14.5 }}
                >
                  ต.{h.subdistrict} › อ.{h.district} › จ.{h.province} <span style={{ color: "#7C8B82" }}>{h.postalCode}</span>
                </button>
              ))}
            </div>
          )}
          {q.trim().length >= 2 && hits.length === 0 && !loading && <div style={{ ...V.muted, marginTop: 4 }}>ไม่พบ — ลองพิมพ์ชื่อตำบลให้สั้นลง หรือเลือกจากช่องด้านล่าง</div>}
        </div>
      )}

      <label style={{ ...V.label, marginTop: 10 }}>บ้านเลขที่ / หมู่ / ซอย / ถนน</label>
      <input style={V.input} value={value.addressDetail ?? ""} disabled={disabled} maxLength={200} onChange={(e) => onChange({ addressDetail: e.target.value })} placeholder="เช่น 99/1 หมู่ 2 ซ.สุขใจ ถ.สุขุมวิท" />

      <div style={grid}>
        <div>
          <label style={V.label}>จังหวัด</label>
          <select style={select} disabled={disabled || loading} value={value.province ?? ""}
            onChange={(e) => onChange({ province: e.target.value, district: "", subdistrict: "", postalCode: "" })}>
            <option value="">{loading ? "กำลังโหลด…" : "เลือกจังหวัด"}</option>
            {provinces.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <label style={V.label}>{value.province === "กรุงเทพมหานคร" ? "เขต" : "อำเภอ"}</label>
          <select style={select} disabled={disabled || !value.province} value={value.district ?? ""}
            onChange={(e) => onChange({ district: e.target.value, subdistrict: "", postalCode: "" })}>
            <option value="">{value.province ? "เลือกอำเภอ" : "เลือกจังหวัดก่อน"}</option>
            {districts.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <label style={V.label}>{value.province === "กรุงเทพมหานคร" ? "แขวง" : "ตำบล"}</label>
          <select style={select} disabled={disabled || !value.district} value={value.subdistrict ?? ""}
            onChange={(e) => onChange({ subdistrict: e.target.value, postalCode: zipOf(tambons.find((t) => t.n === e.target.value)) })}>
            <option value="">{value.district ? "เลือกตำบล" : "เลือกอำเภอก่อน"}</option>
            {tambonNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <label style={V.label}>รหัสไปรษณีย์</label>
          <input style={{ ...V.input, background: autoZip ? "#F3F7F4" : "#fff" }} inputMode="numeric" maxLength={5}
            readOnly={!!autoZip} disabled={disabled} value={value.postalCode ?? ""}
            onChange={(e) => onChange({ postalCode: e.target.value.replace(/\D/g, "") })}
            placeholder={autoZip ? "" : value.subdistrict ? "พิมพ์รหัส 5 หลัก" : "เติมอัตโนมัติ"} />
        </div>
      </div>
    </div>
  )
}
