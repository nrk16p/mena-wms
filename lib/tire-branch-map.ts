// lib/tire-branch-map.ts — สาขา ATMS → สาขาของโมดูลยาง (ไม่มี import — ทดสอบตรงด้วย tsx ได้)
//
// ATMS branch_id: 2=ลาดกระบัง, 3=สระบุรี, 5=ขอนแก่น, 7=DIST
//   • ขอนแก่น + DIST รวมเข้า ลาดกระบัง — คลังลาดกระบังดูแล DIST (ผู้ใช้แจ้ง 17/09/2026
//     เดิม DIST รวมอยู่สระบุรีตั้งแต่ 3292f08) · สระบุรี = branch 3 อย่างเดียว
export const BRANCH_IDS: Record<string, string[]> = {
  latkrabang: ["2", "5", "7"],
  saraburi:   ["3"],
}

// สต็อกยาง (tire_stock) ของ DIST ลงทะเบียนไว้ใต้สระบุรี (ผู้ใช้ยืนยัน 17/09/2026)
// ย้ายสาขาแสดงผลแล้ว แต่การอัปเดตสถานะสต็อก (ขาย/หล่อดอก) ของแถว DIST ต้องไปหาที่สระบุรีเหมือนเดิม
const STOCK_BRANCH_BY_ATMS_ID: Record<string, string> = { "7": "saraburi" }

/** สาขาที่ใช้หาเส้นยางใน tire_stock สำหรับแถวที่มาจาก ATMS branch_id นี้ */
export function stockBranchFor(branch: string, atmsBranchId: string): string {
  return STOCK_BRANCH_BY_ATMS_ID[atmsBranchId] ?? branch
}
