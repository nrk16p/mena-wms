"use client"

// หาอู่ใกล้ที่สุด — ซ้ายเป็นรายการเรียงใกล้→ไกล ขวาเป็นแผนที่ (ผู้ใช้เลือกแบบนี้ 19/10/2569)
//
// โจทย์จริง: รถเสียกลางทาง ยานยนต์แจ้งจุดจอด จัดซื้อต้องตอบใน 1 นาทีว่าโทรหาใครก่อน
// ปลายทางของหน้านี้จึงไม่ใช่ "เลือกอู่เสร็จ" แต่คือ "ได้ 2-3 เบอร์ที่ควรโทรไล่"
//
// ออกแบบใหม่ 19/10/2569 ตามที่ผู้ใช้สั่ง "ใช้ง่าย ดูง่าย แบบไม่ต้องคิดก็เข้าใจได้" (สเปก UI + BA):
//   - ช่องค้นหาช่องเดียว พิมพ์แพล้นท์/จังหวัด/อำเภอ หรือวางลิงก์ก็ได้ ไม่มีปุ่ม "ค้นหา"
//   - ประเภทงานเป็นชิปภาษาช่าง กดแล้วกรองทันที (ไม่ซ่อนใน dropdown อีกแล้ว)
//   - ใบอู่: ระยะ/เวลาตัวใหญ่สุด ปุ่มโทรเต็มแถวอยู่ที่เดิมทุกใบ ป้ายบอกความน่าเชื่อถือแค่ 3 แบบ
//   - โชว์อู่ทุกแหล่งที่มี (AVL + ชีตยานยนต์ + หมุด My Map) ผู้ใช้สั่ง "โชว์ให้มากที่สุดก่อน ค่อยคลีน"
// สีชุด menaIT V.2 (ฟ้า #1c6ef2 · มินต์ = เชื่อได้ · ส้ม = ต้องโทรถามก่อน)
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import {
  Check, ChevronDown, Copy, Crosshair, Factory, Fuel, History, Layers, Loader2, LocateFixed,
  MapPin, MoreHorizontal, Phone, Route, Search, ShieldCheck, TriangleAlert, Wrench, X,
} from "lucide-react"
import type { Map as LeafletMap, Marker as LeafletMarker, Polyline as LeafletPolyline, LayerGroup as LeafletLayerGroup } from "leaflet"
import { canApproveVendor } from "@/lib/roles"
import { swalError, swalToast } from "@/lib/swal"
import type { GarageHit } from "@/lib/garage-geo"
import { parseLatLng, isShortMapLink } from "@/lib/garage-geo"
import { GarageHistoryModal } from "@/components/garage-history-modal"
import layers from "@/data/map-layers.json"
import { loadThaiAddress, type ProvinceNode } from "@/lib/thai-address"

type ApiResult = {
  origin: { lat: number; lng: number } | null
  resolvedFrom: string
  total: number
  withGeo: number
  items: GarageHit[]
}

// ── สีและฟอนต์ชุด menaIT V.2
const C = {
  brand: "#1c6ef2", brandDark: "#1556c9", brandSoft: "#eaf4ff", brandLine: "#cfe3fb",
  ink: "#0f2748", ink2: "#33476b", muted: "#6b7f9e", line: "#e3effd", canvas: "#f0faff",
  mint: "#10b981", mintText: "#0b8a5e", mintSoft: "#e7f9f1",
  sun: "#ff8a3d", sunText: "#c2570c", sunSoft: "#fff4e8",
  red: "#e5484d", navy: "#0f2748", fuel: "#8aa0bd",
}
const BODY = "'Noto Sans Thai', 'Prompt', Tahoma, sans-serif"
const DISPLAY = "'Prompt', 'Noto Sans Thai', sans-serif"

/** ชิปประเภทงาน — ใช้ภาษาที่ช่างพูด แต่ละชิปชี้ไปรหัสอู่นอกใน AVL (ชีตยานยนต์แปลงมาเป็นรหัสชุดเดียวกันแล้ว)
 *  "ออกนอกสถานที่" ไม่มีรหัส ใช้ธง onsite ของชีตยานยนต์กรองฝั่งหน้าจอแทน */
const WORK_CHIPS: { label: string; codes: string[] }[] = [
  { label: "ระบบโม่", codes: ["S45"] },
  { label: "ช่วงล่าง / เบรก", codes: ["S35", "S37"] },
  { label: "เครื่องยนต์", codes: ["S33"] },
  { label: "เกียร์", codes: ["S49"] },
  { label: "ตัวถัง / บอดี้", codes: ["S57", "S43"] },
  { label: "แอร์ / ไฟ", codes: ["S39"] },
  { label: "หัวฉีด / ปั๊ม", codes: ["S61"] },
  { label: "ท่อไอเสีย / หม้อน้ำ", codes: ["S47"] },
  { label: "ระบบลม", codes: ["S59", "S51"] },
]
const ONSITE = "ออกนอกสถานที่"

/** แพล้นท์ของเรา 286 จุด + ปั๊มน้ำมัน 884 จุด (Shell/Caltex/PTT จาก My Maps ยานยนต์ 19/10/2569) */
const PLANTS = (layers as { plants: { n: string; lat: number; lng: number }[] }).plants
const FUEL = (layers as unknown as { fuel: { n: string; b: string; lat: number; lng: number }[] }).fuel

type Place =
  | { kind: "plant"; label: string; lat: number; lng: number }
  | { kind: "area"; label: string; province: string; district: string }
  | { kind: "point"; label: string; raw: string }

const telOf = (phone: string) => (phone.match(/0\d[\d-]{7,}/) ?? [""])[0].replace(/-/g, "")
const fmtKm = (n: number) => (n < 10 ? n.toFixed(1) : Math.round(n).toString())

