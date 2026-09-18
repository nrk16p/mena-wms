// lib/vendor-brand.ts — อัตลักษณ์หน้าอู่ (public) ตามเว็บทางการ menatransport.co.th
// ไฟล์นี้ไม่มี "use client" — ใช้ได้ทั้ง server component (layout) และ client component
// สี/ฟอนต์วัดจากเว็บทางการ 2026-09-18: ฟอนต์ Prompt · เขียวองค์กร #046132 · แดงโลโก้ใช้เป็นจุดเน้นเท่านั้น
export const BRAND = {
  font: "'Prompt', sans-serif",
  green: "#046132",      // สีหลัก (หัวข้อ/ปุ่ม)
  greenDark: "#023A1E",  // แถบท้าย/เงาภาพ
  green2: "#338B5F",     // สถานะกรอกแล้ว
  greenTint: "#E8F1EC",  // พื้นเขียวอ่อน (แถวที่เลือก/ไอคอน)
  red: "#EC1C24",        // จุดเน้นจากโลโก้ — ใช้น้อย
  ink: "#212529",
  body: "#343A40",
  muted: "#6C757D",
  line: "#DEE2E6",
  field: "#CED4DA",
  bg: "#F3F4F5",
  white: "#FFFFFF",
} as const

export const COMPANY = {
  nameTh: "บริษัท มีนาทรานสปอร์ต จำกัด (มหาชน)",
  nameEn: "Mena Transport Public Company Limited",
  address: "455/12-14 ถนนพระรามหก แขวงถนนเพชรบุรี เขตราชเทวี กรุงเทพมหานคร 10400",
  site: "https://www.menatransport.co.th/th/home",
} as const
