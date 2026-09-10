"use client"
// หน้าข้อมูลอู่ (อู่กรอกเอง): ประเภทงานที่ทำได้ + พิกัด (วางลิงก์ Google Maps / ใช้ GPS มือถือ / พิมพ์ lat,lng)
// ส่งใบแล้วข้อมูลนี้ถูกคัดลอกไปทะเบียน AVL ให้จัดซื้อดู (ผู้ใช้ขอ 2026-09-10)
import { useState } from "react"
import { parseLatLng, mapsLink, type RfqProfile } from "@/lib/rfq-core"
import { useInvite, V, VendorHeader, StatusNotice, NeedContact, type PublicInvite } from "@/components/rfq-vendor-shared"

export function RfqVendorProfile({ token }: { token: string }) {
  const { data, loading, error, setLocal } = useInvite(token)
  if (loading) return <div style={V.page}><div style={V.muted}>กำลังโหลด…</div></div>
  if (error || !data) return <div style={V.page}><div style={{ ...V.card, color: "#B91C1C" }}>{error || "โหลดไม่สำเร็จ"}</div></div>
  if (!data.invite.contact && data.invite.canWrite) return <NeedContact token={token} />
  // ฟอร์มถูก mount หลังโหลดแล้วเท่านั้น จึงตั้งค่าตั้งต้นจาก profile ได้ใน useState ตรง ๆ (ไม่ต้องใช้ effect)
  return <ProfileForm token={token} invite={data.invite} onSaved={(p) => setLocal((x) => ({ ...x, invite: { ...x.invite, profile: p } }))} />
}

