// scripts/check-shared-cache.ts — รัน: npx tsx scripts/check-shared-cache.ts
// แคชกลาง (lib/shared-cache.ts): stale-while-revalidate + ล้างด้วย tag (generation) + กันก้อนใหญ่ + แคชพังไม่ล้ม request
import assert from "node:assert/strict"
import { createSharedCache, type CacheStore } from "../lib/shared-cache"

// ── store ปลอมที่ทำตัวเหมือน Runtime Cache (TTL เป็นวินาที, hard expire) ใช้นาฬิกาเดียวกับเทสต์ ──
let t = 0
function fakeStore(): CacheStore & { broken: boolean; sets: number } {
  const m = new Map<string, { v: string; exp: number | null; tags: Set<string> }>()
  const s = {
    broken: false,
    sets: 0,
    async get(k: string) {
      if (s.broken) throw new Error("store down")
      const e = m.get(k)
      if (!e) return null
      if (e.exp !== null && t >= e.exp) { m.delete(k); return null }
      return JSON.parse(e.v)
    },
    async set(k: string, v: unknown, o?: { ttl?: number; tags?: string[] }) {
      if (s.broken) throw new Error("store down")
      s.sets++
      m.set(k, { v: JSON.stringify(v), exp: o?.ttl ? t + o.ttl * 1000 : null, tags: new Set(o?.tags ?? []) })
    },
    async delete(k: string) { m.delete(k) },
    async expireTag(tag: string | string[]) {
      const tags = Array.isArray(tag) ? tag : [tag]
      for (const [k, e] of m) if (tags.some((x) => e.tags.has(x))) m.delete(k)
    },
  }
  return s
}

const bg: Promise<unknown>[] = []
const flush = async () => { while (bg.length) await bg.shift() }
function setup(maxBytes?: number) {
  const store = fakeStore()
  const cache = createSharedCache({ store, now: () => t, background: (p) => { bg.push(p) }, maxBytes })
  return { store, cache }
}
function counter<T>(values: T[]) {
  let i = 0
  const load = async () => values[Math.min(i++, values.length - 1)]
  return { load, calls: () => i }
}
const base = { key: "k", freshMs: 1000, maxStaleMs: 5000, tags: ["ap"] }

