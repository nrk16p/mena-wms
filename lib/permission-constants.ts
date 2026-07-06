// Client-safe constants — no server-only imports here.

// The one and only superadmin — not grantable via the admin UI.
export const SUPERADMIN_EMAIL = "narongkorn.a@menatransport.co.th"

export const SECTION_KEYS = ["sku", "tire", "procurement", "report"] as const
export type SectionKey = (typeof SECTION_KEYS)[number]

export const SECTION_LABELS: Record<SectionKey, string> = {
  sku:         "จัดการ SKU (รายการ/แคตาล็อก/ยานพาหนะ/โค้ด)",
  tire:        "จัดการยาง (รวมสเปคยาง)",
  procurement: "จัดซื้อ",
  report:      "รายงาน ATMS",
}

// Unassigned users keep pre-permission behavior: everything except report.
export const DEFAULT_ACCESS: SectionKey[] = ["sku", "tire", "procurement"]
