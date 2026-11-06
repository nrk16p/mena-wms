"use client"

/**
 * ใบขอความเห็นชอบอนุมัติเปลี่ยนยาง — หน้ารายรถ + หน้าสรุปพร้อมช่องลงนาม
 * หน้าตาเดียวกับเอกสารพิมพ์ของ menait-service (lib/finance/printShared.ts): แถบเขียวน้ำทะเล หัวเอกสาร + กล่องเลขที่
 * หัวข้อมีเลข ตารางหัวเขียวอ่อน ตารางลงนาม และ Document Control ท้ายหน้า
 * ยางที่เคยใช้มาก่อน ขึ้นทุกรอบที่เคยใช้ใต้แถวนั้นเสมอ พร้อมบาท/กม. รวมทุกรอบเทียบมาตรฐาน
 * พิมพ์ / บันทึก PDF ด้วยปุ่มพิมพ์ของเบราว์เซอร์ (A4)
 */
import { useEffect, useState } from "react"
import { Printer } from "lucide-react"
import { fmtDate, type LifeSummary } from "@/lib/tyre-sheet"
import { splitPosition } from "@/lib/tire"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Report = Record<string, any>

const LOGO = "/brand/mena-logo.svg"
const INK = "#17272B"
const TEAL = "#055058"
const MINT = "#EAF4F1"
const LINE = "#C7D3D0"
const MUTED = "#5E6E71"
const WORSE = "#b45309" // ส้ม = แย่กว่าเกณฑ์
const BETTER = "#0B6E75" // เขียวน้ำทะเล = ดีกว่าเกณฑ์
const DOC_NAME = "ใบขอความเห็นชอบอนุมัติเปลี่ยนยาง"
const DOC_OWNER = "ฝ่ายยานยนต์ · แผนกยาง สระบุรี"

const money = (n: number) => (n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const int = (n: number | null | undefined) => (n === null || n === undefined ? "-" : Math.round(n).toLocaleString("th-TH"))
const cpk = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "-" : n.toFixed(3))
/** "0 ปี 1 เดือน 6 วัน" → "1 ด. 6 ว." */
const shortAge = (s: string) =>
  String(s ?? "").replace(/^0 ปี\s*/, "").replace(/ ปี/g, " ป.").replace(/ เดือน/g, " ด.").replace(/ วัน/g, " ว.").trim() || "-"

