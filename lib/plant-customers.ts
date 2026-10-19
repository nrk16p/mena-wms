// ลูกค้าเจ้าของแพล้นท์ (ช่อง "บริการ" ในแผนที่ยานยนต์ — scripts/tag-plant-customers.mjs)
// สีใช้ชุดเดียวกับหมุดในแผนที่เดิม คนคุ้นตาอยู่แล้ว
// โลโก้: วางไฟล์ที่ public/logos/<key>.png แล้วหน้าแผนที่จะใช้รูปแทนป้ายตัวอักษรเอง
"use client"
import { useEffect, useState } from "react"

export type CustomerKey = "CPAC" | "ASIA" | "SCCO" | "KPAC" | "OTHER"
export const CUSTOMERS: { key: CustomerKey; label: string; color: string }[] = [
  { key: "CPAC", label: "CPAC", color: "#0288D1" },
  { key: "ASIA", label: "ASIA", color: "#0F9D58" },
  { key: "SCCO", label: "SCCO", color: "#C2185B" },
  { key: "KPAC", label: "KPAC", color: "#E65100" },
  { key: "OTHER", label: "ลูกค้าอื่น", color: "#5B6B80" },
]
export const customerOf = (c?: string): CustomerKey =>
  (CUSTOMERS.find((x) => x.key !== "OTHER" && x.key === (c ?? "").toUpperCase())?.key ?? "OTHER")
export const customerColor = (k: CustomerKey) => CUSTOMERS.find((x) => x.key === k)!.color
export const logoUrl = (k: CustomerKey) => `/logos/${k.toLowerCase()}.png`

/** เช็กครั้งเดียวว่ามีไฟล์โลโก้ของเจ้าไหนบ้าง (ไม่มีก็ใช้ป้ายตัวอักษร) */
export function useCustomerLogos() {
  const [ok, setOk] = useState<Partial<Record<CustomerKey, boolean>>>({})
  useEffect(() => {
    for (const { key } of CUSTOMERS) {
      if (key === "OTHER") continue
      const img = new Image()
      img.onload = () => setOk((s) => ({ ...s, [key]: true }))
      img.src = logoUrl(key)
    }
  }, [])
  return ok
}

/** HTML ของป้ายลูกค้า ใช้ทั้งหมุดบนแผนที่ (Leaflet divIcon) และรายการค้นหา */
export function badgeHtml(k: CustomerKey, name: string | undefined, hasLogo: boolean) {
  const color = customerColor(k)
  if (hasLogo) return `<img src="${logoUrl(k)}" alt="${k}" style="height:18px;max-width:44px;object-fit:contain;background:#fff;border-radius:5px;padding:1px 3px;border:1.5px solid ${color};box-shadow:0 1px 3px rgba(0,0,0,.35)">`
  const text = k === "OTHER" ? (name || "แพล้นท์").slice(0, 6) : k
  return `<div style="display:inline-block;white-space:nowrap;font:700 9px/1 system-ui,sans-serif;letter-spacing:.3px;color:#fff;background:${color};border:1.5px solid #fff;border-radius:5px;padding:3px 4px;box-shadow:0 1px 3px rgba(0,0,0,.35)">${text.replace(/[<>&"]/g, "")}</div>`
}
