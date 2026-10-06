// scripts/check-pr-list-cache.ts — รัน: npx tsx scripts/check-pr-list-cache.ts
// ตัวช่วยแคชของ GET /api/pr (lib/pr-list-cache.ts): key ต้องครบทุก input · ตาราง ทะเบียน→เบอร์รถ ต้องได้ผลเท่าของเดิมเป๊ะ
import assert from "node:assert/strict"
import {
  prListCacheKey, runMarker, fleetPairs, bkkToday,
  PR_LIST_FRESH_MS, PR_LIST_MAX_STALE_MS, PR_FLEET_KEY,
} from "../lib/pr-list-cache"

type Doc = Record<string, unknown>

// ── 1. key: ต่างกันทุกครั้งที่ input ใด ๆ ต่าง · เท่ากันเมื่อ input เท่ากัน · ขึ้นต้นด้วยชื่อเส้น ──
{
  const base = { q: "", warehouse: "", dept: "", limit: 5000, todayBKK: "2026-10-06", run: "r1" }
  const k = prListCacheKey(base)
  assert.ok(k.startsWith("pr:"), "key ต้องขึ้นต้นด้วยชื่อเส้น")
  assert.equal(prListCacheKey({ ...base }), k, "input เดียวกัน key เดียวกัน")
  for (const [field, v] of [["q", "x"], ["warehouse", "สระบุรี"], ["dept", "ซ่อม"], ["limit", 10000],
    ["todayBKK", "2026-10-07"], ["run", "r2"]] as const) {
    assert.notEqual(prListCacheKey({ ...base, [field]: v }), k, `เปลี่ยน ${field} ต้องได้ key ใหม่`)
  }
  // ตัวคั่นในข้อความค้นหาต้องไม่ทำให้ชุด input ต่างกันชนกัน
  assert.notEqual(
    prListCacheKey({ ...base, q: "a|b", warehouse: "" }),
    prListCacheKey({ ...base, q: "a", warehouse: "b" }),
  )
  assert.notEqual(
    prListCacheKey({ ...base, q: "a\",\"b" }),
    prListCacheKey({ ...base, q: "a", warehouse: "b" }),
  )
  // limit ที่ parse ไม่ได้ (NaN) ยังต้องได้ key ที่แยกจาก limit ปกติ
  assert.notEqual(prListCacheKey({ ...base, limit: NaN }), k)
}

// ── 2. runMarker: ไม่มี run → "none" · เปลี่ยน id/เวลา/from_date/ok → marker ใหม่ ──
{
  assert.equal(runMarker(null), "none")
  const at = new Date("2026-10-06T03:12:00Z")
  const run: Doc = { _id: { toString: () => "66aa" }, created_at: at, finished_at: at, from_date: "06/09/2026", ok: true }
  const m = runMarker(run)
  assert.notEqual(m, "none")
  assert.equal(runMarker({ ...run }), m)
  assert.notEqual(runMarker({ ...run, _id: { toString: () => "66ab" } }), m, "run ใหม่ต้องได้ marker ใหม่")
  assert.notEqual(runMarker({ ...run, finished_at: new Date("2026-10-06T03:20:00Z") }), m)
  assert.notEqual(runMarker({ ...run, from_date: "07/09/2026" }), m)
  assert.notEqual(runMarker({ ...run, ok: false }), m)
  // ไม่มี finished_at → ใช้ created_at เหมือน last_refresh.at
  assert.notEqual(runMarker({ ...run, finished_at: undefined, created_at: new Date("2026-10-06T04:00:00Z") }), m)
}

