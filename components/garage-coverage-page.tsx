"use client"

// สรุปอู่รายจังหวัด — จังหวัดไหนรถเยอะแต่อู่น้อย ต้องหาอู่เพิ่ม (ผู้ใช้ขอ 19/10/2569)
// อ่านง่ายแบบไม่ต้องคิด: บรรทัดบนสุดบอกคำตอบเลยว่าจังหวัดไหนขาดอู่ ตารางมีไว้เจาะดูทีหลัง
// สีชุด menaIT V.2 · ตัวเลขจาก /api/vendors/coverage
import { Fragment, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ChevronDown, ChevronRight, Download, Factory, Loader2, MapPin, Phone, Search, ShieldCheck, Truck, TriangleAlert, Wrench } from "lucide-react"
import type { CoverageRow } from "@/lib/garage-coverage"
import { swalError, swalToast } from "@/lib/swal"

type Data = {
  asOf: string
  totals: { garages: number; trucks: number; provincesWithGarages: number; gapProvinces: string[]; per100: number | null; unknownPlants: string[] }
  works: string[]
  rows: CoverageRow[]
}

const C = {
  brand: "#1c6ef2", brandDark: "#1556c9", brandSoft: "#eaf4ff", ink: "#0f2748", ink2: "#33476b", muted: "#6b7f9e",
  line: "#e3effd", canvas: "#f0faff", mint: "#10b981", mintSoft: "#e7f9f1", mintText: "#0b8a5e",
  sun: "#ff8a3d", sunSoft: "#fff4e8", sunText: "#c2570c", red: "#e5484d", redSoft: "#fdecec",
}
const DISPLAY = "'Prompt', 'Noto Sans Thai', sans-serif"
const BODY = "'Noto Sans Thai', 'Prompt', Tahoma, sans-serif"

/** ระดับความพอของอู่ — ตัดสินจาก "รถต่ออู่ 1 แห่ง" ซึ่งคนอ่านเข้าใจกว่าอู่ต่อรถ 100 คัน */
function level(r: CoverageRow): { label: string; color: string; bg: string } {
  if (r.trucks > 0 && r.garages === 0) return { label: "ไม่มีอู่เลย", color: C.red, bg: C.redSoft }
  if (r.trucks === 0) return { label: "ไม่มีรถประจำ", color: C.muted, bg: "#f1f6fc" }
  if ((r.trucksPerGarage ?? 0) > 5) return { label: "อู่น้อย", color: C.sunText, bg: C.sunSoft }
  if ((r.trucksPerGarage ?? 0) > 2.5) return { label: "พอใช้", color: C.brandDark, bg: C.brandSoft }
  return { label: "เพียงพอ", color: C.mintText, bg: C.mintSoft }
}

type SortKey = "need" | "trucks" | "garages" | "name"

/** ชื่อย่อหัวคอลัมน์จุดงาน 9 หมวด (เรียงตาม COVERAGE_WORKS) — กว้าง 30px ต่อช่อง */
const SHORT = ["เบรก", "เครื่อง", "โม่", "ตัวถัง", "นอกที่", "แอร์", "หัวฉีด", "ฟิล์ม", "ท่อ"]

