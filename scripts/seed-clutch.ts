/**
 * Seed mock clutch data — PRT parts + LAB labor
 * L1: TRN  |  L2(parts): CLT  |  L2(labor): CLTL
 *
 * Run: MONGO_URI=... MONGO_DB=... npx tsx scripts/seed-clutch.ts
 */

import { MongoClient, ObjectId } from "mongodb"

const URI = process.env.MONGO_URI ?? ""
const DB  = process.env.MONGO_DB  ?? "master_data"
if (!URI) throw new Error("Set MONGO_URI env var")

const WH = "XX"

// ─── L2 labor code to add ────────────────────────────────────────────────────
const NEW_L2_LAB = {
  _id:    "LAB_L2:TRN:CLTL",
  dict:   "LAB_L2",
  code:   "CLTL",
  th:     "ค่าแรงระบบครัช",
  en:     "Clutch Labor",
  parent: "TRN",
  order:  210,
  meta:   { expenseType: "LAB" },
}

// ─── L3 labor codes under CLTL ──────────────────────────────────────────────
const NEW_L3_LAB = [
  { code: "RPL", th: "เปลี่ยนชุดครัชครบชุด",        en: "Replace Full Clutch Kit",          order: 1 },
  { code: "DSC", th: "เปลี่ยนจานครัช",              en: "Replace Clutch Disc",               order: 2 },
  { code: "PRS", th: "เปลี่ยนชุดแผ่นกด",            en: "Replace Pressure Plate",            order: 3 },
  { code: "RLB", th: "เปลี่ยนตลับลูกปืนคลัตช์",    en: "Replace Release Bearing",           order: 4 },
  { code: "MAB", th: "เปลี่ยน/ซ่อมแม่ปั๊มคลัตช์",   en: "Replace/Rebuild Master Cylinder",  order: 5 },
  { code: "SLB", th: "เปลี่ยน/ซ่อมลูกปั๊มคลัตช์",   en: "Replace/Rebuild Slave Cylinder",   order: 6 },
  { code: "ADJ", th: "ปรับตั้งระยะครัช",             en: "Clutch Adjustment",                order: 7 },
  { code: "BLD", th: "ไล่ลมระบบน้ำมันครัช",          en: "Bleed Clutch Hydraulic System",    order: 8 },
]

