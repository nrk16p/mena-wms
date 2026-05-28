/**
 * Seed 20 Parts + 20 Labor example SKUs for battery-related work (ELC system)
 * Also seeds missing LAB-tagged L2/L3 codes needed for labor SKUs.
 * Run: MONGO_URI=... MONGO_DB=... npx tsx scripts/seed-example-battery-sku.ts
 */

import { MongoClient } from "mongodb"

const URI = process.env.MONGO_URI ?? ""
const DB  = process.env.MONGO_DB  ?? "master_data"
if (!URI) throw new Error("Set MONGO_URI env var")

// ─── LAB codes to add under ELC ────────────────────────────────────────────

const LAB_L2: Array<{ code: string; th: string; en: string }> = [
  { code: "BATL", th: "ค่าแรงระบบแบตเตอรี่",  en: "Battery Labor"   },
  { code: "ALTL", th: "ค่าแรงซ่อมไดชาร์จ",    en: "Alternator Labor"},
]

const LAB_L3: Array<{ code: string; th: string; en: string; parent: string }> = [
  // BATL
  { parent: "ELC:BATL", code: "RPL", th: "เปลี่ยนแบตเตอรี่",           en: "Replace Battery"           },
  { parent: "ELC:BATL", code: "CLN", th: "ล้างทำความสะอาดแบตเตอรี่",   en: "Clean Battery"             },
  { parent: "ELC:BATL", code: "TST", th: "ทดสอบและตรวจสอบแบตเตอรี่",   en: "Test Battery"              },
  { parent: "ELC:BATL", code: "CHG", th: "ชาร์จแบตเตอรี่",             en: "Charge Battery"            },
  { parent: "ELC:BATL", code: "CAB", th: "เปลี่ยนสายแบตเตอรี่",        en: "Replace Battery Cable"     },
  { parent: "ELC:BATL", code: "TRM", th: "เปลี่ยนขั้วแบตเตอรี่",       en: "Replace Battery Terminal"  },
  { parent: "ELC:BATL", code: "HLD", th: "เปลี่ยนที่ยึดแบตเตอรี่",     en: "Replace Battery Holder"    },
  // ALTL
  { parent: "ELC:ALTL", code: "RPL", th: "เปลี่ยนไดชาร์จ",             en: "Replace Alternator"        },
  { parent: "ELC:ALTL", code: "RPR", th: "ซ่อมไดชาร์จ",                en: "Repair Alternator"         },
  { parent: "ELC:ALTL", code: "CBR", th: "เปลี่ยนแปรงถ่านไดชาร์จ",    en: "Replace Alt. Brushes"      },
  { parent: "ELC:ALTL", code: "VRG", th: "เปลี่ยน Voltage Regulator",  en: "Replace Voltage Regulator" },
  { parent: "ELC:ALTL", code: "BRG", th: "เปลี่ยนลูกปืนไดชาร์จ",     en: "Replace Alt. Bearing"      },
  { parent: "ELC:ALTL", code: "TST", th: "ทดสอบไดชาร์จ",               en: "Test Alternator"           },
  // STM (L3 for existing STM L2)
  { parent: "ELC:STM",  code: "RPL", th: "เปลี่ยนมอเตอร์สตาร์ท",      en: "Replace Starter Motor"     },
  { parent: "ELC:STM",  code: "RPR", th: "ซ่อมมอเตอร์สตาร์ท",         en: "Repair Starter Motor"      },
  { parent: "ELC:STM",  code: "SOL", th: "เปลี่ยน Solenoid สตาร์ท",   en: "Replace Solenoid"          },
  { parent: "ELC:STM",  code: "BND", th: "เปลี่ยน Bendix / Pinion",    en: "Replace Bendix"            },
  { parent: "ELC:STM",  code: "TST", th: "ทดสอบมอเตอร์สตาร์ท",        en: "Test Starter Motor"        },
]

// ─── 20 Parts SKUs (PRT / ELC) ─────────────────────────────────────────────

