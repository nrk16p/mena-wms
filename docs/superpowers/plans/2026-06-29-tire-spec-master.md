# Tire Spec Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a `tire_spec_master` collection that stores brand/size/model/distance combos so stock entry auto-fills ระยะทาง (and optionally productName/productCode) from master — no more manual entry per row.

**Architecture:** New MongoDB collection `tire_spec_master` (global, not branch-specific) backed by a REST API. A management UI page lets admins add/edit/delete specs. The bulk-add page (`TireStockAddPage`) and the inline edit in `TireStockPage` both call a `/api/tire-spec-master/lookup` endpoint to auto-fill fields when brand+size+model are set.

**Tech Stack:** Next.js 14 App Router, MongoDB (via existing `clientPromise`), TypeScript, Tailwind CSS, lucide-react icons — same as the rest of the project.

## Global Constraints

- DB name comes from `process.env.MONGO_DB ?? "master_data"` — never hard-code it
- Collection name: `tire_spec_master`
- All API routes under `app/api/tire-spec-master/`
- Management UI at `/tire/master` (not branch-scoped — specs are global)
- Follow existing code style: no comments unless non-obvious, no trailing summaries, Tailwind only (no CSS files)
- `normStatus` pattern already exists in `lib/tire.ts` — do not duplicate it

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `app/api/tire-spec-master/route.ts` | Create | GET list + POST create |
| `app/api/tire-spec-master/[id]/route.ts` | Create | PUT update + DELETE |
| `app/api/tire-spec-master/lookup/route.ts` | Create | GET lookup by brand+size+model → returns distance+productName+productCode |
| `components/tire-spec-master-page.tsx` | Create | Full CRUD management UI |
| `app/tire/master/page.tsx` | Create | Route wrapper for management UI |
| `components/sidebar.tsx` | Modify | Add "จัดการสเปคยาง" link under a new "ตั้งค่า" group |
| `components/tire-stock-add-page.tsx` | Modify | On brand/size/model change → call lookup → auto-fill distance, productName, productCode |

---

## Task 1: API — CRUD + Lookup

**Files:**
- Create: `app/api/tire-spec-master/route.ts`
- Create: `app/api/tire-spec-master/[id]/route.ts`
- Create: `app/api/tire-spec-master/lookup/route.ts`

**Interfaces:**
- Produces:
  - `GET /api/tire-spec-master` → `TireSpec[]`
  - `POST /api/tire-spec-master` body `{ brand, tireSize, tireModel, distance, productCode?, productName? }` → `TireSpec`
  - `PUT /api/tire-spec-master/[id]` body same as POST → `TireSpec`
  - `DELETE /api/tire-spec-master/[id]` → `{ ok: true }`
  - `GET /api/tire-spec-master/lookup?brand=X&tireSize=Y&tireModel=Z` → `TireSpec | null`

```ts
type TireSpec = {
  _id: string
  brand: string
  tireSize: string
  tireModel: string
  distance: number
  productCode: string
  productName: string
  createdAt: Date
  updatedAt: Date
}
```

- [ ] **Step 1: Create `app/api/tire-spec-master/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { ObjectId } from "mongodb"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "tire_spec_master"

export async function GET() {
  const client = await clientPromise
  const docs = await client.db(DB).collection(COLL)
    .find({})
    .sort({ brand: 1, tireSize: 1, tireModel: 1 })
    .toArray()
  return NextResponse.json(docs)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const brand     = String(body.brand     ?? "").trim()
  const tireSize  = String(body.tireSize  ?? "").trim()
  const tireModel = String(body.tireModel ?? "").trim()
  const distance  = Number(body.distance) || 0

  if (!brand)     return NextResponse.json({ error: "กรุณาระบุยี่ห้อ" },    { status: 400 })
  if (!tireSize)  return NextResponse.json({ error: "กรุณาระบุขนาดยาง" }, { status: 400 })
  if (!tireModel) return NextResponse.json({ error: "กรุณาระบุรุ่นยาง" },  { status: 400 })
  if (distance <= 0) return NextResponse.json({ error: "กรุณาระบุระยะทาง" }, { status: 400 })

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await col.findOne({ brand, tireSize, tireModel } as any)
  if (existing) return NextResponse.json({ error: `สเปค ${brand} ${tireSize} ${tireModel} มีอยู่แล้ว` }, { status: 409 })

  const doc = {
    brand, tireSize, tireModel, distance,
    productCode: String(body.productCode ?? "").trim(),
    productName: String(body.productName ?? "").trim(),
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await col.insertOne(doc as any)
  return NextResponse.json({ ...doc, _id: result.insertedId }, { status: 201 })
}
```

