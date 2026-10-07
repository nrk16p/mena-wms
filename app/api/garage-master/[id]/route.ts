import { NextResponse } from "next/server"

// แก้/ลบรายชื่อใน garage_master ปิดแล้ว (07/10/2569) — ชื่ออู่ใช้ซัพพลายเออร์ใน ATMS เท่านั้น
// เปลี่ยนชื่อใบงานเก่าไปทำที่หน้า /garages (จับคู่อู่กับ ATMS) แทน
const gone = () => NextResponse.json({ error: "แก้รายชื่ออู่ที่นี่ไม่ได้แล้ว — ใช้หน้าจับคู่อู่กับ ATMS (/garages)" }, { status: 410 })
export const PUT = gone
export const DELETE = gone