type PartsSku = {
  l1: string; l2: string; l3: string
  nameTh: string; nameEn: string
  partNo: string; brand: string; grade: string
  oemRef: string; compatRefs: string[]
  unit: string; price: number
  vehicles: string[]
  atmsCodes: string[]
  position: string
}

const PARTS: PartsSku[] = [
  // ── ELC:BAT (แบตเตอรี่)
  {
    l1: "ELC", l2: "BAT", l3: "BAT",
    nameTh: "แบตเตอรี่ 12V 120Ah สำหรับ Mixer ISUZU 6HK1",
    nameEn: "Battery 12V 120Ah for Mixer ISUZU 6HK1",
    partNo: "NS120L", brand: "GS YUASA", grade: "G1",
    oemRef: "8-97602-498-0",
    compatRefs: ["GS-NS120L", "DIN60"],
    unit: "EA", price: 4800,
    vehicles: ["@type:Mixer 10 ล้อ"],
    atmsCodes: ["BAT-001"],
    position: "GN",
  },
  {
    l1: "ELC", l2: "BAT", l3: "BAT",
    nameTh: "แบตเตอรี่ 12V 120Ah สำหรับ Mixer HINO J08E",
    nameEn: "Battery 12V 120Ah for Mixer HINO J08E",
    partNo: "NS120L", brand: "PANASONIC", grade: "G1",
    oemRef: "28800-E0240",
    compatRefs: ["PN-NS120L"],
    unit: "EA", price: 5200,
    vehicles: ["@type:Mixer 10 ล้อ"],
    atmsCodes: ["BAT-002"],
    position: "GN",
  },
  {
    l1: "ELC", l2: "BAT", l3: "BAT",
    nameTh: "แบตเตอรี่ 12V 100Ah (เทียบ OEM)",
    nameEn: "Battery 12V 100Ah OEM",
    partNo: "DIN100", brand: "AMARON", grade: "G3",
    oemRef: "",
    compatRefs: ["AM-DIN100"],
    unit: "EA", price: 2800,
    vehicles: ["@type:Mixer 10 ล้อ", "@type:Mixer 6 ล้อ"],
    atmsCodes: ["BAT-003"],
    position: "GN",
  },
  {
    l1: "ELC", l2: "BAT", l3: "BAT",
    nameTh: "แบตเตอรี่ 12V 120Ah DELKOR (เทียบแท้)",
    nameEn: "Battery 12V 120Ah DELKOR",
    partNo: "DL120", brand: "DELKOR", grade: "G2",
    oemRef: "",
    compatRefs: ["DL-120L"],
    unit: "EA", price: 3900,
    vehicles: ["@type:Mixer 10 ล้อ"],
    atmsCodes: ["BAT-004"],
    position: "GN",
  },
  {
    l1: "ELC", l2: "BAT", l3: "BAT",
    nameTh: "แบตเตอรี่ 12V 150Ah Heavy Duty หัวลาก",
    nameEn: "Battery 12V 150Ah Heavy Duty for Tractor Head",
    partNo: "N150", brand: "GS YUASA", grade: "G1",
    oemRef: "24610-E0260",
    compatRefs: ["GS-N150", "DIN150"],
    unit: "EA", price: 6500,
    vehicles: ["@type:หัวลาก"],
    atmsCodes: ["BAT-005"],
    position: "GN",
  },
  // ── ELC:BAT (สายแบต)
  {
    l1: "ELC", l2: "BAT", l3: "CAB",
    nameTh: "สายแบตเตอรี่บวก (+) 1 เมตร 70 sq.mm",
    nameEn: "Battery Cable Positive (+) 1m 70sq.mm",
    partNo: "CAB-70-P", brand: "THAI YAZAKI", grade: "G3",
    oemRef: "",
    compatRefs: ["BC70P"],
    unit: "EA", price: 350,
    vehicles: [],
    atmsCodes: ["BAT-006"],
    position: "GN",
  },
  {
    l1: "ELC", l2: "BAT", l3: "CAB",
    nameTh: "สายแบตเตอรี่ลบ (-) 1 เมตร 70 sq.mm",
    nameEn: "Battery Cable Negative (-) 1m 70sq.mm",
    partNo: "CAB-70-N", brand: "THAI YAZAKI", grade: "G3",
    oemRef: "",
    compatRefs: ["BC70N"],
    unit: "EA", price: 350,
    vehicles: [],
    atmsCodes: ["BAT-007"],
    position: "GN",
  },
  {
    l1: "ELC", l2: "BAT", l3: "CAB",
    nameTh: "ชุดสายแบตเตอรี่ ISUZU 6HK1 Mixer",
    nameEn: "Battery Cable Set ISUZU 6HK1 Mixer",
    partNo: "1-82230-372-0", brand: "ISUZU", grade: "G1",
    oemRef: "1-82230-372-0",
    compatRefs: [],
    unit: "SET", price: 1800,
    vehicles: ["@type:Mixer 10 ล้อ"],
    atmsCodes: ["BAT-008"],
    position: "GN",
  },
  // ── ELC:BAT (ขั้วแบต)
  {
    l1: "ELC", l2: "BAT", l3: "TRM",
    nameTh: "ขั้วแบตเตอรี่บวก ทองแดง (Terminal +)",
    nameEn: "Battery Terminal Positive Copper",
    partNo: "TRM-CU-P", brand: "KOITO", grade: "G3",
    oemRef: "",
    compatRefs: [],
    unit: "EA", price: 120,
    vehicles: [],
    atmsCodes: ["BAT-009"],
    position: "GN",
  },
  {
    l1: "ELC", l2: "BAT", l3: "TRM",
    nameTh: "ขั้วแบตเตอรี่ลบ ทองแดง (Terminal -)",
    nameEn: "Battery Terminal Negative Copper",
    partNo: "TRM-CU-N", brand: "KOITO", grade: "G3",
    oemRef: "",
    compatRefs: [],
    unit: "EA", price: 120,
    vehicles: [],
    atmsCodes: ["BAT-010"],
    position: "GN",
  },
  // ── ELC:BAT (ที่ยึดแบต)
  {
    l1: "ELC", l2: "BAT", l3: "HLD",
    nameTh: "ที่ยึดแบตเตอรี่ ISUZU 6HK1 (Battery Holder)",
    nameEn: "Battery Holder ISUZU 6HK1",
    partNo: "8-94396-034-0", brand: "ISUZU", grade: "G1",
    oemRef: "8-94396-034-0",
    compatRefs: ["8943960340"],
    unit: "EA", price: 650,
    vehicles: ["@type:Mixer 10 ล้อ"],
    atmsCodes: ["BAT-011"],
    position: "GN",
  },
  // ── ELC:ALT (ไดชาร์จ)
  {
    l1: "ELC", l2: "ALT", l3: "ALT",
    nameTh: "ไดชาร์จ 24V 80A ISUZU 6HK1 (ใหม่แท้)",
    nameEn: "Alternator 24V 80A ISUZU 6HK1 New Genuine",
    partNo: "1-81200-346-0", brand: "ISUZU", grade: "G1",
    oemRef: "1-81200-346-0",
    compatRefs: ["LR180-507", "LR180507"],
    unit: "EA", price: 22000,
    vehicles: ["@type:Mixer 10 ล้อ"],
    atmsCodes: ["ALT-001"],
    position: "GN",
  },
  {
    l1: "ELC", l2: "ALT", l3: "ALT",
    nameTh: "ไดชาร์จ 24V 60A HINO J08E (เทียบ OEM)",
    nameEn: "Alternator 24V 60A HINO J08E OEM",
    partNo: "27060-E0010", brand: "HITACHI", grade: "G3",
    oemRef: "27060-E0010",
    compatRefs: ["LR260-501"],
    unit: "EA", price: 8500,
    vehicles: ["@type:Mixer 10 ล้อ"],
    atmsCodes: ["ALT-002"],
    position: "GN",
  },
  {
    l1: "ELC", l2: "ALT", l3: "ALT",
    nameTh: "ไดชาร์จ 24V 80A รีบิ้วโรงงาน ISUZU 6HK1",
    nameEn: "Alternator 24V 80A Factory Rebuilt ISUZU 6HK1",
    partNo: "1-81200-346-0R", brand: "ISUZU", grade: "G6",
    oemRef: "1-81200-346-0",
    compatRefs: [],
    unit: "EA", price: 9500,
    vehicles: ["@type:Mixer 10 ล้อ"],
    atmsCodes: ["ALT-003"],
    position: "GN",
  },
  {
    l1: "ELC", l2: "ALT", l3: "CBR",
    nameTh: "แปรงถ่านไดชาร์จ ISUZU 6HK1",
    nameEn: "Alternator Carbon Brush ISUZU 6HK1",
    partNo: "8-94460-021-0", brand: "ISUZU", grade: "G1",
    oemRef: "8-94460-021-0",
    compatRefs: ["A866X52572"],
    unit: "SET", price: 380,
    vehicles: ["@type:Mixer 10 ล้อ"],
    atmsCodes: ["ALT-004"],
    position: "GN",
  },
  {
    l1: "ELC", l2: "ALT", l3: "VRG",
    nameTh: "Voltage Regulator ไดชาร์จ ISUZU 6HK1",
    nameEn: "Voltage Regulator Alternator ISUZU 6HK1",
    partNo: "1-81600-095-0", brand: "ISUZU", grade: "G1",
    oemRef: "1-81600-095-0",
    compatRefs: ["TG1Z-171", "TG1Z171"],
    unit: "EA", price: 1200,
    vehicles: ["@type:Mixer 10 ล้อ"],
    atmsCodes: ["ALT-005"],
    position: "GN",
  },
  {
    l1: "ELC", l2: "ALT", l3: "REC",
    nameTh: "Rectifier Diode ไดชาร์จ ISUZU 6HK1",
    nameEn: "Rectifier Diode Alternator ISUZU 6HK1",
    partNo: "8-94397-074-0", brand: "ISUZU", grade: "G2",
    oemRef: "8-94397-074-0",
    compatRefs: [],
    unit: "EA", price: 950,
    vehicles: ["@type:Mixer 10 ล้อ"],
    atmsCodes: ["ALT-006"],
    position: "GN",
  },
  {
    l1: "ELC", l2: "ALT", l3: "BRG",
    nameTh: "ลูกปืนไดชาร์จ (Front Bearing) ISUZU 6HK1",
    nameEn: "Alternator Front Bearing ISUZU 6HK1",
    partNo: "6203-2RS", brand: "NSK", grade: "G3",
    oemRef: "",
    compatRefs: ["6203RS", "6203ZZ"],
    unit: "EA", price: 280,
    vehicles: ["@type:Mixer 10 ล้อ"],
    atmsCodes: ["ALT-007"],
    position: "GN",
  },
  {
    l1: "ELC", l2: "ALT", l3: "BLT",
    nameTh: "สายพานไดชาร์จ ISUZU 6HK1 (V-Belt)",
    nameEn: "Alternator V-Belt ISUZU 6HK1",
    partNo: "9-09312-006-0", brand: "ISUZU", grade: "G1",
    oemRef: "9-09312-006-0",
    compatRefs: ["8PK1680", "B-180"],
    unit: "EA", price: 420,
    vehicles: ["@type:Mixer 10 ล้อ"],
    atmsCodes: ["ALT-008"],
    position: "GN",
  },
  {
    l1: "ELC", l2: "ALT", l3: "ALT",
    nameTh: "ไดชาร์จ 24V 80A HINO 700 E13C (แท้ศูนย์)",
    nameEn: "Alternator 24V 80A HINO 700 E13C Genuine",
    partNo: "27060-E0031", brand: "HINO", grade: "G1",
    oemRef: "27060-E0031",
    compatRefs: ["LR280-502"],
    unit: "EA", price: 28000,
    vehicles: ["@type:หัวลาก"],
    atmsCodes: ["ALT-009"],
    position: "GN",
  },
]