export function GarageMapPage() {
  const { data: session } = useSession()
  const canEdit = canApproveVendor(session?.user?.email)

  const [place, setPlace] = useState<Place | null>(null)
  const [at, setAt] = useState("")
  const [chips, setChips] = useState<string[]>([])
  const [onlyPhone, setOnlyPhone] = useState(false)
  const [onlyAvl, setOnlyAvl] = useState(false)
  const [res, setRes] = useState<ApiResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState("")
  const [active, setActive] = useState<string | null>(null)
  const [historyFor, setHistoryFor] = useState<string | null>(null)
  const [showPlants, setShowPlants] = useState(false)
  const [showFuel, setShowFuel] = useState(false)
  const [legendOpen, setLegendOpen] = useState(true)
  const [noGeoOpen, setNoGeoOpen] = useState(false)
  const [addr, setAddr] = useState<ProvinceNode[]>([])

  const mapRef = useRef<LeafletMap | null>(null)
  const layerRef = useRef<{ plants: LeafletLayerGroup | null; fuel: LeafletLayerGroup | null }>({ plants: null, fuel: null })
  const markersRef = useRef<Map<string, LeafletMarker>>(new Map())
  const originMarkerRef = useRef<LeafletMarker | null>(null)
  const routeRef = useRef<LeafletPolyline | null>(null)
  const [route, setRoute] = useState<{ vendor: string; km: number; min: number } | null>(null)
  const [routing, setRouting] = useState("")
  const boxRef = useRef<HTMLDivElement>(null)
  const shownRef = useRef<GarageHit[]>([])

  const codes = useMemo(
    () => [...new Set(WORK_CHIPS.filter((c) => chips.includes(c.label)).flatMap((c) => c.codes))],
    [chips],
  )

  const search = useCallback(async (input: string, codeList: string[]) => {
    setLoading(true); setErr("")
    try {
      const qs = new URLSearchParams()
      if (input) qs.set("at", input)
      if (codeList.length) qs.set("codes", codeList.join(","))
      const r = await fetch(`/api/vendors/map?${qs}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? "โหลดรายชื่ออู่ไม่ได้ ลองใหม่อีกครั้ง")
      if (input && !j.origin) throw new Error("อ่านลิงก์นี้ไม่ออก ลองวางพิกัด หรือแตะจุดบนแผนที่เอง")
      setRes(j)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadThaiAddress().then(setAddr) }, [])
  // เปลี่ยนชิปงานแล้วค้นใหม่ทันที ไม่ต้องกดปุ่ม
  useEffect(() => { void search(at, codes) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [codes])

  /** ตั้งจุดรถเสียจากสิ่งที่ผู้ใช้เลือกในช่องค้นหา */
  const choosePlace = useCallback(async (p: Place) => {
    setPlace(p)
    if (p.kind === "plant") {
      const v = `${p.lat}, ${p.lng}`
      setAt(v); await search(v, codes); return
    }
    if (p.kind === "point") {
      setAt(p.raw); await search(p.raw, codes); return
    }
    // จังหวัด/อำเภอ: หาจุดกึ่งกลางพื้นที่ แล้ววัดระยะจากตรงนั้น
    setLoading(true)
    try {
      const q = [p.district && `อำเภอ${p.district}`, p.province].filter(Boolean).join(", ")
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=th&accept-language=th&q=${encodeURIComponent(q)}`)
      const j = await r.json()
      if (!j[0]) { setErr(`หาพื้นที่ "${q}" ไม่เจอ ลองเลือกแพล้นท์ใกล้ ๆ แทน`); setLoading(false); return }
      const v = `${(+j[0].lat).toFixed(5)}, ${(+j[0].lon).toFixed(5)}`
      setAt(v); await search(v, codes)
    } catch {
      setErr("ค้นหาพื้นที่ไม่สำเร็จ ลองใหม่อีกครั้ง"); setLoading(false)
    }
  }, [codes, search])

  // ตัวจัดการคลิกแผนที่ผูกไว้ครั้งเดียว จึงอ่านฟังก์ชันล่าสุดผ่าน ref
  const choosePlaceRef = useRef(choosePlace)
  choosePlaceRef.current = choosePlace

  // เปิดจากหน้าสรุปรายจังหวัด (?area=จังหวัด) → ตั้งพื้นที่ให้เลย ไม่ต้องพิมพ์ซ้ำ
  useEffect(() => {
    const area = new URLSearchParams(window.location.search).get("area")
    if (area) void choosePlaceRef.current({ kind: "area", label: `จ.${area}`, province: area, district: "" })
    else void search("", [])
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [])

  const clearPlace = () => { setPlace(null); setAt(""); void search("", codes) }

  const useMyLocation = () => {
    if (!navigator.geolocation) { void swalError("เบราว์เซอร์นี้หาตำแหน่งไม่ได้"); return }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const v = `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`
        void choosePlace({ kind: "point", label: "ตำแหน่งของฉัน", raw: v })
      },
      () => void swalError("หาตำแหน่งไม่ได้ ลองเปิดสิทธิ์ตำแหน่งในเบราว์เซอร์ หรือเลือกแพล้นท์แทน"),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  // ── แผนที่ (Leaflet + OpenStreetMap — ไม่ต้องใช้ API key)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const L = (await import("leaflet")).default
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !boxRef.current || mapRef.current) return
      // preferCanvas: ปั๊มน้ำมัน 884 จุดวาดบน canvas เดียว ไม่ใช่ 884 element
      const map = L.map(boxRef.current, { zoomControl: false, preferCanvas: true }).setView([13.7563, 100.5018], 10)
      L.control.zoom({ position: "topright" }).addTo(map)
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map)
      // แตะบนแผนที่ = ตั้งจุดรถเสียตรงนั้น (เร็วสุดเมื่อรู้แค่ว่า "แถว ๆ นี้")
      map.on("click", (e: { latlng: { lat: number; lng: number } }) => {
        const v = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`
        void choosePlaceRef.current({ kind: "point", label: "จุดที่แตะบนแผนที่", raw: v })
      })
      mapRef.current = map
    })()
    return () => { cancelled = true }
  }, [])

  // ── กรองฝั่งหน้าจอ: พื้นที่ · มีเบอร์ · อู่ประจำ · ออกนอกสถานที่
  // พื้นที่ไม่มีอู่เลย (เช่น ตาก) ห้ามปล่อยว่าง — ถอยไปโชว์อู่ที่ใกล้กลางพื้นที่ที่สุดแทน
  const { items, areaEmpty } = useMemo(() => {
    let all = res?.items ?? []
    if (onlyPhone) all = all.filter((g) => telOf(g.phone))
    if (onlyAvl) all = all.filter((g) => g.source === "avl")
    if (chips.includes(ONSITE)) all = all.filter((g) => g.onsite)
    if (place?.kind !== "area") return { items: all, areaEmpty: false }
    const inArea = all.filter((g) => g.address?.province === place.province && (!place.district || g.address?.district === place.district))
    return inArea.length ? { items: inArea, areaEmpty: false } : { items: all, areaEmpty: true }
  }, [res, place, onlyPhone, onlyAvl, chips])
  const shown = items.filter((g) => g.geo)
  const noGeo = items.filter((g) => !g.geo)
  shownRef.current = shown

  // ── วาดหมุดอู่ทุกครั้งที่รายการเปลี่ยน
  useEffect(() => {
    const map = mapRef.current
    if (!map || !res) return
    void (async () => {
      const L = (await import("leaflet")).default
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = new Map()
      originMarkerRef.current?.remove()
      routeRef.current?.remove(); routeRef.current = null; setRoute(null)

      shownRef.current.slice(0, 60).forEach((g, i) => {
        const m = L.marker([g.geo!.lat, g.geo!.lng], { icon: garageIcon(L, g, i + 1, false), zIndexOffset: 1000 - i })
          .addTo(map)
          .bindTooltip(`${i + 1}. ${g.name}`, { direction: "top", offset: [0, -14] })
        m.on("click", () => {
          setActive(g.name)
          document.getElementById(`g-${encodeURIComponent(g.name)}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
        })
        markersRef.current.set(g.name, m)
      })

      if (res.origin) {
        originMarkerRef.current = L.marker([res.origin.lat, res.origin.lng], {
          zIndexOffset: 2000,
          icon: L.divIcon({
            className: "",
            html: `<div style="position:relative;width:38px;height:38px"><div style="position:absolute;inset:-8px;border-radius:999px;background:rgba(229,72,77,.18)"></div><div style="position:absolute;inset:0;border-radius:999px;background:${C.red};color:#fff;font:600 12px/38px ${DISPLAY};text-align:center;border:3px solid #fff;box-shadow:0 4px 12px rgba(0,0,0,.3)">รถ</div></div>`,
            iconSize: [38, 38], iconAnchor: [19, 19],
          }),
        }).addTo(map).bindTooltip("จุดที่รถเสีย", { direction: "top", offset: [0, -18] })
        // โฟกัส 3 อันดับแรก — รวมมากกว่านี้แผนที่จะซูมออกจนอู่ที่ใกล้สุดจมหาย
        const near = shownRef.current.slice(0, 3).map((g) => [g.geo!.lat, g.geo!.lng] as [number, number])
        map.fitBounds(L.latLngBounds([[res.origin.lat, res.origin.lng], ...near]).pad(0.3), { maxZoom: 14 })
      }
    })()
  }, [res, items])

  // อู่ที่เลือกอยู่: ขยายหมุดให้เด่น
  useEffect(() => {
    void (async () => {
      const L = (await import("leaflet")).default
      shownRef.current.slice(0, 60).forEach((g, i) => {
        markersRef.current.get(g.name)?.setIcon(garageIcon(L, g, i + 1, g.name === active))
      })
    })()
  }, [active])

  /** วาดเส้นทางขับจริงจากจุดรถเสียไปอู่ที่กด — กดเจ้าเดิมซ้ำคือเอาเส้นออก */
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
      if (!r.ok) throw new Error("วาดเส้นทางไม่ได้ตอนนี้ ดูระยะในใบรายการแทนได้")
      const L = (await import("leaflet")).default
      routeRef.current?.remove()
      routeRef.current = L.polyline(j.line as [number, number][], { color: C.brand, weight: 5, opacity: .85 }).addTo(map)
      map.fitBounds(routeRef.current.getBounds().pad(0.15))
      setRoute({ vendor: g.name, km: j.km, min: j.min })
    } catch (e) {
      void swalError(e instanceof Error ? e.message : String(e))
    } finally {
      setRouting("")
    }
  }, [res, route])

  // ── เลเยอร์อ้างอิง: แพล้นท์ (สี่เหลี่ยมกรมท่า) · ปั๊มน้ำมัน (จุดเทาเล็ก)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    void (async () => {
      const L = (await import("leaflet")).default
      layerRef.current.plants?.remove(); layerRef.current.plants = null
      if (showPlants) {
        const icon = L.divIcon({ className: "", html: `<div style="width:12px;height:12px;border-radius:3px;background:${C.navy};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35)"></div>`, iconSize: [12, 12], iconAnchor: [6, 6] })
        layerRef.current.plants = L.layerGroup(PLANTS.map((p) =>
          L.marker([p.lat, p.lng], { icon }).bindTooltip(`แพล้นท์ ${p.n}`, { direction: "top" }))).addTo(map)
      }
      layerRef.current.fuel?.remove(); layerRef.current.fuel = null
      if (showFuel) {
        layerRef.current.fuel = L.layerGroup(FUEL.map((f) =>
          L.circleMarker([f.lat, f.lng], { radius: 3.5, color: "#fff", weight: 1, fillColor: C.fuel, fillOpacity: .95 })
            .bindTooltip(`${f.b} · ${f.n}`, { direction: "top" }))).addTo(map)
      }
    })()
  }, [showPlants, showFuel])

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

  const toggleChip = (label: string) =>
    setChips((cur) => (cur.includes(label) ? cur.filter((c) => c !== label) : [...cur, label]))
  const filtersOn = chips.length > 0 || onlyPhone || onlyAvl
  const clearFilters = () => { setChips([]); setOnlyPhone(false); setOnlyAvl(false) }

  return (
    <div style={{ fontFamily: BODY, display: "flex", height: "calc(100vh - 56px)", background: C.canvas, color: C.ink }}>
      {/* ── ซ้าย */}
      <div style={{ width: 460, minWidth: 460, display: "flex", flexDirection: "column", background: "#fff", borderRight: `1px solid ${C.line}`, boxShadow: "4px 0 24px -16px rgba(21,86,201,.35)", zIndex: 2 }}>
        {/* ส่วนที่ 1: รถเสียที่ไหน */}
        <div style={{ padding: "16px 18px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h1 style={{ fontFamily: DISPLAY, fontSize: 19, fontWeight: 600, margin: 0 }}>รถเสียที่ไหน?</h1>
            <button onClick={useMyLocation}
              style={{ display: "flex", alignItems: "center", gap: 5, border: `1px solid ${C.brandLine}`, background: C.brandSoft, color: C.brandDark, borderRadius: 999, padding: "5px 11px", fontSize: 12, fontWeight: 500, cursor: "pointer" }}>
              <LocateFixed size={13} /> ตำแหน่งของฉัน
            </button>
          </div>
          <SmartSearch addr={addr} place={place} onPick={(p) => void choosePlace(p)} onClear={clearPlace} />
        </div>

        {/* ส่วนที่ 2: ต้องซ่อมอะไร */}
        <div style={{ padding: "4px 18px 12px", borderBottom: `1px solid ${C.line}` }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 14, fontWeight: 600, marginBottom: 7 }}>ต้องซ่อมอะไร?</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <Chip on={chips.length === 0} onClick={() => setChips([])}>ทั้งหมด</Chip>
            {[...WORK_CHIPS.map((c) => c.label), ONSITE].map((label) => (
              <Chip key={label} on={chips.includes(label)} onClick={() => toggleChip(label)}>{label}</Chip>
            ))}
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 12.5, color: C.ink2 }}>
            <Toggle on={onlyPhone} onClick={() => setOnlyPhone((v) => !v)}>เฉพาะที่มีเบอร์</Toggle>
            <Toggle on={onlyAvl} onClick={() => setOnlyAvl((v) => !v)}>เฉพาะอู่ประจำ</Toggle>
          </div>
        </div>

        {/* แถบสรุป */}
        {areaEmpty && place?.kind === "area" && (
          <div style={{ margin: "10px 14px 0", padding: "9px 12px", borderRadius: 12, background: C.sunSoft, border: `1px dashed ${C.sun}`, color: C.sunText, fontSize: 12.5, lineHeight: 1.5 }}>
            <b>{place.label} ยังไม่มีอู่ในระบบ</b> · แสดงอู่ที่ใกล้ที่สุดจากพื้นที่ข้างเคียงแทน ระยะวัดจากกลางพื้นที่
          </div>
        )}
        <div style={{ padding: "9px 18px", fontSize: 12.5, color: C.muted, display: "flex", alignItems: "center", gap: 8 }}>
          {err ? (
            <span style={{ color: C.red, display: "flex", alignItems: "center", gap: 5 }}>
              <TriangleAlert size={13} /> {err}
              <button onClick={() => void search(at, codes)} style={{ border: 0, background: "none", color: C.brand, cursor: "pointer", fontSize: 12.5, textDecoration: "underline" }}>ลองใหม่</button>
            </span>
          ) : loading ? (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Loader2 size={13} className="animate-spin" /> กำลังหาอู่ใกล้ ๆ…</span>
          ) : res ? (
            <span>
              {place ? <>ใกล้ <b style={{ color: C.ink }}>{place.label}</b> · </> : <>ยังไม่ได้เลือกจุด เรียงตามอู่ที่ใช้บ่อย · </>}
              เจอ <b style={{ color: C.ink }}>{shown.length.toLocaleString()}</b> อู่
            </span>
          ) : null}
          <span style={{ flex: 1 }} />
          {filtersOn && (
            <button onClick={clearFilters} style={{ border: 0, background: "none", color: C.brand, cursor: "pointer", fontSize: 12.5 }}>ล้างตัวกรอง</button>
          )}
        </div>

        {/* รายการอู่ */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 16px" }}>
          {!loading && res && shown.length === 0 && (
            <div style={{ textAlign: "center", padding: "36px 18px", color: C.muted, fontSize: 13, lineHeight: 1.6 }}>
              {filtersOn ? <>ไม่มีอู่ที่ตรงกับตัวกรองนี้<br /><button onClick={clearFilters} style={{ marginTop: 10, border: 0, borderRadius: 999, background: C.brand, color: "#fff", padding: "7px 18px", cursor: "pointer", fontFamily: DISPLAY }}>ล้างตัวกรอง</button></>
                : "ยังไม่มีอู่ที่รู้ตำแหน่ง"}
            </div>
          )}
          {!place && res && shown.length > 0 && (
            <div style={{ margin: "2px 4px 10px", padding: "10px 12px", borderRadius: 12, background: C.brandSoft, color: C.brandDark, fontSize: 12.5, lineHeight: 1.5 }}>
              เลือกแพล้นท์ พิมพ์จังหวัด หรือแตะบนแผนที่ แล้วอู่จะเรียงจากใกล้ไปไกลให้เอง
            </div>
          )}
          {shown.map((g, i) => (<div key={g.name}>
            {g.workUnknown && !shown[i - 1]?.workUnknown && (
              <div style={{ margin: "14px 4px 8px", fontSize: 12.5, color: C.sunText, lineHeight: 1.5 }}>
                <b>อาจรับงานนี้ได้ · ยังไม่มีข้อมูลประเภทงาน</b><br />
                <span style={{ color: C.muted }}>อู่กลุ่มนี้ไม่ได้บอกว่าทำงานอะไรบ้าง โทรถามก่อนส่งรถ</span>
              </div>
            )}
            <GarageCard g={g} rank={i + 1} active={active === g.name} chips={chips}
              hasOrigin={!!res?.origin} routing={routing === g.name}
              routeOn={route?.vendor === g.name}
              onSelect={() => {
                setActive(g.name)
                if (g.geo) mapRef.current?.setView([g.geo.lat, g.geo.lng], Math.max(mapRef.current.getZoom(), 13))
              }}
              onRoute={() => void showRoute(g)}
              onHistory={() => setHistoryFor(g.name)} />
          </div>))}

          {noGeo.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <button onClick={() => setNoGeoOpen((v) => !v)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, border: 0, background: "none", padding: "8px 6px", cursor: "pointer", color: C.muted, fontSize: 12.5 }}>
                <ChevronDown size={14} style={{ transform: noGeoOpen ? "none" : "rotate(-90deg)", transition: "transform .15s" }} />
                อู่ที่ยังไม่มีตำแหน่ง ({noGeo.length.toLocaleString()})
              </button>
              {noGeoOpen && noGeo.map((g) => (
                <div key={g.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", borderBottom: `1px solid ${C.line}` }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</div>
                    <div style={{ fontSize: 11.5, color: C.muted }}>{g.phone || "ยังไม่มีเบอร์"}</div>
                  </div>
                  {canEdit && g.source === "avl" && (
                    <button onClick={() => void saveLocation(g.name)}
                      style={{ border: `1px solid ${C.brandLine}`, background: "#fff", color: C.brand, borderRadius: 999, padding: "4px 11px", fontSize: 11.5, cursor: "pointer" }}>
                      ใส่พิกัด
                    </button>
                  )}
                  {telOf(g.phone) && (
                    <a href={`tel:${telOf(g.phone)}`} style={{ background: C.brand, color: "#fff", borderRadius: 999, padding: "5px 12px", fontSize: 12, textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}>
                      <Phone size={12} /> โทร
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {historyFor && <GarageHistoryModal vendor={historyFor} onClose={() => setHistoryFor(null)} />}

      {/* ── ขวา: แผนที่ */}
      <div style={{ flex: 1, position: "relative" }}>
        <div ref={boxRef} style={{ position: "absolute", inset: 0 }} />
        <Legend open={legendOpen} onToggle={() => setLegendOpen((v) => !v)}
          showPlants={showPlants} onPlants={() => setShowPlants((v) => !v)}
          showFuel={showFuel} onFuel={() => setShowFuel((v) => !v)} />
        {route && (
          <div style={{ position: "absolute", top: 12, left: 12, zIndex: 500, background: "#fff", borderRadius: 14, padding: "8px 14px", boxShadow: "0 8px 24px -10px rgba(21,86,201,.45)", fontSize: 13 }}>
            เส้นทางไป <b>{route.vendor}</b> · <b style={{ fontFamily: DISPLAY, color: C.brand }}>{fmtKm(route.km)} กม. · ~{route.min} นาที</b>
          </div>
        )}
      </div>
    </div>
  )
}

/** หมุดอู่บนแผนที่ — สีตามความน่าเชื่อถือ ตรงกับป้ายในใบรายการ
 *  มินต์ = อู่ประจำ · ฟ้า = ยานยนต์แนะนำ · ส้มขอบประ = ยังไม่ผ่านอนุมัติ / ที่ตั้งโดยประมาณ */
function garageIcon(L: typeof import("leaflet"), g: GarageHit, rank: number, on: boolean) {
  const approx = g.geo?.precision !== "หน้าอู่"
  const t = trustOf(g)
  const size = on ? 34 : 26
  const style = t === "pin" || approx
    ? `background:#fff;color:${C.sunText};border:2px dashed ${C.sun}`
    : `background:${t === "avl" ? C.mint : C.brand};color:#fff;border:2px solid #fff`
  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;border-radius:${t === "pin" ? 8 : 999}px;${style};font:600 ${on ? 13 : 11}px/${size - 4}px 'Prompt',sans-serif;text-align:center;box-shadow:0 3px 10px rgba(15,39,72,.3)${on ? `,0 0 0 4px rgba(28,110,242,.35)` : ""}">${rank}</div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2],
  })
}

type Trust = "avl" | "fleet" | "pin"
const trustOf = (g: GarageHit): Trust => g.source

/** ป้ายความน่าเชื่อถือ — 3 แบบเท่านั้น มีไอคอน+คำ ไม่พึ่งสีอย่างเดียว */
function TrustBadge({ g }: { g: GarageHit }) {
  const t = trustOf(g)
  const base: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap" }
  if (t === "avl") return (
    <span style={{ ...base, background: C.mint, color: "#fff" }}>
      <ShieldCheck size={11} /> อู่ประจำ{g.jobs > 0 ? ` · เคยซ่อม ${g.jobs} ใบ` : ""}
    </span>
  )
  if (t === "fleet") return (
    <span style={{ ...base, background: "#fff", color: C.brand, border: `1.5px solid ${C.brand}` }}>
      <Wrench size={11} /> ยานยนต์แนะนำ
    </span>
  )
  return (
    <span style={{ ...base, background: C.sunSoft, color: C.sunText, border: `1.5px dashed ${C.sun}` }}>
      ! ยังไม่ผ่านอนุมัติ · โทรถามก่อนส่งรถ
    </span>
  )
}

function GarageCard({ g, rank, active, chips, hasOrigin, routing, routeOn, onSelect, onRoute, onHistory }: {
  g: GarageHit; rank: number; active: boolean; chips: string[]
  hasOrigin: boolean; routing: boolean; routeOn: boolean
  onSelect: () => void; onRoute: () => void; onHistory: () => void
}) {
  const [menu, setMenu] = useState(false)
  const [copied, setCopied] = useState(false)
  const tel = telOf(g.phone)
  const approx = !!g.geo && g.geo.precision !== "หน้าอู่"
  const km = g.roadKm ?? g.distanceKm
  const area = g.address ? [g.address.district, g.address.province].filter(Boolean).join(" · ") : g.zone

  // ชิปงาน: ใช้คำจากชีตยานยนต์ถ้ามี (ภาษาช่าง) ไม่งั้นใช้ชื่องานจาก AVL · ตัวที่ตรงกับที่เลือกขึ้นก่อน
  const workList = g.fleetWorks.length ? g.fleetWorks.filter((w) => w !== "นอกสถานที่") : g.works
  const wanted = chips.map((c) => c.split(" / ")[0])
  const isHit = (w: string) => wanted.some((k) => w.includes(k) || k.includes(w.split("/")[0]))
  const sorted = [...workList].sort((a, b) => Number(isHit(b)) - Number(isHit(a)))

  return (
    <div id={`g-${encodeURIComponent(g.name)}`} onClick={onSelect}
      style={{
        position: "relative", display: "flex", gap: 12, padding: 12, marginBottom: 8, borderRadius: 16, cursor: "pointer",
        background: "#fff", border: `1.5px solid ${active ? C.brand : C.line}`,
        boxShadow: active ? "0 10px 24px -12px rgba(28,110,242,.55)" : "0 4px 14px -10px rgba(21,86,201,.3)",
        transition: "border-color .12s, box-shadow .12s",
      }}>
      {/* ระยะ/เวลา — คำตอบหลักของหน้า จึงใหญ่สุด */}
      <div style={{
        width: 70, flexShrink: 0, borderRadius: 12, padding: "8px 4px", textAlign: "center",
        background: approx ? "#fff" : C.brandSoft, border: approx ? `1.5px dashed ${C.sun}` : "1.5px solid transparent",
      }} title={approx ? "ที่ตั้งโดยประมาณ (ระดับตำบล) ระยะคลาดได้ 1-3 กม." : "ระยะขับตามถนน ไม่รวมรถติดตอนนั้น"}>
        <div style={{ fontSize: 10.5, color: C.muted }}>#{rank}</div>
        {km !== null ? (
          <>
            <div style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 600, lineHeight: 1.1, color: C.ink }}>{fmtKm(km)}</div>
            <div style={{ fontSize: 11, color: C.ink2 }}>{approx ? "กม. ประมาณ" : "กม."}</div>
            {g.roadMin !== null && <div style={{ fontSize: 11.5, fontWeight: 600, color: C.brand, marginTop: 2 }}>~{g.roadMin} นาที</div>}
          </>
        ) : (
          <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>เลือกจุด<br />เพื่อดูระยะ</div>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
          <div style={{ flex: 1, minWidth: 0, fontFamily: DISPLAY, fontSize: 14.5, fontWeight: 600, lineHeight: 1.3 }}>{g.name}</div>
          <button aria-label="ตัวเลือกเพิ่มเติม" onClick={(e) => { e.stopPropagation(); setMenu((v) => !v) }}
            style={{ border: 0, background: menu ? C.brandSoft : "none", borderRadius: 8, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: C.muted, flexShrink: 0 }}>
            <MoreHorizontal size={16} />
          </button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          <TrustBadge g={g} />
          {area && <span style={{ fontSize: 11.5, color: C.muted }}>{area}</span>}
        </div>
        {(sorted.length > 0 || g.onsite) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {g.onsite && <WorkChip hit={chips.includes(ONSITE)}>ออกนอกสถานที่ได้</WorkChip>}
            {sorted.slice(0, 3).map((w) => <WorkChip key={w} hit={isHit(w)}>{w}</WorkChip>)}
            {sorted.length > 3 && <span style={{ fontSize: 11, color: C.muted, padding: "2px 2px" }}>+{sorted.length - 3}</span>}
          </div>
        )}

        {/* ปุ่มโทร — อยู่ตำแหน่งเดิมทุกใบ ไม่มีเบอร์ก็ยังมีปุ่มเทาบอกว่าทำไง */}
        {tel ? (
          <a href={`tel:${tel}`} onClick={(e) => e.stopPropagation()}
            style={{ marginTop: 2, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, height: 38, borderRadius: 999, background: C.brand, color: "#fff", textDecoration: "none", fontFamily: DISPLAY, fontSize: 14, fontWeight: 500, boxShadow: "0 8px 18px -10px rgba(28,110,242,.9)" }}>
            <Phone size={15} /> โทร {g.phone.length > 26 ? tel : g.phone}
          </a>
        ) : (
          <div style={{ marginTop: 2, display: "flex", alignItems: "center", justifyContent: "center", height: 38, borderRadius: 999, background: "#f1f6fc", color: C.muted, fontSize: 12.5 }}>
            ยังไม่มีเบอร์อู่นี้ · แจ้งทีมจัดซื้อให้เพิ่ม
          </div>
        )}
      </div>

      {menu && (
        <div onClick={(e) => e.stopPropagation()}
          style={{ position: "absolute", top: 40, right: 10, zIndex: 20, width: 210, background: "#fff", borderRadius: 14, border: `1px solid ${C.line}`, boxShadow: "0 16px 30px -12px rgba(15,39,72,.35)", padding: 6 }}>
          {hasOrigin && g.geo && (
            <MenuItem onClick={() => { onRoute(); setMenu(false) }} icon={routing ? <Loader2 size={14} className="animate-spin" /> : <Route size={14} />}>
              {routeOn ? "ซ่อนเส้นทาง" : "ดูเส้นทางขับไปอู่นี้"}
            </MenuItem>
          )}
          {g.source === "avl" && <MenuItem onClick={() => { onHistory(); setMenu(false) }} icon={<History size={14} />}>ดูประวัติการซ่อม</MenuItem>}
          {g.phone && (
            <MenuItem onClick={() => { void navigator.clipboard.writeText(g.phone); setCopied(true); setTimeout(() => { setCopied(false); setMenu(false) }, 900) }}
              icon={copied ? <Check size={14} color={C.mintText} /> : <Copy size={14} />}>
              {copied ? "คัดลอกแล้ว" : "คัดลอกเบอร์"}
            </MenuItem>
          )}
          {g.geo && (
            <MenuItem onClick={() => { window.open(`https://www.google.com/maps/search/?api=1&query=${g.geo!.lat},${g.geo!.lng}`, "_blank"); setMenu(false) }} icon={<MapPin size={14} />}>
              เปิดใน Google Maps
            </MenuItem>
          )}
          <div style={{ fontSize: 11, color: C.muted, padding: "6px 10px 4px", lineHeight: 1.5 }}>
            ข้อมูลจาก: {g.sources.map((s) => ({ avl: "ทะเบียน AVL", fleet: "ชีตยานยนต์", pin: "หมุด My Map" }[s])).join(" · ")}
            {g.address?.full ? <><br />{g.address.full}</> : null}
          </div>
        </div>
      )}
    </div>
  )
}

function WorkChip({ hit, children }: { hit: boolean; children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: hit ? C.brandSoft : "#f1f6fc", color: hit ? C.brandDark : C.ink2, fontWeight: hit ? 600 : 400 }}>
      {children}
    </span>
  )
}

function MenuItem({ onClick, icon, children }: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, border: 0, background: "none", borderRadius: 9, padding: "8px 10px", cursor: "pointer", fontSize: 13, color: C.ink, textAlign: "left" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = C.brandSoft)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>
      <span style={{ color: C.brand, display: "flex" }}>{icon}</span>{children}
    </button>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      style={{
        border: `1.5px solid ${on ? C.brand : C.line}`, background: on ? C.brand : "#fff", color: on ? "#fff" : C.ink2,
        borderRadius: 999, padding: "5px 12px", fontSize: 12.5, fontWeight: on ? 500 : 400, cursor: "pointer", fontFamily: BODY,
      }}>
      {children}
    </button>
  )
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} role="switch" aria-checked={on}
      style={{ display: "flex", alignItems: "center", gap: 7, border: 0, background: "none", padding: 0, cursor: "pointer", color: C.ink2, fontSize: 12.5, fontFamily: BODY }}>
      <span style={{ width: 30, height: 17, borderRadius: 999, background: on ? C.brand : "#d7e6f7", position: "relative", transition: "background .15s" }}>
        <span style={{ position: "absolute", top: 2, left: on ? 15 : 2, width: 13, height: 13, borderRadius: 999, background: "#fff", transition: "left .15s", boxShadow: "0 1px 2px rgba(0,0,0,.2)" }} />
      </span>
      {children}
    </button>
  )
}

