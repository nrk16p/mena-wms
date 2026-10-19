// หมวดงาน 9 หมวดของหน้าสรุปอู่ — แยกไฟล์ออกมาให้ฝั่งหน้าเว็บ (ไฟล์ Excel) ใช้ได้ด้วย
import type { GarageHit } from "@/lib/garage-geo"

/** 9 หมวดงานตามชีตยานยนต์ — คอลัมน์ "ครอบคลุมงาน" ในหน้าสรุป (รหัส AVL ที่นับว่าทำหมวดนั้นได้) */
export const COVERAGE_WORKS: { label: string; fleet: string; codes: string[] }[] = [
  { label: "ช่วงล่าง/เบรก", fleet: "ช่วงล่าง/เบรค/คลัทซ์", codes: ["S35", "S37"] },
  { label: "เครื่องยนต์", fleet: "เครื่องยนต์", codes: ["S33"] },
  { label: "ระบบโม่", fleet: "ระบบโม่", codes: ["S45"] },
  { label: "ตัวถัง", fleet: "ตัวถัง/บอดี้", codes: ["S57", "S43"] },
  { label: "นอกสถานที่", fleet: "นอกสถานที่", codes: [] },
  { label: "แอร์", fleet: "แอร์", codes: ["S39"] },
  { label: "หัวฉีด/ปั๊ม", fleet: "หัวฉีด/ปั้ม", codes: ["S61"] },
  { label: "ฟิล์ม", fleet: "ติดฟิลม์", codes: [] },
  { label: "ท่อไอเสีย", fleet: "ทำท่อไอเสีย", codes: ["S47"] },
]

export const doesWork = (g: GarageHit, w: (typeof COVERAGE_WORKS)[number]) =>
  g.fleetWorks.includes(w.fleet) || w.codes.some((c) => g.codes.includes(c))