async function main() {
  // 1. miss → โหลด 1 ครั้ง · ภายในช่วงสด → ไม่โหลดซ้ำ
  {
    t = 0; const { cache } = setup(); const c = counter(["v1", "v2"])
    assert.equal(await cache.get({ ...base, load: c.load }), "v1")
    t = 500
    assert.equal(await cache.get({ ...base, load: c.load }), "v1")
    assert.equal(c.calls(), 1, "ยังสดอยู่ ต้องไม่ยิงโหลดซ้ำ")
  }
  // 2. miss พร้อมกันหลาย request → โหลดครั้งเดียว
  {
    t = 0; const { cache } = setup(); const c = counter(["v1"])
    const [a, b] = await Promise.all([cache.get({ ...base, load: c.load }), cache.get({ ...base, load: c.load })])
    assert.equal(a, "v1"); assert.equal(b, "v1")
    assert.equal(c.calls(), 1, "miss พร้อมกันต้องรอผลโหลดเดียวกัน")
  }
  // 3. เลยช่วงสดแต่ยังไม่เกิน maxStale → คืนค่าเก่าทันที + โหลดใหม่เบื้องหลังครั้งเดียว
  {
    t = 0; const { cache } = setup(); const c = counter(["v1", "v2"])
    await cache.get({ ...base, load: c.load })
    t = 2000
    assert.equal(await cache.get({ ...base, load: c.load }), "v1", "stale ต้องได้ค่าเก่าทันที")
    assert.equal(await cache.get({ ...base, load: c.load }), "v1")
    await flush()
    assert.equal(c.calls(), 2, "โหลดเบื้องหลังครั้งเดียว แม้มีหลาย request ระหว่างนั้น")
    assert.equal(await cache.get({ ...base, load: c.load }), "v2", "หลังโหลดเบื้องหลังเสร็จ ได้ค่าใหม่")
  }
  // 4. เกิน maxStale → รอโหลดใหม่ (ไม่คืนค่าเก่าเกินกำหนด)
  {
    t = 0; const { cache } = setup(); const c = counter(["v1", "v2"])
    await cache.get({ ...base, load: c.load })
    t = 6000
    assert.equal(await cache.get({ ...base, load: c.load }), "v2")
  }
  // 5. force → โหลดใหม่แม้ยังสด
  {
    t = 0; const { cache } = setup(); const c = counter(["v1", "v2"])
    await cache.get({ ...base, load: c.load })
    assert.equal(await cache.get({ ...base, load: c.load, force: true }), "v2")
    assert.equal(await cache.get({ ...base, load: c.load }), "v2", "ผล force ต้องถูกเก็บด้วย")
  }
  // 6. invalidate(tag) → ครั้งถัดไปโหลดใหม่ทันที (ไม่เสิร์ฟค่าเก่า)
  {
    t = 0; const { cache } = setup(); const c = counter(["v1", "v2"])
    await cache.get({ ...base, load: c.load })
    await cache.invalidate(["ap"])
    assert.equal(await cache.get({ ...base, load: c.load }), "v2", "หลังบันทึก ต้องเห็นข้อมูลใหม่ทันที")
    // tag อื่นไม่โดน
    const other = counter(["o1", "o2"])
    await cache.get({ ...base, key: "o", tags: ["tire"], load: other.load })
    await cache.invalidate(["ap"])
    assert.equal(await cache.get({ ...base, key: "o", tags: ["tire"], load: other.load }), "o1")
  }
  // 7. มีคนบันทึกระหว่างโหลดเบื้องหลัง → ผลที่โหลดก่อนบันทึกต้องไม่ถูกนับว่าใหม่
  {
    t = 0; const { cache } = setup()
    let release!: (v: string) => void
    let n = 0
    const load = () => (++n === 1 ? Promise.resolve("v1") : n === 2 ? new Promise<string>((r) => { release = r }) : Promise.resolve("v3"))
    await cache.get({ ...base, load })
    t = 2000
    assert.equal(await cache.get({ ...base, load }), "v1")       // เริ่มโหลดเบื้องหลัง (n=2) ค้างไว้
    await cache.invalidate(["ap"])                                // มีคนบันทึกระหว่างนั้น
    release("v2-before-write")
    await flush()
    assert.equal(await cache.get({ ...base, load }), "v3", "ผลที่อ่านก่อนการบันทึกต้องถูกทิ้ง")
  }
  // 8. ก้อนใหญ่เกิน maxBytes → ไม่เก็บ แต่ยังคืนผลถูกต้อง
  {
    t = 0; const { cache, store } = setup(50); const c = counter(["x".repeat(200), "y".repeat(200)])
    assert.equal(await cache.get({ ...base, load: c.load }), "x".repeat(200))
    assert.equal(await cache.get({ ...base, load: c.load }), "y".repeat(200), "ไม่ได้เก็บ จึงโหลดใหม่")
    assert.equal(store.sets, 0, "ต้องไม่เขียนก้อนใหญ่ลง store")
  }
  // 9. store พัง → ยังได้ผลจากการโหลด ไม่ throw
  {
    t = 0; const { cache, store } = setup(); const c = counter(["v1"])
    store.broken = true
    assert.equal(await cache.get({ ...base, load: c.load }), "v1")
    await cache.invalidate(["ap"])  // ไม่ throw
  }
  // 10. โหลดพังตอน miss → throw ตามเดิม · โหลดเบื้องหลังพัง → ยังเสิร์ฟค่าเก่า
  {
    t = 0; const { cache } = setup()
    await assert.rejects(cache.get({ ...base, load: async () => { throw new Error("db down") } }), /db down/)
    let n = 0
    const load = async () => { if (++n === 1) return "v1"; throw new Error("db down") }
    await cache.get({ ...base, key: "s", load })
    t = 2000
    assert.equal(await cache.get({ ...base, key: "s", load }), "v1")
    await flush()
    assert.equal(await cache.get({ ...base, key: "s", load }), "v1", "โหลดเบื้องหลังพัง ต้องเสิร์ฟค่าเก่าต่อ")
  }
  // 11. key ต่างกัน → แยกกัน
  {
    t = 0; const { cache } = setup()
    assert.equal(await cache.get({ ...base, key: "a", load: async () => "A" }), "A")
    assert.equal(await cache.get({ ...base, key: "b", load: async () => "B" }), "B")
    assert.equal(await cache.get({ ...base, key: "a", load: async () => "X" }), "A")
  }
  console.log("check-shared-cache: ok")
}

main().catch((e) => { console.error(e); process.exit(1) })
