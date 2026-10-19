"use client"

// หาอู่ใกล้ที่สุด — ซ้ายเป็นรายการเรียงใกล้→ไกล ขวาเป็นแผนที่ (ผู้ใช้เลือกแบบนี้ 19/10/2569)
//
// โจทย์จริง: รถเสียกลางทาง ยานยนต์แจ้งจุดจอด จัดซื้อต้องตอบใน 1 นาทีว่าโทรหาใครก่อน
// ปลายทางของหน้านี้จึงไม่ใช่ "เลือกอู่เสร็จ" แต่คือ "ได้ 2-3 เบอร์ที่ควรโทรไล่"
// ปุ่มโทรจึงอยู่ในใบรายการทุกใบ ไม่ต้องกดเข้าไปอีกชั้น
//
// ระยะเป็นเส้นตรง ไม่ใช่ระยะขับจริง — ในเมืองต่างกันราว 20-30% แต่ลำดับใกล้-ไกลยังถูก
// ถ้าวันหลังต้องการระยะขับจริง ต่อ API เส้นทางเพิ่มที่ฝั่ง /api/vendors/map ได้โดยหน้านี้ไม่ต้องแก้
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { Crosshair, History, Loader2, MapPin, Phone, Route, Search, TriangleAlert, Copy, Check } from "lucide-react"
import type { Map as LeafletMap, Marker as LeafletMarker, Polyline as LeafletPolyline } from "leaflet"
import { REPAIR_TYPES } from "@/lib/repair-type-master"
import { canApproveVendor } from "@/lib/roles"
import { swalError, swalToast } from "@/lib/swal"
import type { GarageHit } from "@/lib/garage-geo"
import { MultiSelectCombobox } from "@/components/multi-select-combobox"
import { GarageHistoryModal } from "@/components/garage-history-modal"
import { mitr, num } from "@/components/vendor-shared"
import { loadThaiAddress, listProvinces, listDistricts, listSubdistricts, type ProvinceNode } from "@/lib/thai-address"

type ApiResult = {
  origin: { lat: number; lng: number } | null
  resolvedFrom: string
  total: number
  withGeo: number
  items: GarageHit[]
}

/** ชื่องานฝั่งอู่นอก → รหัสทั้งหมดของงานนั้น (AVL เก็บเป็นรหัส ไม่ใช่ชื่อ) */
const OUTSIDE_WORKS: { work: string; codes: string[] }[] = (() => {
  const m = new Map<string, string[]>()
  for (const r of REPAIR_TYPES) {
    if (r.side !== "อู่นอก") continue
    m.set(r.work, [...(m.get(r.work) ?? []), r.code])
  }
  return [...m].map(([work, codes]) => ({ work, codes }))
})()

/** ตัวเลือกใน dropdown — ใช้ชื่องานเป็นคีย์ตรง ๆ (th เว้นว่างเพื่อไม่ให้ชื่อซ้ำสองรอบในป้าย) */
const WORK_OPTIONS: Record<string, { th: string; en: string }> =
  Object.fromEntries(OUTSIDE_WORKS.map(({ work }) => [work, { th: work, en: "" }]))

const PRECISION_NOTE: Record<string, string> = {
  "หน้าอู่": "พิกัดที่ยืนยันแล้ว",
  "ตำบล":   "พิกัดระดับตำบล — มาจากที่อยู่จดทะเบียน คลาดได้ 1-3 กม.",
  "อำเภอ":  "พิกัดระดับอำเภอ — หยาบ ใช้ดูทิศทางคร่าว ๆ",
}