// ─── 20 Labor SKUs (LAB / ELC) ──────────────────────────────────────────────

type LaborSku = {
  l1: string; l2: string; l3: string
  nameTh: string; nameEn: string
  grade: string
  unit: string
  vehicles: string[]
  atmsCodes: string[]
  position: string
}

const LABORS: LaborSku[] = [
  // ── ELC:BATL (แบตเตอรี่)
  { l1: "ELC", l2: "BATL", l3: "RPL", nameTh: "เปลี่ยนแบตเตอรี่ (1 ก้อน)", nameEn: "Replace Battery (1 unit)", grade: "INH", unit: "EA", vehicles: [], atmsCodes: ["LAB-BAT-001"], position: "GN" },
  { l1: "ELC", l2: "BATL", l3: "CLN", nameTh: "ล้างทำความสะอาดแบตเตอรี่และขั้วแบต", nameEn: "Clean Battery & Terminals", grade: "INH", unit: "JOB", vehicles: [], atmsCodes: ["LAB-BAT-002"], position: "GN" },
  { l1: "ELC", l2: "BATL", l3: "TST", nameTh: "ทดสอบและวัดค่าแบตเตอรี่ด้วยเครื่อง", nameEn: "Battery Load Test", grade: "INH", unit: "JOB", vehicles: [], atmsCodes: ["LAB-BAT-003"], position: "GN" },
  { l1: "ELC", l2: "BATL", l3: "CHG", nameTh: "ชาร์จแบตเตอรี่ (overnight)", nameEn: "Overnight Battery Charge", grade: "INH", unit: "JOB", vehicles: [], atmsCodes: ["LAB-BAT-004"], position: "GN" },
  { l1: "ELC", l2: "BATL", l3: "CAB", nameTh: "เปลี่ยนสายแบตเตอรี่ บวก/ลบ", nameEn: "Replace Battery Cable +/-", grade: "INH", unit: "JOB", vehicles: [], atmsCodes: ["LAB-BAT-005"], position: "GN" },
  { l1: "ELC", l2: "BATL", l3: "TRM", nameTh: "เปลี่ยนขั้วแบตเตอรี่และปรับขันให้แน่น", nameEn: "Replace & Tighten Battery Terminals", grade: "INH", unit: "JOB", vehicles: [], atmsCodes: ["LAB-BAT-006"], position: "GN" },
  { l1: "ELC", l2: "BATL", l3: "HLD", nameTh: "เปลี่ยนที่ยึดแบตเตอรี่", nameEn: "Replace Battery Holder Bracket", grade: "INH", unit: "EA", vehicles: [], atmsCodes: ["LAB-BAT-007"], position: "GN" },
  // ── ELC:ALTL (ไดชาร์จ)
  { l1: "ELC", l2: "ALTL", l3: "RPL", nameTh: "เปลี่ยนไดชาร์จทั้งตัว", nameEn: "Replace Alternator Assembly", grade: "CTR", unit: "EA", vehicles: [], atmsCodes: ["LAB-ALT-001"], position: "GN" },
  { l1: "ELC", l2: "ALTL", l3: "RPR", nameTh: "ซ่อมไดชาร์จ (ตรวจ/ทดสอบ)", nameEn: "Repair & Test Alternator", grade: "CTR", unit: "JOB", vehicles: [], atmsCodes: ["LAB-ALT-002"], position: "GN" },
  { l1: "ELC", l2: "ALTL", l3: "CBR", nameTh: "เปลี่ยนแปรงถ่านไดชาร์จ", nameEn: "Replace Alternator Carbon Brush", grade: "INH", unit: "SET", vehicles: [], atmsCodes: ["LAB-ALT-003"], position: "GN" },
  { l1: "ELC", l2: "ALTL", l3: "VRG", nameTh: "เปลี่ยน Voltage Regulator ไดชาร์จ", nameEn: "Replace Alternator Voltage Regulator", grade: "INH", unit: "EA", vehicles: [], atmsCodes: ["LAB-ALT-004"], position: "GN" },
  { l1: "ELC", l2: "ALTL", l3: "BRG", nameTh: "เปลี่ยนลูกปืนไดชาร์จ (Front/Rear)", nameEn: "Replace Alternator Bearing F/R", grade: "INH", unit: "EA", vehicles: [], atmsCodes: ["LAB-ALT-005"], position: "GN" },
  { l1: "ELC", l2: "ALTL", l3: "TST", nameTh: "ทดสอบไดชาร์จ วัดค่าแรงดัน/กระแส", nameEn: "Test Alternator Voltage & Current", grade: "INH", unit: "JOB", vehicles: [], atmsCodes: ["LAB-ALT-006"], position: "GN" },
  // ── ELC:STM (มอเตอร์สตาร์ท)
  { l1: "ELC", l2: "STM", l3: "RPL", nameTh: "เปลี่ยนมอเตอร์สตาร์ทั้งตัว", nameEn: "Replace Starter Motor Assembly", grade: "CTR", unit: "EA", vehicles: [], atmsCodes: ["LAB-STM-001"], position: "GN" },
  { l1: "ELC", l2: "STM", l3: "RPR", nameTh: "ซ่อมมอเตอร์สตาร์ท (ตรวจ/ทดสอบ)", nameEn: "Repair & Test Starter Motor", grade: "CTR", unit: "JOB", vehicles: [], atmsCodes: ["LAB-STM-002"], position: "GN" },
  { l1: "ELC", l2: "STM", l3: "SOL", nameTh: "เปลี่ยน Solenoid มอเตอร์สตาร์ท", nameEn: "Replace Starter Solenoid", grade: "INH", unit: "EA", vehicles: [], atmsCodes: ["LAB-STM-003"], position: "GN" },
  { l1: "ELC", l2: "STM", l3: "BND", nameTh: "เปลี่ยน Bendix / Pinion Gear สตาร์ท", nameEn: "Replace Starter Bendix/Pinion", grade: "INH", unit: "EA", vehicles: [], atmsCodes: ["LAB-STM-004"], position: "GN" },
  { l1: "ELC", l2: "STM", l3: "TST", nameTh: "ทดสอบมอเตอร์สตาร์ท", nameEn: "Test Starter Motor", grade: "INH", unit: "JOB", vehicles: [], atmsCodes: ["LAB-STM-005"], position: "GN" },
  { l1: "ELC", l2: "BATL", l3: "TST", nameTh: "ตรวจวิเคราะห์ระบบชาร์จไฟครบชุด", nameEn: "Full Charging System Diagnosis", grade: "INH", unit: "JOB", vehicles: [], atmsCodes: ["LAB-SYS-001"], position: "GN" },
  { l1: "ELC", l2: "ALTL", l3: "RPL", nameTh: "เปลี่ยนไดชาร์จ + สายพาน (ชุด)", nameEn: "Replace Alternator + Belt (Set)", grade: "G1", unit: "SET", vehicles: [], atmsCodes: ["LAB-SYS-002"], position: "GN" },
]