export function GarageCoveragePage() {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState("")
  const [q, setQ] = useState("")
  const [sort, setSort] = useState<SortKey>("need")
  const [open, setOpen] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const exportXlsx = async () => {
    if (!data) return
    setExporting(true)
    try {
      const { downloadCoverageXlsx } = await import("@/components/garage-coverage-xlsx")
      await downloadCoverageXlsx(data)
      void swalToast("success", "ดาวน์โหลดไฟล์ Excel แล้ว")
    } catch (e) {
      void swalError(e instanceof Error ? e.message : "ทำไฟล์ Excel ไม่สำเร็จ")
    } finally { setExporting(false) }
  }

  useEffect(() => {
    fetch("/api/vendors/coverage")
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setData(j) })
      .catch((e) => setErr(e instanceof Error ? e.message : "โหลดข้อมูลไม่ได้ ลองใหม่อีกครั้ง"))
  }, [])

  const rows = useMemo(() => {
    if (!data) return []
    let r = data.rows.filter((x) => !q || x.province.includes(q) || x.districts?.some((d) => d.district?.includes(q)))
    if (sort === "trucks") r = [...r].sort((a, b) => b.trucks - a.trucks)
    if (sort === "garages") r = [...r].sort((a, b) => b.garages - a.garages)
    if (sort === "name") r = [...r].sort((a, b) => a.province.localeCompare(b.province, "th"))
    return r
  }, [data, q, sort])

  // จังหวัดที่ต้องหาอู่เพิ่ม พร้อมเหตุผล — รถเราเป็นรถโม่ จังหวัดที่มีรถแต่ไม่มีอู่ทำระบบโม่ก็นับว่าขาด
  const needs = useMemo(() => {
    if (!data) return []
    const mixer = data.works.indexOf("ระบบโม่")
    return data.rows
      .filter((r) => r.province !== "ไม่รู้จังหวัด" && r.trucks > 0)
      .map((r) => ({
        r,
        why: r.garages === 0 ? "ไม่มีอู่เลย"
          : (r.trucksPerGarage ?? 0) > 5 ? `รถ ${r.trucksPerGarage} คันต่ออู่ 1 แห่ง`
          : mixer >= 0 && r.works[mixer] === 0 ? "ไม่มีอู่ทำระบบโม่"
          : "",
      }))
      .filter((x) => x.why)
  }, [data])

  if (err) return <Shell><div style={{ color: C.red, display: "flex", gap: 6, alignItems: "center" }}><TriangleAlert size={16} /> {err}</div></Shell>
  if (!data) return <Shell><div style={{ color: C.muted, display: "flex", gap: 8, alignItems: "center" }}><Loader2 size={16} className="animate-spin" /> กำลังรวมข้อมูลอู่กับรถทุกจังหวัด…</div></Shell>

  const t = data.totals
  return (
    <Shell>
      {/* คำตอบหลัก */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
        <Kpi icon={<Wrench size={18} />} tone="blue" label="อู่ทั้งหมดในระบบ" value={t.garages.toLocaleString()} sub={`อยู่ใน ${t.provincesWithGarages} จังหวัด`} />
        <Kpi icon={<Truck size={18} />} tone="ink" label="รถที่ประจำแพล้นท์" value={t.trucks.toLocaleString()} sub={data.asOf ? `ข้อมูลรถ ณ ${data.asOf}` : ""} />
        <Kpi icon={<TriangleAlert size={18} />} tone="sun" label="จังหวัดที่ต้องหาอู่เพิ่ม" value={needs.length.toLocaleString()}
          sub={t.gapProvinces.length ? `ไม่มีอู่เลย ${t.gapProvinces.length} จังหวัด` : "ทุกจังหวัดที่มีรถ มีอู่อย่างน้อย 1 แห่ง"} />
        <Kpi icon={<ShieldCheck size={18} />} tone="mint" label="อู่ต่อรถ 100 คัน" value={t.per100 === null ? "—" : String(t.per100)} sub="ทั้งประเทศ" />
      </div>

      {needs.length > 0 && (
        <div style={{ marginTop: 14, background: "#fff", borderRadius: 20, padding: "14px 18px", boxShadow: "0 8px 24px -10px rgba(21,86,201,.25)" }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 15, fontWeight: 600 }}>ต้องหาอู่เพิ่มก่อน</div>
          <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>จังหวัดที่มีรถประจำแพล้นท์ แต่ไม่มีอู่ อู่น้อยเกิน (เกิน 5 คันต่ออู่) หรือไม่มีอู่ทำระบบโม่</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            {needs.map(({ r, why }) => {
              const lv = why.startsWith("ไม่มีอู่เลย") ? level(r) : { color: C.sunText, bg: C.sunSoft }
              return (
                <button key={r.province} onClick={() => { setOpen(r.province); document.getElementById(`p-${r.province}`)?.scrollIntoView({ behavior: "smooth", block: "center" }) }}
                  style={{ border: `1.5px solid ${lv.color}33`, background: lv.bg, color: lv.color, borderRadius: 14, padding: "7px 12px", cursor: "pointer", textAlign: "left", fontFamily: BODY }}>
                  <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 14 }}>{r.province}</div>
                  <div style={{ fontSize: 11.5, fontWeight: 600 }}>{why}</div>
                  <div style={{ fontSize: 11.5 }}>รถ {r.trucks} คัน · อู่ {r.garages} แห่ง</div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ตาราง */}
      <div style={{ marginTop: 14, background: "#fff", borderRadius: 20, boxShadow: "0 8px 24px -10px rgba(21,86,201,.25)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: `1px solid ${C.line}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, border: `1.5px solid ${C.line}`, borderRadius: 12, padding: "6px 10px", width: 260 }}>
            <Search size={15} color={C.muted} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นจังหวัด หรืออำเภอ"
              style={{ border: 0, outline: "none", fontSize: 13.5, flex: 1, fontFamily: BODY, color: C.ink }} />
          </div>
          <button onClick={() => void exportXlsx()} disabled={exporting}
            style={{ display: "flex", alignItems: "center", gap: 6, border: `1.5px solid ${C.mint}`, background: C.mintSoft, color: C.mintText, borderRadius: 12, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: exporting ? "wait" : "pointer", fontFamily: BODY }}>
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} {exporting ? "กำลังทำไฟล์…" : "ดาวน์โหลด Excel"}
          </button>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12.5, color: C.muted }}>เรียงตาม</span>
          {([["need", "ต้องหาอู่ก่อน"], ["trucks", "รถมากสุด"], ["garages", "อู่มากสุด"], ["name", "ชื่อจังหวัด"]] as [SortKey, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setSort(k)}
              style={{ border: `1.5px solid ${sort === k ? C.brand : C.line}`, background: sort === k ? C.brand : "#fff", color: sort === k ? "#fff" : C.ink2, borderRadius: 999, padding: "4px 12px", fontSize: 12.5, cursor: "pointer", fontFamily: BODY }}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.canvas, color: C.ink2, textAlign: "left" }}>
                <Th>จังหวัด</Th>
                <Th right>รถ</Th>
                <Th right>อู่</Th>
                <Th>อู่แยกตามที่มา</Th>
                <Th right>รถต่ออู่ 1 แห่ง</Th>
                <Th>สถานะ</Th>
                <Th>
                  <div>จำนวนอู่ที่ทำงานแต่ละหมวด</div>
                  <div style={{ display: "flex", gap: 3, marginTop: 4 }}>
                    {SHORT.map((w, i) => (
                      <span key={w} title={data.works[i]} style={{ width: 34, textAlign: "center", fontSize: 10, fontWeight: 500, color: C.muted, lineHeight: 1.1 }}>{w}</span>
                    ))}
                  </div>
                </Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const lv = level(r)
                const isOpen = open === r.province
                return (
                  <Fragment key={r.province}>
                    <tr id={`p-${r.province}`} onClick={() => setOpen(isOpen ? null : r.province)}
                      style={{ borderTop: `1px solid ${C.line}`, cursor: "pointer", background: isOpen ? C.brandSoft : "#fff" }}>
                      <Td>
                        <span style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: DISPLAY, fontWeight: 600 }}>
                          {isOpen ? <ChevronDown size={15} color={C.brand} /> : <ChevronRight size={15} color={C.muted} />}
                          {r.province}
                        </span>
                        {r.plants.length > 0 && <div style={{ fontSize: 11.5, color: C.muted, marginLeft: 21 }}>แพล้นท์ {r.plants.length} แห่ง</div>}
                      </Td>
                      <Td right><b>{r.trucks || "—"}</b></Td>
                      <Td right><b>{r.garages || "—"}</b></Td>
                      <Td><SourceBar r={r} /></Td>
                      <Td right>{r.trucksPerGarage === null ? "—" : r.trucksPerGarage}</Td>
                      <Td><span style={{ background: lv.bg, color: lv.color, borderRadius: 999, padding: "2px 10px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>{lv.label}</span></Td>
                      <Td><WorkDots works={data.works} counts={r.works} /></Td>
                      <Td>
                        {r.province !== "ไม่รู้จังหวัด" && (
                          <Link href={`/vendors/map?area=${encodeURIComponent(r.province)}`} onClick={(e) => e.stopPropagation()}
                            style={{ display: "inline-flex", alignItems: "center", gap: 4, color: C.brand, fontSize: 12.5, textDecoration: "none", whiteSpace: "nowrap" }}>
                            <MapPin size={13} /> ดูบนแผนที่
                          </Link>
                        )}
                      </Td>
                    </tr>
                    {isOpen && (
                      <tr style={{ background: "#fafcff" }}>
                        <td colSpan={8} style={{ padding: "4px 16px 16px 37px" }}>
                          <Detail r={r} works={data.works} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ fontSize: 12, color: C.muted, marginTop: 12, lineHeight: 1.6 }}>
        นับรถจากทะเบียนรถรายวันของ ATMS ตามแพล้นท์ที่รถประจำ แล้วดูว่าแพล้นท์อยู่จังหวัดไหน · อู่รวมทุกแหล่ง (ทะเบียน AVL + ชีตยานยนต์ + หมุด My Map)
        {t.unknownPlants.length > 0 && <> · แพล้นท์ที่ยังไม่รู้ที่ตั้ง {t.unknownPlants.length} แห่ง ({t.unknownPlants.join(", ")}) นับไว้ที่ “ไม่รู้จังหวัด”</>}
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: BODY, color: C.ink, maxWidth: 1280, margin: "0 auto" }}>
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 600, margin: 0 }}>สรุปอู่รายจังหวัด</h1>
        <div style={{ fontSize: 13, color: C.muted, marginTop: 3 }}>จังหวัดไหนรถเยอะแต่อู่น้อย ให้หาอู่เพิ่มที่นั่นก่อน</div>
      </div>
      {children}
    </div>
  )
}