// ─── PRT SKUs ────────────────────────────────────────────────────────────────
// Realistic part numbers: Isuzu 6HK1, Hino J08E, Hino J05E trucks
const PRT_SKUS = [
  // ── จานคลัตช์ (DSC) ──
  {
    l3: "DSC",
    nameTh:    "จานครัช Isuzu 6HK1 (430mm)",
    nameEn:    "Clutch Disc Isuzu 6HK1 430mm",
    partNo:    "EXEDY-MFZ070U",
    oemRef:    "1876101980",            // Isuzu OEM
    compatRefs: ["MFZ070U", "1876101860"],
    brand:     "EXEDY",
    grade:     "G3",
    unit:      "EA",
    price:     4800,
    position:  "GN",
    vehicles:  ["@type:Mixer 10 ล้อ Isuzu", "@type:รถบรรทุก 10ล้อ Isuzu"],
    atmsCodes: ["CLT-DSC-001"],
  },
  {
    l3: "DSC",
    nameTh:    "จานครัช Hino J08E (380mm)",
    nameEn:    "Clutch Disc Hino J08E 380mm",
    partNo:    "EXEDY-HFZ038U",
    oemRef:    "31250-E0500",           // Hino OEM
    compatRefs: ["HFZ038U", "31250-E0480"],
    brand:     "EXEDY",
    grade:     "G3",
    unit:      "EA",
    price:     4200,
    position:  "GN",
    vehicles:  ["@type:Mixer 10 ล้อ Hino", "@type:รถบรรทุก 10ล้อ Hino"],
    atmsCodes: ["CLT-DSC-002"],
  },
  {
    l3: "DSC",
    nameTh:    "จานครัช Hino J05E (350mm)",
    nameEn:    "Clutch Disc Hino J05E 350mm",
    partNo:    "VALEO-826347",
    oemRef:    "31250-E0400",
    compatRefs: ["826347", "31250-E0390"],
    brand:     "VALEO",
    grade:     "G3",
    unit:      "EA",
    price:     3600,
    position:  "GN",
    vehicles:  ["@type:รถบรรทุก 6ล้อ Hino"],
    atmsCodes: ["CLT-DSC-003"],
  },

  // ── ชุดแผ่นกด (PRS) ──
  {
    l3: "PRS",
    nameTh:    "ชุดแผ่นกด Isuzu 6HK1 430mm",
    nameEn:    "Clutch Pressure Plate Isuzu 6HK1",
    partNo:    "EXEDY-MFC547",
    oemRef:    "1876201980",
    compatRefs: ["MFC547", "SFC547"],
    brand:     "EXEDY",
    grade:     "G3",
    unit:      "EA",
    price:     8500,
    position:  "GN",
    vehicles:  ["@type:Mixer 10 ล้อ Isuzu", "@type:รถบรรทุก 10ล้อ Isuzu"],
    atmsCodes: ["CLT-PRS-001"],
  },
  {
    l3: "PRS",
    nameTh:    "ชุดแผ่นกด Hino J08E 380mm",
    nameEn:    "Clutch Pressure Plate Hino J08E",
    partNo:    "EXEDY-HFC526",
    oemRef:    "31210-E0500",
    compatRefs: ["HFC526", "31210-E0480"],
    brand:     "EXEDY",
    grade:     "G3",
    unit:      "EA",
    price:     7800,
    position:  "GN",
    vehicles:  ["@type:Mixer 10 ล้อ Hino", "@type:รถบรรทุก 10ล้อ Hino"],
    atmsCodes: ["CLT-PRS-002"],
  },

  // ── ชุดครัชครบชุด (DSC+PRS kit — ใช้ DSC code แต่เป็น KIT) ──
  {
    l3: "DSC",
    nameTh:    "ชุดครัชครบชุด Isuzu 6HK1 (จาน+แผ่นกด+ลูกปืน)",
    nameEn:    "Clutch Kit Isuzu 6HK1 Complete",
    partNo:    "EXEDY-IFK008",
    oemRef:    "1876301980",
    compatRefs: ["IFK008", "1876101980", "1876201980"],
    brand:     "EXEDY",
    grade:     "G3",
    unit:      "SET",
    price:     14500,
    position:  "GN",
    vehicles:  ["@type:Mixer 10 ล้อ Isuzu", "@type:รถบรรทุก 10ล้อ Isuzu"],
    atmsCodes: ["CLT-KIT-001"],
  },
  {
    l3: "DSC",
    nameTh:    "ชุดครัชครบชุด Hino J08E (จาน+แผ่นกด+ลูกปืน)",
    nameEn:    "Clutch Kit Hino J08E Complete",
    partNo:    "EXEDY-HFK028",
    oemRef:    "31250-E0590",
    compatRefs: ["HFK028", "31250-E0500", "31210-E0500"],
    brand:     "EXEDY",
    grade:     "G3",
    unit:      "SET",
    price:     13200,
    position:  "GN",
    vehicles:  ["@type:Mixer 10 ล้อ Hino", "@type:รถบรรทุก 10ล้อ Hino"],
    atmsCodes: ["CLT-KIT-002"],
  },

  // ── ตลับลูกปืนคลัตช์ (RLB) ──
  {
    l3: "RLB",
    nameTh:    "ตลับลูกปืนครัช Isuzu 6HK1",
    nameEn:    "Clutch Release Bearing Isuzu 6HK1",
    partNo:    "EXEDY-BRG312",
    oemRef:    "8980936760",
    compatRefs: ["BRG312", "ME521366"],
    brand:     "EXEDY",
    grade:     "G3",
    unit:      "EA",
    price:     1850,
    position:  "GN",
    vehicles:  ["@type:Mixer 10 ล้อ Isuzu", "@type:รถบรรทุก 10ล้อ Isuzu"],
    atmsCodes: ["CLT-RLB-001"],
  },
  {
    l3: "RLB",
    nameTh:    "ตลับลูกปืนครัช Hino J08E",
    nameEn:    "Clutch Release Bearing Hino J08E",
    partNo:    "SKF-VKC2204",
    oemRef:    "31230-E0300",
    compatRefs: ["VKC2204", "BRG290H"],
    brand:     "SKF",
    grade:     "G3",
    unit:      "EA",
    price:     1650,
    position:  "GN",
    vehicles:  ["@type:Mixer 10 ล้อ Hino", "@type:รถบรรทุก 10ล้อ Hino"],
    atmsCodes: ["CLT-RLB-002"],
  },

  // ── คันโยกคลัตช์ (FRK) ──
  {
    l3: "FRK",
    nameTh:    "คันโยกครัช Isuzu 6HK1",
    nameEn:    "Clutch Fork Isuzu 6HK1",
    partNo:    "8973625200",
    oemRef:    "8973625200",
    compatRefs: ["CLT-FORK-ISZ6HK1"],
    brand:     "ISUZU",
    grade:     "G2",
    unit:      "EA",
    price:     2200,
    position:  "GN",
    vehicles:  ["@type:Mixer 10 ล้อ Isuzu", "@type:รถบรรทุก 10ล้อ Isuzu"],
    atmsCodes: ["CLT-FRK-001"],
  },
  {
    l3: "FRK",
    nameTh:    "คันโยกครัช Hino J08E",
    nameEn:    "Clutch Fork Hino J08E",
    partNo:    "31504-E0300",
    oemRef:    "31504-E0300",
    compatRefs: ["CLT-FORK-HINJ08E"],
    brand:     "HINO",
    grade:     "G2",
    unit:      "EA",
    price:     1900,
    position:  "GN",
    vehicles:  ["@type:Mixer 10 ล้อ Hino", "@type:รถบรรทุก 10ล้อ Hino"],
    atmsCodes: ["CLT-FRK-002"],
  },

  // ── แม่ปั๊มคลัตช์ (MAB) ──
  {
    l3: "MAB",
    nameTh:    "แม่ปั๊มครัช Isuzu 6HK1",
    nameEn:    "Clutch Master Cylinder Isuzu 6HK1",
    partNo:    "AISIN-CMI-015",
    oemRef:    "8973041380",
    compatRefs: ["CMI-015", "31410-E0070"],
    brand:     "AISIN",
    grade:     "G3",
    unit:      "EA",
    price:     3200,
    position:  "GN",
    vehicles:  ["@type:Mixer 10 ล้อ Isuzu", "@type:รถบรรทุก 10ล้อ Isuzu"],
    atmsCodes: ["CLT-MAB-001"],
  },
  {
    l3: "MAB",
    nameTh:    "แม่ปั๊มครัช Hino J08E / J05E",
    nameEn:    "Clutch Master Cylinder Hino J08/J05",
    partNo:    "AISIN-CMH-012",
    oemRef:    "31410-E0090",
    compatRefs: ["CMH-012", "31410-E0070"],
    brand:     "AISIN",
    grade:     "G3",
    unit:      "EA",
    price:     2900,
    position:  "GN",
    vehicles:  ["@type:Mixer 10 ล้อ Hino", "@type:รถบรรทุก 10ล้อ Hino", "@type:รถบรรทุก 6ล้อ Hino"],
    atmsCodes: ["CLT-MAB-002"],
  },

  // ── ลูกปั๊มคลัตช์ (SLB) ──
  {
    l3: "SLB",
    nameTh:    "ลูกปั๊มครัช Isuzu 6HK1",
    nameEn:    "Clutch Slave Cylinder Isuzu 6HK1",
    partNo:    "AISIN-CSI-019",
    oemRef:    "8972551830",
    compatRefs: ["CSI-019", "31470-E0110"],
    brand:     "AISIN",
    grade:     "G3",
    unit:      "EA",
    price:     2100,
    position:  "GN",
    vehicles:  ["@type:Mixer 10 ล้อ Isuzu", "@type:รถบรรทุก 10ล้อ Isuzu"],
    atmsCodes: ["CLT-SLB-001"],
  },
  {
    l3: "SLB",
    nameTh:    "ลูกปั๊มครัช Hino J08E",
    nameEn:    "Clutch Slave Cylinder Hino J08E",
    partNo:    "AISIN-CSH-015",
    oemRef:    "31470-E0090",
    compatRefs: ["CSH-015", "31470-E0070"],
    brand:     "AISIN",
    grade:     "G3",
    unit:      "EA",
    price:     1950,
    position:  "GN",
    vehicles:  ["@type:Mixer 10 ล้อ Hino", "@type:รถบรรทุก 10ล้อ Hino"],
    atmsCodes: ["CLT-SLB-002"],
  },

  // ── จุดหมุนคันโยก (PVT) ──
  {
    l3: "PVT",
    nameTh:    "สลักจุดหมุนคันโยกครัช (Fork Pin)",
    nameEn:    "Clutch Fork Pivot Pin",
    partNo:    "8973625210",
    oemRef:    "8973625210",
    compatRefs: [],
    brand:     "ISUZU",
    grade:     "G2",
    unit:      "EA",
    price:     350,
    position:  "GN",
    vehicles:  ["@type:Mixer 10 ล้อ Isuzu", "@type:รถบรรทุก 10ล้อ Isuzu"],
    atmsCodes: ["CLT-PVT-001"],
  },
]

