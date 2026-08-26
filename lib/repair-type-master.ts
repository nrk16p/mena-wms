// lib/repair-type-master.ts
// ── ประเภทการซ่อม (ยานยนต์) — ทะเบียนกลางตามที่ ATMS ใช้จริง ──────────────
// ตรรกะล้วน ห้าม import อะไรทั้งสิ้น เพื่อให้ทดสอบตรง ๆ ได้ด้วย tsx
//
// รหัส S30–S101 คือ "ประเภทการซ่อม (ยานยนต์)" ชุดใหม่ที่ใช้แทนของเดิม
// ชื่อเต็มประกอบจาก 3 ส่วนเสมอ:  <อู่ใน|อู่นอก> - <หมวด> - <ประเภทงาน>
//   CM  = ซ่อมแก้ไข (corrective)   PM = บำรุงรักษาตามแผน (preventive)
//   T   = ยาง                      AC = อุบัติเหตุ         OTH = อื่น ๆ
//   ทำความสะอาด / แย็กโม่ ไม่มีอักษรหมวดในชื่อ (ตามต้นฉบับ)
//
// สองคอลัมน์แรกของต้นฉบับผูกกับฟิลด์จริงในฐานข้อมูล — นี่คือเหตุผลที่ทะเบียนนี้มีค่า:
//   repairType → `maint_tasks.repair_type`            (ฝั่งใบแจ้งซ่อม MR)
//   purpose    → `stockmovement_v5.จุดประสงค์ในการเบิก` (ฝั่งจัดซื้อ/รับของ)
// ทะเบียนนี้จึงเป็นตัวเชื่อมสองฝั่งที่เดิมต่อกันไม่ได้ (ดูหมายเหตุท้ายไฟล์)

export type GarageSide = "อู่ใน" | "อู่นอก"
export type RepairGroup = "CM" | "PM" | "T" | "AC" | "OTH" | "ทำความสะอาด" | "แย็กโม่"

export type RepairTypeRow = {
  /** รหัสประเภทการซ่อม เช่น "S44" */
  code: string
  /** ชื่อเต็มตามต้นฉบับ เช่น "อู่นอก-CM-ระบบโม่" */
  label: string
  side: GarageSide
  group: RepairGroup
  /** ชื่องานท้ายป้าย เช่น "ระบบโม่" — ใช้จับคู่กันระหว่างอู่ใน/อู่นอก */
  work: string
  /** ประเภทการซ่อม (ยานยนต์) ตามต้นฉบับ = ค่าใน maint_tasks.repair_type
   *  null = ต้นฉบับเว้นว่างไว้ (แถวต่อเนื่องของหมวด PM/T) ยังไม่ยืนยันการจับคู่ */
  repairType: string | null
  /** จุดประสงค์ในการเบิก ตามต้นฉบับ · null = ต้นฉบับเว้นว่าง */
  purpose: string | null
}

/** ต้นฉบับจากฝ่ายยานยนต์ (รับมา 2026-08-26) — เรียงตามรหัส
 *  คู่ อู่ใน/อู่นอก ของงานเดียวกันวางติดกันเสมอ ยกเว้น 3 รหัสที่ต้นฉบับมีด้านเดียวจริง ๆ
 *  (S92 เครื่องมือช่าง มีแต่อู่ใน · S95 ตรวจสภาพถังก๊าซ NGV มีแต่อู่นอก) */