/** คำอธิบายสัญลักษณ์ + สวิตช์เลเยอร์ อยู่กล่องเดียวกัน (ไม่เกิน 5 แถว) */
function Legend({ open, onToggle, showPlants, onPlants, showFuel, onFuel }: {
  open: boolean; onToggle: () => void
  showPlants: boolean; onPlants: () => void; showFuel: boolean; onFuel: () => void
}) {
  const dot = (s: React.CSSProperties) => <span style={{ width: 14, height: 14, flexShrink: 0, ...s }} />
  return (
    <div style={{ position: "absolute", left: 12, bottom: 18, zIndex: 500, background: "rgba(255,255,255,.96)", borderRadius: 16, boxShadow: "0 12px 28px -14px rgba(15,39,72,.45)", padding: open ? "10px 12px" : "6px 10px", fontSize: 12, color: C.ink2, minWidth: open ? 200 : 0 }}>
      <button onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 6, border: 0, background: "none", padding: 0, cursor: "pointer", fontFamily: DISPLAY, fontSize: 12.5, fontWeight: 600, color: C.ink }}>
        <Layers size={14} /> สัญลักษณ์บนแผนที่ <ChevronDown size={13} style={{ transform: open ? "none" : "rotate(180deg)" }} />
      </button>
      {open && (
        <div style={{ display: "grid", gap: 7, marginTop: 9 }}>
          <Row icon={dot({ borderRadius: 999, background: C.mint, border: "2px solid #fff", boxShadow: "0 0 0 1px #cfe3fb" })}>อู่ประจำ (ทะเบียน AVL)</Row>
          <Row icon={dot({ borderRadius: 999, background: C.brand, border: "2px solid #fff", boxShadow: "0 0 0 1px #cfe3fb" })}>ยานยนต์แนะนำ</Row>
          <Row icon={dot({ borderRadius: 4, background: "#fff", border: `2px dashed ${C.sun}` })}>ยังไม่อนุมัติ / ที่ตั้งประมาณ</Row>
          <Row icon={dot({ borderRadius: 3, background: C.navy })}>
            <LayerSwitch on={showPlants} onClick={onPlants} icon={<Factory size={12} />}>แพล้นท์</LayerSwitch>
          </Row>
          <Row icon={dot({ borderRadius: 999, background: C.fuel, width: 9, height: 9, margin: "0 2.5px" })}>
            <LayerSwitch on={showFuel} onClick={onFuel} icon={<Fuel size={12} />}>ปั๊มน้ำมัน</LayerSwitch>
          </Row>
          <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.45, maxWidth: 220 }}>แตะบนแผนที่เพื่อตั้งจุดรถเสียตรงนั้น</div>
        </div>
      )}
    </div>
  )
}
function Row({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{icon}{children}</div>
}
function LayerSwitch({ on, onClick, icon, children }: { on: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 5, border: `1px solid ${on ? C.brand : C.line}`, background: on ? C.brandSoft : "#fff", color: on ? C.brandDark : C.ink2, borderRadius: 999, padding: "2px 9px", fontSize: 11.5, cursor: "pointer" }}>
      {icon}{children} <b style={{ fontWeight: 600 }}>{on ? "เปิด" : "ปิด"}</b>
    </button>
  )
}