// ─── LAB SKUs ────────────────────────────────────────────────────────────────
const LAB_SKUS = [
  { l3: "RPL", nameTh: "เปลี่ยนชุดครัชครบชุด (Isuzu 6HK1)",     nameEn: "Replace Full Clutch Kit Isuzu 6HK1",      grade: "T2", unit: "JOB", atms: ["CLTL-RPL-001"] },
  { l3: "RPL", nameTh: "เปลี่ยนชุดครัชครบชุด (Hino J08E)",       nameEn: "Replace Full Clutch Kit Hino J08E",        grade: "T2", unit: "JOB", atms: ["CLTL-RPL-002"] },
  { l3: "DSC", nameTh: "เปลี่ยนจานครัชเฉพาะแผ่น",               nameEn: "Replace Clutch Disc Only",                grade: "T2", unit: "JOB", atms: ["CLTL-DSC-001"] },
  { l3: "PRS", nameTh: "เปลี่ยนชุดแผ่นกด",                       nameEn: "Replace Pressure Plate",                  grade: "T2", unit: "JOB", atms: ["CLTL-PRS-001"] },
  { l3: "RLB", nameTh: "เปลี่ยนตลับลูกปืนครัช",                  nameEn: "Replace Release Bearing",                 grade: "T2", unit: "JOB", atms: ["CLTL-RLB-001"] },
  { l3: "MAB", nameTh: "เปลี่ยนแม่ปั๊มครัช",                     nameEn: "Replace Clutch Master Cylinder",           grade: "T1", unit: "JOB", atms: ["CLTL-MAB-001"] },
  { l3: "MAB", nameTh: "ซ่อมแม่ปั๊มครัช (Rebuild)",              nameEn: "Rebuild Clutch Master Cylinder",           grade: "T1", unit: "JOB", atms: ["CLTL-MAB-002"] },
  { l3: "SLB", nameTh: "เปลี่ยนลูกปั๊มครัช",                     nameEn: "Replace Clutch Slave Cylinder",            grade: "T1", unit: "JOB", atms: ["CLTL-SLB-001"] },
  { l3: "ADJ", nameTh: "ปรับตั้งระยะครัช",                        nameEn: "Clutch Pedal & Linkage Adjustment",        grade: "T2", unit: "JOB", atms: ["CLTL-ADJ-001"] },
  { l3: "BLD", nameTh: "ไล่ลมระบบน้ำมันครัช",                    nameEn: "Bleed Clutch Hydraulic System",            grade: "T2", unit: "JOB", atms: ["CLTL-BLD-001"] },
]