function ProfileForm({ token, invite, onSaved }: { token: string; invite: PublicInvite; onSaved: (p: RfqProfile) => void }) {
  const p0 = invite.profile
  const [bays, setBays] = useState(p0 ? String(p0.capacity.bays || "") : "")
  const [heavy, setHeavy] = useState(p0 ? String(p0.capacity.heavy || "") : "")
  const [mid, setMid] = useState(p0 ? String(p0.capacity.mid || "") : "")
  const [light, setLight] = useState(p0 ? String(p0.capacity.light || "") : "")
  const [mapUrl, setMapUrl] = useState(p0?.mapUrl ?? "")
  const [lat, setLat] = useState(p0?.lat !== undefined ? String(p0.lat) : ""); const [lng, setLng] = useState(p0?.lng !== undefined ? String(p0.lng) : "")
  const [address, setAddress] = useState(p0?.address ?? "")
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(""); const [err, setErr] = useState("")
  const ro = !invite.canWrite
  const parsed = lat && lng ? { lat: Number(lat), lng: Number(lng) } : parseLatLng(mapUrl)
  const okCoord = parsed && Number.isFinite(parsed.lat) && Number.isFinite(parsed.lng) && Math.abs(parsed.lat) <= 90 && Math.abs(parsed.lng) <= 180 ? parsed : null

  function onMapUrl(v: string) {
    setMapUrl(v)
    const p = parseLatLng(v)
    if (p) { setLat(String(p.lat)); setLng(String(p.lng)) }
  }
  function useGps() {
    if (!navigator.geolocation) { setErr("เบราว์เซอร์นี้ไม่รองรับ GPS"); return }
    setErr(""); setMsg("กำลังหาตำแหน่ง…")
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLat(pos.coords.latitude.toFixed(6)); setLng(pos.coords.longitude.toFixed(6)); setMsg("ได้ตำแหน่งแล้ว กดบันทึกด้านล่าง") },
      () => { setMsg(""); setErr("ขอตำแหน่งไม่สำเร็จ — เปิดอนุญาตตำแหน่งให้เบราว์เซอร์ หรือวางลิงก์แผนที่แทน") },
      { enableHighAccuracy: true, timeout: 15000 }
    )
  }
  async function save() {
    setBusy(true); setErr(""); setMsg("")
    try {
      const r = await fetch(`/api/q/${token}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile: { capacity: { bays: bays || undefined, heavy: heavy || undefined, mid: mid || undefined, light: light || undefined }, mapUrl, lat: lat || undefined, lng: lng || undefined, address } }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error ?? "บันทึกไม่สำเร็จ")
      const p = d.profile as RfqProfile
      onSaved(p)
      if (p.lat !== undefined) { setLat(String(p.lat)); setLng(String(p.lng)) }
      setBays(String(p.capacity.bays || ""))
      setMsg(p.lat !== undefined ? "บันทึกแล้ว · พิกัดถูกต้อง" : "บันทึกแล้ว (ยังไม่มีพิกัด — วางลิงก์แผนที่หรือกดใช้ GPS)")
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const sum = (Number(heavy) || 0) + (Number(mid) || 0) + (Number(light) || 0)

  return (
    <div style={V.page}>
      <VendorHeader invite={invite} subtitle="ข้อมูลอู่ — งานที่รับทำ และที่ตั้ง" backHref={`/q/${token}`} />
      <StatusNotice invite={invite} />
      <div style={V.card}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>กำลังการซ่อม (ช่องซ่อม)</div>
        <div style={{ ...V.muted, marginBottom: 8 }}>อู่มีช่องซ่อมกี่ช่อง และรับงาน หนัก / กลาง / เบา ได้อย่างละกี่ช่อง</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <div><label style={V.label}>งานหนัก<span style={{ display: "block", fontWeight: 400, color: "#7C8B82", fontSize: 11.5 }}>ยกเครื่อง/เกียร์/โครงสร้าง</span></label><input style={V.input} inputMode="numeric" disabled={ro} value={heavy} onChange={(e) => setHeavy(e.target.value)} placeholder="0" /></div>
          <div><label style={V.label}>งานกลาง<span style={{ display: "block", fontWeight: 400, color: "#7C8B82", fontSize: 11.5 }}>ช่วงล่าง/เบรก/ไฟฟ้า</span></label><input style={V.input} inputMode="numeric" disabled={ro} value={mid} onChange={(e) => setMid(e.target.value)} placeholder="0" /></div>
          <div><label style={V.label}>งานเบา<span style={{ display: "block", fontWeight: 400, color: "#7C8B82", fontSize: 11.5 }}>PM/เปลี่ยนถ่าย/ตรวจเช็ค</span></label><input style={V.input} inputMode="numeric" disabled={ro} value={light} onChange={(e) => setLight(e.target.value)} placeholder="0" /></div>
        </div>
        <div style={{ marginTop: 10 }}>
          <label style={V.label}>ช่องซ่อมทั้งหมด<span style={{ display: "block", fontWeight: 400, color: "#7C8B82", fontSize: 11.5 }}>ถ้าไม่กรอก ระบบใช้ผลรวม หนัก+กลาง+เบา = {sum} ช่อง</span></label>
          <input style={V.input} inputMode="numeric" disabled={ro} value={bays} onChange={(e) => setBays(e.target.value)} placeholder={String(sum)} />
        </div>
      </div>
      <div style={V.card}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>ที่ตั้งอู่</div>
        <div style={{ ...V.muted, marginBottom: 8 }}>ทำอย่างใดอย่างหนึ่ง: วางลิงก์จาก Google Maps · กดใช้ตำแหน่งปัจจุบัน · หรือพิมพ์พิกัดเอง</div>
        <label style={V.label}>ลิงก์ Google Maps</label>
        <input style={V.input} value={mapUrl} disabled={ro} onChange={(e) => onMapUrl(e.target.value)} placeholder="วางลิงก์จากปุ่มแชร์ใน Google Maps" inputMode="url" />
        <button type="button" onClick={useGps} disabled={ro} style={{ ...V.btn, marginTop: 10, width: "100%", background: "#EFF6FF", borderColor: "#BFDBFE", color: "#1D4ED8" }}>📍 ใช้ตำแหน่งปัจจุบัน (GPS มือถือ)</button>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
          <div><label style={V.label}>ละติจูด (lat)</label><input style={V.input} inputMode="decimal" disabled={ro} value={lat} onChange={(e) => setLat(e.target.value)} placeholder="13.75" /></div>
          <div><label style={V.label}>ลองจิจูด (lng)</label><input style={V.input} inputMode="decimal" disabled={ro} value={lng} onChange={(e) => setLng(e.target.value)} placeholder="100.50" /></div>
        </div>
        {okCoord && <a href={mapsLink(okCoord.lat, okCoord.lng)} target="_blank" rel="noreferrer" style={{ ...V.muted, display: "block", marginTop: 6, color: "#1D4ED8" }}>ตรวจสอบตำแหน่งบนแผนที่ ↗ ({okCoord.lat}, {okCoord.lng})</a>}
        <label style={{ ...V.label, marginTop: 10 }}>ที่อยู่ / จุดสังเกต</label>
        <input style={V.input} value={address} disabled={ro} maxLength={300} onChange={(e) => setAddress(e.target.value)} placeholder="เช่น ถ.สุขุมวิท กม.30 ตรงข้ามปั๊ม ปตท." />
        {msg && <div style={{ color: "#047857", fontSize: 13, marginTop: 10 }}>{msg}</div>}
        {err && <div style={{ color: "#B91C1C", fontSize: 13, marginTop: 10 }}>{err}</div>}
        {!ro && <button style={{ ...V.btnPrimary, marginTop: 14, opacity: busy ? .6 : 1 }} disabled={busy} onClick={() => void save()}>บันทึกข้อมูลอู่</button>}
      </div>
      <a href={`/q/${token}`} style={{ ...V.btn, display: "block", textAlign: "center", textDecoration: "none", color: "#14271C" }}>‹ กลับหน้าหลัก</a>
    </div>
  )
}
