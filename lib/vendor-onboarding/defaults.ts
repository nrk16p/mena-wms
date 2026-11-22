// ค่าเริ่มต้นสำหรับ seed — ถอดจาก ใบคัดเลือกผู้ส่งมอบ_Rev1_TW28.11.68(2).xlsx
// seed ครั้งเดียวตอนคอลเลกชันว่าง หลังจากนั้นฐานข้อมูลคือของจริง (แก้ผ่านหน้า settings)
import type { Criterion, DocSlot } from "./types"

export const DEFAULT_CRITERIA: Criterion[] = [
  // 1. ความน่าเชื่อถือของบริษัท
  { key: "1.1", category: 1, order: 10, label: "ใบอนุญาตประกอบการหรือทะเบียนพาณิชย์", vendorQuestion: "มีใบอนุญาตประกอบการหรือทะเบียนพาณิชย์ไหม", input: { kind: "yesno" }, active: true },
  { key: "1.2", category: 1, order: 20, label: "ที่ตั้งบริษัทหรือสถานประกอบการชัดเจน ตรวจสอบได้", vendorQuestion: null, input: { kind: "none" }, active: true },
  { key: "1.3", category: 1, order: 30, label: "อายุการดำเนินงาน (เกณฑ์ 3 ปี)", vendorQuestion: "เปิดกิจการมากี่ปี", input: { kind: "number", unit: "ปี" }, suggestMin: 3, active: true },
  { key: "1.4", category: 1, order: 40, label: "มีผลงานหรือลูกค้าอ้างอิงได้", vendorQuestion: "ลูกค้าหลักหรือผลงานที่อ้างอิงได้ (ใส่ชื่อ 1–3 ราย)", input: { kind: "text", placeholder: "เช่น บริษัท A, บริษัท B" }, active: true },
  { key: "1.5", category: 1, order: 50, label: "สถานะการเงินอยู่ในเกณฑ์ดี - รายได้ปีล่าสุด", vendorQuestion: "รายได้ปีล่าสุด และกำไรหรือขาดทุน", input: { kind: "text", placeholder: "เช่น รายได้ 12 ล้าน กำไร 1.2 ล้าน" }, active: true },
  // 2. การบริหารคุณภาพ
  { key: "2.1", category: 2, order: 10, label: "มีมาตรฐานคุณภาพ เช่น ISO หรือเทียบเท่า", vendorQuestion: "มีมาตรฐาน ISO หรือเทียบเท่าไหม ระบุชื่อมาตรฐาน (ไม่มีเว้นว่าง)", input: { kind: "text", placeholder: "เช่น ISO 9001" }, active: true },
  { key: "2.2", category: 2, order: 20, label: "มีระบบตรวจสอบคุณภาพก่อนส่งมอบ", vendorQuestion: "ตรวจคุณภาพสินค้าก่อนส่งมอบไหม", input: { kind: "yesno" }, active: true },
  { key: "2.3", category: 2, order: 30, label: "มีการรับประกันสินค้า/บริการ", vendorQuestion: "มีรับประกันสินค้าหรือบริการไหม", input: { kind: "yesno" }, active: true },
  { key: "2.4", category: 2, order: 40, label: "มีการควบคุมคุณภาพอย่างสม่ำเสมอและเป็นลายลักษณ์อักษร", vendorQuestion: "มีขั้นตอนควบคุมคุณภาพเป็นเอกสารไหม", input: { kind: "yesno" }, active: true },
  // 3. ด้านราคาและเงื่อนไขการค้า
  { key: "3.1", category: 3, order: 10, label: "ราคามีความสามารถในการแข่งขันในตลาด", vendorQuestion: null, input: { kind: "none" }, active: true },
  { key: "3.2", category: 3, order: 20, label: "เงื่อนไขการชำระเงิน เครดิต (วัน)", vendorQuestion: "ให้เครดิตกี่วัน (เงินสด = 0)", input: { kind: "number", unit: "วัน" }, active: true },
  { key: "3.3", category: 3, order: 30, label: "มีส่วนลดปริมาณหรือเงื่อนไขเชิงพาณิชย์ระยะยาว", vendorQuestion: "มีส่วนลดตามปริมาณหรือสัญญาระยะยาวไหม", input: { kind: "yesno" }, active: true },
  // 4. ความสามารถในการส่งมอบ
  { key: "4.1", category: 4, order: 10, label: "ส่งมอบตรงเวลาอย่างสม่ำเสมอ", vendorQuestion: null, input: { kind: "none" }, active: true },
  { key: "4.2", category: 4, order: 20, label: "ระยะเวลานำส่ง (Lead Time) เหมาะสม", vendorQuestion: "ปกติส่งของได้ภายในกี่วันหลังได้ PO", input: { kind: "number", unit: "วัน" }, active: true },
  { key: "4.3", category: 4, order: 30, label: "มีระบบติดตามสถานะงาน/สินค้า", vendorQuestion: "ลูกค้าติดตามสถานะงานหรือสินค้าได้ไหม", input: { kind: "yesno" }, active: true },
  { key: "4.4", category: 4, order: 40, label: "มีแผนสำรองเมื่อเกิดเหตุล่าช้าหรือของขาด", vendorQuestion: "มีแผนสำรองตอนของขาดหรือส่งช้าไหม", input: { kind: "yesno" }, active: true },
  // 5. การบริการและการดูแลลูกค้า
  { key: "5.1", category: 5, order: 10, label: "มีทีมบริการหลังการขาย", vendorQuestion: "มีทีมบริการหลังการขายไหม", input: { kind: "yesno" }, active: true },
  { key: "5.2", category: 5, order: 20, label: "มีช่องทางติดต่อหลายช่องทาง", vendorQuestion: "ช่องทางติดต่อที่มี (โทร, LINE, อีเมล ฯลฯ)", input: { kind: "text", placeholder: "เช่น โทร, LINE, อีเมล" }, active: true },
  { key: "5.3", category: 5, order: 30, label: "ตอบสนองรวดเร็วและแก้ปัญหาได้อย่างมีประสิทธิภาพ", vendorQuestion: null, input: { kind: "none" }, active: true },
  // 6. ความปลอดภัย กฎหมาย และสิ่งแวดล้อม
  { key: "6.1", category: 6, order: 10, label: "ปฏิบัติตามกฎหมายและมาตรฐานด้านความปลอดภัย", vendorQuestion: "ทำตามกฎหมายและมาตรฐานด้านความปลอดภัยไหม", input: { kind: "yesno" }, active: true },
  { key: "6.2", category: 6, order: 20, label: "มีมาตรการหรือแนวทางด้านสิ่งแวดล้อม", vendorQuestion: "มีมาตรการด้านสิ่งแวดล้อมไหม", input: { kind: "yesno" }, active: true },
]

