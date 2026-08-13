"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Landmark, Search } from "lucide-react"
import { swalError, swalToast } from "@/lib/swal"
import { CREDIT_TERMS } from "@/lib/ap-tracking"

const mitr = { fontFamily: "var(--font-mitr), sans-serif" }
type Supplier = { name: string; creditTerm: string; updatedBy?: string }

export function ApSuppliersPage() {
  const [items, setItems] = useState<Supplier[]>([])
  const [q, setQ]         = useState("")
  const [newName, setNewName] = useState("")

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ap-suppliers")
      const d   = await res.json()
      if (!res.ok) throw new Error(d?.error ?? "โหลดไม่สำเร็จ")
      setItems(d)
    } catch (e) { swalError(`โหลดไม่สำเร็จ${e instanceof Error && e.message ? ` · ${e.message}` : ""}`) }
  }, [])
  useEffect(() => { load() }, [load])

  const save = async (name: string, creditTerm: string) => {
    setItems((xs) => xs.some((x) => x.name === name)
      ? xs.map((x) => (x.name === name ? { ...x, creditTerm } : x))
      : [...xs, { name, creditTerm }].sort((a, b) => a.name.localeCompare(b.name)))
    try {
      const res = await fetch("/api/ap-suppliers", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, creditTerm }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error ?? "บันทึกไม่สำเร็จ")
      swalToast("success", `บันทึก ${name} · ${creditTerm || "ไม่ระบุ"}`)
    } catch (e) {
      swalError(`บันทึกไม่สำเร็จ${e instanceof Error && e.message ? ` · ${e.message}` : ""}`)
      load()
    }
  }

  const shown = useMemo(() => {
    if (!q) return items
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
    return items.filter((x) => rx.test(x.name))
  }, [items, q])

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Landmark className="w-6 h-6 text-emerald-600" />
        <h1 className="text-lg font-bold text-[#14271C] dark:text-white" style={mitr}>เครดิตเทอมเจ้าหนี้</h1>
        <span className="text-xs text-gray-500">{items.length} ราย</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาซัพพลายเออร์"
            className="rounded-lg border pl-8 pr-3 py-1.5 text-sm w-72 bg-white dark:bg-white/5" />
        </div>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="เพิ่มซัพพลายเออร์ใหม่"
          className="rounded-lg border px-3 py-1.5 text-sm w-72 bg-white dark:bg-white/5" />
        <button onClick={() => { const n = newName.trim(); if (n) { save(n, "30D"); setNewName("") } }}
          className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-white/5">เพิ่ม (30D)</button>
      </div>

      <div className="rounded-xl border dark:border-white/10 overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-white/5 text-xs text-gray-600 dark:text-gray-300">
            <tr>
              <th className="px-3 py-2 text-left">ซัพพลายเออร์</th>
              <th className="px-3 py-2 text-left w-40">เครดิตเทอม</th>
              <th className="px-3 py-2 text-left w-40">แก้ไขล่าสุดโดย</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((x) => (
              <tr key={x.name} className="border-t dark:border-white/10">
                <td className="px-3 py-2">{x.name}</td>
                <td className="px-3 py-2">
                  <select value={x.creditTerm} onChange={(e) => save(x.name, e.target.value)}
                    className="rounded-lg border px-2 py-1 text-sm bg-white dark:bg-white/5">
                    <option value="">ไม่ระบุ</option>
                    {CREDIT_TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2 text-xs text-gray-500">{x.updatedBy || "—"}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={3} className="px-3 py-10 text-center text-gray-400">ไม่พบซัพพลายเออร์</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
