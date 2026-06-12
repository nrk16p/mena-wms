// normalize status variants: "in-stock" / "in stock" / "instock" → "In Stock"
export function normStatus(s: unknown): string {
  const t = String(s ?? "").trim()
  if (t.toLowerCase().replace(/[-_\s]+/g, "") === "instock") return "In Stock"
  return t || "In Stock"
}