export const DEFAULT_DOC_SLOTS: DocSlot[] = [
  { key: "selection_form", group: "ข้อมูลผู้ส่งมอบ", label: "ใบคัดเลือกผู้ส่งมอบ", requirement: "system", hint: "ทำผ่านระบบ", order: 10, active: true },
  { key: "new_creditor_form", group: "ข้อมูลผู้ส่งมอบ", label: "ใบขอเปิดเจ้าหนี้รายใหม่", requirement: "system", hint: "ทำผ่านระบบ", order: 20, active: true },
  { key: "company_profile", group: "ข้อมูลผู้ส่งมอบ", label: "Company Profile", requirement: "required_company", order: 30, active: true },
  { key: "company_cert", group: "ข้อมูลผู้ส่งมอบ", label: "หนังสือรับรองบริษัท (อายุไม่เกิน 6 เดือน)", requirement: "required_company", order: 40, active: true },
  { key: "signer_id_card", group: "ข้อมูลผู้ส่งมอบ", label: "สำเนาบัตรประชาชนผู้มีอำนาจลงนาม", requirement: "required", order: 50, active: true },
  { key: "commercial_reg", group: "ด้านกฎหมายและการจดทะเบียน", label: "ใบทะเบียนพาณิชย์ / ใบทะเบียนการค้า", requirement: "required_company", order: 60, active: true },
  { key: "pp20", group: "ด้านกฎหมายและการจดทะเบียน", label: "ใบทะเบียนภาษีมูลค่าเพิ่ม (ภ.พ.20)", requirement: "required_company", order: 70, active: true },
  { key: "power_of_attorney", group: "ด้านกฎหมายและการจดทะเบียน", label: "หนังสือมอบอำนาจ", requirement: "optional", hint: "ถ้ามีผู้ลงนามแทน", order: 80, active: true },
  { key: "iso_cert", group: "ด้านมาตรฐานคุณภาพ", label: "ใบรับรองมาตรฐาน (ISO 9001 / ISO 14001 / อื่น ๆ)", requirement: "optional", order: 90, active: true },
  { key: "dealer_cert", group: "ด้านมาตรฐานคุณภาพ", label: "ใบรับรองผู้แทนจำหน่ายจากแบรนด์ต้นสังกัด", requirement: "optional", order: 100, active: true },
  { key: "test_report", group: "ด้านมาตรฐานคุณภาพ", label: "ผลการทดสอบ / Test Report", requirement: "optional", order: 110, active: true },
  { key: "financial_stmt", group: "ด้านการเงินและเครดิต", label: "งบการเงินย้อนหลัง", requirement: "optional", order: 120, active: true },
  { key: "bank_reference", group: "ด้านการเงินและเครดิต", label: "หนังสือรับรองเครดิตจากธนาคาร (Bank Reference Letter)", requirement: "optional", order: 130, active: true },
  { key: "credit_term", group: "ด้านการเงินและเครดิต", label: "รายละเอียดเงื่อนไขเครดิต (Credit Term)", requirement: "optional", order: 140, active: true },
  { key: "bookbank", group: "ด้านการเงินและเครดิต", label: "สำเนาหน้า Bookbank", requirement: "required", order: 150, active: true },
  { key: "product_list", group: "ด้านสินค้าและบริการ", label: "รายการสินค้า/บริการที่เสนอ", requirement: "optional", order: 160, active: true },
  { key: "catalog", group: "ด้านสินค้าและบริการ", label: "เอกสารสเปกสินค้า / Catalog", requirement: "optional", order: 170, active: true },
  { key: "quotation", group: "ด้านสินค้าและบริการ", label: "ใบเสนอราคาเบื้องต้น (Quotation)", requirement: "optional", order: 180, active: true },
  { key: "warranty_terms", group: "ด้านสินค้าและบริการ", label: "เงื่อนไขการรับประกันสินค้า/บริการ", requirement: "optional", order: 190, active: true },
  { key: "reference_list", group: "ประสบการณ์และลูกค้าอ้างอิง", label: "รายชื่อลูกค้าสำคัญ (Reference List)", requirement: "optional", order: 200, active: true },
  { key: "project_reference", group: "ประสบการณ์และลูกค้าอ้างอิง", label: "ประวัติผลงาน / Project Reference", requirement: "optional", order: 210, active: true },
  { key: "pdpa", group: "เอกสาร PDPA", label: "เอกสาร PDPA", requirement: "system", hint: "ติ๊กยินยอมผ่านระบบ", order: 220, active: true },
]

export const DEFAULT_SETTINGS = {
  _id: "default",
  passThreshold: 15,
  reviewerEmails: ["nopparut.a@menatransport.co.th"], // พี่นพ ผู้ช่วยผู้จัดการ (ผู้ใช้ยืนยัน 2026-11-22)
  approverEmails: [] as string[],                      // คุณอาม ผู้จัดการจัดซื้อ — รออีเมล
  linkDays: 14,
}
