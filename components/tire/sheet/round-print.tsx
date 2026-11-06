"use client"

/**
 * ใบขอความเห็นชอบอนุมัติเปลี่ยนยาง — หน้ารายรถ (แบบ A) + หน้าสรุปพร้อมช่องลงนาม (แบบ C)
 * แบบร่างอยู่ใน Claude Design: https://claude.ai/artifact/UvuyyMedGbimB2FEittm1r
 * ยางที่เคยใช้มาก่อน ขึ้นทุกชีวิตใต้แถวนั้นเสมอ พร้อมบาท/กม. รวมทุกชีวิตเทียบมาตรฐาน
 * พิมพ์ / บันทึก PDF ด้วยปุ่มพิมพ์ของเบราว์เซอร์ (A4)
 */
import { useEffect, useState } from "react"
import { Printer } from "lucide-react"
import { fmtDate, type LifeSummary } from "@/lib/tyre-sheet"
import { splitPosition } from "@/lib/tire"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Report = Record<string, any>

const LOGO = "/brand/mena-logo.svg"
const ACCENT = "#1e3a8a"
const WORSE = "#b45309" // ส้ม = แย่กว่าเกณฑ์
const BETTER = "#1d4ed8" // น้ำเงิน = ดีกว่าเกณฑ์ (ต่างกันทั้งสีและความเข้ม พิมพ์ขาวดำยังแยกได้)

const money = (n: number) => (n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const int = (n: number | null | undefined) => (n === null || n === undefined ? "-" : Math.round(n).toLocaleString("th-TH"))
const cpk = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "-" : n.toFixed(3))
/** "0 ปี 1 เดือน 6 วัน" → "1 ด. 6 ว." */
const shortAge = (s: string) =>
  String(s ?? "").replace(/^0 ปี\s*/, "").replace(/ ปี/g, " ป.").replace(/ เดือน/g, " ด.").replace(/ วัน/g, " ว.").trim() || "-"

