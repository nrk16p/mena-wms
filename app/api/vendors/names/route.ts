// app/api/vendors/names/route.ts — รายชื่ออู่/คู่ค้าชุดเดียวกับหน้า /vendors (AVL) แบบเบา ๆ
// ใช้เป็นแหล่งเดียวของช่องเลือก supplier ในใบเทียบราคา (ผู้ใช้กำหนด 2026-09-10: S1–S4 ต้องมาจาก /vendors เท่านั้น)
// ใช้ getVendors() ตัวเดียวกับหน้า (raw cache 1 ชม.) จึงได้ครบ 339 ราย ไม่ใช่แค่ที่มีเอกสารอนุมัติ
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getVendors } from "@/lib/vendor"

export const dynamic = "force-dynamic"

export async function GET() {
  const s = await getServerSession(authOptions)
  if (!s?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  try {
    const d = await getVendors()
    const vendors = d.vendors
      .map((v) => ({ vendor: v.vendor, status: v.status, kind: v.kind ?? "", jobs: v.jobs, lastYm: v.lastYm }))
      .sort((a, b) => a.vendor.localeCompare(b.vendor, "th"))
    return NextResponse.json({ vendors })
  } catch (e) {
    console.error("[vendors/names] GET", e)
    return NextResponse.json({ error: "โหลดรายชื่ออู่ไม่สำเร็จ" }, { status: 500 })
  }
}