export const REPAIR_TYPES: RepairTypeRow[] = [
  // ── CM: ซ่อมแก้ไข ─────────────────────────────────────────────────────────
  { code: "S30",  label: "อู่ใน-CM-ระบบหัวเก๋ง",                    side: "อู่ใน",  group: "CM", work: "ระบบหัวเก๋ง",                     repairType: "ระบบหัวเก๋ง",                     purpose: "ซ่อม" },
  { code: "S31",  label: "อู่นอก-CM-ระบบหัวเก๋ง",                   side: "อู่นอก", group: "CM", work: "ระบบหัวเก๋ง",                     repairType: "ระบบหัวเก๋ง",                     purpose: "ซ่อม" },
  { code: "S32",  label: "อู่ใน-CM-ระบบเครื่องยนต์",                 side: "อู่ใน",  group: "CM", work: "ระบบเครื่องยนต์",                  repairType: "ระบบเครื่องยนต์",                  purpose: "ซ่อม" },
  { code: "S33",  label: "อู่นอก-CM-ระบบเครื่องยนต์",                side: "อู่นอก", group: "CM", work: "ระบบเครื่องยนต์",                  repairType: "ระบบเครื่องยนต์",                  purpose: "ซ่อม" },
  { code: "S34",  label: "อู่ใน-CM-ระบบช่วงล่าง",                    side: "อู่ใน",  group: "CM", work: "ระบบช่วงล่าง",                     repairType: "ระบบช่วงล่าง",                     purpose: "ซ่อม" },
  { code: "S35",  label: "อู่นอก-CM-ระบบช่วงล่าง",                   side: "อู่นอก", group: "CM", work: "ระบบช่วงล่าง",                     repairType: "ระบบช่วงล่าง",                     purpose: "ซ่อม" },
  { code: "S36",  label: "อู่ใน-CM-ระบบเบรกและคลัตช์",               side: "อู่ใน",  group: "CM", work: "ระบบเบรกและคลัตช์",                repairType: "ระบบเบรค ครัทช์",                 purpose: "ซ่อม" },
  { code: "S37",  label: "อู่นอก-CM-ระบบเบรกและคลัตช์",              side: "อู่นอก", group: "CM", work: "ระบบเบรกและคลัตช์",                repairType: "ระบบเบรค ครัทช์",                 purpose: "ซ่อม" },
  { code: "S38",  label: "อู่ใน-CM-ระบบแอร์และไฟ",                   side: "อู่ใน",  group: "CM", work: "ระบบแอร์และไฟ",                    repairType: "ระบบแอร์ ไฟ",                     purpose: "ซ่อม" },
  { code: "S39",  label: "อู่นอก-CM-ระบบแอร์และไฟ",                  side: "อู่นอก", group: "CM", work: "ระบบแอร์และไฟ",                    repairType: "ระบบแอร์ ไฟ",                     purpose: "ซ่อม" },
  { code: "S40",  label: "อู่ใน-CM-หาง",                             side: "อู่ใน",  group: "CM", work: "หาง",                              repairType: "หาง",                             purpose: "ซ่อม" },
  { code: "S41",  label: "อู่นอก-CM-หาง",                            side: "อู่นอก", group: "CM", work: "หาง",                              repairType: "หาง",                             purpose: "ซ่อม" },
  { code: "S42",  label: "อู่ใน-CM-ปะผุและทำสี",                     side: "อู่ใน",  group: "CM", work: "ปะผุและทำสี",                      repairType: "ปะผุ ทำสี",                       purpose: "ซ่อม" },
  { code: "S43",  label: "อู่นอก-CM-ปะผุและทำสี",                    side: "อู่นอก", group: "CM", work: "ปะผุและทำสี",                      repairType: "ปะผุ ทำสี",                       purpose: "ซ่อม" },
  { code: "S44",  label: "อู่ใน-CM-ระบบโม่",                         side: "อู่ใน",  group: "CM", work: "ระบบโม่",                          repairType: "ระบบโม่",                         purpose: "ซ่อม" },
  { code: "S45",  label: "อู่นอก-CM-ระบบโม่",                        side: "อู่นอก", group: "CM", work: "ระบบโม่",                          repairType: "ระบบโม่",                         purpose: "ซ่อม" },
  { code: "S46",  label: "อู่ใน-CM-ระบบหม้อน้ำและท่อไอเสีย",         side: "อู่ใน",  group: "CM", work: "ระบบหม้อน้ำและท่อไอเสีย",          repairType: "ระบบหม้อน้ำและท่อไอเสีย",         purpose: "ซ่อม" },
  { code: "S47",  label: "อู่นอก-CM-ระบบหม้อน้ำและท่อไอเสีย",        side: "อู่นอก", group: "CM", work: "ระบบหม้อน้ำและท่อไอเสีย",          repairType: "ระบบหม้อน้ำและท่อไอเสีย",         purpose: "ซ่อม" },
  { code: "S48",  label: "อู่ใน-CM-ระบบเกียร์",                      side: "อู่ใน",  group: "CM", work: "ระบบเกียร์",                       repairType: "ระบบเกียร์",                      purpose: "ซ่อม" },
  { code: "S49",  label: "อู่นอก-CM-ระบบเกียร์",                     side: "อู่นอก", group: "CM", work: "ระบบเกียร์",                       repairType: "ระบบเกียร์",                      purpose: "ซ่อม" },
  { code: "S50",  label: "อู่ใน-CM-ปั๊มลม-อุปกรณ์เกี่ยวกับปั๊มลม",    side: "อู่ใน",  group: "CM", work: "ปั๊มลม-อุปกรณ์เกี่ยวกับปั๊มลม",     repairType: "ปั้มลม - อุปกรณ์เกี่ยวกับปั้มลม", purpose: "ซ่อม" },
  { code: "S51",  label: "อู่นอก-CM-ปั๊มลม-อุปกรณ์เกี่ยวกับปั๊มลม",   side: "อู่นอก", group: "CM", work: "ปั๊มลม-อุปกรณ์เกี่ยวกับปั๊มลม",     repairType: "ปั้มลม - อุปกรณ์เกี่ยวกับปั้มลม", purpose: "ซ่อม" },
  { code: "S52",  label: "อู่ใน-CM-ผ้าใบหลอด/ผ้าใบตูดถัง",           side: "อู่ใน",  group: "CM", work: "ผ้าใบหลอด/ผ้าใบตูดถัง",            repairType: "ผ้าใบหลอด / ผ้าใบตูดถัง",         purpose: "ซ่อม" },
  { code: "S53",  label: "อู่นอก-CM-ผ้าใบหลอด/ผ้าใบตูดถัง",          side: "อู่นอก", group: "CM", work: "ผ้าใบหลอด/ผ้าใบตูดถัง",            repairType: "ผ้าใบหลอด / ผ้าใบตูดถัง",         purpose: "ซ่อม" },
  { code: "S54",  label: "อู่ใน-CM-ระบบอุปกรณ์ลงอาหารสัตว์",         side: "อู่ใน",  group: "CM", work: "ระบบอุปกรณ์ลงอาหารสัตว์",          repairType: "ระบบอุปกรณ์ลงอาหารสัตว์",         purpose: "ซ่อม" },
  { code: "S55",  label: "อู่นอก-CM-ระบบอุปกรณ์ลงอาหารสัตว์",        side: "อู่นอก", group: "CM", work: "ระบบอุปกรณ์ลงอาหารสัตว์",          repairType: "ระบบอุปกรณ์ลงอาหารสัตว์",         purpose: "ซ่อม" },
  { code: "S56",  label: "อู่ใน-CM-ตัวถังบอดี้",                     side: "อู่ใน",  group: "CM", work: "ตัวถังบอดี้",                      repairType: "ตัวถังบอดี้",                     purpose: "ซ่อม" },
  { code: "S57",  label: "อู่นอก-CM-ตัวถังบอดี้",                    side: "อู่นอก", group: "CM", work: "ตัวถังบอดี้",                      repairType: "ตัวถังบอดี้",                     purpose: "ซ่อม" },
  { code: "S58",  label: "อู่ใน-CM-ระบบลม",                          side: "อู่ใน",  group: "CM", work: "ระบบลม",                           repairType: "ระบบลม",                          purpose: "ซ่อม" },
  { code: "S59",  label: "อู่นอก-CM-ระบบลม",                         side: "อู่นอก", group: "CM", work: "ระบบลม",                           repairType: "ระบบลม",                          purpose: "ซ่อม" },
  { code: "S60",  label: "อู่ใน-CM-ระบบเชื้อเพลิง",                  side: "อู่ใน",  group: "CM", work: "ระบบเชื้อเพลิง",                   repairType: "ระบบเชื้อเพลิง",                  purpose: "น้ำมันเชื้อเพลิง" },
  { code: "S61",  label: "อู่นอก-CM-ระบบเชื้อเพลิง",                 side: "อู่นอก", group: "CM", work: "ระบบเชื้อเพลิง",                   repairType: "ระบบเชื้อเพลิง",                  purpose: "น้ำมันเชื้อเพลิง" },

  // ── PM: บำรุงรักษาตามแผน ─────────────────────────────────────────────────
  // ต้นฉบับระบุ repairType ไว้แค่ 3 แถวแรกของบล็อกนี้ ที่เหลือเว้นว่าง
  // จึงคง null ไว้ตามต้นฉบับ ไม่เดาแทน (ดูหมายเหตุท้ายไฟล์)
  { code: "S62",  label: "อู่ใน-PM-1",                               side: "อู่ใน",  group: "PM", work: "PM-1",                             repairType: "ระบบบำรุงรักษา", purpose: "PM" },
  { code: "S63",  label: "อู่นอก-PM-1",                              side: "อู่นอก", group: "PM", work: "PM-1",                             repairType: "PMศูนย์บริการ",  purpose: "PM ความเย็น / PM ช่วงล่าง / PM น้ำมันเครื่อง" },
  { code: "S64",  label: "อู่ใน-PM-2",                               side: "อู่ใน",  group: "PM", work: "PM-2",                             repairType: "PMช่างมีนา",     purpose: "PM ช่วงล่าง / PM น้ำมันเครื่อง" },
  { code: "S65",  label: "อู่นอก-PM-2",                              side: "อู่นอก", group: "PM", work: "PM-2",                             repairType: null, purpose: null },
  { code: "S96",  label: "อู่ใน-PM-3",                               side: "อู่ใน",  group: "PM", work: "PM-3",                             repairType: null, purpose: null },
  { code: "S97",  label: "อู่นอก-PM-3",                              side: "อู่นอก", group: "PM", work: "PM-3",                             repairType: null, purpose: null },
  { code: "S98",  label: "อู่ใน-PM-4",                               side: "อู่ใน",  group: "PM", work: "PM-4",                             repairType: null, purpose: null },
  { code: "S99",  label: "อู่นอก-PM-4",                              side: "อู่นอก", group: "PM", work: "PM-4",                             repairType: null, purpose: null },
  { code: "S66",  label: "อู่ใน-PM-ลูกปืนล้อ",                       side: "อู่ใน",  group: "PM", work: "ลูกปืนล้อ",                        repairType: null, purpose: null },
  { code: "S67",  label: "อู่นอก-PM-ลูกปืนล้อ",                      side: "อู่นอก", group: "PM", work: "ลูกปืนล้อ",                        repairType: null, purpose: null },
  { code: "S68",  label: "อู่ใน-PM-ช่วงล่าง",                        side: "อู่ใน",  group: "PM", work: "ช่วงล่าง",                         repairType: null, purpose: null },
  { code: "S69",  label: "อู่นอก-PM-ช่วงล่าง",                       side: "อู่นอก", group: "PM", work: "ช่วงล่าง",                         repairType: null, purpose: null },
  { code: "S70",  label: "อู่ใน-PM-ระบบความเย็น",                    side: "อู่ใน",  group: "PM", work: "ระบบความเย็น",                     repairType: null, purpose: null },
  { code: "S71",  label: "อู่นอก-PM-ระบบความเย็น",                   side: "อู่นอก", group: "PM", work: "ระบบความเย็น",                     repairType: null, purpose: null },
  { code: "S72",  label: "อู่ใน-PM-ลิฟต์ท้าย",                       side: "อู่ใน",  group: "PM", work: "ลิฟต์ท้าย",                        repairType: null, purpose: null },
  { code: "S73",  label: "อู่นอก-PM-ลิฟต์ท้าย",                      side: "อู่นอก", group: "PM", work: "ลิฟต์ท้าย",                        repairType: null, purpose: null },

  // ── T: ยาง ────────────────────────────────────────────────────────────────
  { code: "S74",  label: "อู่ใน-T-ปะยาง",                            side: "อู่ใน",  group: "T",  work: "ปะยาง",                            repairType: "ยาง", purpose: "ยาง" },
  { code: "S75",  label: "อู่นอก-T-ปะยาง",                           side: "อู่นอก", group: "T",  work: "ปะยาง",                            repairType: "ยาง", purpose: "ยาง" },
  { code: "S76",  label: "อู่ใน-T-เปลี่ยนยาง",                       side: "อู่ใน",  group: "T",  work: "เปลี่ยนยาง",                       repairType: "ยาง", purpose: "ยาง" },
  { code: "S77",  label: "อู่นอก-T-เปลี่ยนยาง",                      side: "อู่นอก", group: "T",  work: "เปลี่ยนยาง",                       repairType: "ยาง", purpose: "ยาง" },
  { code: "S78",  label: "อู่ใน-T-เปลี่ยนน็อตล้อ",                   side: "อู่ใน",  group: "T",  work: "เปลี่ยนน็อตล้อ",                   repairType: "ยาง", purpose: "ยาง" },
  { code: "S79",  label: "อู่นอก-T-เปลี่ยนน็อตล้อ",                  side: "อู่นอก", group: "T",  work: "เปลี่ยนน็อตล้อ",                   repairType: "ยาง", purpose: "ยาง" },
  { code: "S80",  label: "อู่ใน-T-เปลี่ยนยางใน",                     side: "อู่ใน",  group: "T",  work: "เปลี่ยนยางใน",                     repairType: "ยาง", purpose: "ยาง" },
  { code: "S81",  label: "อู่นอก-T-เปลี่ยนยางใน",                    side: "อู่นอก", group: "T",  work: "เปลี่ยนยางใน",                     repairType: "ยาง", purpose: "ยาง" },
  { code: "S82",  label: "อู่ใน-T-เปลี่ยนยางรองคอ",                  side: "อู่ใน",  group: "T",  work: "เปลี่ยนยางรองคอ",                  repairType: "ยาง", purpose: "ยาง" },
  { code: "S83",  label: "อู่นอก-T-เปลี่ยนยางรองคอ",                 side: "อู่นอก", group: "T",  work: "เปลี่ยนยางรองคอ",                  repairType: "ยาง", purpose: "ยาง" },

  // ── ทำความสะอาด / แย็กโม่ (ไม่มีอักษรหมวดในชื่อ ตามต้นฉบับ) ───────────────
  { code: "S84",  label: "อู่ใน-ทำความสะอาด",                        side: "อู่ใน",  group: "ทำความสะอาด", work: "ทำความสะอาด",              repairType: "ทำความสะอาด", purpose: "ค่าล้างรถ" },
  { code: "S85",  label: "อู่นอก-ทำความสะอาด",                       side: "อู่นอก", group: "ทำความสะอาด", work: "ทำความสะอาด",              repairType: "ทำความสะอาด", purpose: "ค่าล้างรถ" },
  { code: "S86",  label: "อู่ใน-แย็กโม่",                            side: "อู่ใน",  group: "แย็กโม่",     work: "แย็กโม่",                  repairType: "แยคโม่",      purpose: "แยคโม่" },
  { code: "S87",  label: "อู่นอก-แย็กโม่",                           side: "อู่นอก", group: "แย็กโม่",     work: "แย็กโม่",                  repairType: "แยคโม่",      purpose: "แยคโม่" },

  // ── AC: อุบัติเหตุ ────────────────────────────────────────────────────────
  { code: "S88",  label: "อู่ใน-AC-เคสอุบัติเหตุ",                   side: "อู่ใน",  group: "AC", work: "เคสอุบัติเหตุ",                    repairType: "เคสอุบัติเหตุ", purpose: "ซ่อมอุบัติเหตุ" },
  { code: "S89",  label: "อู่นอก-AC-เคสอุบัติเหตุ",                  side: "อู่นอก", group: "AC", work: "เคสอุบัติเหตุ",                    repairType: "เคสอุบัติเหตุ", purpose: "ซ่อมอุบัติเหตุ" },

  // ── OTH: อื่น ๆ ───────────────────────────────────────────────────────────
  { code: "S90",  label: "อู่ใน-OTH-วัสดุสิ้นเปลือง",                side: "อู่ใน",  group: "OTH", work: "วัสดุสิ้นเปลือง",                 repairType: "วัสดุสิ้นเปลือง", purpose: "อะไหล่/วัสดุสิ้นเปลือง" },
  { code: "S91",  label: "อู่นอก-OTH-วัสดุสิ้นเปลือง",               side: "อู่นอก", group: "OTH", work: "วัสดุสิ้นเปลือง",                 repairType: "วัสดุสิ้นเปลือง", purpose: "อะไหล่/วัสดุสิ้นเปลือง" },
  // ต้นฉบับมีเฉพาะอู่ใน — เครื่องมือช่างไม่ได้จ้างอู่นอกทำ
  { code: "S92",  label: "อู่ใน-OTH-เครื่องมือช่าง",                 side: "อู่ใน",  group: "OTH", work: "เครื่องมือช่าง",                  repairType: "เครื่องมือช่าง",  purpose: "เครื่องมือช่าง - เบิกประจำรถ - เบิกประจำตัวช่าง" },
  { code: "S93",  label: "อู่ใน-OTH-อุปกรณ์เสริม",                   side: "อู่ใน",  group: "OTH", work: "อุปกรณ์เสริม",                    repairType: "อุปกรณ์เสริม",    purpose: "ซ่อม" },
  { code: "S94",  label: "อู่นอก-OTH-อุปกรณ์เสริม",                  side: "อู่นอก", group: "OTH", work: "อุปกรณ์เสริม",                    repairType: "อุปกรณ์เสริม",    purpose: "ซ่อม" },
  // ต้นฉบับมีเฉพาะอู่นอก — งานตรวจถังก๊าซต้องใช้ผู้ตรวจภายนอกที่ได้รับอนุญาต
  { code: "S95",  label: "อู่นอก-OTH-ตรวจสภาพถังก๊าซ NGV (ประจำปี)", side: "อู่นอก", group: "OTH", work: "ตรวจสภาพถังก๊าซ NGV (ประจำปี)",   repairType: "ตรวจสภาพถังก๊าซ NGV (ประจำปี)", purpose: "ซ่อม" },
  { code: "S100", label: "อู่ใน-OTH-อัดจารบี",                       side: "อู่ใน",  group: "OTH", work: "อัดจารบี",                        repairType: null, purpose: null },
  { code: "S101", label: "อู่นอก-OTH-อัดจารบี",                      side: "อู่นอก", group: "OTH", work: "อัดจารบี",                        repairType: null, purpose: null },
]