// ── 3. fleetPairs: rebuild เป็น Map ได้ผลเท่ากับตรรกะเดิมของ route ทุกค่า (รวมกรณีขอบ) ──
{
  const s = (v: unknown) => (v == null ? "" : String(v)).trim()
  // ตรรกะเดิมใน app/api/pr/route.ts (ก่อนแคช) — ใช้เป็นตัวเทียบ
  const legacy = (vm: Doc[], vd: Doc[]) => {
    const m = new Map(vm.map((v) => [s(v["ทะเบียน"]), s(v["เลขรถ"])]))
    for (const v of vd) {
      const p = s(v["ทะเบียน"]), f = s(v["เบอร์รถ"])
      if (p && f) m.set(p, f)
    }
    return m
  }
  const vm: Doc[] = [
    { "ทะเบียน": "71-1111", "เลขรถ": "A1" },
    { "ทะเบียน": " 71-2222 ", "เลขรถ": " B2 " },   // ช่องว่างหัวท้าย
    { "ทะเบียน": "71-3333", "เลขรถ": null },        // ไม่มีเบอร์ใน master
    { "ทะเบียน": "", "เลขรถ": "EMPTY" },            // ทะเบียนว่าง (ของเดิมเก็บไว้ที่ key "")
    { "ทะเบียน": "71-1111", "เลขรถ": "A1-dup" },    // ซ้ำ — ตัวหลังชนะ
    { "ทะเบียน": "__proto__", "เลขรถ": "P" },       // key แปลก ต้องไม่พัง
    { "ทะเบียน": 715555, "เลขรถ": 99 },             // ตัวเลข
  ]
  const vd: Doc[] = [
    { "ทะเบียน": "71-2222", "เบอร์รถ": "B2-daily" }, // daily ทับ master
    { "ทะเบียน": "71-3333", "เบอร์รถ": "" },         // daily ว่าง → ไม่ทับ
    { "ทะเบียน": "", "เบอร์รถ": "X" },               // ทะเบียนว่าง → ไม่ทับ
    { "ทะเบียน": "71-4444", "เบอร์รถ": "D4" },       // มีแต่ใน daily
  ]
  const want = legacy(vm, vd)
  const pairs = fleetPairs(vm, vd)
  // ผ่าน JSON เหมือนเก็บลง Runtime Cache แล้ว rebuild
  const got = new Map(JSON.parse(JSON.stringify(pairs)) as [string, string][])
  assert.deepEqual([...got], [...want], "ผลต้องเท่าตรรกะเดิมทุกคู่ (ลำดับด้วย)")
  for (const plate of ["71-1111", "71-2222", "71-3333", "", "71-4444", "__proto__", "715555", "ไม่มี"]) {
    assert.equal(got.get(plate) || "", want.get(plate) || "", `เบอร์รถของ "${plate}" ต้องเท่าเดิม`)
  }
  assert.deepEqual(fleetPairs([], []), [])
}

// ── 4. วันนี้ (Asia/Bangkok) — ตัดวันที่เที่ยงคืนไทย ไม่ใช่ UTC ──
{
  assert.equal(bkkToday(Date.parse("2026-10-05T16:59:59Z")), "2026-10-05")
  assert.equal(bkkToday(Date.parse("2026-10-05T17:00:00Z")), "2026-10-06")
}

// ── 5. ช่วงเวลา: ข้อมูล atms มาจาก pipeline ภายนอก — ยอมเก่าได้ไม่เกิน 5 นาที ──
{
  assert.ok(PR_LIST_FRESH_MS <= 2 * 60_000, "freshMs ต้อง ≤ 2 นาที")
  assert.ok(PR_LIST_MAX_STALE_MS <= 5 * 60_000, "maxStaleMs ต้อง ≤ 5 นาที")
  assert.ok(PR_LIST_FRESH_MS < PR_LIST_MAX_STALE_MS)
  assert.ok(PR_FLEET_KEY.startsWith("pr:"))
  assert.notEqual(PR_FLEET_KEY, prListCacheKey({ q: "", warehouse: "", dept: "", limit: 5000, todayBKK: "2026-10-06", run: "none" }))
}

console.log("check-pr-list-cache: ok")