export function GarageMapPage() {
  const { data: session } = useSession()
  const canEdit = canApproveVendor(session?.user?.email)

  const [at, setAt] = useState("")
  const [works, setWorks] = useState<string[]>([])
  const [res, setRes] = useState<ApiResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState("")
  const [active, setActive] = useState<string | null>(null)
  const [copied, setCopied] = useState("")
  // ป๊อปอัปประวัติซ่อมของอู่ที่กด (ชื่ออู่ = คีย์เดียวที่ต้องใช้)
  const [historyFor, setHistoryFor] = useState<string | null>(null)

  // เลือกพื้นที่แทนการวางพิกัด — คนแจ้งรถเสียบางทีบอกได้แค่ชื่อย่าน
  const [addr, setAddr] = useState<ProvinceNode[]>([])
  const [prov, setProv] = useState("")
  const [dist, setDist] = useState("")

  const mapRef = useRef<LeafletMap | null>(null)
  const markersRef = useRef<LeafletMarker[]>([])
  const originMarkerRef = useRef<LeafletMarker | null>(null)
  const routeRef = useRef<LeafletPolyline | null>(null)
  const [route, setRoute] = useState<{ vendor: string; km: number; min: number } | null>(null)
  const [routing, setRouting] = useState("")
  const boxRef = useRef<HTMLDivElement>(null)

  const codes = useMemo(
    () => OUTSIDE_WORKS.filter((w) => works.includes(w.work)).flatMap((w) => w.codes),
    [works],
  )

  const search = useCallback(async (input: string, codeList: string[]) => {
    setLoading(true); setErr("")
    try {
      const qs = new URLSearchParams()
      if (input) qs.set("at", input)
      if (codeList.length) qs.set("codes", codeList.join(","))
      const r = await fetch(`/api/vendors/map?${qs}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? "ค้นหาไม่สำเร็จ")
      setRes(j)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  // โหลดรายการทั้งหมดครั้งแรก (ยังไม่มีจุดอ้างอิง = เรียงตามจำนวนงานที่เคยทำให้เรา)
  useEffect(() => { void search("", []) }, [search])
  useEffect(() => { void loadThaiAddress().then(setAddr) }, [])
  // เปลี่ยนตัวกรองแล้วค้นใหม่ทันที ไม่ต้องกดปุ่ม
  useEffect(() => { void search(at, codes) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [codes])

  // ── แผนที่ (Leaflet + แผนที่ OpenStreetMap — ไม่ต้องใช้ API key)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const L = (await import("leaflet")).default
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !boxRef.current || mapRef.current) return
      const map = L.map(boxRef.current, { zoomControl: true }).setView([13.7563, 100.5018], 10)
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, attribution: "© OpenStreetMap",
      }).addTo(map)
      // คลิกบนแผนที่ = ตั้งจุดที่รถเสียตรงนั้น (ทางที่เร็วที่สุดเมื่อรู้แค่ว่า "แถว ๆ นี้")
      map.on("click", (e: { latlng: { lat: number; lng: number } }) => {
        const v = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`
        setAt(v); void search(v, codes)
      })
      mapRef.current = map
    })()
    return () => { cancelled = true }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [])

  // วาดหมุดใหม่ทุกครั้งที่ผลลัพธ์เปลี่ยน
  useEffect(() => {
    const map = mapRef.current
    if (!map || !res) return
    void (async () => {
      const L = (await import("leaflet")).default
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
      originMarkerRef.current?.remove()
      routeRef.current?.remove(); routeRef.current = null; setRoute(null)

      const pin = (text: string, bg: string) => L.divIcon({
        className: "",
        html: `<div style="background:${bg};color:#fff;font:700 11px/22px 'Mitr',sans-serif;width:24px;height:24px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.4)"><span style="display:block;transform:rotate(45deg)">${text}</span></div>`,
        iconSize: [24, 24], iconAnchor: [12, 24],
      })

      const withGeo = res.items.filter((g) => g.geo)
      withGeo.slice(0, 40).forEach((g, i) => {
        const m = L.marker([g.geo!.lat, g.geo!.lng], { icon: pin(String(i + 1), g.matchesAll ? "#047857" : "#6D28D9") })
          .addTo(map)
          .bindTooltip(`${i + 1}. ${g.name}${g.distanceKm !== null ? ` · ${g.distanceKm} กม.` : ""}`, { direction: "top" })
        m.on("click", () => {
          setActive(g.name)
          document.getElementById(`g-${encodeURIComponent(g.name)}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
        })
        markersRef.current.push(m)
      })

      if (res.origin) {
        originMarkerRef.current = L.marker([res.origin.lat, res.origin.lng], { icon: pin("🚚", "#B91C1C") })
          .addTo(map).bindTooltip("จุดที่รถเสีย", { direction: "top" })
        // โฟกัสแค่ 3 อันดับแรก — ถ้ารวม 5 อันดับ อันที่ไกล 13 กม. จะลากให้ซูมออกจนอู่ที่ใกล้สุดจมหาย
        const near = withGeo.slice(0, 3).map((g) => [g.geo!.lat, g.geo!.lng] as [number, number])
        map.fitBounds(L.latLngBounds([[res.origin.lat, res.origin.lng], ...near]).pad(0.3), { maxZoom: 14 })
      }
    })()
  }, [res])

  /** วาดเส้นทางขับจริงจากจุดที่รถเสียไปอู่ที่กด — กดซ้ำที่เจ้าเดิมคือเอาเส้นออก */
  const showRoute = useCallback(async (g: GarageHit) => {
    const map = mapRef.current
    if (!map || !g.geo || !res?.origin) return
    if (route?.vendor === g.name) {
      routeRef.current?.remove(); routeRef.current = null; setRoute(null)
      return
    }
    setRouting(g.name)
    try {
      const qs = new URLSearchParams({
        fromLat: String(res.origin.lat), fromLng: String(res.origin.lng),
        toLat: String(g.geo.lat), toLng: String(g.geo.lng),
      })
      const r = await fetch(`/api/vendors/map/route-line?${qs}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? "หาเส้นทางไม่ได้")
      const L = (await import("leaflet")).default
      routeRef.current?.remove()
      routeRef.current = L.polyline(j.line as [number, number][], { color: "#6D28D9", weight: 5, opacity: .8 }).addTo(map)
      map.fitBounds(routeRef.current.getBounds().pad(0.15))
      setRoute({ vendor: g.name, km: j.km, min: j.min })
    } catch (e) {
      void swalError(e instanceof Error ? e.message : String(e))
    } finally {
      setRouting("")
    }
  }, [res, route])

  const onSubmit = (e: React.FormEvent) => { e.preventDefault(); void search(at, codes) }

  /** เลือก จังหวัด→อำเภอ→ตำบล แล้วค้นจากจุดกึ่งกลางของพื้นที่นั้น */
  const pickArea = async (province: string, district: string, subdistrict: string) => {
    const q = [subdistrict && `ตำบล${subdistrict}`, district && `อำเภอ${district}`, province].filter(Boolean).join(", ")
    setLoading(true)
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=th&accept-language=th&q=${encodeURIComponent(q)}`)
      const j = await r.json()
      if (!j[0]) { setErr(`หาพื้นที่ "${q}" ไม่เจอ ลองวางพิกัดแทน`); setLoading(false); return }
      const v = `${(+j[0].lat).toFixed(5)}, ${(+j[0].lon).toFixed(5)}`
      setAt(v); await search(v, codes)
    } catch {
      setErr("ค้นหาพื้นที่ไม่สำเร็จ")
      setLoading(false)
    }
  }

  const saveLocation = async (vendor: string) => {
    const input = window.prompt(`วางลิงก์ Google Maps หรือพิกัดของ "${vendor}"\n(เช่น 13.72451, 100.78032)`)
    if (!input) return
    const r = await fetch("/api/vendors/map/location", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ vendor, at: input }),
    })
    const j = await r.json()
    if (!r.ok) { void swalError(j.error ?? "บันทึกไม่สำเร็จ"); return }
    void swalToast("success", `บันทึกพิกัด ${vendor} แล้ว`)
    void search(at, codes)
  }

  const copy = (text: string, key: string) => {
    void navigator.clipboard.writeText(text)
    setCopied(key); setTimeout(() => setCopied(""), 1500)
  }

  const items = res?.items ?? []
  const shown = items.filter((g) => g.geo)
  const noGeo = items.filter((g) => !g.geo)

  return (
    <div style={{ ...mitr, display: "flex", height: "calc(100vh - 56px)", background: "#FAFAFA" }}>
      {/* ── ซ้าย: ค้นหา + ตัวกรอง + รายการ */}
      <div style={{ width: 492, minWidth: 492, borderRight: "1px solid #E4E4E7", display: "flex", flexDirection: "column", background: "#fff" }}>
        <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid #F1F1F3" }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#18181B" }}>หาอู่ใกล้ที่สุด</div>
          <div style={{ fontSize: 12, color: "#71717A", marginTop: 2 }}>
            รถเสียตรงไหน วางพิกัดหรือเลือกพื้นที่ แล้วดูว่าอู่ไหนอยู่ใกล้และรับงานนั้นได้
          </div>

          <form onSubmit={onSubmit} style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <Search size={15} style={{ position: "absolute", left: 9, top: 9, color: "#A1A1AA" }} />
              <input
                value={at} onChange={(e) => setAt(e.target.value)}
                placeholder="วางพิกัด / ลิงก์ Google Maps"
                style={{ width: "100%", padding: "7px 9px 7px 29px", border: "1px solid #D4D4D8", borderRadius: 8, fontSize: 13, outline: "none" }}
              />
            </div>
            <button type="submit" disabled={loading}
              style={{ background: "#6D28D9", color: "#fff", border: 0, borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Crosshair size={14} />} ค้นหา
            </button>
          </form>

          {/* เลือกพื้นที่แทน — สำหรับเคสที่รู้แค่ชื่ออำเภอ */}
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <select value={prov} onChange={(e) => { setProv(e.target.value); setDist("") }}
              style={{ flex: 1, padding: "6px 8px", border: "1px solid #E4E4E7", borderRadius: 8, fontSize: 12, background: "#fff" }}>
              <option value="">— จังหวัด —</option>
              {listProvinces(addr).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={dist} disabled={!prov}
              onChange={(e) => { setDist(e.target.value); if (e.target.value) void pickArea(prov, e.target.value, "") }}
              style={{ flex: 1, padding: "6px 8px", border: "1px solid #E4E4E7", borderRadius: 8, fontSize: 12, background: prov ? "#fff" : "#FAFAFA" }}>
              <option value="">— อำเภอ/เขต —</option>
              {listDistricts(addr, prov).map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select disabled={!dist} onChange={(e) => e.target.value && void pickArea(prov, dist, e.target.value)}
              style={{ flex: 1, padding: "6px 8px", border: "1px solid #E4E4E7", borderRadius: 8, fontSize: 12, background: dist ? "#fff" : "#FAFAFA" }}>
              <option value="">— ตำบล/แขวง —</option>
              {listSubdistricts(addr, prov, dist).map((t) => <option key={t.n} value={t.n}>{t.n}</option>)}
            </select>
          </div>

          {/* ตัวกรองประเภทงาน — เลือกได้หลายอย่าง เป็น dropdown เพราะมี 36 ประเภท
              ถ้าโชว์เป็นชิปทั้งหมดจะกินพื้นที่จนรายการอู่หาย (ผู้ใช้ขอ 19/10/2569) */}
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, color: "#71717A", marginBottom: 2, display: "flex", justifyContent: "space-between" }}>
              <span>ประเภทงานที่ต้องซ่อม (เลือกได้หลายอย่าง)</span>
              {works.length > 0 && (
                <button onClick={() => setWorks([])} style={{ border: 0, background: "none", color: "#6D28D9", fontSize: 11, cursor: "pointer" }}>ล้าง</button>
              )}
            </div>
            <div style={{ border: "1px solid #D4D4D8", borderRadius: 8, padding: "0 8px" }}>
              <MultiSelectCombobox
                options={WORK_OPTIONS} values={works} onChange={setWorks}
                placeholder="— ทุกประเภทงาน —"
                searchPlaceholder="พิมพ์ชื่อประเภทงาน เช่น โม่ / เบรก / แอร์"
                showCode={false} emptyText="ไม่พบประเภทงานที่ค้นหา"
              />
            </div>
          </div>
        </div>

        {/* สรุปผล */}
        <div style={{ padding: "7px 16px", fontSize: 11, color: "#71717A", background: "#FAFAFA", borderBottom: "1px solid #F1F1F3" }}>
          {err ? <span style={{ color: "#B91C1C" }}><TriangleAlert size={11} style={{ display: "inline", marginRight: 4 }} />{err}</span>
            : res ? <>{res.origin
                ? <>แสดง <b style={{ color: "#3F3F46" }}>{num(shown.length)}</b> อู่ที่รู้ที่ตั้ง เรียงตามเวลาขับถึง{noGeo.length > 0 && <> · อีก {num(noGeo.length)} อู่ยังไม่มีพิกัด อยู่ท้ายรายการ</>}</>
                : <>พบ {num(items.length)} อู่ · ยังไม่ได้ระบุจุดที่รถเสีย จึงเรียงตามอู่ที่ใช้บ่อย</>}</>
              : "กำลังโหลด…"}
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {shown.map((g, i) => (
            <GarageCard key={g.name} g={g} rank={i + 1} active={active === g.name} copied={copied}
              onCopy={copy} onHover={() => setActive(g.name)}
              canRoute={!!res?.origin} routing={routing === g.name}
              onHistory={() => setHistoryFor(g.name)}
              routeInfo={route?.vendor === g.name ? route : null}
              onRoute={() => void showRoute(g)}
              onFocusMap={() => { if (g.geo) mapRef.current?.setView([g.geo.lat, g.geo.lng], 14) }} />
          ))}

          {noGeo.length > 0 && (
            <div style={{ padding: "10px 16px 6px", fontSize: 11, color: "#A1A1AA", borderTop: "1px solid #F1F1F3", marginTop: 6 }}>
              ยังไม่มีพิกัด {num(noGeo.length)} อู่ — ขึ้นท้ายรายการไว้ ไม่ได้ตัดทิ้ง
            </div>
          )}
          {noGeo.map((g) => (
            <div key={g.name} style={{ padding: "9px 16px", borderBottom: "1px solid #F4F4F5", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <button onClick={() => setHistoryFor(g.name)} title="ดูประวัติการซ่อมของอู่นี้"
                  style={{ border: 0, background: "none", padding: 0, textAlign: "left", cursor: "pointer", fontSize: 12.5, color: "#3F3F46", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }}>
                  {g.name}
                </button>
                <div style={{ fontSize: 11, color: g.jobs > 0 ? "#047857" : "#A1A1AA" }}>
                  {g.jobs > 0 ? `เคยซ่อมให้ ${g.jobs} ใบ` : "ยังไม่เคยใช้"}
                </div>
                {g.phone && <div style={{ fontSize: 12, color: "#18181B", marginTop: 1 }}>{g.phone}</div>}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                {canEdit && (
                  <button onClick={() => void saveLocation(g.name)}
                    style={{ border: "1px solid #D4D4D8", background: "#fff", color: "#6D28D9", borderRadius: 7, padding: "5px 10px", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>
                    ใส่พิกัด
                  </button>
                )}
                {(g.phone.match(/0\d[\d-]{7,}/) ?? [""])[0].replace(/-/g, "") && (
                  <a href={`tel:${(g.phone.match(/0\d[\d-]{7,}/) ?? [""])[0].replace(/-/g, "")}`}
                    style={{ background: "#047857", color: "#fff", borderRadius: 7, padding: "5px 12px", fontSize: 11.5, fontWeight: 700, textDecoration: "none", display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                    <Phone size={12} /> โทร
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {historyFor && <GarageHistoryModal vendor={historyFor} onClose={() => setHistoryFor(null)} />}

      {/* ── ขวา: แผนที่ */}
      <div style={{ flex: 1, position: "relative" }}>
        <div ref={boxRef} style={{ position: "absolute", inset: 0 }} />
        <div style={{ position: "absolute", left: 12, bottom: 12, zIndex: 500, background: "rgba(255,255,255,.94)", borderRadius: 8, padding: "7px 11px", fontSize: 11, color: "#52525B", boxShadow: "0 1px 6px rgba(0,0,0,.16)", maxWidth: 340 }}>
          คลิกบนแผนที่เพื่อตั้งจุดที่รถเสีย · ระยะและเวลาเป็นการขับตามถนนจริง (ไม่รวมรถติดตอนนั้น) · กด "ดูเส้นทาง" ในใบรายการเพื่อวาดเส้น
        </div>
      </div>
    </div>
  )
}

function GarageCard({ g, rank, active, copied, onCopy, onHover, onFocusMap, onRoute, canRoute, routing, routeInfo, onHistory }: {
  g: GarageHit; rank: number; active: boolean; copied: string
  onCopy: (t: string, k: string) => void; onHover: () => void; onFocusMap: () => void
  onRoute: () => void; canRoute: boolean; routing: boolean; onHistory: () => void
  routeInfo: { km: number; min: number } | null
}) {
  const tel = (g.phone.match(/0\d[\d-]{7,}/) ?? [""])[0].replace(/-/g, "")
  return (
    <div id={`g-${encodeURIComponent(g.name)}`} onMouseEnter={onHover} onClick={onFocusMap}
      style={{
        padding: "10px 16px", borderBottom: "1px solid #F4F4F5", cursor: "pointer",
        background: active ? "#F5F3FF" : "#fff",
        borderLeft: `3px solid ${g.matchesAll ? "#047857" : active ? "#6D28D9" : "transparent"}`,
      }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
        <span style={{ fontSize: 11, color: "#A1A1AA", minWidth: 14 }}>{rank}.</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <button onClick={(e) => { e.stopPropagation(); onHistory() }} title="ดูประวัติการซ่อมของอู่นี้"
            style={{ border: 0, background: "none", padding: 0, textAlign: "left", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#18181B", lineHeight: 1.35 }}>
            {g.name}
          </button>
          <div style={{ fontSize: 11, color: "#71717A", marginTop: 2 }}>
            {g.address ? [g.address.subdistrict, g.address.district, g.address.province].filter(Boolean).join(" · ") : "—"}
          </div>
        </div>
        {g.distanceKm !== null && (
          <div style={{ textAlign: "right", whiteSpace: "nowrap" }}
            title={[
              g.roadKm !== null ? `ระยะขับจริงตามถนน ${g.roadKm} กม. · เวลาขับราว ${g.roadMin} นาที (ไม่รวมรถติดตอนนั้น)` : "",
              `เส้นตรง ${g.distanceKm} กม.`,
              g.geo ? PRECISION_NOTE[g.geo.precision] : "",
            ].filter(Boolean).join("\n")}>
            <div style={{ fontSize: 13, fontWeight: 700, color: g.geo?.precision === "หน้าอู่" ? "#047857" : "#6D28D9" }}>
              {g.roadKm !== null ? `${g.roadKm} กม.` : `${g.distanceKm} กม.`}
              {g.geo?.precision !== "หน้าอู่" && <span style={{ fontSize: 10, fontWeight: 400, color: "#A1A1AA" }}> ~</span>}
            </div>
            {g.roadMin !== null
              ? <div style={{ fontSize: 11, color: "#52525B" }}>ขับราว {g.roadMin} นาที</div>
              : <div style={{ fontSize: 10, color: "#A1A1AA" }}>เส้นตรง</div>}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 6 }}>
        {g.matchesAll && (
          <span style={{ background: "#ECFDF5", color: "#047857", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999 }}>
            ครบทุกงานที่เลือก
          </span>
        )}
        {g.works.slice(0, 4).map((w) => (
          <span key={w} style={{ background: "#F4F4F5", color: "#52525B", fontSize: 10, padding: "2px 7px", borderRadius: 999 }}>{w}</span>
        ))}
        {g.works.length > 4 && <span style={{ fontSize: 10, color: "#A1A1AA", padding: "2px 3px" }}>+{g.works.length - 4}</span>}
        {g.works.length === 0 && <span style={{ fontSize: 10, color: "#A1A1AA" }}>ยังไม่ได้ระบุประเภทงาน</span>}
      </div>

      {/* แถวปฏิบัติการ — ปลายทางของหน้านี้คือ "โทร" จึงโชว์เบอร์เต็มให้เห็นเลย
          ไม่ต้องกดคัดลอกหรือ hover ก่อน (ผู้ใช้ขอ 19/10/2569) และให้ปุ่มโทรเด่นปุ่มเดียว
          ที่เหลือเป็นไอคอนเงียบ ๆ — เดิม 4 ปุ่มน้ำหนักเท่ากันจนตัดคำขึ้นบรรทัดใหม่ */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 11 }}>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                       color: g.jobs > 0 ? "#047857" : "#A1A1AA", fontWeight: g.jobs > 0 ? 600 : 400 }}>
          {g.jobs > 0 ? `เคยซ่อมให้ ${g.jobs} ใบ${g.lastJob ? ` · ล่าสุด ${g.lastJob}` : ""}` : "ยังไม่เคยใช้"}
        </span>
        <IconBtn label="ดูประวัติการซ่อมของอู่นี้" onClick={(e) => { e.stopPropagation(); onHistory() }}>
          <History size={13} />
        </IconBtn>
        {canRoute && (
          <IconBtn label={routeInfo ? "ซ่อนเส้นทาง" : "ดูเส้นทางขับไปอู่นี้"} active={!!routeInfo} disabled={routing}
            onClick={(e) => { e.stopPropagation(); onRoute() }}>
            {routing ? <Loader2 size={13} className="animate-spin" /> : <Route size={13} />}
          </IconBtn>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
        {g.phone ? (
          <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "#18181B", lineHeight: 1.35 }}>
            <Phone size={11} style={{ display: "inline", marginRight: 4, color: "#71717A", verticalAlign: "-1px" }} />
            {g.phone}
          </span>
        ) : (
          <span style={{ flex: 1, fontSize: 11, color: "#A1A1AA", display: "flex", alignItems: "center", gap: 4 }}>
            <MapPin size={12} /> ไม่มีเบอร์ใน ATMS
          </span>
        )}
        {g.phone && (
          <IconBtn label={`คัดลอกเบอร์ ${g.phone}`} onClick={(e) => { e.stopPropagation(); onCopy(g.phone, g.name) }}>
            {copied === g.name ? <Check size={13} color="#047857" /> : <Copy size={13} />}
          </IconBtn>
        )}
        {tel && (
          <a href={`tel:${tel}`} onClick={(e) => e.stopPropagation()} title={`โทร ${tel}`}
            style={{ background: "#047857", color: "#fff", borderRadius: 7, padding: "6px 14px", fontSize: 12, fontWeight: 700, textDecoration: "none", display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", flexShrink: 0 }}>
            <Phone size={13} /> โทร
          </a>
        )}
      </div>
    </div>
  )
}

/** ปุ่มรองในใบรายการ — ขนาดเท่ากันทุกปุ่ม เป้ากด 28px และมี tooltip บอกว่าทำอะไร */
function IconBtn({ children, label, onClick, active, disabled }: {
  children: React.ReactNode; label: string; active?: boolean; disabled?: boolean
  onClick: (e: React.MouseEvent) => void
}) {
  return (
    <button onClick={onClick} title={label} aria-label={label} disabled={disabled}
      style={{
        width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
        border: `1px solid ${active ? "#6D28D9" : "#E4E4E7"}`, background: active ? "#F5F3FF" : "#fff",
        color: active ? "#6D28D9" : "#52525B", borderRadius: 7, cursor: disabled ? "default" : "pointer", flexShrink: 0,
      }}>
      {children}
    </button>
  )
}