export const GROUP_LABEL: Record<RepairGroup, string> = {
  CM: "ซ่อมแก้ไข",
  PM: "บำรุงรักษาตามแผน",
  T: "ยาง",
  AC: "อุบัติเหตุ",
  OTH: "อื่น ๆ",
  "ทำความสะอาด": "ทำความสะอาด",
  "แย็กโม่": "แย็กโม่",
}

// ── ดัชนีสำหรับค้นหา ────────────────────────────────────────────────────────

export const BY_CODE = new Map(REPAIR_TYPES.map((r) => [r.code, r]))

/** ชื่องานทั้งหมดแบบไม่ซ้ำ เรียงตามลำดับที่ปรากฏในต้นฉบับ
 *  = แกน "ประเภทงาน" ที่ผู้ใช้เลือกในหน้า /vendors/by-service
 *  อู่ใน/อู่นอก เป็นคนละรหัสแต่เป็นงานเดียวกัน จึงยุบเหลือชื่อเดียว */
export const WORKS: string[] = [...new Set(REPAIR_TYPES.map((r) => r.work))]

/** ประเภทการซ่อม (ยานยนต์) แบบไม่ซ้ำ = ค่าที่คาดว่าจะเจอใน maint_tasks.repair_type */
export const REPAIR_TYPE_NAMES: string[] =
  [...new Set(REPAIR_TYPES.map((r) => r.repairType).filter((x): x is string => !!x))]

