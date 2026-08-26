"use client"

// ตารางความสามารถอู่ — แถว = อู่ · คอลัมน์ = ประเภทการซ่อม (ยานยนต์) S30–S101
// จัดซื้อติ๊กว่าอู่ไหนทำงานประเภทไหนได้ ติ๊กแล้วบันทึกทันทีทีละช่อง
//
// ในช่องมีตัวเลขประวัติจาง ๆ = จำนวนครั้งที่อู่นี้เคยทำงานกลุ่มนั้นจริงจากใบรับของ
// ให้ติ๊กโดยมีหลักฐาน ไม่ใช่ติ๊กจากความจำ · คอลัมน์ "อู่ใน" ไม่มีตัวเลขเพราะเป็น
// ช่างในบริษัท ไม่ได้จ้าง vendor (ดู historyApplies ใน lib/vendor-core)
import { useMemo, useState } from "react"
import { useSession } from "next-auth/react"
import { Search } from "lucide-react"
import { MultiSelectCombobox } from "@/components/multi-select-combobox"
import { swalError, swalToast } from "@/lib/swal"
import { REPAIR_TYPES, GROUP_LABEL, type RepairGroup, type RepairTypeRow } from "@/lib/repair-type-master"
import { WORKS_OF_SERVICE, type VendorSummary } from "@/lib/vendor-core"
import { baht, num, ymThai, mitr, useVendors, VendorShell } from "@/components/vendor-shared"

const GROUP_ORDER: RepairGroup[] = ["CM", "PM", "T", "ทำความสะอาด", "แย็กโม่", "AC", "OTH"]

const STATUS_META: Record<VendorSummary["status"], { th: string; bg: string; fg: string }> = {
  approved: { th: "อนุมัติ",   bg: "#ECFDF5", fg: "#047857" },
  rejected: { th: "ไม่อนุมัติ", bg: "#FEF2F2", fg: "#B91C1C" },
  pending:  { th: "รอพิจารณา",  bg: "#F4F4F5", fg: "#52525B" },
}

/** ประวัติของอู่รายนี้ต่อ "งาน" ตามทะเบียน — ประเภทฝั่งจัดซื้อ 1 ตัวจับได้หลายงาน
 *  (เช่น "ระบบยาง" ครอบ 5 งานย่อย) ตัวเลขจึงเป็นระดับกลุ่มงาน ไม่ใช่รายงานย่อย */
function historyByWork(v: VendorSummary): Map<string, number> {
  const out = new Map<string, number>()
  for (const d of v.didTypes) {
    for (const w of WORKS_OF_SERVICE[d.serviceType] ?? []) {
      out.set(w, (out.get(w) ?? 0) + d.jobs)
    }
  }
  return out
}