function Kpi({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub: string; tone: "blue" | "ink" | "sun" | "mint" }) {
  const tile = { blue: "linear-gradient(135deg,#58b6ff,#1c6ef2)", ink: "linear-gradient(135deg,#5b7299,#0f2748)", sun: "linear-gradient(135deg,#ffc27a,#ff8a3d)", mint: "linear-gradient(135deg,#7cefc0,#16b981)" }[tone]
  return (
    <div style={{ background: "#fff", borderRadius: 20, padding: "14px 16px", boxShadow: "0 8px 24px -10px rgba(21,86,201,.25)", display: "flex", gap: 12, alignItems: "center" }}>
      <div style={{ width: 42, height: 42, borderRadius: 14, background: tile, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: C.muted }}>{label}</div>
        <div style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 600, lineHeight: 1.15 }}>{value}</div>
        {sub && <div style={{ fontSize: 11.5, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>}
      </div>
    </div>
  )
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return <th style={{ padding: "9px 12px", fontWeight: 600, fontSize: 12.5, textAlign: right ? "right" : "left", whiteSpace: "nowrap" }}>{children}</th>
}
function Td({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return <td style={{ padding: "9px 12px", textAlign: right ? "right" : "left", verticalAlign: "middle" }}>{children}</td>
}

/** แถบสัดส่วนอู่ตามที่มา: อู่ AVL (มินต์) · อู่ที่ยังไม่ได้ยืนยัน (ฟ้า) · ยังไม่อนุมัติ (ส้ม) */
function SourceBar({ r }: { r: CoverageRow }) {
  if (!r.garages) return <span style={{ color: C.muted }}>—</span>
  const parts = [
    { n: r.bySource.avl, c: C.mint, l: "อู่ AVL" },
    { n: r.bySource.fleet, c: C.brand, l: "อู่ที่ยังไม่ได้ยืนยัน" },
    { n: r.bySource.pin, c: C.sun, l: "ยังไม่อนุมัติ" },
  ]
  return (
    <div title={parts.map((p) => `${p.l} ${p.n}`).join(" · ")} style={{ minWidth: 150 }}>
      <div style={{ display: "flex", height: 8, borderRadius: 999, overflow: "hidden", background: "#f1f6fc" }}>
        {parts.map((p) => p.n > 0 && <div key={p.l} style={{ width: `${(p.n / r.garages) * 100}%`, background: p.c }} />)}
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 3, whiteSpace: "nowrap" }}>
        AVL {r.bySource.avl} · ยังไม่ยืนยัน {r.bySource.fleet} · ยังไม่อนุมัติ {r.bySource.pin}
      </div>
    </div>
  )
}