function buildSku(wh: string, type: string, l1: string, l2: string, l3: string, seq: number) {
  return `${wh}-${type}-${l1}-${l2}-${l3}-${String(seq).padStart(4, "0")}`
}

async function getNextSeq(col: ReturnType<ReturnType<typeof MongoClient.prototype.db>["collection"]>, prefix: string) {
  const last = await col.find({ SKU: { $regex: `^${prefix}` } } as never).sort({ SKU: -1 }).limit(1).toArray()
  return last.length > 0 ? parseInt((last[0] as { SKU: string }).SKU.split("-").pop() ?? "0") + 1 : 1
}

async function main() {
  const client = await MongoClient.connect(URI)
  const codes  = client.db(DB).collection("master_codes")
  const skus   = client.db(DB).collection("master_sku")
  const now    = new Date()

  // 1. Upsert CLTL L2 labor code
  await codes.updateOne(
    { _id: NEW_L2_LAB._id } as never,
    { $set: NEW_L2_LAB },
    { upsert: true }
  )
  console.log("✓ L2 labor code CLTL")

  // 2. Upsert L3 labor codes under CLTL
  for (const c of NEW_L3_LAB) {
    await codes.updateOne(
      { _id: `LAB_L3:TRN:CLTL:${c.code}` } as never,
      { $set: { _id: `LAB_L3:TRN:CLTL:${c.code}`, dict: "LAB_L3", code: c.code, th: c.th, en: c.en, parent: "CLTL", order: c.order, meta: { expenseType: "LAB", l1: "TRN" } } },
      { upsert: true }
    )
    console.log(`  ✓ L3 labor code CLTL:${c.code}`)
  }

  // 3. Insert PRT SKUs
  console.log("\nInserting PRT SKUs...")
  const seqMap: Record<string, number> = {}
  for (const s of PRT_SKUS) {
    const prefix = `${WH}-PRT-TRN-CLT-${s.l3}-`
    if (!seqMap[prefix]) seqMap[prefix] = await getNextSeq(skus, prefix)
    const seq = seqMap[prefix]++
    const sku = buildSku(WH, "PRT", "TRN", "CLT", s.l3, seq)

    await skus.insertOne({
      SKU:               sku,
      status:            "approved",
      createdBy:         "seed@menatransport.co.th",
      createdByName:     "Seed Script",
      คลังสินค้า:        WH,
      ประเภทค่าใช้จ่าย: "PRT",
      ชื่ออะไหล่_TH:    s.nameTh,
      Part_Name_EN:      s.nameEn,
      เบอร์อะไหล่:       s.partNo,
      เบอร์แท้อ้างอิง:   s.oemRef,
      เบอร์เทียบอ้างอิง: s.compatRefs,
      ระบบ_L1:           "TRN",
      ชุดประกอบ_L2:      "CLT",
      ชิ้นส่วน_L3:       s.l3,
      ตำแหน่ง:           s.position,
      ราคาต่อหน่วย:      s.price,
      หน่วย:             s.unit,
      ยี่ห้อ:            s.brand,
      เบอร์เทียบอ้างอิง2: [],
      ทะเบียนหรือรุ่นรถ: s.vehicles,
      Grade:             s.grade,
      รหัสATMS:          s.atmsCodes,
      createdAt:         now,
      updatedAt:         now,
    } as never)
    console.log(`  ✓ ${sku}  ${s.nameTh}`)
  }

  // 4. Insert LAB SKUs
  console.log("\nInserting LAB SKUs...")
  const labSeqMap: Record<string, number> = {}
  for (const s of LAB_SKUS) {
    const prefix = `${WH}-LAB-TRN-CLTL-${s.l3}-`
    if (!labSeqMap[prefix]) labSeqMap[prefix] = await getNextSeq(skus, prefix)
    const seq = labSeqMap[prefix]++
    const sku = buildSku(WH, "LAB", "TRN", "CLTL", s.l3, seq)

    await skus.insertOne({
      SKU:               sku,
      status:            "approved",
      createdBy:         "seed@menatransport.co.th",
      createdByName:     "Seed Script",
      คลังสินค้า:        WH,
      ประเภทค่าใช้จ่าย: "LAB",
      ชื่ออะไหล่_TH:    s.nameTh,
      Part_Name_EN:      s.nameEn,
      เบอร์อะไหล่:       "",
      เบอร์แท้อ้างอิง:   "",
      เบอร์เทียบอ้างอิง: [],
      ระบบ_L1:           "TRN",
      ชุดประกอบ_L2:      "CLTL",
      ชิ้นส่วน_L3:       s.l3,
      ตำแหน่ง:           "GN",
      ราคาต่อหน่วย:      0,
      หน่วย:             s.unit,
      ยี่ห้อ:            "",
      ทะเบียนหรือรุ่นรถ: [],
      Grade:             s.grade,
      รหัสATMS:          s.atms,
      createdAt:         now,
      updatedAt:         now,
    } as never)
    console.log(`  ✓ ${sku}  ${s.nameTh}`)
  }

  await client.close()
  console.log(`\nDone — ${PRT_SKUS.length} PRT + ${LAB_SKUS.length} LAB clutch SKUs seeded`)
}

main().catch((e) => { console.error(e); process.exit(1) })