export function VendorMatrixPage() {
  const { data, loading, error, reload } = useVendors()
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "admin"
  const [q, setQ] = useState("")
  const [groups, setGroups] = useState<RepairGroup[]>([])
  const [whs, setWhs] = useState<string[]>([])
  const [pickedCodes, setPickedCodes] = useState<string[]>([])
  const [outsideOnly, setOutsideOnly] = useState(true)
  const [tickedOnly, setTickedOnly] = useState(false)
  const [saving, setSaving] = useState("")
  // ทับผลที่เพิ่งติ๊กบนข้อมูลเดิม จะได้ไม่ต้องโหลดทั้งหน้าใหม่ทุกคลิก
  const [patched, setPatched] = useState<Record<string, string[]>>({})

  // ตัวเลือกในช่องกรองประเภทงาน — โชว์เฉพาะฝั่งที่กำลังแสดงอยู่ จะได้ไม่เลือกคอลัมน์
  // ที่ถูกสวิตช์ "เฉพาะอู่นอก" ซ่อนไว้แล้วงงว่าทำไมไม่ขึ้น
  const codeOptions = useMemo(() => {
    const out: Record<string, { th: string; en: string }> = {}
    for (const r of REPAIR_TYPES) {
      if (outsideOnly && r.side !== "อู่นอก") continue
      out[r.code] = { th: r.label, en: r.code }
    }
    return out
  }, [outsideOnly])

  const cols: RepairTypeRow[] = useMemo(() => {
    const g = groups.length ? new Set(groups) : null
    const picked = pickedCodes.length ? new Set(pickedCodes) : null
    return REPAIR_TYPES
      .filter((r) =>
        (!outsideOnly || r.side === "อู่นอก") &&
        // เลือกประเภทเจาะจงแล้ว ให้ตัวนั้นชนะตัวกรองหมวด — คนเลือกเจาะจงย่อมตั้งใจกว่า
        (picked ? picked.has(r.code) : !g || g.has(r.group)))
      .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
  }, [groups, outsideOnly, pickedCodes])

  const rows = useMemo(() => {
    if (!data) return []
    const rx = q.trim() ? new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null
    const w = whs.length ? new Set(whs) : null
    return data.vendors
      .map((v) => ({ ...v, codes: patched[v.vendor] ?? v.codes }))
      .filter((v) =>
        (!rx || rx.test(v.vendor)) &&
        (!tickedOnly || v.codes.length > 0) &&
        // อู่รายเดียวรับงานได้หลายคลัง เลือกคลังไหนก็ให้ติดมาถ้ามีงานที่คลังนั้น
        (!w || v.warehouses.some((x) => w.has(x))))
  }, [data, q, tickedOnly, patched, whs])

  /** คลังทั้งหมดที่พบในข้อมูลจริง — ไม่ hardcode เผื่อขอบเขตเปลี่ยน */
  const allWarehouses = useMemo(
    () => [...new Set((data?.vendors ?? []).flatMap((v) => v.warehouses))].sort(),
    [data]
  )

  const totalTicked = rows.reduce((a, v) => a + v.codes.length, 0)

  async function toggle(v: { vendor: string; codes: string[] }, code: string) {
    const on = !v.codes.includes(code)
    const key = `${v.vendor}|${code}`
    setSaving(key)
    // ติ๊กให้เห็นก่อนเลย แล้วค่อยถอยกลับถ้าบันทึกไม่ผ่าน — ตารางนี้คลิกรัว ๆ
    const next = on ? [...v.codes, code] : v.codes.filter((c) => c !== code)
    setPatched((p) => ({ ...p, [v.vendor]: next }))
    try {
      const r = await fetch("/api/vendors/capability", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor: v.vendor, code, on }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error ?? "บันทึกไม่สำเร็จ")
    } catch (e) {
      setPatched((p) => ({ ...p, [v.vendor]: v.codes }))
      swalError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving("")
    }
  }

  async function setStatus(vendor: string, status: VendorSummary["status"]) {
    try {
      const r = await fetch("/api/vendors/approval", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor, status }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error ?? "บันทึกไม่สำเร็จ")
      swalToast("success", "บันทึกแล้ว")
      reload()
    } catch (e) {
      swalError(e instanceof Error ? e.message : String(e))
    }
  }

  const TH = { position: "sticky" as const, top: 0, zIndex: 2, background: "#F9FAFB" }
  const NAMECOL = { position: "sticky" as const, left: 0, zIndex: 1, background: "#fff" }

  return (
    <VendorShell
      title="อู่ทั้งหมด — ตารางความสามารถ"
      subtitle="จัดซื้อติ๊กว่าอู่ไหนทำงานประเภทไหนได้ · ตัวเลขจาง ๆ ในช่องคือจำนวนครั้งที่เคยทำจริง"
      data={data} loading={loading} error={error} reload={reload}
    >
      {data && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
            <div style={{ position: "relative" }}>
              <Search size={14} style={{ position: "absolute", left: 10, top: 10, color: "#9CA3AF" }} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ค้นหาชื่ออู่"
                style={{ ...mitr, padding: "8px 12px 8px 30px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, width: 240 }}
              />
            </div>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}
              title="อู่ในคือช่างในบริษัท ไม่ได้จ้าง vendor จึงซ่อนไว้ก่อน">
              <input type="checkbox" checked={outsideOnly} onChange={(e) => setOutsideOnly(e.target.checked)} />
              เฉพาะคอลัมน์อู่นอก
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
              <input type="checkbox" checked={tickedOnly} onChange={(e) => setTickedOnly(e.target.checked)} />
              เฉพาะอู่ที่ติ๊กแล้ว
            </label>
            <span style={{ fontSize: 12, color: "#9AA8A0" }}>
              {num(rows.length)} อู่ · {cols.length} คอลัมน์ · ติ๊กแล้ว {num(totalTicked)} ช่อง
            </span>
            {!isAdmin && <span style={{ fontSize: 11.5, color: "#9AA8A0" }}>· ดูได้อย่างเดียว</span>}
          </div>

          {/* กรองคลัง — อู่แต่ละพื้นที่คนละชุดกัน จัดซื้อที่ดูแลคนละคลังจะได้ไม่ต้องเลื่อนผ่านอู่ที่ไม่เกี่ยว */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>คลัง:</span>
            {allWarehouses.map((w) => {
              const on = whs.includes(w)
              return (
                <button
                  key={w}
                  onClick={() => setWhs((c) => (on ? c.filter((x) => x !== w) : [...c, w]))}
                  style={{
                    padding: "5px 11px", borderRadius: 999, fontSize: 12, cursor: "pointer",
                    border: on ? "1px solid #0E7490" : "1px solid #E5E7EB",
                    background: on ? "#0E7490" : "#fff", color: on ? "#fff" : "#374151",
                    fontWeight: on ? 700 : 500,
                  }}
                >
                  {w.replace(/^คลัง/, "")}
                </button>
              )
            })}
            {whs.length > 0 && (
              <button onClick={() => setWhs([])}
                style={{ padding: "5px 11px", borderRadius: 999, fontSize: 12, cursor: "pointer", border: "1px solid #E5E7EB", background: "#fff" }}>
                ล้าง
              </button>
            )}
          </div>

          {/* กรองประเภทงานเจาะจง — เลือกได้หลายตัว ใช้ตอนอยากเทียบแค่ 2-3 ประเภท
              ไม่ต้องเลื่อนผ่านคอลัมน์ที่ไม่เกี่ยว · เลือกแล้วจะชนะตัวกรองหมวดด้านล่าง */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#6B7280", fontWeight: 600, whiteSpace: "nowrap" }}>ประเภทงานซ่อม:</span>
            <div style={{ minWidth: 320, flex: "1 1 320px", maxWidth: 620 }}>
              <MultiSelectCombobox
                options={codeOptions}
                values={pickedCodes}
                onChange={setPickedCodes}
                placeholder="— ทุกประเภท (เลือกเจาะจงได้หลายตัว) —"
              />
            </div>
            {pickedCodes.length > 0 && (
              <span style={{ fontSize: 11.5, color: "#9AA8A0" }}>เลือก {pickedCodes.length} ประเภท · ตัวกรองหมวดถูกข้าม</span>
            )}
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12, alignItems: "center", opacity: pickedCodes.length ? 0.45 : 1 }}>
            <span style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>หมวด:</span>
            {GROUP_ORDER.map((g) => {
              const on = groups.includes(g)
              return (
                <button
                  key={g}
                  onClick={() => setGroups((c) => (on ? c.filter((x) => x !== g) : [...c, g]))}
                  style={{
                    padding: "5px 11px", borderRadius: 999, fontSize: 12, cursor: "pointer",
                    border: on ? "1px solid #1B8C4B" : "1px solid #E5E7EB",
                    background: on ? "#1B8C4B" : "#fff", color: on ? "#fff" : "#374151",
                    fontWeight: on ? 700 : 500,
                  }}
                >
                  {g} · {GROUP_LABEL[g]}
                </button>
              )
            })}
            {groups.length > 0 && (
              <button onClick={() => setGroups([])}
                style={{ padding: "5px 11px", borderRadius: 999, fontSize: 12, cursor: "pointer", border: "1px solid #E5E7EB", background: "#fff" }}>
                ล้าง
              </button>
            )}
          </div>

          <div style={{ overflow: "auto", maxHeight: "72vh", border: "1px solid #E5E7EB", borderRadius: 12, background: "#fff" }}>
            <table style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th style={{
                    ...TH, ...NAMECOL, zIndex: 3, minWidth: 240, textAlign: "left",
                    padding: "8px 12px", fontWeight: 700, color: "#374151",
                    borderBottom: "1px solid #E5E7EB", borderRight: "1px solid #E5E7EB",
                  }}>
                    อู่ ({num(rows.length)})
                  </th>
                  <th style={{ ...TH, padding: "8px 10px", borderBottom: "1px solid #E5E7EB", borderRight: "1px solid #E5E7EB", whiteSpace: "nowrap" }}>
                    สถานะ
                  </th>
                  {cols.map((c) => (
                    <th
                      key={c.code}
                      title={`${c.code} · ${c.label}${c.repairType ? `\nrepair_type: ${c.repairType}` : ""}`}
                      style={{
                        ...TH, borderBottom: "1px solid #E5E7EB", padding: "6px 2px",
                        minWidth: 34, width: 34,
                      }}
                    >
                      {/* หัวคอลัมน์ตะแคง — 72 ประเภท ถ้าวางแนวนอนตารางจะกว้างจนเลื่อนไม่ไหว */}
                      <div style={{
                        writingMode: "vertical-rl", transform: "rotate(180deg)",
                        whiteSpace: "nowrap", fontSize: 11, fontWeight: 600, color: "#374151",
                        height: 168, margin: "0 auto", textAlign: "right",
                      }}>
                        {c.work} <span style={{ color: "#9AA8A0", fontWeight: 400 }}>{c.code}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => {
                  const hist = historyByWork(v)
                  const m = STATUS_META[v.status]
                  const ticked = new Set(v.codes)
                  return (
                    <tr key={v.vendor}>
                      <td
                        title={`${num(v.jobs)} ครั้ง · ${baht(v.baht)} · ล่าสุด ${ymThai(v.lastYm)}`}
                        style={{
                          ...NAMECOL, minWidth: 240, maxWidth: 300, padding: "6px 12px",
                          borderBottom: "1px solid #F3F4F6", borderRight: "1px solid #E5E7EB",
                          fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}
                      >
                        {v.vendor}
                        <span style={{ display: "block", fontSize: 10.5, color: "#9AA8A0", fontWeight: 400 }}>
                          {num(v.jobs)} ครั้ง · {ymThai(v.lastYm)}
                        </span>
                      </td>
                      <td style={{ padding: "6px 8px", borderBottom: "1px solid #F3F4F6", borderRight: "1px solid #E5E7EB" }}>
                        <select
                          value={v.status}
                          disabled={!isAdmin}
                          onChange={(e) => void setStatus(v.vendor, e.target.value as VendorSummary["status"])}
                          style={{
                            ...mitr, fontSize: 11, padding: "3px 6px", borderRadius: 6,
                            border: "1px solid #E5E7EB", background: m.bg, color: m.fg, fontWeight: 700,
                            cursor: isAdmin ? "pointer" : "not-allowed",
                          }}
                        >
                          {(["pending", "approved", "rejected"] as const).map((s) => (
                            <option key={s} value={s}>{STATUS_META[s].th}</option>
                          ))}
                        </select>
                      </td>
                      {cols.map((c) => {
                        const on = ticked.has(c.code)
                        const n = c.side === "อู่นอก" ? (hist.get(c.work) ?? 0) : 0
                        const key = `${v.vendor}|${c.code}`
                        return (
                          <td
                            key={c.code}
                            title={
                              `${v.vendor}\n${c.code} · ${c.label}` +
                              (n > 0
                                ? `\n\nเคยทำงานกลุ่มนี้ ${num(n)} ครั้ง (จากใบรับของจริง)\nตัวเลขเป็นระดับกลุ่มงาน ต้นทางไม่ได้แยกงานย่อยละเอียดเท่าทะเบียน`
                                : c.side === "อู่ใน" ? "\n\nอู่ใน = ช่างในบริษัท ไม่มีประวัติการจ้าง" : "\n\nยังไม่เคยมีประวัติงานกลุ่มนี้")
                            }
                            onClick={() => isAdmin && !saving && toggle(v, c.code)}
                            style={{
                              textAlign: "center", padding: 0, width: 34, minWidth: 34,
                              borderBottom: "1px solid #F3F4F6",
                              background: on ? "#E7F6EC" : n > 0 ? "#FCFDFC" : "#fff",
                              cursor: isAdmin ? "pointer" : "default",
                              opacity: saving === key ? 0.4 : 1,
                            }}
                          >
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 38, gap: 1 }}>
                              <span style={{ fontSize: 14, lineHeight: 1, color: on ? "#1B8C4B" : "#D1D5DB", fontWeight: 700 }}>
                                {on ? "✓" : "·"}
                              </span>
                              {n > 0 && (
                                <span style={{ fontSize: 9, lineHeight: 1, color: on ? "#2F5D45" : "#B8C4BC" }}>
                                  {n > 999 ? "999+" : n}
                                </span>
                              )}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={cols.length + 2} style={{ padding: 40, textAlign: "center", color: "#9CA3AF" }}>
                      ไม่มีอู่ที่ตรงเงื่อนไข
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p style={{ fontSize: 11.5, color: "#9AA8A0", marginTop: 10 }}>
            คอลัมน์เรียงตามหมวด CM → PM → T → ทำความสะอาด → แย็กโม่ → AC → OTH ·
            ชี้ที่หัวคอลัมน์เพื่อดูรหัสและชื่อเต็ม · ชี้ที่ช่องเพื่อดูที่มาของตัวเลขประวัติ
          </p>
        </>
      )}
    </VendorShell>
  )
}