function buildSku(wh: string, type: string, l1: string, l2: string, l3: string, seq: number) {
  return `${wh}-${type}-${l1}-${l2}-${l3}-${String(seq).padStart(4, "0")}`
}

async function main() {
  const client = await MongoClient.connect(URI)
  const col    = client.db(DB).collection("master_codes")
  const skuCol = client.db(DB).collection("master_sku")

  // 1. Seed missing LAB L2 codes
  console.log("\n── Seeding LAB L2 codes under ELC ──")
  for (const l2 of LAB_L2) {
    const id = `SUB_ASSEMBLY_L2:ELC:${l2.code}`
    await col.updateOne(
      { _id: id } as never,
      { $set: { dict: "SUB_ASSEMBLY_L2", code: l2.code, th: l2.th, en: l2.en, parent: "ELC", order: 900, meta: { expenseType: "LAB" } } },
      { upsert: true }
    )
    console.log(`  ✓ L2 ELC:${l2.code} — ${l2.th}`)
  }

  // 2. Seed missing LAB L3 codes
  console.log("\n── Seeding LAB L3 codes ──")
  for (const l3 of LAB_L3) {
    const id = `COMPONENT_L3:${l3.parent}:${l3.code}`
    await col.updateOne(
      { _id: id } as never,
      { $set: { dict: "COMPONENT_L3", code: l3.code, th: l3.th, en: l3.en, parent: l3.parent, order: 900, meta: { expenseType: "LAB" } } },
      { upsert: true }
    )
    console.log(`  ✓ L3 ${l3.parent}:${l3.code} — ${l3.th}`)
  }

  // 3. Parts SKUs
  console.log("\n── Seeding 20 Parts SKUs ──")
  for (const p of PARTS) {
    const prefix = `XX-PRT-${p.l1}-${p.l2}-${p.l3}-`
    const last   = await skuCol.find({ SKU: { $regex: `^${prefix}` } }).sort({ SKU: -1 }).limit(1).toArray()
    const seq    = last.length > 0 ? parseInt(last[0].SKU.split("-").pop() ?? "0") + 1 : 1
    const sku    = buildSku("XX", "PRT", p.l1, p.l2, p.l3, seq)

    await skuCol.insertOne({
      SKU:               sku,
      status:            "approved",
      createdBy:         "seed@menatransport.co.th",
      createdByName:     "Seed Script",
      คลังสินค้า:        "XX",
      ประเภทค่าใช้จ่าย: "PRT",
      ชื่ออะไหล่_TH:    p.nameTh,
      Part_Name_EN:      p.nameEn,
      เบอร์อะไหล่:       p.partNo,
      ระบบ_L1:           p.l1,
      ชุดประกอบ_L2:      p.l2,
      ชิ้นส่วน_L3:       p.l3,
      ตำแหน่ง:           p.position,
      ราคาต่อหน่วย:      p.price,
      หน่วย:             p.unit,
      ยี่ห้อ:            p.brand,
      เบอร์แท้อ้างอิง:   p.oemRef,
      เบอร์เทียบอ้างอิง: p.compatRefs,
      ทะเบียนหรือรุ่นรถ: p.vehicles,
      Grade:             p.grade,
      รหัสATMS:          p.atmsCodes,
      createdAt:         new Date(),
      updatedAt:         new Date(),
    } as never)
    console.log(`  ✓ ${sku}  ${p.nameTh}`)
  }

  // 4. Labor SKUs
  console.log("\n── Seeding 20 Labor SKUs ──")
  for (const lb of LABORS) {
    const prefix = `XX-LAB-${lb.l1}-${lb.l2}-${lb.l3}-`
    const last   = await skuCol.find({ SKU: { $regex: `^${prefix}` } }).sort({ SKU: -1 }).limit(1).toArray()
    const seq    = last.length > 0 ? parseInt(last[0].SKU.split("-").pop() ?? "0") + 1 : 1
    const sku    = buildSku("XX", "LAB", lb.l1, lb.l2, lb.l3, seq)

    await skuCol.insertOne({
      SKU:               sku,
      status:            "approved",
      createdBy:         "seed@menatransport.co.th",
      createdByName:     "Seed Script",
      คลังสินค้า:        "XX",
      ประเภทค่าใช้จ่าย: "LAB",
      ชื่ออะไหล่_TH:    lb.nameTh,
      Part_Name_EN:      lb.nameEn,
      เบอร์อะไหล่:       "",
      ระบบ_L1:           lb.l1,
      ชุดประกอบ_L2:      lb.l2,
      ชิ้นส่วน_L3:       lb.l3,
      ตำแหน่ง:           lb.position,
      ราคาต่อหน่วย:      0,
      หน่วย:             lb.unit,
      ยี่ห้อ:            "",
      เบอร์แท้อ้างอิง:   "",
      เบอร์เทียบอ้างอิง: [],
      ทะเบียนหรือรุ่นรถ: lb.vehicles,
      Grade:             lb.grade,
      รหัสATMS:          lb.atmsCodes,
      createdAt:         new Date(),
      updatedAt:         new Date(),
    } as never)
    console.log(`  ✓ ${sku}  ${lb.nameTh}`)
  }

  await client.close()
  console.log("\nDone ✓")
}

main().catch((e) => { console.error(e); process.exit(1) })
