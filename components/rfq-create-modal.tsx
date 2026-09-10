"use client"
// modal สร้างลิงก์ขอราคา: ชื่อรอบ · วันปิดรับ · ตาราง อู่ × ชีต (ค่าตั้งต้นจากช่องที่ติ๊ก) · ส่วน ค่าแรง/อะไหล่ → ลิงก์รายอู่ + ข้อความ LINE
import { Fragment, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Copy, X } from "lucide-react"
import { swalError, swalToast } from "@/lib/swal"
import { bkkToday } from "@/lib/bkk-time"
import { sheetsForVendor, addDays, SHEET_ORDER, SVC_SHEET, type RfqSection } from "@/lib/rfq-core"
import { mitr } from "@/components/vendor-shared"
import { thDate } from "@/components/rfq-vendor-shared"

type SheetInfo = { sheet: string; title: string; jobs: number; parts: number }
type JobInfo = { sheet: string; seq: number; jobCode: string; name: string }

/** ชื่อย่อของชีตไว้ในหัวตาราง — ชื่อเต็มจากแคตตาล็อกยาวเกินช่อง */
const SHEET_SHORT: Record<string, string> = {
  S45: "โม่", S37: "เบรก-ครัช-เกียร์", S39: "ไฟฟ้า-แอร์", S35: "ช่วงล่าง", S33: "เครื่องยนต์",
  S47: "หล่อเย็น-ไอเสีย", S61: "เชื้อเพลิง", S59: "ลม-ปั๊มลม", S31: "หัวเก๋ง-ตัวถัง", S43: "ปะผุ-ทำสี",
  S65: "PM", S85: "ทำความสะอาด", SVC: "งานพื้นฐาน",
}
type Created = { id: string; vendor: string; token: string; url: string }