/** จุดประสงค์ในการเบิก แบบไม่ซ้ำ ตามที่เขียนในต้นฉบับ (ยังไม่แตกค่า) */
export const PURPOSES_RAW: string[] =
  [...new Set(REPAIR_TYPES.map((r) => r.purpose).filter((x): x is string => !!x))]

/** จุดประสงค์แบบแตกค่าแล้ว — ต้นฉบับใช้ " / " (มีเว้นวรรค) คั่นเมื่อเป็นหลายจุดประสงค์
 *  เช่น "PM ความเย็น / PM ช่วงล่าง / PM น้ำมันเครื่อง" = 3 ค่า
 *  ส่วน "อะไหล่/วัสดุสิ้นเปลือง" ไม่มีเว้นวรรค = ค่าเดียว จึงไม่แตก */
export const PURPOSES: string[] = [...new Set(
  REPAIR_TYPES.flatMap((r) => (r.purpose ?? "").split(/\s+\/\s+/).map((s) => s.trim()).filter(Boolean))
)]

export function byCode(code: string | null | undefined): RepairTypeRow | null {
  return BY_CODE.get((code ?? "").trim().toUpperCase()) ?? null
}

/** แกะรหัสจากข้อความที่อาจมีรหัสฝังอยู่ เช่น "S45 อู่นอก-CM-ระบบโม่" หรือ "[S45]"
 *  ต้องเป็นคำเดี่ยว ๆ ไม่งั้น "LBS30xxx" จะถูกจับผิดตัว */