/** จุด 9 หมวดงาน: มีอู่ทำ = จุดฟ้าพร้อมจำนวน · ไม่มีเลย = วงแดงจาง (ช่องว่างที่ต้องหาอู่) */
function WorkDots({ works, counts }: { works: string[]; counts: number[] }) {
  return (
    <div style={{ display: "flex", gap: 3 }}>
      {works.map((w, i) => (
        <span key={w} title={`${w}: ${counts[i]} อู่`}
          style={{
            width: 34, height: 22, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 600,
            background: counts[i] ? C.brandSoft : "#fff", color: counts[i] ? C.brandDark : "#e5484d99",
            border: counts[i] ? "0" : "1.5px dashed #e5484d55",
          }}>
          {counts[i] || "0"}
        </span>
      ))}
    </div>
  )
}

function Detail({ r, works }: { r: CoverageRow; works: string[] }) {
  const missing = works.filter((_, i) => !r.works[i])
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.3fr)", gap: 16, marginTop: 8 }}>
      <div>
        <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 13.5, marginBottom: 6 }}>รายอำเภอ</div>
        {r.districts?.length ? (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead><tr style={{ color: C.muted, textAlign: "left" }}><th style={{ padding: "4px 6px" }}>อำเภอ</th><th style={{ padding: "4px 6px", textAlign: "right" }}>รถ</th><th style={{ padding: "4px 6px", textAlign: "right" }}>อู่</th><th style={{ padding: "4px 6px" }}>แพล้นท์</th></tr></thead>
            <tbody>
              {r.districts.map((d) => (
                <tr key={d.district} style={{ borderTop: `1px solid ${C.line}` }}>
                  <td style={{ padding: "5px 6px" }}>{d.district}</td>
                  <td style={{ padding: "5px 6px", textAlign: "right", fontWeight: 600 }}>{d.trucks || "—"}</td>
                  <td style={{ padding: "5px 6px", textAlign: "right", fontWeight: 600, color: d.trucks && !d.garages ? C.red : C.ink }}>{d.garages || (d.trucks ? "0" : "—")}</td>
                  <td style={{ padding: "5px 6px", color: C.muted }}>{d.plants.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div style={{ fontSize: 12.5, color: C.muted }}>ยังไม่มีข้อมูลรายอำเภอ</div>}
        {missing.length > 0 && r.garages > 0 && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: C.sunText, background: C.sunSoft, borderRadius: 12, padding: "8px 10px" }}>
            ยังไม่มีอู่ที่ทำงาน: <b>{missing.join(", ")}</b>
          </div>
        )}
        {r.plants.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12, color: C.muted, display: "flex", gap: 5, alignItems: "flex-start" }}>
            <Factory size={13} style={{ marginTop: 2, flexShrink: 0 }} /> {r.plants.join(", ")}
          </div>
        )}
      </div>
      <div>
        <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 13.5, marginBottom: 6 }}>รายชื่ออู่ ({r.list?.length ?? 0})</div>
        <div style={{ maxHeight: 300, overflowY: "auto", display: "grid", gap: 4 }}>
          {(r.list ?? []).map((g) => (
            <div key={g.name} style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: "6px 10px" }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, flexShrink: 0, background: { avl: C.mint, fleet: C.brand, pin: C.sun }[g.source] }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</div>
                <div style={{ fontSize: 11, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {[g.district, g.works.join(" · ")].filter(Boolean).join(" — ") || "ยังไม่มีข้อมูลงาน"}
                </div>
              </div>
              {/0\d[\d-]{7,}/.test(g.phone) ? (
                // โชว์เบอร์เต็ม (ผู้ใช้สั่ง) กดแล้วโทรได้เลยบนมือถือ
                <a href={`tel:${(g.phone.match(/0\d[\d-]{7,}/) ?? [""])[0].replace(/-/g, "")}`} title={`โทร ${g.phone}`}
                  style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0, color: C.brandDark, background: C.brandSoft, borderRadius: 999, padding: "4px 10px", fontSize: 12.5, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                  <Phone size={12} /> {g.phone}
                </a>
              ) : (
                <span style={{ flexShrink: 0, fontSize: 11.5, color: C.muted, whiteSpace: "nowrap" }}>ยังไม่มีเบอร์</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