/**
 * ช่องค้นหาช่องเดียว: พิมพ์ชื่อแพล้นท์ / จังหวัด / อำเภอ แล้วเลือกจากรายการ
 * หรือวางลิงก์ Google Maps / พิกัด แล้วกด Enter ก็ได้ — ระบบดูเองว่าเป็นอะไร
 * ↑↓ เลื่อน · Enter เลือก · Esc ปิด
 */
function SmartSearch({ addr, place, onPick, onClear }: {
  addr: ProvinceNode[]; place: Place | null
  onPick: (p: Place) => void; onClear: () => void
}) {
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const looksLikePoint = (s: string) => !!parseLatLng(s) || isShortMapLink(s) || /google\.[^/]+\/maps|maps\.app\.goo\.gl/.test(s)

  const hits = useMemo((): Place[] => {
    const t = q.trim()
    if (!t) return PLANTS.slice(0, 8).map((p) => ({ kind: "plant", label: `แพล้นท์ ${p.n}`, lat: p.lat, lng: p.lng }))
    if (looksLikePoint(t)) return [{ kind: "point", label: "จุดที่วางไว้", raw: t }]
    const low = t.toLowerCase()
    const out: Place[] = []
    for (const p of addr) {
      if (p.p.includes(t)) out.push({ kind: "area", label: `จ.${p.p}`, province: p.p, district: "" })
      for (const a of p.a) if (a.n.includes(t)) out.push({ kind: "area", label: `อ.${a.n} จ.${p.p}`, province: p.p, district: a.n })
    }
    const plants: Place[] = PLANTS.filter((p) => p.n.toLowerCase().includes(low)).map((p) => ({ kind: "plant", label: `แพล้นท์ ${p.n}`, lat: p.lat, lng: p.lng }))
    return [...plants.slice(0, 8), ...out.slice(0, 8)]
  }, [q, addr])

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${cursor}"]`)?.scrollIntoView({ block: "nearest" })
  }, [cursor])

  const choose = (i: number) => {
    const p = hits[i]
    if (!p) return
    onPick(p); setOpen(false); setQ("")
  }

  if (place && !open) {
    const Icon = place.kind === "plant" ? Factory : place.kind === "area" ? MapPin : Crosshair
    return (
      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 14, background: C.brandSoft, border: `1.5px solid ${C.brandLine}` }}>
        <Icon size={16} color={C.brand} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 500, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{place.label}</span>
        <button onClick={() => { setOpen(true); setQ("") }} style={{ border: 0, background: "none", color: C.brand, cursor: "pointer", fontSize: 12.5 }}>เปลี่ยน</button>
        <button onClick={onClear} aria-label="ล้างจุดที่เลือก" style={{ border: 0, background: "none", color: C.muted, cursor: "pointer", display: "flex", padding: 0 }}><X size={15} /></button>
      </div>
    )
  }

  return (
    <div ref={boxRef} style={{ position: "relative", marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, border: `1.5px solid ${open ? C.brand : C.line}`, borderRadius: 14, padding: "9px 12px", background: "#fff", boxShadow: open ? "0 0 0 4px rgba(61,165,255,.18)" : "none" }}>
        <Search size={16} color={C.muted} />
        <input autoFocus={!!place}
          value={q}
          onChange={(e) => { setQ(e.target.value); setCursor(0); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onPaste={(e) => {
            const t = e.clipboardData.getData("text").trim()
            if (looksLikePoint(t)) { e.preventDefault(); onPick({ kind: "point", label: "จุดที่วางไว้", raw: t }); setOpen(false); setQ("") }
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, hits.length - 1)) }
            if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
            if (e.key === "Enter") { e.preventDefault(); choose(cursor) }
            if (e.key === "Escape") setOpen(false)
          }}
          placeholder="พิมพ์ชื่อแพล้นท์ จังหวัด อำเภอ หรือวางลิงก์แผนที่"
          style={{ flex: 1, minWidth: 0, border: 0, outline: "none", fontSize: 14, color: C.ink, background: "transparent", fontFamily: BODY }}
        />
      </div>
      {open && (
        <div ref={listRef}
          style={{ position: "absolute", zIndex: 600, top: "calc(100% + 6px)", left: 0, right: 0, maxHeight: 300, overflowY: "auto", background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, boxShadow: "0 16px 32px -14px rgba(15,39,72,.4)", padding: 4 }}>
          {!q.trim() && <div style={{ padding: "6px 10px 4px", fontSize: 11.5, color: C.muted }}>แพล้นท์ · พิมพ์เพื่อค้นทั้งหมด {PLANTS.length} แห่ง หรือชื่อจังหวัด/อำเภอ</div>}
          {hits.length === 0
            ? <div style={{ padding: "10px 12px", fontSize: 13, color: C.muted }}>ไม่เจอ “{q}” ลองพิมพ์สั้นลง หรือแตะจุดบนแผนที่แทน</div>
            : hits.map((p, i) => {
                const Icon = p.kind === "plant" ? Factory : p.kind === "area" ? MapPin : Crosshair
                return (
                  <button key={`${p.kind}-${p.label}-${i}`} data-i={i} onMouseEnter={() => setCursor(i)} onClick={() => choose(i)}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", border: 0, cursor: "pointer", padding: "8px 10px", borderRadius: 10, fontSize: 13.5, color: C.ink, background: i === cursor ? C.brandSoft : "#fff", fontFamily: BODY }}>
                    <Icon size={14} color={p.kind === "plant" ? C.navy : C.brand} /> {p.label}
                  </button>
                )
              })}
        </div>
      )}
    </div>
  )
}