export function RfqCreateModal({ vendors, onClose }: { vendors: { vendor: string; codes: string[] }[]; onClose: () => void }) {
  const [catalog, setCatalog] = useState<SheetInfo[]>([])
  const [jobs, setJobs] = useState<JobInfo[]>([])
  // เลือกข้อย่อย (งานช่าง) รายอู่ — ไม่มี key = ทุกงานของชีตที่ให้ · เปิดแผงแล้วค่อยสร้างชุดเต็ม
  const [picks, setPicks] = useState<Record<string, Set<string>>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [title, setTitle] = useState(`ขอราคางานช่าง Mixer ${new Date().toLocaleDateString("th-TH", { month: "short", year: "2-digit" })}`)
  const [deadline, setDeadline] = useState(addDays(bkkToday(), 14))
  const [sections, setSections] = useState<RfqSection[]>(["labour", "parts"])
  const [sheets, setSheets] = useState<Record<string, Set<string>>>(() => Object.fromEntries(vendors.map((v) => [v.vendor, new Set(sheetsForVendor(v.codes))])))
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<Created[] | null>(null)
  useEffect(() => {
    void fetch("/api/rfq/catalog").then((r) => r.json())
      .then((d) => { setCatalog(d.sheets ?? []); setJobs(d.jobs ?? []) })
      .catch(() => { setCatalog([]); setJobs([]) })
  }, [])
  const cols = useMemo(() => SHEET_ORDER.filter((s) => catalog.some((c) => c.sheet === s)), [catalog])
  const jobsOf = (sheetSet: Set<string>) => jobs.filter((j) => sheetSet.has(j.sheet))
  const toggle = (vendor: string, s: string) => {
    if (s === SVC_SHEET) return
    setSheets((m) => { const n = new Set(m[vendor]); if (n.has(s)) n.delete(s); else n.add(s); return { ...m, [vendor]: n } })
    // ชุดข้อย่อยตามชีตไปด้วย: เปิดชีต = ติ๊กงานทั้งชีต · ปิดชีต = เอางานของชีตนั้นออก
    setPicks((pm) => {
      const cur = pm[vendor]; if (!cur) return pm
      const n = new Set(cur)
      const on = !sheets[vendor].has(s)
      for (const j of jobs) if (j.sheet === s) { if (on) n.add(j.jobCode); else n.delete(j.jobCode) }
      return { ...pm, [vendor]: n }
    })
  }
  const openPicks = (vendor: string) => {
    setPicks((pm) => pm[vendor] ? pm : { ...pm, [vendor]: new Set(jobsOf(sheets[vendor]).map((j) => j.jobCode)) })
    setExpanded((e) => (e === vendor ? null : vendor))
  }
  const toggleJob = (vendor: string, code: string) => setPicks((pm) => { const n = new Set(pm[vendor]); if (n.has(code)) n.delete(code); else n.add(code); return { ...pm, [vendor]: n } })
  const setSheetJobs = (vendor: string, sheet: string, on: boolean) => setPicks((pm) => { const n = new Set(pm[vendor]); for (const j of jobs) if (j.sheet === sheet) { if (on) n.add(j.jobCode); else n.delete(j.jobCode) } return { ...pm, [vendor]: n } })
  /** จำนวนที่เลือก / ทั้งหมด ของอู่ · ส่ง jobCodes เฉพาะเมื่อเลือกไม่ครบ */
  const pickInfo = (vendor: string) => {
    const all = jobsOf(sheets[vendor]); const p = picks[vendor]
    const chosen = p ? all.filter((j) => p.has(j.jobCode)) : all
    return { all: all.length, chosen: chosen.length, codes: p && chosen.length < all.length ? chosen.map((j) => j.jobCode) : undefined }
  }
  async function create() {
    if (!title.trim()) { swalError("กรุณาตั้งชื่อรอบ"); return }
    if (!sections.length) { swalError("เลือกอย่างน้อย 1 ส่วน (ค่าแรง/อะไหล่)"); return }
    setBusy(true)
    try {
      const r = await fetch("/api/rfq", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, deadline, invites: vendors.map((v) => ({ vendor: v.vendor, sheets: [...sheets[v.vendor]], sections, jobCodes: pickInfo(v.vendor).codes })) }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error ?? "สร้างไม่สำเร็จ")
      setCreated(d.invites)
    } catch (e) { swalError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const lineText = (c: Created) => `เรียน ${c.vendor}\nMena Transport ขอเชิญเสนอราคา ${title}\nกรอกได้ที่ลิงก์นี้ (เปิดจากมือถือได้ ไม่ต้องสมัคร): ${c.url}\nปิดรับ ${thDate(deadline)}\nขอบคุณครับ/ค่ะ — ฝ่ายจัดซื้อ`
  const copy = (t: string) => { void navigator.clipboard.writeText(t); swalToast("success", "คัดลอกแล้ว") }
  const inp = { ...mitr, padding: "8px 10px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13 }
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...mitr, background: "#fff", borderRadius: 14, padding: 18, width: "100%", maxWidth: 960, maxHeight: "90vh", overflow: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>{created ? `สร้างลิงก์แล้ว ${created.length} อู่` : `ขอราคา — ${vendors.length} อู่`}</div>
          <button onClick={onClose} style={{ marginLeft: "auto", border: "none", background: "transparent", cursor: "pointer" }}><X size={18} /></button>
        </div>
        {!created ? (
          <>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", marginBottom: 12 }}>
              <label style={{ flex: 2, minWidth: 220 }}><div style={{ fontSize: 12, fontWeight: 600 }}>ชื่อรอบ</div><input value={title} onChange={(e) => setTitle(e.target.value)} style={{ ...inp, width: "100%", boxSizing: "border-box" }} maxLength={120} /></label>
              <label><div style={{ fontSize: 12, fontWeight: 600 }}>ปิดรับ</div><input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} style={inp} /></label>
              <div><div style={{ fontSize: 12, fontWeight: 600 }}>ส่วนที่ให้เสนอ</div>
                {(["labour", "parts"] as const).map((s) => <label key={s} style={{ marginRight: 12, fontSize: 13 }}><input type="checkbox" checked={sections.includes(s)} onChange={(e) => setSections((c) => e.target.checked ? [...new Set([...c, s])] : c.filter((x) => x !== s))} /> {s === "labour" ? "ค่าแรง" : "อะไหล่"}</label>)}
              </div>
            </div>
            <div style={{ fontSize: 12, color: "#6B7C72", marginBottom: 6 }}>ค่าตั้งต้นของชีตมาจากช่องที่ติ๊กในตารางความสามารถ · SVC (งานพื้นฐาน) ให้ทุกอู่ · คลิกช่องเพื่อเพิ่ม/ลด · กด “เลือกข้อย่อย” เพื่อให้เสนอเฉพาะบางงานในชีต</div>
            <div style={{ overflowX: "auto", border: "1px solid #E5E7EB", borderRadius: 10 }}>
              <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 760 }}>
                <thead><tr style={{ background: "#F6FAF7" }}>
                  <th style={{ padding: 6, textAlign: "left", position: "sticky", left: 0, background: "#F6FAF7", zIndex: 1 }}>อู่</th>
                  {cols.map((s) => { const c = catalog.find((x) => x.sheet === s)!; return (
                    <th key={s} title={`${c.title} · งาน ${c.jobs} · อะไหล่ ${c.parts}`} style={{ padding: "6px 4px", fontWeight: 600, whiteSpace: "nowrap", verticalAlign: "bottom" }}>
                      <div>{s}</div>
                      <div style={{ fontSize: 10, fontWeight: 500, color: "#6B7C72" }}>{SHEET_SHORT[s] ?? c.title}</div>
                    </th>) })}
                  <th style={{ padding: 6, fontWeight: 600, whiteSpace: "nowrap" }}>ข้อย่อย</th>
                </tr></thead>
                <tbody>{vendors.map((v) => {
                  const info = pickInfo(v.vendor)
                  const isOpen = expanded === v.vendor
                  return (
                    <Fragment key={v.vendor}>
                      <tr style={{ borderTop: "1px solid #F3F4F6" }}>
                        <td style={{ padding: 6, fontWeight: 600, whiteSpace: "nowrap", position: "sticky", left: 0, background: "#fff" }}>{v.vendor}</td>
                        {cols.map((s) => { const on = sheets[v.vendor].has(s); return <td key={s} onClick={() => toggle(v.vendor, s)} title={s === SVC_SHEET ? "งานพื้นฐานให้ทุกอู่" : on ? "คลิกเพื่อเอาออก" : "คลิกเพื่อเพิ่ม"} style={{ padding: 6, textAlign: "center", cursor: s === SVC_SHEET ? "default" : "pointer", background: on ? "#ECFDF5" : "#fff", color: on ? "#047857" : "#D1D5DB", fontWeight: 700 }}>{on ? "✓" : "·"}</td> })}
                        <td style={{ padding: 6, whiteSpace: "nowrap" }}>
                          <button type="button" onClick={() => openPicks(v.vendor)} style={{ ...mitr, padding: "3px 10px", borderRadius: 999, fontSize: 11.5, border: `1px solid ${info.codes ? "#0E7490" : "#E5E7EB"}`, background: info.codes ? "#ECFEFF" : "#fff", color: info.codes ? "#0E7490" : "#374151", cursor: "pointer" }}>
                            {isOpen ? "ซ่อน" : "เลือกข้อย่อย"} · {info.chosen}/{info.all} งาน
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={cols.length + 2} style={{ padding: "6px 10px 10px", background: "#FAFCFB", borderTop: "1px dashed #E5E7EB" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 10 }}>
                              {cols.filter((s) => sheets[v.vendor].has(s)).map((s) => {
                                const list = jobs.filter((j) => j.sheet === s)
                                const p = picks[v.vendor] ?? new Set<string>()
                                const n = list.filter((j) => p.has(j.jobCode)).length
                                return (
                                  <div key={s} style={{ border: "1px solid #E5E7EB", borderRadius: 8, background: "#fff", padding: 8 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                      <b style={{ fontSize: 12 }}>{s} · {SHEET_SHORT[s] ?? s}</b>
                                      <span style={{ fontSize: 11, color: "#6B7C72" }}>{n}/{list.length}</span>
                                      <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                                        <button type="button" onClick={() => setSheetJobs(v.vendor, s, true)} style={{ ...mitr, fontSize: 11, border: "none", background: "transparent", color: "#0E7490", cursor: "pointer" }}>ทั้งหมด</button>
                                        <button type="button" onClick={() => setSheetJobs(v.vendor, s, false)} style={{ ...mitr, fontSize: 11, border: "none", background: "transparent", color: "#9CA3AF", cursor: "pointer" }}>ไม่เลือก</button>
                                      </span>
                                    </div>
                                    {list.map((j) => (
                                      <label key={j.jobCode} style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 11.5, padding: "2px 0", cursor: "pointer" }}>
                                        <input type="checkbox" checked={p.has(j.jobCode)} onChange={() => toggleJob(v.vendor, j.jobCode)} style={{ marginTop: 2 }} />
                                        <span><span style={{ color: "#9CA3AF" }}>{j.seq}.</span> {j.name} <span style={{ color: "#B8C4BC" }}>{j.jobCode}</span></span>
                                      </label>
                                    ))}
                                  </div>
                                )
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}</tbody>
              </table>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button onClick={onClose} style={{ ...inp, background: "#fff", cursor: "pointer" }}>ยกเลิก</button>
              <button disabled={busy} onClick={() => void create()} style={{ ...mitr, padding: "8px 16px", borderRadius: 8, border: "none", background: "#1B8C4B", color: "#fff", fontWeight: 600, cursor: "pointer", opacity: busy ? .6 : 1 }}>สร้างลิงก์</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button onClick={() => copy(created.map(lineText).join("\n\n"))} style={{ ...mitr, display: "inline-flex", gap: 6, alignItems: "center", padding: "8px 14px", borderRadius: 8, border: "none", background: "#1B8C4B", color: "#fff", fontWeight: 600, cursor: "pointer" }}><Copy size={14} /> คัดลอกข้อความ LINE ทั้งหมด</button>
              <Link href="/rfq" style={{ ...inp, textDecoration: "none", color: "#14271C" }}>ไปหน้าใบขอราคาอู่</Link>
            </div>
            {created.map((c) => (
              <div key={c.id} style={{ border: "1px solid #E5E7EB", borderRadius: 10, padding: 10, marginBottom: 8 }}>
                <div style={{ fontWeight: 600 }}>{c.vendor}</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                  <code style={{ fontSize: 12, background: "#F6FAF7", padding: "4px 8px", borderRadius: 6, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.url}</code>
                  <button onClick={() => copy(c.url)} style={{ ...inp, cursor: "pointer" }}>ลิงก์</button>
                  <button onClick={() => copy(lineText(c))} style={{ ...inp, cursor: "pointer" }}>ข้อความ LINE</button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