const CODE_RE = /(?:^|[^A-Za-z0-9])(S(?:3[0-9]|[4-9][0-9]|10[01]))(?![0-9])/

export function extractCode(text: string | null | undefined): string | null {
  const m = CODE_RE.exec(text ?? "")
  return m ? m[1] : null
}

/** จับคู่จากชื่อเต็ม "อู่นอก-CM-ระบบโม่" → แถวในทะเบียน (เทียบแบบตัดช่องว่างทิ้ง
 *  เพราะต้นทางบางที่เว้นวรรครอบขีดไม่เหมือนกัน) */
const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase()
const BY_LABEL = new Map(REPAIR_TYPES.map((r) => [norm(r.label), r]))

export function byLabel(label: string | null | undefined): RepairTypeRow | null {
  return BY_LABEL.get(norm(label ?? "")) ?? null
}

/** แถวทั้งหมดของงานหนึ่ง (คู่ อู่ใน/อู่นอก) */
export function rowsOfWork(work: string): RepairTypeRow[] {
  return REPAIR_TYPES.filter((r) => r.work === work)
}

// หมายเหตุที่ยังต้องยืนยันกับฝ่ายยานยนต์ก่อนเอาไปคิดตัวเลข:
//   1) บล็อก PM — ต้นฉบับกรอก repairType ไว้แค่ S62/S63/S64 ที่เหลือ (S65-S73, S96-S99)
//      เว้นว่าง จึงยังไม่รู้ว่า PM-3 / PM-4 / ลูกปืนล้อ ฯลฯ ตรงกับ repair_type ตัวไหน
//      คงเป็น null ไว้ก่อน ดีกว่าเดาแล้วตัวเลขเพี้ยนโดยไม่มีใครรู้
//   2) S100/S101 อัดจารบี ต้นฉบับไม่ได้ระบุ repairType/purpose เช่นกัน
//   3) ชื่อสะกดต่างกันสองฝั่งเป็นเรื่องปกติและตั้งใจคงไว้ตามต้นฉบับ —
//      "ระบบเบรกและคลัตช์" (ชื่อรหัส) กับ "ระบบเบรค ครัทช์" (repair_type),
//      "แย็กโม่" กับ "แยคโม่" — ใช้ฟิลด์ให้ถูกฝั่งเวลา join อย่าเทียบข้ามกันเอง