- [ ] **Step 2: Create `app/api/tire-spec-master/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"
import { ObjectId } from "mongodb"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "tire_spec_master"

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json()
  const brand     = String(body.brand     ?? "").trim()
  const tireSize  = String(body.tireSize  ?? "").trim()
  const tireModel = String(body.tireModel ?? "").trim()
  const distance  = Number(body.distance) || 0

  if (!brand || !tireSize || !tireModel || distance <= 0)
    return NextResponse.json({ error: "ข้อมูลไม่ครบ" }, { status: 400 })

  let oid: ObjectId
  try { oid = new ObjectId(params.id) } catch { return NextResponse.json({ error: "invalid id" }, { status: 400 }) }

  const client = await clientPromise
  const col    = client.db(DB).collection(COLL)

  const update = {
    brand, tireSize, tireModel, distance,
    productCode: String(body.productCode ?? "").trim(),
    productName: String(body.productName ?? "").trim(),
    updatedAt: new Date(),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await col.updateOne({ _id: oid } as any, { $set: update })
  return NextResponse.json({ _id: params.id, ...update })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  let oid: ObjectId
  try { oid = new ObjectId(params.id) } catch { return NextResponse.json({ error: "invalid id" }, { status: 400 }) }

  const client = await clientPromise
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.db(DB).collection(COLL).deleteOne({ _id: oid } as any)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Create `app/api/tire-spec-master/lookup/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server"
import clientPromise from "@/lib/mongo"

const DB   = process.env.MONGO_DB ?? "master_data"
const COLL = "tire_spec_master"

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const brand     = searchParams.get("brand")?.trim()     ?? ""
  const tireSize  = searchParams.get("tireSize")?.trim()  ?? ""
  const tireModel = searchParams.get("tireModel")?.trim() ?? ""

  if (!brand || !tireSize || !tireModel)
    return NextResponse.json(null)

  const client = await clientPromise
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = await client.db(DB).collection(COLL).findOne({ brand, tireSize, tireModel } as any)
  return NextResponse.json(doc ?? null)
}
```

- [ ] **Step 4: Verify APIs manually**

```bash
# from project root
curl "http://localhost:3000/api/tire-spec-master" 
# → []

curl -X POST "http://localhost:3000/api/tire-spec-master" \
  -H "Content-Type: application/json" \
  -d '{"brand":"Bridgestone","tireSize":"295/80R22.5","tireModel":"R249","distance":120000,"productCode":"BS-R249-29580","productName":"Bridgestone R249 295/80R22.5"}'
# → 201 with _id

curl "http://localhost:3000/api/tire-spec-master/lookup?brand=Bridgestone&tireSize=295/80R22.5&tireModel=R249"
# → { brand, tireSize, tireModel, distance: 120000, ... }
```

- [ ] **Step 5: Commit**

```bash
git add app/api/tire-spec-master/
git commit -m "feat: add tire-spec-master CRUD + lookup API"
```

---

## Task 2: Management UI

**Files:**
- Create: `components/tire-spec-master-page.tsx`
- Create: `app/tire/master/page.tsx`
- Modify: `components/sidebar.tsx` — add nav link

**Interfaces:**
- Consumes: `GET/POST /api/tire-spec-master`, `PUT/DELETE /api/tire-spec-master/[id]`

- [ ] **Step 1: Create `app/tire/master/page.tsx`**

```tsx
import { Suspense } from "react"
import { TireSpecMasterPage } from "@/components/tire-spec-master-page"

export default function TireMasterPage() {
  return (
    <Suspense>
      <TireSpecMasterPage />
    </Suspense>
  )
}
```

- [ ] **Step 2: Create `components/tire-spec-master-page.tsx`**

```tsx
"use client"

import { useState, useEffect } from "react"
import { Plus, Pencil, Trash2, Check, X, BookOpen } from "lucide-react"
import { swalDeleteConfirm, swalToast, swalError } from "@/lib/swal"

type TireSpec = {
  _id: string
  brand: string
  tireSize: string
  tireModel: string
  distance: number
  productCode: string
  productName: string
}

const EMPTY: Omit<TireSpec, "_id"> = {
  brand: "", tireSize: "", tireModel: "", distance: 0, productCode: "", productName: "",
}

const fmtInt = (n: number) => (n ?? 0).toLocaleString("th-TH")

const inp = "w-full rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0a0a10] text-gray-900 dark:text-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-white/30 placeholder-gray-400"
const th  = "px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 whitespace-nowrap"
const td  = "px-3 py-2 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap"