function DocHead({ title, sub, pr, round, page, pages }: { title: string; sub: string; pr: string; round: string; page: number; pages: number }) {
  return (
    <header className="grid items-center gap-3.5" style={{ gridTemplateColumns: "auto 1fr auto" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={LOGO} alt="Mena Transport" className="h-[44px] w-auto" />
      <div>
        <div className="text-[21px] font-bold leading-tight" style={{ color: TEAL }}>{title}</div>
        <div className="text-[12px] font-semibold" style={{ color: MUTED }}>{sub}</div>
      </div>
      <div className="min-w-[58mm] rounded-[3px] text-[10.5px]" style={{ border: `1px solid ${TEAL}` }}>
        {[["เลขที่ PR", pr || "-"], ["รอบอนุมัติ", round || "-"], ["หน้า", `${page} / ${pages}`]].map(([k, v], i) => (
          <div key={k} className="flex justify-between gap-3 px-2 py-[3px]" style={i ? { borderTop: `1px solid ${LINE}` } : undefined}>
            <span style={{ color: MUTED }}>{k}</span><b className="font-semibold">{v}</b>
          </div>
        ))}
      </div>
    </header>
  )
}

function Sec({ n, title, en }: { n: number; title: string; en?: string }) {
  return (
    <div className="mb-1.5 mt-1 flex items-center gap-2">
      <span className="grid h-[19px] w-[19px] flex-none place-items-center rounded-[3px] text-[11px] font-bold text-white" style={{ background: TEAL }}>{n}</span>
      <h2 className="m-0 whitespace-nowrap text-[13px] font-bold">{title}</h2>
      {en && <small className="whitespace-nowrap text-[10px] font-medium" style={{ color: MUTED }}>{en}</small>}
      <span className="ml-1 flex-1" style={{ borderTop: `1px solid ${LINE}` }} />
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 pb-0.5" style={{ borderBottom: `1px solid ${LINE}` }}>
      <span className="block text-[9.5px]" style={{ color: MUTED }}>{label}</span>
      <span className="block min-h-[18px] truncate text-[12.5px] font-medium">{value || "-"}</span>
    </div>
  )
}

/** Document Control & Revision History แบบเดียวกับ menait-service */
function DocControl({ pr, approvedBy, printed }: { pr: string; approvedBy: string; printed: string }) {
  const td = { border: `1px solid ${LINE}`, padding: "2px 6px" }
  const lb = { ...td, background: MINT, color: TEAL, fontWeight: 600 }
  return (
    <footer className="mt-auto pt-3">
      <table className="w-full border-collapse text-left text-[8.5px] leading-[1.3]">
        <thead><tr><th colSpan={6} className="text-center font-semibold text-white" style={{ ...td, background: TEAL }}>Document Control &amp; Revision History</th></tr></thead>
        <tbody>
          <tr><td style={{ ...lb, width: "15%" }}>Document Ref</td><td style={{ ...td, width: "33%" }}>{pr || " "}</td><td style={{ ...lb, width: "15%" }}>Document Name</td><td colSpan={3} style={td}>{DOC_NAME}</td></tr>
          <tr><td style={lb}>Document Owner</td><td style={td}>{DOC_OWNER}</td><td style={lb}>Version No</td><td style={{ ...td, width: "8%" }}>01</td><td style={{ ...lb, width: "14%" }}>Revision Date</td><td style={{ ...td, width: "13%" }}> </td></tr>
          <tr><td style={lb}>Approved By</td><td style={td}>{approvedBy || " "}</td><td style={lb}>Approved Date</td><td style={td}> </td><td style={lb}>Printed</td><td style={td}>{printed}</td></tr>
        </tbody>
      </table>
    </footer>
  )
}

/** ตารางเล็กใต้แถว: ทุกรอบที่ยางเส้นนี้เคยใช้ + สูตรบาท/กม. รวมทุกรอบเทียบมาตรฐาน */
function LivesBlock({ s }: { s: LifeSummary }) {
  const price = s.price ?? 0
  const worse = s.cpkTotal !== null && s.cpkStandard !== null ? s.cpkTotal > s.cpkStandard : null
  const pctDiff = s.cpkTotal !== null && s.cpkStandard ? Math.abs(s.cpkTotal / s.cpkStandard - 1) * 100 : null
  const rated = s.ratedKm
  const th = { color: TEAL, fontWeight: 600, padding: "1px 6px", textAlign: "left" as const, borderBottom: `1px solid ${LINE}` }
  const td = { padding: "1px 6px", verticalAlign: "top" as const }
  return (
    <div className="px-2.5 py-1.5 text-[10px]" style={{ background: MINT, borderLeft: `3px solid ${TEAL}` }}>
      <div className="mb-0.5 text-[10.5px] font-bold" style={{ color: TEAL }}>ยางเส้นนี้เคยใช้มาแล้ว {s.lives.length} รอบ</div>
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          {[15, 11, 17, 15, 24, 10, 8].map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}
        </colgroup>
        <thead>
          <tr>
            <th style={th}>รอบ</th><th style={th}>วันที่จอง</th><th style={th}>รถ / ตำแหน่ง</th><th style={th}>ใบแจ้งซ่อม</th>
            <th style={th}>อาการ</th><th style={{ ...th, textAlign: "right" }}>ระยะใช้ (กม.)</th><th style={{ ...th, textAlign: "right" }}>ดอก</th>
          </tr>
        </thead>
        <tbody>
          {s.lives.map((l, i) => {
            const pos = splitPosition(l.position)
            return (
              <tr key={i} className={l.isCurrent ? "font-semibold" : ""}>
                <td style={td}>รอบที่ {i + 1}{l.isCurrent ? " ครั้งนี้" : ""}</td>
                <td style={td}>{fmtDate(l.bookingDate) || "-"}</td>
                <td style={td}>{l.plate} {pos.code || l.position}</td>
                <td style={td}>{l.mrNo || "-"}</td>
                <td style={td} className="break-words">{[l.symptom, l.spare].filter(Boolean).join(" · ") || "-"}</td>
                <td style={{ ...td, textAlign: "right" }}>{int(l.km)}</td>
                <td style={{ ...td, textAlign: "right" }}>{l.depthFrom !== null && l.depthTo !== null ? `${l.depthFrom}→${l.depthTo}` : ""}</td>
              </tr>
            )
          })}
          <tr className="font-bold" style={{ borderTop: `1px solid ${LINE}` }}>
            <td style={td} colSpan={5}>รวม {s.lives.length} รอบ</td>
            <td style={{ ...td, textAlign: "right" }}>{int(s.totalKm)} กม.</td>
            <td />
          </tr>
        </tbody>
      </table>
      <div className="mt-1 grid gap-x-2 text-[10.5px]" style={{ gridTemplateColumns: "auto auto 1fr" }}>
        <span style={{ color: MUTED }}>ค่ายางจริง</span>
        <span>{money(price)} ÷ {int(s.totalKm)} กม. = <b style={{ color: worse === null ? INK : worse ? WORSE : BETTER }}>{cpk(s.cpkTotal)}</b> บาท/กม.</span>
        <span />
        <span style={{ color: MUTED }}>มาตรฐาน</span>
        <span>{money(price)} ÷ {int(rated)} กม. = <b>{cpk(s.cpkStandard)}</b> บาท/กม.</span>
        <span className="font-semibold" style={{ color: worse ? WORSE : BETTER }}>
          {worse !== null && pctDiff !== null ? `→ ${worse ? "แพงกว่า" : "ถูกกว่า"}มาตรฐาน ${pctDiff.toFixed(0)}%` : ""}
        </span>
      </div>
    </div>
  )
}

const TH = "tp-th"
const TD = "tp-td"

export function RoundPrint({ id }: { id: string }) {
  const [data, setData] = useState<Report | null>(null)
  const [err, setErr] = useState("")

  // หน้าพิมพ์ต้องพื้นขาวเสมอ — ธีมมืดของ WMS บังคับ bg-white เป็นสีเข้ม (!important)
  useEffect(() => {
    const html = document.documentElement
    const wasDark = html.classList.contains("dark")
    html.classList.remove("dark")
    return () => { if (wasDark) html.classList.add("dark") }
  }, [])

  useEffect(() => {
    fetch(`/api/tyre-sheet/rounds/${id}/report`)
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error ?? "โหลดไม่สำเร็จ"); setData(d) })
      .catch((e) => setErr(String(e.message ?? e)))
  }, [id])

  if (err) return <div className="p-10 text-red-600">{err}</div>
  if (!data) return <div className="p-10 text-gray-500">กำลังโหลด…</div>

  const docs: Report[] = data.documents ?? []
  const overall = data.overallSummary ?? {}
  const t = overall.tire
  const pages = docs.length + 1
  const at = String(data.generatedAt ?? "")
  const vehicles: Report[] = overall.vehicles ?? []
  const good = vehicles.reduce((a, v) => a + (v.tiregood || 0), 0)
  const bad = vehicles.reduce((a, v) => a + (v.tiredefect || 0), 0)
  const dash = (n: number, f: (n: number) => string) => (n ? f(n) : "–")
  const pageCls = "pdf-page relative mx-auto mb-8 flex flex-col gap-2.5 bg-white px-[14mm] pb-[8mm] pt-[11mm] shadow"
  const pageStyle = { width: "210mm", minHeight: "297mm" }
  const band = <div className="absolute inset-x-0 top-0 h-[5mm]" style={{ background: TEAL }} />
  const sumRow = { background: MINT, borderTop: `1.5px solid ${TEAL}` }

  return (
    <div className="tyre-print min-h-full bg-[#e5e7eb] py-6" style={{ color: INK, fontFamily: "'IBM Plex Sans Thai', 'Noto Sans Thai', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap');
        @page { size: A4 portrait; margin: 0; }
        .tyre-print .pdf-page { font-size: 11.5px; line-height: 1.42; font-variant-numeric: tabular-nums; }
        .tyre-print table.tp { width: 100%; border-collapse: collapse; }
        .tyre-print .tp-th { background: ${MINT}; color: ${TEAL}; font-size: 9.5px; font-weight: 600; line-height: 1.25; padding: 3px 4px; border: 1px solid ${LINE}; vertical-align: middle; }
        .tyre-print .tp-td { border-left: 1px solid ${LINE}; border-right: 1px solid ${LINE}; border-bottom: 1px dotted #A9B8B5; padding: 3px 4px; font-size: 10.5px; line-height: 1.3; vertical-align: top; }
        .tyre-print .tp-sum td { border: 1px solid ${LINE}; font-weight: 700; padding: 4px; font-size: 10.5px; }
        @media print {
          html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
          .tyre-print { background: #fff !important; padding: 0 !important; }
          .no-print { display: none !important; }
          .pdf-page { box-shadow: none !important; margin: 0 !important; height: 297mm !important; min-height: 297mm !important; overflow: hidden; break-after: page; }
          .pdf-page:last-child { break-after: auto; }
          tr { break-inside: avoid; }
          * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        }
      `}</style>

      <div className="no-print fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
        <div className="rounded bg-white px-3 py-2 text-xs text-gray-600 shadow">ปลายทางเลือก “บันทึกเป็น PDF” · กระดาษ A4 · เปิด “กราฟิกพื้นหลัง”</div>
        <button onClick={() => window.print()} className="flex items-center gap-2 rounded-lg px-6 py-3 font-semibold text-white shadow-lg" style={{ background: TEAL }}>
          <Printer className="h-5 w-5" /> พิมพ์ / บันทึก PDF
        </button>
      </div>

      {docs.map((doc, index) => {
        const summary = doc.summary ?? {}
        const header = doc.header ?? {}
        const items: Report[] = doc.items ?? []
        const avgBpk = summary.count ? summary.totalBpk / summary.count : 0
        const truck = items.find((x) => x.typeTruck)?.typeTruck
        return (
          <div key={`${header.docNo}-${index}`} className={pageCls} style={pageStyle}>
            {band}
            <DocHead title={DOC_NAME} sub="(Tyre Replacement Approval Request)" pr={data.docPR} round={data.approvalRound} page={index + 1} pages={pages} />

            <div>
              <Sec n={1} title="ข้อมูลรถ" en="Vehicle" />
              <div className="grid grid-cols-3 gap-x-5 gap-y-1.5">
                <Field label="ทะเบียนรถ" value={<>{header.plate || "-"}{truck && <span style={{ color: MUTED }}> ({truck})</span>}</>} />
                <Field label="ใบแจ้งซ่อม" value={header.docNo} />
                <Field label="วันที่จอง" value={header.bookingDate} />
                <Field label="ลูกค้า" value={header.customer} />
                <Field label="พนักงานขับรถ" value={header.employee} />
                <Field label="ผู้ขออนุมัติ" value={data.approver1} />
              </div>
            </div>

            <div>
              <Sec n={2} title={`รายการยางที่ขออนุมัติเปลี่ยน · ${items.length} เส้น`} en="Tyres" />
              <table className="tp table-fixed">
                <colgroup>
                  {[4, 13, 17, 11, 14, 7, 9, 11, 14].map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}
                </colgroup>
                <thead>
                  <tr>
                    <th className={`${TH} text-center`}>#</th>
                    <th className={`${TH} text-left`}>ตำแหน่ง</th>
                    <th className={`${TH} text-left`}>ยี่ห้อ / เบอร์ยาง</th>
                    <th className={`${TH} text-left`}>ใส่เมื่อ · อายุ</th>
                    <th className={`${TH} text-right`}>ระยะใช้ / กำหนด (กม.)</th>
                    <th className={`${TH} text-right`}>ดอก (มม.)</th>
                    <th className={`${TH} text-right`}>ราคา (บ.)</th>
                    <th className={`${TH} text-right`}>บาท/กม. จริง / มาตรฐาน</th>
                    <th className={`${TH} text-left`}>อาการ · ยางสำรอง</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => {
                    const pos = splitPosition(item.position || "")
                    const mDiff = item.mileageDiff || 0
                    const mColor = mDiff > 0 ? BETTER : mDiff < 0 ? WORSE : MUTED
                    const dDiff = item.depthDiff || 0
                    const bpkWorse = (item.bpk || 0) > (item.bline || 0)
                    const multi = (item.lives?.lives?.length ?? 0) > 1
                    const [brand, ...rest] = [item.brand, ...String(item.tireCode || "-").split(" ")]
                    return [
                      <tr key={item.id}>
                        <td className={`${TD} text-center font-bold`}>{i + 1}</td>
                        <td className={TD}><b>{pos.code || "-"}</b><br />{pos.name || item.position || ""}</td>
                        <td className={`${TD} break-words`}>{brand || "-"}<br /><b>{rest[0]}</b> {rest.slice(1).join(" ")}</td>
                        <td className={TD}>{item.changeDate || "-"}<br />{shortAge(item.ageText)}</td>
                        <td className={`${TD} text-right`}>
                          <b>{int(item.actualMileage)}</b> / {int(item.targetMileage)}<br />
                          <span className="font-semibold" style={{ color: mColor }}>{item.mileageStatus || ""}</span>
                        </td>
                        <td className={`${TD} text-right`}>
                          <b>{item.tireDepth ?? "-"}</b><br />
                          <span style={{ color: dDiff < 0 ? WORSE : BETTER }}>{item.depthStatus || ""}</span>
                        </td>
                        <td className={`${TD} text-right`}>{money(item.price)}</td>
                        <td className={`${TD} text-right`}>
                          <span className="font-bold" style={{ color: bpkWorse ? WORSE : BETTER }}>{cpk(item.bpk)}</span> / {cpk(item.bline)}
                          {multi && <><br /><span style={{ color: MUTED }}>เฉพาะครั้งนี้</span></>}
                        </td>
                        <td className={TD}>{item.status || "-"}<br /><span style={{ color: MUTED }}>สำรอง: {item.spare || "–"}</span></td>
                      </tr>,
                      multi ? (
                        <tr key={`${item.id}-lives`}>
                          <td colSpan={9} className={TD} style={{ padding: "2px 4px 4px" }}><LivesBlock s={item.lives} /></td>
                        </tr>
                      ) : null,
                    ]
                  })}
                  <tr className="tp-sum" style={sumRow}>
                    <td colSpan={6} className="text-right" style={{ color: TEAL }}>รวม {items.length} เส้น</td>
                    <td className="text-right">{money(summary.totalPrice)}</td>
                    <td className="text-right">เฉลี่ย {cpk(avgBpk)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>

            <div style={{ breakInside: "avoid" }}>
              <Sec n={3} title="หมายเหตุ" en="Remarks" />
              <div className="h-14 rounded-[3px]" style={{ border: `1px solid ${LINE}` }} />
              <div className="mt-1 text-[9.5px]" style={{ color: MUTED }}>
                บาท/กม. รวมทุกรอบ = ราคา ÷ ระยะรวมทุกรอบที่ใช้ · มาตรฐาน = ราคา ÷ ระยะกำหนด · สีส้ม = แย่กว่าเกณฑ์ สีเขียว = ดีกว่าเกณฑ์ · เอกสารมีผลเมื่ออนุมัติครบทุกลำดับ
              </div>
            </div>

            <DocControl pr={data.docPR} approvedBy={data.approver3} printed={at} />
          </div>
        )
      })}

      {/* หน้าสรุป + ลงนาม */}
      <div className={pageCls} style={pageStyle}>
        {band}
        <DocHead title="สรุปการขออนุมัติเปลี่ยนยาง" sub="(Approval Summary)" pr={data.docPR} round={data.approvalRound} page={pages} pages={pages} />

        <div className="grid grid-cols-4 gap-2.5">
          {[
            ["รถ (ใบแจ้งซ่อม)", int(overall.totalDocs || 0), "คัน", ""],
            ["ยางที่ขอเปลี่ยน", int(overall.totalTires || 0), "เส้น", overall.multiLifeTires ? `ใช้มาหลายรอบ ${overall.multiLifeTires} เส้น` : ""],
            ["บาท/กม. เฉลี่ย", cpk(overall.avgBpk || 0), "", "ทั้งรอบอนุมัติ"],
          ].map(([k, v, u, sub]) => (
            <div key={k} className="rounded-[3px] px-3 py-2" style={{ border: `1px solid ${TEAL}` }}>
              <div className="text-[10px]" style={{ color: MUTED }}>{k}</div>
              <div className="text-[22px] font-bold leading-tight" style={{ color: TEAL }}>{v} {u && <span className="text-[11px] font-medium">{u}</span>}</div>
              {sub && <div className="text-[10px]" style={{ color: MUTED }}>{sub}</div>}
            </div>
          ))}
          <div className="rounded-[3px] px-3 py-2 text-white" style={{ background: TEAL }}>
            <div className="text-[10px] opacity-85">มูลค่ารวม</div>
            <div className="text-right text-[22px] font-bold leading-tight">{money(overall.totalPrice)}<span className="ml-1 text-[11px] font-medium">บาท</span></div>
          </div>
        </div>

        {t && (
          <div>
            <Sec n={1} title="แยกตามชนิดยาง" en="By tyre type" />
            <table className="tp">
              <thead>
                <tr>
                  <th className={`${TH} text-left`}>ตำแหน่ง</th>
                  <th className={`${TH} text-left`}>ชนิดยาง</th>
                  <th className={`${TH} text-right`}>จำนวน (เส้น)</th>
                  <th className={`${TH} text-right`}>มูลค่า (บาท)</th>
                  <th className={`${TH} text-right`}>บาท/กม. เฉลี่ย</th>
                </tr>
              </thead>
              <tbody>
                {(["head", "tail"] as const).flatMap((part) =>
                  (["typeI", "typeII"] as const).map((k) => {
                    const p = t[part]?.[k] ?? { countTire: 0, cost: 0, avgBpk: 0 }
                    return (
                      <tr key={`${part}-${k}`} style={p.countTire ? undefined : { color: MUTED }}>
                        <td className={`${TD} font-semibold`}>{part === "head" ? "หัว" : "หาง"}</td>
                        <td className={TD}>{k === "typeI" ? "ยางนอก 11R22.5" : "ยางนอก 1000-20"}</td>
                        <td className={`${TD} text-right`}>{dash(p.countTire, (n) => n.toLocaleString("th-TH"))}</td>
                        <td className={`${TD} text-right`}>{dash(p.cost, money)}</td>
                        <td className={`${TD} text-right`}>{dash(p.avgBpk, (n) => n.toFixed(3))}</td>
                      </tr>
                    )
                  }),
                )}
              </tbody>
            </table>
          </div>
        )}

        <div>
          <Sec n={2} title="แยกตามรถ" en="By vehicle" />
          <table className="tp table-fixed">
            <colgroup>
              {[4, 11, 15, 11, 19, 6, 12, 12, 10].map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}
            </colgroup>
            <thead>
              <tr>
                <th className={`${TH} text-center`}>#</th>
                <th className={`${TH} text-left`}>ทะเบียน</th>
                <th className={`${TH} text-left`}>ใบแจ้งซ่อม</th>
                <th className={`${TH} text-left`}>วันที่จอง</th>
                <th className={`${TH} text-left`}>พนักงานขับรถ</th>
                <th className={`${TH} text-right`}>เส้น</th>
                <th className={`${TH} text-left`}>ปกติ / ไม่ปกติ</th>
                <th className={`${TH} text-right`}>มูลค่า (บ.)</th>
                <th className={`${TH} text-right`}>บาท/กม.</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v, i) => (
                <tr key={`${v.docNo}-${i}`}>
                  <td className={`${TD} text-center`}>{i + 1}</td>
                  <td className={TD}>{v.plate || "-"}</td>
                  <td className={TD}>{v.docNo || "-"}</td>
                  <td className={TD}>{v.bookingDate || "-"}</td>
                  <td className={`${TD} truncate`}>{v.employee || "-"}</td>
                  <td className={`${TD} text-right`}>{v.count || 0}</td>
                  <td className={TD}>{v.tiregood || 0} / {v.tiredefect ? <b style={{ color: WORSE }}>{v.tiredefect}</b> : 0}</td>
                  <td className={`${TD} text-right`}>{money(v.totalPrice)}</td>
                  <td className={`${TD} text-right`}>{cpk(v.avgBpk)}</td>
                </tr>
              ))}
              {!vehicles.length && <tr><td colSpan={9} className={`${TD} py-4 text-center`} style={{ color: MUTED }}>ไม่มีรถในรอบนี้</td></tr>}
              <tr className="tp-sum" style={sumRow}>
                <td colSpan={5} className="text-right" style={{ color: TEAL }}>รวมทั้งหมด</td>
                <td className="text-right">{overall.totalTires || 0}</td>
                <td>{good} / {bad}</td>
                <td className="text-right">{money(overall.totalPrice)}</td>
                <td className="text-right">{cpk(overall.avgBpk || 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{ breakInside: "avoid" }}>
          <Sec n={3} title="ลงนามอนุมัติ" en="Signatures" />
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr>
                {["ผู้จัดทำ", "ผู้อนุมัติ 1", "ผู้อนุมัติ 2"].map((r) => (
                  <th key={r} className="p-[5px] text-[11px] font-semibold" style={{ background: MINT, color: TEAL, border: `1px solid ${LINE}` }}>{r}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {[data.approver1, data.approver2, data.approver3].map((name, i) => (
                  <td key={i} className="px-2 pb-2 align-bottom" style={{ border: `1px solid ${LINE}` }}>
                    <div className="h-[17mm]" />
                    <div className="flex gap-1.5 text-[10px]" style={{ borderTop: `1px dotted ${MUTED}` }}><span style={{ color: MUTED }}>ชื่อ</span><i className="not-italic text-[11px] font-semibold">{name || ""}</i></div>
                    <div className="mt-1 flex gap-1.5 text-[10px]"><span style={{ color: MUTED }}>วันที่</span><span>......./......./...........</span></div>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        <DocControl pr={data.docPR} approvedBy={data.approver3} printed={at} />
      </div>
    </div>
  )
}
