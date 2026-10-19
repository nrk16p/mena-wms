// ไฟล์ Excel ของหน้าสรุปอู่รายจังหวัด (/vendors/coverage) — ผู้ใช้ขอ 19/10/2569 "โหลด excel มาจัดการข้อมูลต่อได้"
// 4 ชีต: รายจังหวัด · รายอำเภอ · รายชื่ออู่ทั้งหมด (ทุกแหล่ง มีคอลัมน์ที่มาให้กรองเอง) · แพล้นท์ที่ยังไม่รู้ที่ตั้ง
// เอาทั้งชุด ไม่สนช่องค้นหาบนหน้า — ไฟล์ส่งต่อกัน คนรับไม่รู้ว่าคนกดกรองอะไรไว้
import { downloadExcelBook, type ExcelCol, type ExcelRow } from "@/lib/excel-table"
import { COVERAGE_WORKS, doesWork } from "@/lib/garage-coverage-works"
import type { CoverageRow } from "@/lib/garage-coverage"
import type { GarageHit, GarageSource } from "@/lib/garage-geo"

export const SOURCE_LABEL: Record<GarageSource, string> = { avl: "อู่ AVL", fleet: "อู่ที่ยังไม่ได้ยืนยัน", pin: "ยังไม่ผ่านอนุมัติ" }

type Level = { label: string; tone?: "warn" | "danger" }
function level(r: CoverageRow): Level {
  if (r.trucks > 0 && r.garages === 0) return { label: "ไม่มีอู่เลย", tone: "danger" }
  if (r.trucks === 0) return { label: "ไม่มีรถประจำ" }
  if ((r.trucksPerGarage ?? 0) > 5) return { label: "อู่น้อย", tone: "warn" }
  if ((r.trucksPerGarage ?? 0) > 2.5) return { label: "พอใช้" }
  return { label: "เพียงพอ" }
}

const workCols: ExcelCol[] = COVERAGE_WORKS.map((w, i) => ({ key: `w${i}`, header: w.label, width: 10, align: "right", numFmt: "#,##0", group: "จำนวนอู่ที่ทำงานหมวดนี้" }))
const areaCols = (withDistrict: boolean): ExcelCol[] => [
  { key: "province", header: "จังหวัด", width: 18, group: "พื้นที่" },
  ...(withDistrict ? [{ key: "district", header: "อำเภอ", width: 18, group: "พื้นที่" } as ExcelCol] : []),
  { key: "trucks", header: "รถ (คัน)", width: 10, align: "right", numFmt: "#,##0", group: "รถ" },
  { key: "plants", header: "แพล้นท์", width: 34, wrap: true, group: "รถ" },
  { key: "garages", header: "อู่รวม", width: 9, align: "right", numFmt: "#,##0", group: "อู่" },
  { key: "avl", header: "อู่ AVL", width: 9, align: "right", numFmt: "#,##0", group: "อู่" },
  { key: "fleet", header: "ยังไม่ได้ยืนยัน", width: 13, align: "right", numFmt: "#,##0", group: "อู่" },
  { key: "pin", header: "ยังไม่ผ่านอนุมัติ", width: 14, align: "right", numFmt: "#,##0", group: "อู่" },
  { key: "withPhone", header: "มีเบอร์", width: 9, align: "right", numFmt: "#,##0", group: "อู่" },
  { key: "tpg", header: "รถต่ออู่ (นับทุกแหล่ง)", width: 14, align: "right", numFmt: "0.0", group: "ความพอ" },
  { key: "tpgAvl", header: "รถต่ออู่ AVL", width: 12, align: "right", numFmt: "0.0", group: "ความพอ" },
  { key: "per100", header: "อู่ต่อรถ 100 คัน", width: 13, align: "right", numFmt: "0.0", group: "ความพอ" },
  ...(withDistrict ? [] : [{ key: "level", header: "สถานะ", width: 13, align: "center", group: "ความพอ" } as ExcelCol]),
  ...workCols,
]
function areaRow(r: CoverageRow, withLevel: boolean): ExcelRow {
  const lv = level(r)
  const cells: ExcelRow["cells"] = {
    province: r.province, district: r.district ?? "", trucks: r.trucks, plants: [...new Set(r.plants)].join(", "),
    garages: r.garages, avl: r.bySource.avl, fleet: r.bySource.fleet, pin: r.bySource.pin, withPhone: r.withPhone,
    tpg: r.trucksPerGarage, tpgAvl: r.trucks && r.bySource.avl ? Math.round((r.trucks / r.bySource.avl) * 10) / 10 : null,
    per100: r.per100, level: lv.label,
  }
  r.works.forEach((n, i) => { cells[`w${i}`] = n })
  return { cells, tone: withLevel && r.trucks > 0 ? lv.tone : undefined }
}