function Header() {
  return (
    <header className="flex items-center justify-between pb-2.5" style={{ borderBottom: `2px solid ${ACCENT}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={LOGO} alt="Mena Transport" className="h-[46px] w-auto" />
      <div className="text-right">
        <div className="text-[15px] font-bold" style={{ color: ACCENT }}>บริษัท มีนาทรานสปอร์ต จำกัด (มหาชน)</div>
        <div className="text-[12px] text-[#4b5563]">MEENA TRANSPORT PUBLIC COMPANY LIMITED · ฝ่ายยานยนต์ แผนกยาง</div>
      </div>
    </header>
  )
}

function TitleRow({ title, pr, round, page, pages }: { title: string; pr: string; round: string; page: number; pages: number }) {
  return (
    <div className="flex items-end justify-between">
      <div>
        <h1 className="m-0 text-[21px] font-bold" style={{ color: ACCENT }}>{title}</h1>
        <div className="text-[13px] text-[#374151]">เลขที่ PR <b>{pr || "-"}</b> · รอบอนุมัติ {round || "-"}</div>
      </div>
      <div className="text-[13px] text-[#374151]">หน้า <b>{page}</b> / {pages}</div>
    </div>
  )
}

function Footer({ at }: { at: string }) {
  return (
    <footer className="mt-auto flex justify-between border-t border-[#d1d5db] pt-2 text-[#4b5563]">
      <span>พิมพ์จากระบบ WMS · ทะเบียนยางสระบุรี</span>
      <span>สร้างเมื่อ {at}</span>
    </footer>
  )
}

function Field({ label, value, big = false }: { label: string; value: React.ReactNode; big?: boolean }) {
  return (
    <div>
      <div className="text-[#4b5563]">{label}</div>
      <div className={big ? "text-[14px] font-bold" : "text-[13px] font-semibold"}>{value || "-"}</div>
    </div>
  )
}

/** กล่องเหลืองใต้แถว: ทุกชีวิตของยางเส้นนี้ + บาท/กม. รวมเทียบมาตรฐาน */
function LivesBlock({ s }: { s: LifeSummary }) {
  const worse = s.cpkTotal !== null && s.cpkStandard !== null ? s.cpkTotal > s.cpkStandard : null
  const pctDiff = s.cpkTotal !== null && s.cpkStandard ? Math.abs(s.cpkTotal / s.cpkStandard - 1) * 100 : null
  return (
    <div className="grid rounded-md border border-[#f59e0b] bg-[#fffbeb] px-2.5 py-2" style={{ gridTemplateColumns: "minmax(0,1fr) 150px", columnGap: 12 }}>
      <div className="flex flex-col gap-1">
        <div className="font-bold text-[#78350f]">
          เส้นนี้ใช้มาแล้ว {s.lives.length} ชีวิต · รวม {int(s.totalKm)} กม.
          {s.pctOfRated !== null ? ` (${(s.pctOfRated * 100).toFixed(0)}% ของระยะกำหนด)` : ""}
          {s.depthUsedTotal !== null ? ` · ดอกใช้ไป ${s.depthUsedTotal}${s.fullDepth ? `/${s.fullDepth}` : ""} มม.` : ""}
        </div>
        <div className="grid text-[#451a03]" style={{ gridTemplateColumns: "auto 66px minmax(0,1fr) auto auto", columnGap: 8 }}>
          {s.lives.map((l, i) => {
            const pos = splitPosition(l.position)
            const extra = [l.mrNo, l.symptom, l.spare].filter(Boolean).join(" · ")
            return [
              <span key={`a${i}`} className={l.isCurrent ? "font-bold" : "font-semibold"}>ชีวิตที่ {i + 1}{l.isCurrent ? " · รอบนี้" : ""}</span>,
              <span key={`b${i}`}>{fmtDate(l.bookingDate) || "-"}</span>,
              <span key={`c${i}`}>{l.plate} {pos.code || l.position}{extra ? ` · ${extra}` : ""}</span>,
              <span key={`d${i}`} className="text-right">{int(l.km)} กม.</span>,
              <span key={`e${i}`} className="text-right">{l.depthFrom !== null && l.depthTo !== null ? `ดอก ${l.depthFrom}→${l.depthTo}` : ""}</span>,
            ]
          })}
        </div>
      </div>
      <div className="flex flex-col justify-center gap-0.5 border-l border-[#fcd34d] pl-3">
        <div className="text-[#78350f]">บาท/กม. รวมทุกชีวิต</div>
        <div>
          <span className="text-[18px] font-bold" style={{ color: worse === null ? "#111827" : worse ? WORSE : BETTER }}>{cpk(s.cpkTotal)}</span>{" "}
          <span className="text-[#451a03]">เทียบ {cpk(s.cpkStandard)}</span>
        </div>
        {worse !== null && pctDiff !== null && (
          <div className="text-[#78350f]">{worse ? "แพงกว่า" : "ถูกกว่า"}มาตรฐาน {pctDiff.toFixed(0)}%</div>
        )}
      </div>
    </div>
  )
}

const TH = "px-1 py-1.5 font-semibold"
const TD = "px-1 py-[7px] align-top"

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

  return (
    <div className="tyre-print min-h-full bg-[#e5e7eb] py-6 text-[#111827]" style={{ fontFamily: "'Sarabun', 'TH Sarabun New', Arial, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap');
        @page { size: A4; margin: 10mm; }
        .tyre-print .pdf-page { font-size: 12px; line-height: 1.45; }
        @media print {
          html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
          .tyre-print { background: #fff !important; padding: 0 !important; }
          .no-print { display: none !important; }
          .pdf-page { box-shadow: none !important; margin: 0 !important; width: auto !important; min-height: 277mm !important; padding: 0 !important; break-after: page; }
          .pdf-page:last-child { break-after: auto; }
          tr { break-inside: avoid; }
          * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        }
      `}</style>

      <div className="no-print fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
        <div className="rounded bg-white px-3 py-2 text-xs text-gray-600 shadow">ปลายทางเลือก “บันทึกเป็น PDF” · กระดาษ A4 · เปิด “กราฟิกพื้นหลัง”</div>
        <button onClick={() => window.print()} className="flex items-center gap-2 rounded-lg bg-green-600 px-6 py-3 font-semibold text-white shadow-lg hover:bg-green-700">
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
          <div key={`${header.docNo}-${index}`} className="pdf-page mx-auto mb-8 flex flex-col gap-3.5 bg-white px-10 pb-8 pt-10 shadow" style={{ width: "210mm", minHeight: "297mm" }}>
            <Header />
            <TitleRow title="ใบขอความเห็นชอบอนุมัติเปลี่ยนยาง" pr={data.docPR} round={data.approvalRound} page={index + 1} pages={pages} />

            <section className="grid grid-cols-3 gap-x-5 gap-y-2 rounded-md bg-[#f3f4f6] px-3.5 py-3">
              <Field big label="ทะเบียนรถ" value={<>{header.plate || "-"}{truck && <span className="font-medium text-[#374151]"> ({truck})</span>}</>} />
              <Field big label="ใบแจ้งซ่อม" value={header.docNo} />
              <Field big label="วันที่จอง" value={header.bookingDate} />
              <Field label="ลูกค้า" value={header.customer} />
              <Field label="พนักงานขับรถ" value={header.employee} />
              <Field label="ผู้ขออนุมัติ" value={data.approver1} />
            </section>

            <section className="flex flex-col gap-1.5">
              <h2 className="m-0 text-[14px] font-bold">รายการยางที่ขออนุมัติเปลี่ยน · {items.length} เส้น</h2>
              <table className="w-full table-fixed border-collapse text-[12px]">
                <colgroup>
                  {[3, 14, 17, 11, 14, 7, 9, 11, 14].map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}
                </colgroup>
                <thead>
                  <tr className="text-left text-white" style={{ background: ACCENT }}>
                    <th className={`${TH} text-center`}>#</th>
                    <th className={TH}>ตำแหน่ง</th>
                    <th className={TH}>ยี่ห้อ / เบอร์ยาง</th>
                    <th className={TH}>ใส่เมื่อ · อายุ</th>
                    <th className={`${TH} text-right`}>ระยะใช้ / กำหนด (กม.)</th>
                    <th className={`${TH} text-right`}>ดอก (มม.)</th>
                    <th className={`${TH} text-right`}>ราคา (บ.)</th>
                    <th className={`${TH} text-right`}>บาท/กม. จริง / มาตรฐาน</th>
                    <th className={TH}>อาการ · ยางสำรอง</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => {
                    const pos = splitPosition(item.position || "")
                    const mDiff = item.mileageDiff || 0
                    const mColor = mDiff > 0 ? BETTER : mDiff < 0 ? WORSE : "#374151"
                    const dDiff = item.depthDiff || 0
                    const bpkWorse = (item.bpk || 0) > (item.bline || 0)
                    const multi = (item.lives?.lives?.length ?? 0) > 1
                    const [brand, ...rest] = [item.brand, ...String(item.tireCode || "-").split(" ")]
                    return [
                      <tr key={item.id} className="border-t border-[#9ca3af]">
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
                          {multi && <><br /><span className="text-[#4b5563]">เฉพาะรอบนี้</span></>}
                        </td>
                        <td className={TD}>{item.status || "-"}<br /><span className="text-[#4b5563]">สำรอง: {item.spare || "–"}</span></td>
                      </tr>,
                      multi ? (
                        <tr key={`${item.id}-lives`}>
                          <td colSpan={9} className="px-1 pb-2"><LivesBlock s={item.lives} /></td>
                        </tr>
                      ) : null,
                    ]
                  })}
                  <tr className="bg-[#eff6ff] font-bold" style={{ borderTop: `2px solid ${ACCENT}` }}>
                    <td colSpan={6} className="px-1 py-[7px] text-right">รวม {items.length} เส้น</td>
                    <td className="px-1 py-[7px] text-right">{money(summary.totalPrice)}</td>
                    <td className="px-1 py-[7px] text-right">เฉลี่ย {cpk(avgBpk)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </section>

            <section className="flex flex-col gap-1.5">
              <h2 className="m-0 text-[14px] font-bold">หมายเหตุ</h2>
              <div className="h-16 rounded-md border border-[#9ca3af]" />
              <div className="text-[#4b5563]">
                บาท/กม. รวมทุกชีวิต = ราคา ÷ ระยะรวมทุกชีวิต · มาตรฐาน = ราคา ÷ ระยะกำหนด · สีส้ม = แย่กว่าเกณฑ์ สีน้ำเงิน = ดีกว่าเกณฑ์ · เอกสารมีผลเมื่ออนุมัติครบทุกลำดับ
              </div>
            </section>

            <Footer at={at} />
          </div>
        )
      })}

      {/* หน้าสรุป (แบบ C) */}
      <div className="pdf-page mx-auto mb-8 flex flex-col gap-3.5 bg-white px-10 pb-8 pt-10 shadow" style={{ width: "210mm", minHeight: "297mm" }}>
        <Header />
        <TitleRow title="สรุปการขออนุมัติเปลี่ยนยาง" pr={data.docPR} round={data.approvalRound} page={pages} pages={pages} />

        <section className="grid grid-cols-4 gap-2.5">
          {[
            ["รถ (ใบแจ้งซ่อม)", int(overall.totalDocs || 0), "คัน", ""],
            ["ยางที่ขอเปลี่ยน", int(overall.totalTires || 0), "เส้น", overall.multiLifeTires ? `ใช้หลายชีวิต ${overall.multiLifeTires} เส้น` : ""],
            ["มูลค่ารวม", money(overall.totalPrice), "", "บาท"],
            ["บาท/กม. เฉลี่ย", cpk(overall.avgBpk || 0), "", "ทั้งรอบ"],
          ].map(([k, v, u, sub]) => (
            <div key={k} className="rounded-md border border-[#bfdbfe] bg-[#eff6ff] px-3 py-2.5">
              <div className="text-[#374151]">{k}</div>
              <div className="text-[24px] font-bold leading-tight" style={{ color: ACCENT }}>{v} {u && <span className="text-[13px] font-medium">{u}</span>}</div>
              {sub && <div className="text-[#374151]">{sub}</div>}
            </div>
          ))}
        </section>

        {t && (
          <section className="flex flex-col gap-1.5">
            <h2 className="m-0 text-[14px] font-bold">แยกตามชนิดยาง</h2>
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="text-white" style={{ background: ACCENT }}>
                  <th className="px-2 py-1.5 text-left font-semibold">ตำแหน่ง</th>
                  <th className="px-2 py-1.5 text-left font-semibold">ชนิดยาง</th>
                  <th className="px-2 py-1.5 text-right font-semibold">จำนวน (เส้น)</th>
                  <th className="px-2 py-1.5 text-right font-semibold">มูลค่า (บาท)</th>
                  <th className="px-2 py-1.5 text-right font-semibold">บาท/กม. เฉลี่ย</th>
                </tr>
              </thead>
              <tbody>
                {(["head", "tail"] as const).flatMap((part) =>
                  (["typeI", "typeII"] as const).map((k) => {
                    const p = t[part]?.[k] ?? { countTire: 0, cost: 0, avgBpk: 0 }
                    return (
                      <tr key={`${part}-${k}`} className={`border-b border-[#d1d5db] ${p.countTire ? "" : "text-[#4b5563]"}`}>
                        <td className="px-2 py-1.5 font-semibold">{part === "head" ? "หัว" : "หาง"}</td>
                        <td className="px-2 py-1.5">{k === "typeI" ? "ยางนอก 11R22.5" : "ยางนอก 1000-20"}</td>
                        <td className="px-2 py-1.5 text-right">{dash(p.countTire, (n) => n.toLocaleString("th-TH"))}</td>
                        <td className="px-2 py-1.5 text-right">{dash(p.cost, money)}</td>
                        <td className="px-2 py-1.5 text-right">{dash(p.avgBpk, (n) => n.toFixed(3))}</td>
                      </tr>
                    )
                  }),
                )}
              </tbody>
            </table>
          </section>
        )}

        <section className="flex flex-col gap-1.5">
          <h2 className="m-0 text-[14px] font-bold">แยกตามรถ</h2>
          <table className="w-full table-fixed border-collapse text-[12px]">
            <colgroup>
              {[4, 11, 15, 11, 19, 6, 12, 12, 10].map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}
            </colgroup>
            <thead>
              <tr className="text-left text-white" style={{ background: ACCENT }}>
                <th className="px-1 py-1.5 text-center font-semibold">#</th>
                <th className="px-1 py-1.5 font-semibold">ทะเบียน</th>
                <th className="px-1 py-1.5 font-semibold">ใบแจ้งซ่อม</th>
                <th className="px-1 py-1.5 font-semibold">วันที่จอง</th>
                <th className="px-1 py-1.5 font-semibold">พนักงานขับรถ</th>
                <th className="px-1 py-1.5 text-right font-semibold">เส้น</th>
                <th className="px-1 py-1.5 font-semibold">ปกติ / ไม่ปกติ</th>
                <th className="px-1 py-1.5 text-right font-semibold">มูลค่า (บ.)</th>
                <th className="px-1 py-1.5 text-right font-semibold">บาท/กม.</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v, i) => (
                <tr key={`${v.docNo}-${i}`} className={`border-b border-[#e5e7eb] ${i % 2 ? "bg-[#f9fafb]" : ""}`}>
                  <td className="p-1 text-center">{i + 1}</td>
                  <td className="p-1">{v.plate || "-"}</td>
                  <td className="p-1">{v.docNo || "-"}</td>
                  <td className="p-1">{v.bookingDate || "-"}</td>
                  <td className="p-1">{v.employee || "-"}</td>
                  <td className="p-1 text-right">{v.count || 0}</td>
                  <td className="p-1">{v.tiregood || 0} / {v.tiredefect ? <b style={{ color: WORSE }}>{v.tiredefect}</b> : 0}</td>
                  <td className="p-1 text-right">{money(v.totalPrice)}</td>
                  <td className="p-1 text-right">{cpk(v.avgBpk)}</td>
                </tr>
              ))}
              {!vehicles.length && <tr><td colSpan={9} className="py-4 text-center text-[#4b5563]">ไม่มีรถในรอบนี้</td></tr>}
              <tr className="bg-[#eff6ff] font-bold" style={{ borderTop: `2px solid ${ACCENT}` }}>
                <td colSpan={5} className="px-1 py-1.5 text-right">รวมทั้งหมด</td>
                <td className="px-1 py-1.5 text-right">{overall.totalTires || 0}</td>
                <td className="px-1 py-1.5">{good} / {bad}</td>
                <td className="px-1 py-1.5 text-right">{money(overall.totalPrice)}</td>
                <td className="px-1 py-1.5 text-right">{cpk(overall.avgBpk || 0)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="flex flex-col gap-2" style={{ breakInside: "avoid" }}>
          <h2 className="m-0 text-[14px] font-bold">ลงนามอนุมัติ</h2>
          <div className="grid grid-cols-3 gap-3.5">
            {[["ผู้จัดทำ", data.approver1], ["ผู้อนุมัติ 1", data.approver2], ["ผู้อนุมัติ 2", data.approver3]].map(([role, name]) => (
              <div key={role} className="flex flex-col gap-1.5 rounded-md border border-[#9ca3af] px-3 py-2.5 text-center">
                <div className="text-[#374151]">{role}</div>
                <div className="h-[54px] border-b border-[#6b7280]" />
                <div className="text-[13px] font-bold">( {name || "........................................"} )</div>
                <div className="text-[#374151]">วันที่ ......./......./...........</div>
              </div>
            ))}
          </div>
        </section>

        <Footer at={at} />
      </div>
    </div>
  )
}
