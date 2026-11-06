"use client"

/**
 * ใบขอความเห็นชอบอนุมัติเปลี่ยนยาง — หน้าตาเดียวกับเว็บ PDF ของ Apps Script เดิม (deploy_web.html)
 * เพิ่มอย่างเดียว: ยางที่มีหลายชีวิต จะขึ้นประวัติทุกชีวิตใต้แถวนั้นเสมอ พร้อม CPK รวมเทียบมาตรฐาน
 * พิมพ์ / บันทึก PDF ด้วยปุ่มพิมพ์ของเบราว์เซอร์ (A4)
 */
import { useEffect, useState } from "react"
import { Printer } from "lucide-react"
import { fmtDate, type LifeSummary } from "@/lib/tyre-sheet"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Report = Record<string, any>

const LOGO = "/brand/mena-logo.svg"
const money = (n: number) => (n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const int = (n: number | null | undefined) => (n === null || n === undefined ? "-" : Math.round(n).toLocaleString("th-TH"))

function Header({ big = false }: { big?: boolean }) {
  return (
    <div className="bg-white mb-6 p-6">
      <div className="flex items-center justify-between mb-8">
        <div className="flex-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO} alt="Meena Transport Logo" className={`${big ? "h-20" : "h-16"} object-contain`} />
        </div>
        <div className="flex-1 text-right">
          <div className="text-xl font-bold text-blue-900">บริษัท มีนาทรานสปอร์ต จำกัด (มหาชน)</div>
          <div className="text-base text-gray-600 mt-2">MEENA TRANSPORT PUBLIC COMPANY LIMITED</div>
        </div>
      </div>
      {!big && <div className="text-left text-base text-gray-600 mb-3 border-t pt-4">จัดทำโดยฝ่ายยานยนต์ แผนกยาง</div>}
    </div>
  )
}

function LivesBlock({ s }: { s: LifeSummary }) {
  const better = s.cpkTotal !== null && s.cpkStandard !== null ? s.cpkTotal <= s.cpkStandard : null
  return (
    <div className="bg-amber-50 border border-amber-300 rounded px-2 py-1.5 text-[10px]">
      <div className="font-bold text-amber-900 mb-1">ประวัติยางเส้นนี้ทุกชีวิต ({s.lives.length} ชีวิต)</div>
      <table className="w-full">
        <thead>
          <tr className="text-amber-900">
            <th className="text-left px-1">ชีวิต</th><th className="text-left px-1">รถ / ตำแหน่ง</th><th className="text-left px-1">ใบแจ้งซ่อม</th>
            <th className="text-left px-1">วันจอง</th><th className="text-right px-1">ระยะวิ่ง (กม.)</th><th className="text-right px-1">มิลใช้ไป</th>
            <th className="text-left px-1">กลุ่มอาการ</th><th className="text-left px-1">ใช้เป็นยางสำรอง</th>
          </tr>
        </thead>
        <tbody>
          {s.lives.map((l, i) => (
            <tr key={l.id || i} className={l.isCurrent ? "font-semibold" : ""}>
              <td className="px-1">{i + 1}{l.isCurrent ? " (รอบนี้)" : ""}</td>
              <td className="px-1">{l.plate} · {l.position}</td>
              <td className="px-1">{l.mrNo}</td>
              <td className="px-1">{fmtDate(l.bookingDate)}</td>
              <td className="px-1 text-right">{int(l.km)}</td>
              <td className="px-1 text-right">{l.depthFrom !== null && l.depthTo !== null ? `${l.depthFrom - l.depthTo} (${l.depthFrom}→${l.depthTo})` : "-"}</td>
              <td className="px-1">{l.symptom || "-"}</td>
              <td className="px-1">{l.spare || "-"}</td>
            </tr>
          ))}
          <tr className="border-t border-amber-300 font-bold">
            <td className="px-1" colSpan={4}>รวมทุกชีวิต</td>
            <td className="px-1 text-right">{int(s.totalKm)}</td>
            <td className="px-1 text-right">{s.depthUsedTotal !== null ? `${s.depthUsedTotal}${s.fullDepth ? ` จาก ${s.fullDepth}` : ""}` : "-"}</td>
            <td className="px-1" colSpan={2}></td>
          </tr>
        </tbody>
      </table>
      <div className="mt-1 flex flex-wrap gap-x-5 gap-y-0.5">
        <span>CPK รวม = {money(s.price ?? 0)} ÷ {int(s.totalKm)} = <b>{s.cpkTotal !== null ? s.cpkTotal.toFixed(3) : "-"}</b></span>
        <span>CPK มาตรฐาน = {money(s.price ?? 0)} ÷ {int(s.ratedKm)} = <b>{s.cpkStandard !== null ? s.cpkStandard.toFixed(3) : "-"}</b></span>
        {better !== null && (
          <span className={`font-bold ${better ? "text-green-700" : "text-red-700"}`}>
            {better ? "ถูกกว่า/เท่ามาตรฐาน" : "แพงกว่ามาตรฐาน"}{s.pctOfRated !== null ? ` · ได้ ${(s.pctOfRated * 100).toFixed(0)}% ของระยะกำหนด` : ""}
          </span>
        )}
        <span className="text-gray-600">CPK รอบล่าสุด {s.cpkLatest !== null ? s.cpkLatest.toFixed(3) : "-"} (ดูอย่างเดียว)</span>
      </div>
    </div>
  )
}

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

  const docs = data.documents ?? []
  const overall = data.overallSummary ?? {}
  const t = overall.tire
  const fc = (n: number) => (n === 0 ? <span className="text-gray-400">—</span> : n.toLocaleString("en-US"))
  const fm = (n: number) => (n === 0 ? <span className="text-gray-400">—</span> : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
  const fa = (n: number) => (n === 0 ? <span className="text-gray-400">—</span> : n.toFixed(3))

  return (
    <div className="tyre-print bg-gray-200 min-h-full py-6 text-gray-900" style={{ fontFamily: "'Sarabun', 'TH Sarabun New', Arial, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&display=swap');
        @page { size: A4; margin: 1.2cm; }
        @media print {
          html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
          .tyre-print { background: #fff !important; padding: 0 !important; }
          .no-print { display: none !important; }
          .pdf-page { box-shadow: none !important; margin: 0 !important; width: auto !important; min-height: auto !important; padding: 0 !important; }
          .page-break { page-break-after: always; break-after: page; }
          * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        }
      `}</style>

      <div className="no-print fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
        <div className="bg-white text-xs text-gray-600 rounded px-3 py-2 shadow">ปลายทางเลือก “บันทึกเป็น PDF” · กระดาษ A4 · เปิด “กราฟิกพื้นหลัง”</div>
        <button onClick={() => window.print()} className="bg-green-600 hover:bg-green-700 text-white font-semibold px-6 py-3 rounded-lg shadow-lg flex items-center gap-2">
          <Printer className="w-5 h-5" /> พิมพ์ / บันทึก PDF
        </button>
      </div>

      {docs.map((doc: Report, index: number) => {
        const summary = doc.summary ?? {}
        const header = doc.header ?? {}
        const items = doc.items ?? []
        const avgBpk = summary.count ? summary.totalBpk / summary.count : 0
        return (
          <div key={header.docNo}>
            <div className="pdf-page bg-white px-6 py-8 mb-8 mx-auto shadow" style={{ width: "210mm", minHeight: "297mm" }}>
              <Header />
              <div className="flex flex-col my-6 gap-3">
                <div className="py-4"><h1 className="text-center text-2xl font-bold text-blue-900 uppercase tracking-wide">ใบขอความเห็นชอบอนุมัติเปลี่ยนยาง</h1></div>
                <div className="grid grid-cols-3 gap-4 text-base border-b pb-4">
                  <div className="text-left"><span className="font-semibold">เลขที่ PR:</span><span className="ml-2 underline">{data.docPR}</span></div>
                  <div className="text-center"><span className="font-semibold">รอบอนุมัติ:</span><span className="ml-2 px-3 py-1">{data.approvalRound}</span></div>
                  <div className="text-right"><span className="font-semibold">หน้า:</span><span className="ml-2"> {index + 1}/ {docs.length}</span></div>
                </div>
              </div>

              <div className="p-4 mb-8 bg-gray-50 rounded">
                <h2 className="text-lg font-bold text-gray-800 mb-5 pb-3 border-b-2 border-gray-400">ข้อมูลรถและการจอง</h2>
                <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-base">
                  {[
                    ["ทะเบียนรถ:", header.plate], ["ใบแจ้งซ่อม:", header.docNo], ["ลูกค้า:", header.customer], ["พนักงานขับรถ:", header.employee],
                    ["วันที่จอง:", header.bookingDate], ["ผู้ขออนุมัติ:", data.approver1], ["วันที่เปลี่ยนยาง:", header.changeDate],
                  ].map(([k, v]) => (
                    <div key={k} className="flex"><span className="font-semibold w-36 text-gray-700">{k}</span><span className="flex-1 border-b border-dotted border-gray-400"> {v || "-"}</span></div>
                  ))}
                </div>
              </div>

              <div className="mb-8">
                <h2 className="text-lg font-bold text-gray-800 mb-4 pb-3 border-b-2 border-gray-400">รายละเอียดยางที่ขออนุมัติเปลี่ยน</h2>
                <div className="border border-gray-900 rounded overflow-hidden">
                  <table className="w-full text-[10px] table-fixed">
                    <colgroup>
                      {[4, 8, 13, 7, 7, 8, 9, 8, 5, 7, 8, 10, 6].map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}
                    </colgroup>
                    <thead>
                      <tr className="bg-blue-900 text-white">
                        {["ลำดับ", "ตำแหน่ง", "หมายเลขยาง", "ระยะกำหนด (กม.)", "ระยะที่วิ่ง (กม.)", "ส่วนต่าง ระยะทาง", "วันที่เปลี่ยน", "อายุการใช้งาน", "มิลยาง วันจอง", "เปรียบเทียบ กับ 3 มม.", "ราคา (บาท)", "บาท/กม. (baseline/actual)", "กลุ่มอาการ"].map((h) => (
                          <th key={h} className="border border-blue-800 px-1 py-2 text-center font-semibold leading-tight">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item: Report, i: number) => {
                        const mDiff = item.mileageDiff || 0
                        const mileageColor = mDiff === 0 ? "text-red-700" : mDiff > 0 ? "text-green-700" : "text-amber-600"
                        const dDiff = item.depthDiff || 0
                        const depthColor = dDiff >= 0 ? "text-green-700" : "text-red-700"
                        const statusColor = item.status === "ปกติ" || item.status === "ตามรอบ" || item.spare ? "text-green-700" : "text-red-700"
                        const good = item.bline >= item.bpk
                        const multi = item.lives?.lives?.length > 1
                        return [
                          <tr key={item.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                            <td className="border border-gray-300 px-1 py-1.5 break-words text-center">{i + 1}</td>
                            <td className="border border-gray-300 px-1 py-1.5 break-words text-center font-medium">{item.position || "-"}</td>
                            <td className="border border-gray-300 px-1 py-1.5 break-words"><span className="text-indigo-700">{item.brand}</span><br />{item.tireCode || "-"}</td>
                            <td className="border border-gray-300 px-1 py-1.5 break-words text-right">{(item.targetMileage || 0).toLocaleString()}</td>
                            <td className="border border-gray-300 px-1 py-1.5 break-words text-right">{(item.actualMileage || 0).toLocaleString()}</td>
                            <td className={`border border-gray-300 px-1.5 py-2 text-center font-semibold ${mileageColor}`}>{item.mileageStatus}<br /><span className="text-[10px]">({mDiff > 0 ? "+" : ""}{mDiff.toLocaleString()})</span></td>
                            <td className="border border-gray-300 px-1 py-1.5 text-center whitespace-nowrap">{item.changeDate}</td>
                            <td className="border border-gray-300 px-1 py-1.5 break-words text-center">{item.ageText}</td>
                            <td className="border border-gray-300 px-1 py-1.5 break-words text-center">{(item.tireDepth || 0).toFixed(1)}</td>
                            <td className={`border border-gray-300 px-1.5 py-2 text-center font-semibold ${depthColor}`}>{item.depthStatus}<br /><span className="text-[10px]">({dDiff > 0 ? "+" : ""}{dDiff.toFixed(1)})</span></td>
                            <td className="border border-gray-300 px-1 py-1.5 break-words text-right">{money(item.price)}</td>
                            <td className={`border border-gray-300 px-1.5 py-2 text-right font-bold ${good ? "text-green-700" : "text-red-700"}`}>{(item.bline || 0).toFixed(3)} / {(item.bpk || 0).toFixed(3)} : {good ? "ดี" : "ไม่ดี"}</td>
                            <td className={`border border-gray-300 px-1.5 py-2 text-center font-semibold ${statusColor}`}>{item.status || (item.spare ? "-" : "-")}{item.spare && <><br /><span className="text-[10px] text-gray-600">{item.spare}</span></>}</td>
                          </tr>,
                          multi ? (
                            <tr key={`${item.id}-lives`}><td colSpan={13} className="border border-gray-300 px-2 py-1.5"><LivesBlock s={item.lives} /></td></tr>
                          ) : null,
                        ]
                      })}
                      <tr className="bg-blue-100 font-bold">
                        <td colSpan={10} className="border border-gray-400 px-3 py-3 text-right">รวมทั้งสิ้น</td>
                        <td className="border border-gray-400 px-3 py-3 text-right">{money(summary.totalPrice)}</td>
                        <td className="border border-gray-400 px-3 py-3 text-right">{avgBpk.toFixed(3)}</td>
                        <td className="border border-gray-400 px-3 py-3"></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="p-5 mb-6 text-sm">
                  <div className="font-bold text-amber-900 mb-3 text-base">หมายเหตุ:</div>
                  <ul className="list-disc list-inside space-y-2 text-gray-700">
                    <li>การพิจารณาอนุมัติอ้างอิงจากค่าเฉลี่ย บาท/กิโลเมตร และนโยบายการจัดซื้อของบริษัท</li>
                    <li>ส่วนต่างระยะทาง: <span className="text-amber-700 font-semibold">ตรงตามกำหนด</span> / <span className="text-red-600 font-semibold">ต่ำกว่ากำหนด</span> / <span className="text-green-700 font-semibold">ดีกว่ากำหนด</span></li>
                    <li>มิลยางวันจอง: <span className="text-red-700 font-semibold">&gt;3 มม.</span> / <span className="text-green-700 font-semibold">≤3 มม.</span></li>
                    <li>ยางที่เคยใช้มาก่อน แสดงทุกชีวิต CPK รวม = ราคา ÷ ระยะรวมทุกชีวิต</li>
                    <li>เอกสารมีผลเมื่อได้รับอนุมัติครบทุกลำดับแล้วเท่านั้น</li>
                  </ul>
                </div>
                <div className="p-5 mb-6">
                  <div className="mb-3"><label className="text-base font-semibold text-gray-700">ความคิดเห็น / หมายเหตุ:</label></div>
                  <div className="border border-gray-300 rounded bg-white p-4 min-h-[120px]" />
                </div>
              </div>
              <div className="text-sm text-gray-500 text-center border-t pt-3 mt-6">เอกสารสร้างโดยระบบจัดการยาง - บริษัท มีนาทรานสปอร์ต จำกัด (มหาชน)</div>
            </div>
            <div className="page-break" />
          </div>
        )
      })}

      <div className="pdf-page bg-white px-6 py-8 mb-8 mx-auto shadow" style={{ width: "210mm", minHeight: "297mm" }}>
        <div className="border-b-2 border-gray-300 mb-6"><Header big /></div>
        <div className="py-4 mb-6"><h1 className="text-center text-2xl font-bold text-blue-900 uppercase tracking-wide">สรุปรวมการขออนุมัติเปลี่ยนยางทั้งหมด</h1></div>
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[["จำนวนรถทั้งหมด", overall.totalDocs || 0, "คัน"], ["จำนวนยางทั้งหมด", overall.totalTires || 0, "เส้น"], ["มูลค่ารวมทั้งหมด", money(overall.totalPrice), "บาท"], ["ค่าเฉลี่ย บาท/กม.", (overall.avgBpk || 0).toFixed(3), "บาท/กม."]].map(([k, v, u]) => (
            <div key={k as string} className="border-2 border-blue-200 bg-blue-50 rounded p-4 text-center">
              <div className="text-sm text-gray-600">{k}</div><div className="text-2xl font-bold text-blue-900 my-1">{v}</div><div className="text-xs text-gray-500">{u}</div>
            </div>
          ))}
        </div>
        {t && (
          <table className="w-full text-sm border border-gray-400 mb-8">
            <thead><tr className="bg-blue-900 text-white">{["ประเภท", "ชนิดยาง", "จำนวนยาง (เส้น)", "มูลค่ารวม (฿)", "ค่าเฉลี่ย บาท/กม."].map((h) => <th key={h} className="border border-blue-800 px-3 py-2">{h}</th>)}</tr></thead>
            <tbody>
              {(["head", "tail"] as const).map((part) => {
                const p = t[part]
                const cnt = p.typeI.countTire + p.typeII.countTire
                const cost = p.typeI.cost + p.typeII.cost
                const avg = cnt ? (p.typeI.totalBpk + p.typeII.totalBpk) / cnt : 0
                return [
                  <tr key={`${part}1`}><td rowSpan={3} className="border border-gray-300 px-3 py-2 text-center font-bold">{part === "head" ? "หัว" : "หาง"}</td><td className="border border-gray-300 px-3 py-2">ยางนอก 11R22.5</td><td className="border border-gray-300 px-3 py-2 text-right">{fc(p.typeI.countTire)}</td><td className="border border-gray-300 px-3 py-2 text-right">{fm(p.typeI.cost)}</td><td className="border border-gray-300 px-3 py-2 text-right">{fa(p.typeI.avgBpk)}</td></tr>,
                  <tr key={`${part}2`}><td className="border border-gray-300 px-3 py-2">ยางนอก 1000-20</td><td className="border border-gray-300 px-3 py-2 text-right">{fc(p.typeII.countTire)}</td><td className="border border-gray-300 px-3 py-2 text-right">{fm(p.typeII.cost)}</td><td className="border border-gray-300 px-3 py-2 text-right">{fa(p.typeII.avgBpk)}</td></tr>,
                  <tr key={`${part}3`} className="bg-gray-100 font-bold"><td className="border border-gray-300 px-3 py-2">รวม</td><td className="border border-gray-300 px-3 py-2 text-right">{fc(cnt)}</td><td className="border border-gray-300 px-3 py-2 text-right">{fm(cost)}</td><td className="border border-gray-300 px-3 py-2 text-right">{fa(avg)}</td></tr>,
                ]
              })}
            </tbody>
          </table>
        )}
        <h2 className="text-lg font-bold text-gray-800 mb-4 pb-3 border-b-2 border-gray-400">รายละเอียดการขออนุมัติแยกตามรถ</h2>
        <table className="w-full text-xs border border-gray-400 mb-8">
          <thead><tr className="bg-blue-900 text-white">{["ลำดับ", "ลูกค้า", "พนักงานขับรถ", "ทะเบียน", "เลขที่แจ้งซ่อม", "วันที่จอง", "จำนวน (เส้น)", "กลุ่มอาการ", "มูลค่า (บาท)"].map((h) => <th key={h} className="border border-blue-800 px-2 py-2">{h}</th>)}</tr></thead>
          <tbody>
            {(overall.vehicles ?? []).map((v: Report, i: number) => (
              <tr key={`${v.docNo}-${i}`} className={i % 2 ? "bg-gray-50" : ""}>
                <td className="border border-gray-300 px-2 py-1.5 text-center">{i + 1}</td><td className="border border-gray-300 px-2 py-1.5">{v.customer || "-"}</td>
                <td className="border border-gray-300 px-2 py-1.5">{v.employee || "-"}</td><td className="border border-gray-300 px-2 py-1.5">{v.plate || "-"}</td>
                <td className="border border-gray-300 px-2 py-1.5">{v.docNo || "-"}</td><td className="border border-gray-300 px-2 py-1.5">{v.bookingDate || "-"}</td>
                <td className="border border-gray-300 px-2 py-1.5 text-center">{v.count || 0}</td>
                <td className="border border-gray-300 px-2 py-1.5 text-center"><span className="text-green-700">ปกติ {v.tiregood || 0}</span><br /><span className="text-red-700">ไม่ปกติ {v.tiredefect || 0}</span></td>
                <td className="border border-gray-300 px-2 py-1.5 text-right">{money(v.totalPrice)}</td>
              </tr>
            ))}
            {!overall.vehicles?.length && <tr><td colSpan={9} className="text-center py-4 text-gray-400">ไม่มีข้อมูลสรุปรายรถ</td></tr>}
            <tr className="bg-blue-100 font-bold"><td colSpan={6} className="border border-gray-400 px-2 py-2 text-right">รวมทั้งหมด</td><td className="border border-gray-400 px-2 py-2 text-center">{overall.totalTires || 0}</td><td className="border border-gray-400" /><td className="border border-gray-400 px-2 py-2 text-right">{money(overall.totalPrice)}</td></tr>
          </tbody>
        </table>
        <h2 className="text-lg font-bold text-gray-800 mb-4 pb-3 border-b-2 border-gray-400">ส่วนการอนุมัติ</h2>
        <div className="grid grid-cols-3 gap-6">
          {[["ผู้จัดทำ", data.approver1], ["ผู้อนุมัติ", data.approver2], ["ผู้อนุมัติ", data.approver3]].map(([role, name], i) => (
            <div key={i} className="border border-gray-300 rounded p-4">
              <div className="text-center font-semibold text-gray-700 mb-2">{role}</div>
              <div className="text-center font-bold text-lg mb-5 bg-blue-50 py-3 rounded">{name || "-"}</div>
              <div className="border-b border-gray-400" style={{ minHeight: 100 }} />
              <div className="text-center text-sm text-gray-600 mt-3"><div>ลงวันที่ ......../......../...........</div><div>ตำแหน่ง: {role}</div></div>
            </div>
          ))}
        </div>
        <div className="text-xs text-gray-400 text-right mt-6">สร้างเมื่อ {data.generatedAt}</div>
      </div>
    </div>
  )
}