const garageCols: ExcelCol[] = [
  { key: "name", header: "ชื่ออู่", width: 38, wrap: true, group: "อู่" },
  { key: "source", header: "ที่มา", width: 18, group: "อู่" },
  { key: "sources", header: "เจอในแหล่ง", width: 26, group: "อู่" },
  { key: "phone", header: "เบอร์โทร", width: 22, group: "อู่" },
  { key: "status", header: "สถานะอนุมัติ", width: 14, group: "อู่" },
  { key: "province", header: "จังหวัด", width: 16, group: "ที่ตั้ง" },
  { key: "district", header: "อำเภอ", width: 16, group: "ที่ตั้ง" },
  { key: "subdistrict", header: "ตำบล", width: 16, group: "ที่ตั้ง" },
  { key: "address", header: "ที่อยู่", width: 40, wrap: true, group: "ที่ตั้ง" },
  { key: "zone", header: "โซน (ชีตยานยนต์)", width: 24, wrap: true, group: "ที่ตั้ง" },
  { key: "lat", header: "ละติจูด", width: 11, align: "right", numFmt: "0.000000", group: "ที่ตั้ง" },
  { key: "lng", header: "ลองจิจูด", width: 11, align: "right", numFmt: "0.000000", group: "ที่ตั้ง" },
  { key: "precision", header: "ความแม่นพิกัด", width: 13, group: "ที่ตั้ง" },
  { key: "gmap", header: "Google Maps", width: 14, group: "ที่ตั้ง" },
  ...COVERAGE_WORKS.map((w, i) => ({ key: `w${i}`, header: w.label, width: 9, align: "center", group: "ทำงานหมวดนี้ได้ (✓)" } as ExcelCol)),
  { key: "works", header: "งานที่ลงไว้ใน AVL", width: 36, wrap: true, group: "ประวัติ" },
  { key: "jobs", header: "เคยซ่อม (ใบ)", width: 11, align: "right", numFmt: "#,##0", group: "ประวัติ" },
  { key: "lastJob", header: "ซ่อมล่าสุด", width: 12, align: "center", group: "ประวัติ" },
  { key: "poCount", header: "PO (ใบ)", width: 9, align: "right", numFmt: "#,##0", group: "ประวัติ" },
  { key: "poBaht", header: "ยอด PO (บาท)", width: 14, align: "right", numFmt: "#,##0", group: "ประวัติ" },
]
function garageRow(g: GarageHit): ExcelRow {
  const cells: ExcelRow["cells"] = {
    name: g.name, source: SOURCE_LABEL[g.source], sources: g.sources.map((s) => SOURCE_LABEL[s]).join(", "),
    phone: g.phone, status: ({ approved: "อนุมัติแล้ว", pending: "รออนุมัติ" } as Record<string, string>)[g.status] ?? g.status,
    province: g.address?.province || "ไม่รู้จังหวัด", district: g.address?.district ?? "", subdistrict: g.address?.subdistrict ?? "",
    address: g.address?.full ?? "", zone: g.zone,
    lat: g.geo?.lat ?? null, lng: g.geo?.lng ?? null, precision: g.geo?.precision ?? "ไม่มีพิกัด",
    gmap: g.geo ? { text: "เปิดแผนที่", hyperlink: `https://www.google.com/maps?q=${g.geo.lat},${g.geo.lng}` } : "",
    works: g.works.join(", "), jobs: g.jobs || null, lastJob: g.lastJob, poCount: g.poCount || null, poBaht: g.poBaht || null,
  }
  COVERAGE_WORKS.forEach((w, i) => { cells[`w${i}`] = doesWork(g, w) ? "✓" : "" })
  return { cells }
}

export async function downloadCoverageXlsx(data: { asOf: string; rows: CoverageRow[]; totals: { unknownPlants: string[] } }) {
  const r = await fetch("/api/vendors/map")
  const j = await r.json()
  if (!r.ok) throw new Error(j.error ?? "โหลดรายชื่ออู่ไม่สำเร็จ")
  const garages = (j.items as GarageHit[]).slice().sort((a, b) =>
    (a.address?.province || "ฮ").localeCompare(b.address?.province || "ฮ", "th") ||
    ["avl", "fleet", "pin"].indexOf(a.source) - ["avl", "fleet", "pin"].indexOf(b.source) || a.name.localeCompare(b.name, "th"))

  const now = new Date().toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })
  const sub = `ส่งออก ${now} · ข้อมูลรถ ณ ${data.asOf || "-"} · อู่นับทุกแหล่ง (AVL / ยังไม่ได้ยืนยัน / ยังไม่ผ่านอนุมัติ) แยกคอลัมน์ไว้ให้`
  const districts = data.rows.flatMap((p) => p.districts ?? [])
  const stamp = new Date().toISOString().slice(0, 10)
  return downloadExcelBook(`สรุปอู่รายจังหวัด_${stamp}.xlsx`, [
    { sheetName: "รายจังหวัด", title: "สรุปอู่รายจังหวัด เทียบจำนวนรถ", subtitle: sub, columns: areaCols(false), rows: data.rows.map((x) => areaRow(x, true)), freezeCols: 1 },
    { sheetName: "รายอำเภอ", title: "สรุปอู่รายอำเภอ", subtitle: sub, columns: areaCols(true), rows: districts.map((x) => areaRow(x, false)), freezeCols: 2 },
    { sheetName: "รายชื่ออู่", title: `รายชื่ออู่ทั้งหมด ${garages.length} แห่ง`, subtitle: `${sub} · กรองคอลัมน์ "ที่มา" ถ้าจะดูเฉพาะอู่ AVL`, columns: garageCols, rows: garages.map(garageRow), freezeCols: 1 },
    { sheetName: "แพล้นท์ไม่รู้ที่ตั้ง", title: "แพล้นท์ใน ATMS ที่ยังจับคู่ที่ตั้งไม่ได้", subtitle: "ชื่อใน ATMS ไม่ตรงกับแพล้นท์บนแผนที่ รถของแพล้นท์เหล่านี้เลยไปนับที่แถว ไม่รู้จังหวัด · ส่งชื่อจังหวัด/อำเภอให้ทีมระบบเติมได้",
      columns: [{ key: "n", header: "ชื่อแพล้นท์ใน ATMS", width: 30 }], rows: data.totals.unknownPlants.map((n) => ({ cells: { n } })) },
  ])
}