export function TireSpecMasterPage() {
  const [specs, setSpecs]       = useState<TireSpec[]>([])
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId]     = useState<string | null>(null)
  const [form, setForm]         = useState(EMPTY)
  const [saving, setSaving]     = useState(false)

  async function load() {
    setLoading(true)
    const res = await fetch("/api/tire-spec-master")
    setSpecs(await res.json())
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  function openAdd() {
    setEditId(null)
    setForm(EMPTY)
    setShowForm(true)
  }

  function openEdit(s: TireSpec) {
    setEditId(s._id)
    setForm({ brand: s.brand, tireSize: s.tireSize, tireModel: s.tireModel, distance: s.distance, productCode: s.productCode, productName: s.productName })
    setShowForm(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const url    = editId ? `/api/tire-spec-master/${editId}` : "/api/tire-spec-master"
    const method = editId ? "PUT" : "POST"
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, distance: Number(form.distance) }),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      swalError(d.error ?? "บันทึกไม่สำเร็จ")
      return
    }
    setShowForm(false)
    swalToast("success", editId ? "อัปเดตสำเร็จ" : "เพิ่มสเปคสำเร็จ")
    load()
  }

  async function handleDelete(s: TireSpec) {
    const confirmed = await swalDeleteConfirm(`ลบ ${s.brand} ${s.tireSize} ${s.tireModel}?`)
    if (!confirmed) return
    await fetch(`/api/tire-spec-master/${s._id}`, { method: "DELETE" })
    swalToast("success", "ลบสำเร็จ")
    load()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <BookOpen size={20} className="text-gray-400" />
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">จัดการสเปคยาง</h1>
        </div>
        <button onClick={openAdd}
          className="flex items-center gap-1.5 rounded-lg bg-gray-950 dark:bg-white text-white dark:text-gray-900 px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity">
          <Plus size={14} /> เพิ่มสเปค
        </button>
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <form onSubmit={handleSave} className="mb-6 rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] p-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">{editId ? "แก้ไขสเปค" : "เพิ่มสเปคใหม่"}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {([
              { key: "brand",       label: "ยี่ห้อ *",      placeholder: "Bridgestone" },
              { key: "tireSize",    label: "ขนาดยาง *",     placeholder: "295/80R22.5" },
              { key: "tireModel",   label: "รุ่นยาง *",      placeholder: "R249" },
              { key: "distance",    label: "ระยะทาง (กม.) *", placeholder: "120000", type: "number" },
              { key: "productCode", label: "รหัสสินค้า",     placeholder: "BS-R249-29580" },
              { key: "productName", label: "ชื่อสินค้า",     placeholder: "Bridgestone R249 295/80R22.5" },
            ] as { key: keyof typeof form; label: string; placeholder: string; type?: string }[]).map(({ key, label, placeholder, type }) => (
              <div key={key}>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">{label}</label>
                <input
                  type={type ?? "text"}
                  value={form[key]}
                  onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                  placeholder={placeholder}
                  required={label.includes("*")}
                  className={inp}
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-4">
            <button type="submit" disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-gray-950 dark:bg-white text-white dark:text-gray-900 px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity">
              <Check size={14} /> {saving ? "กำลังบันทึก..." : "บันทึก"}
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-white/10 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
              <X size={14} /> ยกเลิก
            </button>
          </div>
        </form>
      )}

      {/* Table */}
      <div className="rounded-xl border border-gray-200 dark:border-white/8 bg-white dark:bg-[#0f1117] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-white/8 bg-gray-50 dark:bg-white/3">
                <th className={th}>ยี่ห้อ</th>
                <th className={th}>ขนาดยาง</th>
                <th className={th}>รุ่นยาง</th>
                <th className={th + " text-right"}>ระยะทาง (กม.)</th>
                <th className={th}>รหัสสินค้า</th>
                <th className={th}>ชื่อสินค้า</th>
                <th className="px-3 py-2.5 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">กำลังโหลด...</td></tr>
              ) : specs.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">ยังไม่มีสเปค — กด "เพิ่มสเปค" เพื่อเริ่มต้น</td></tr>
              ) : specs.map((s, i) => (
                <tr key={s._id} className={`border-b border-gray-100 dark:border-white/5 ${i % 2 === 1 ? "bg-gray-50/50 dark:bg-white/1" : ""}`}>
                  <td className={td + " font-medium"}>{s.brand}</td>
                  <td className={td + " font-mono"}>{s.tireSize}</td>
                  <td className={td}>{s.tireModel}</td>
                  <td className={td + " text-right font-semibold"}>{fmtInt(s.distance)}</td>
                  <td className={td + " text-gray-500 dark:text-gray-400"}>{s.productCode || "—"}</td>
                  <td className={td}>{s.productName || "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <button onClick={() => openEdit(s)} className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors"><Pencil size={13} /></button>
                      <button onClick={() => handleDelete(s)} className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add sidebar link in `components/sidebar.tsx`**

Find the closing `]` of the nav groups array (around line 88) and add a new group before it:

```ts
  {
    label: "ตั้งค่า",
    collapsible: true,
    items: [
      { href: "/tire/master", label: "สเปคยาง", icon: BookOpen },
    ],
  },
```

Also add `BookOpen` to the lucide-react import at the top of `sidebar.tsx`.

- [ ] **Step 4: Verify UI**

1. Run `npm run dev`
2. Navigate to `http://localhost:3000/tire/master`
3. Add a spec: Bridgestone / 295/80R22.5 / R249 / 120000
4. Edit it — change distance to 130000 → save → verify row updates
5. Delete it → verify it disappears
6. Check sidebar shows "สเปคยาง" link under "ตั้งค่า"

- [ ] **Step 5: Commit**

```bash
git add components/tire-spec-master-page.tsx app/tire/master/page.tsx components/sidebar.tsx
git commit -m "feat: add tire spec master management UI and sidebar link"
```

---

## Task 3: Auto-fill in Bulk Add Page

When the user types or pastes brand + tireSize + tireModel into `TireStockAddPage`, the row's `distance` (and `productCode`, `productName`) auto-fills from master.

**Files:**
- Modify: `components/tire-stock-add-page.tsx`

**Interfaces:**
- Consumes: `GET /api/tire-spec-master/lookup?brand=X&tireSize=Y&tireModel=Z` → `{ distance, productCode, productName } | null`

**Logic:** Debounce 300 ms after the user stops typing in `brand`, `tireSize`, or `tireModel`. If all three are non-empty, call lookup and patch the row. Only auto-fill fields that are currently empty (don't overwrite what the user already typed).

- [ ] **Step 1: Add lookup helper and debounce ref to `TireStockAddPage`**

Add at the top of the component function body (after existing state):

```ts
const lookupTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})

async function lookupSpec(ri: number, row: Row) {
  const { brand, tireSize, tireModel } = row
  if (!brand.trim() || !tireSize.trim() || !tireModel.trim()) return
  const qs = new URLSearchParams({ brand: brand.trim(), tireSize: tireSize.trim(), tireModel: tireModel.trim() })
  const res = await fetch(`/api/tire-spec-master/lookup?${qs}`)
  const spec = await res.json()
  if (!spec) return
  setRows((prev) =>
    prev.map((r, i) => {
      if (i !== ri) return r
      return {
        ...r,
        distance:    r.distance    || String(spec.distance),
        productCode: r.productCode || spec.productCode,
        productName: r.productName || spec.productName,
      }
    })
  )
}
```

- [ ] **Step 2: Trigger lookup in `setCell`**

Replace the existing `setCell` function:

```ts
function setCell(ri: number, key: keyof Row, value: string) {
  setRows((prev) => {
    const next = prev.map((r, i) => (i === ri ? { ...r, [key]: value } : r))
    if (key === "brand" || key === "tireSize" || key === "tireModel") {
      clearTimeout(lookupTimers.current[ri])
      lookupTimers.current[ri] = setTimeout(() => lookupSpec(ri, next[ri]), 300)
    }
    return next
  })
}
```

Also add `useRef` to the import line (it's already `useState` only):

```ts
import { useState, useRef } from "react"
```

- [ ] **Step 3: Also trigger lookup after paste**

In `parsePaste`-based rows, run a lookup after state is set. Replace the paste handler body:

```ts
function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
  e.preventDefault()
  const parsed = parsePaste(e.clipboardData.getData("text/plain"))
  if (parsed.length === 0) {
    swalError("ไม่พบข้อมูลที่วางได้ — กรุณา copy จาก Excel เป็นแถว")
    return
  }
  setRows((prev) => {
    const next = [...prev, ...parsed]
    // auto-fill specs for newly pasted rows
    parsed.forEach((row, pi) => {
      const ri = prev.length + pi
      setTimeout(() => lookupSpec(ri, next[ri]), 50 * pi)
    })
    return next
  })
}
```

- [ ] **Step 4: Verify auto-fill**

1. Go to `/tire/latkrabang/stock-tire/new`
2. Click "เพิ่มแถวว่าง"
3. Type `Bridgestone` in ยี่ห้อ, `295/80R22.5` in ขนาดยาง, `R249` in รุ่นยาง
4. After ~300 ms: ระยะทาง should auto-fill with `120000`, productCode and productName should fill if master has them
5. Paste from Excel with brand/size/model columns filled — verify ระยะทาง fills after paste

- [ ] **Step 5: Commit**

```bash
git add components/tire-stock-add-page.tsx
git commit -m "feat: auto-fill distance/productCode/productName from tire spec master on bulk add"
```
