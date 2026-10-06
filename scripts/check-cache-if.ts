// scripts/check-cache-if.ts — รัน: npx tsx scripts/check-cache-if.ts
// cachedIf (lib/cache-if.ts): แคชเฉพาะผลที่ผ่านเงื่อนไข (เช่น ok) — ผล error / ไม่พบ คืนตามจริงแต่ไม่เก็บ
// + isExactMrMatch (lib/atms-links.ts): by-code แคชเฉพาะผลที่ตรงเลขใบเป๊ะ (prefix/ตัวเดียวที่เจอ อาจเปลี่ยนเมื่อมีใบใหม่)
import assert from "node:assert/strict"
import { createSharedCache, type CacheStore } from "../lib/shared-cache"
import { cachedIf } from "../lib/cache-if"
import { isExactMrMatch } from "../lib/atms-links"

let t = 0
function memStore(): CacheStore {
  const m = new Map<string, { v: string; exp: number | null }>()
  return {
    async get(k) { const e = m.get(k); if (!e) return null; if (e.exp !== null && t >= e.exp) { m.delete(k); return null } return JSON.parse(e.v) },
    async set(k, v, o) { m.set(k, { v: JSON.stringify(v), exp: o?.ttl ? t + o.ttl * 1000 : null }) },
    async delete(k) { m.delete(k) },
    async expireTag() {},
  }
}
const bg: Promise<unknown>[] = []
const flush = async () => { while (bg.length) await bg.shift() }
const setup = () => createSharedCache({ store: memStore(), now: () => t, background: (p) => { bg.push(p) } })

type Res = { ok: boolean; status: number; data: unknown }
function seq(values: Res[]) {
  let i = 0
  return { load: async () => values[Math.min(i++, values.length - 1)], calls: () => i }
}
const base = { key: "k", freshMs: 1000, maxStaleMs: 5000, keep: (r: Res) => r.ok }
const OK1: Res = { ok: true, status: 200, data: { v: 1 } }
const OK2: Res = { ok: true, status: 200, data: { v: 2 } }
const E401: Res = { ok: false, status: 401, data: { detail: "expired" } }

async function main() {
  // 1. ผลผ่านเงื่อนไข → เก็บ · ครั้งถัดไปไม่โหลดซ้ำ
  {
    t = 0; const cache = setup(); const s = seq([OK1, OK2])
    assert.deepEqual(await cachedIf(cache, { ...base, load: s.load }), OK1)
    assert.deepEqual(await cachedIf(cache, { ...base, load: s.load }), OK1)
    assert.equal(s.calls(), 1)
  }
  // 2. ผลไม่ผ่าน (401 ฯลฯ) → คืนผลนั้นตามจริง แต่ไม่เก็บ — ครั้งถัดไปต้องยิงใหม่
  {
    t = 0; const cache = setup(); const s = seq([E401, OK1, OK2])
    assert.deepEqual(await cachedIf(cache, { ...base, load: s.load }), E401, "ผล error ต้องคืนตามจริง")
    assert.deepEqual(await cachedIf(cache, { ...base, load: s.load }), OK1, "ผล error ต้องไม่ถูกเก็บ")
    assert.deepEqual(await cachedIf(cache, { ...base, load: s.load }), OK1, "ผล ok หลังจากนั้นถูกเก็บตามปกติ")
    assert.equal(s.calls(), 2)
  }
  // 3. load throw → throw ต่อตามเดิม · ไม่เก็บ
  {
    t = 0; const cache = setup(); let n = 0
    const load = async () => { if (++n === 1) throw new Error("network down"); return OK1 }
    await assert.rejects(cachedIf(cache, { ...base, load }), /network down/)
    assert.deepEqual(await cachedIf(cache, { ...base, load }), OK1)
  }
  // 4. เรียกพร้อมกันตอน miss แล้วผลไม่ผ่าน → ทุกคนได้ผลนั้น (โหลดครั้งเดียว)
  {
    t = 0; const cache = setup(); const s = seq([E401, OK1])
    const [a, b] = await Promise.all([cachedIf(cache, { ...base, load: s.load }), cachedIf(cache, { ...base, load: s.load })])
    assert.deepEqual(a, E401); assert.deepEqual(b, E401)
    assert.equal(s.calls(), 1)
  }
  // 5. ค่าในแคชเก่าแล้ว (stale) และโหลดเบื้องหลังได้ผลไม่ผ่าน → ยังเสิร์ฟค่าเดิมที่ผ่าน ไม่เอาผล error มาทับ
  {
    t = 0; const cache = setup(); const s = seq([OK1, E401, OK2])
    await cachedIf(cache, { ...base, load: s.load })
    t = 2000
    const warn = console.warn; console.warn = () => {}
    try {
      assert.deepEqual(await cachedIf(cache, { ...base, load: s.load }), OK1)
      await flush()
      assert.deepEqual(await cachedIf(cache, { ...base, load: s.load }), OK1, "ผล error เบื้องหลังต้องไม่ทับค่าเดิม")
    } finally { console.warn = warn }
  }
  // 6. key ต่างกัน → แยกกัน (by-code คนละเลขใบ / options คนละผู้ใช้)
  {
    t = 0; const cache = setup()
    assert.deepEqual(await cachedIf(cache, { ...base, key: "a", load: async () => OK1 }), OK1)
    assert.deepEqual(await cachedIf(cache, { ...base, key: "b", load: async () => OK2 }), OK2)
  }

  // ── isExactMrMatch: ตรงแบบเดียวกับ api-ncac (strip + lower) และต้องไม่ว่าง ──
  assert.equal(isExactMrMatch("BKMR26080001", "BKMR26080001"), true)
  assert.equal(isExactMrMatch(" BKMR26080001 ", "bkmr26080001"), true, "ไม่สนตัวพิมพ์/ช่องว่างหัวท้าย")
  assert.equal(isExactMrMatch("BKMR26080001", "BKMR2608"), false, "prefix ไม่นับ — ใบใหม่อาจทำให้ผลเปลี่ยน")
  assert.equal(isExactMrMatch("BKMR26080001", "BKMR260800011"), false)
  assert.equal(isExactMrMatch(undefined, "BKMR26080001"), false)
  assert.equal(isExactMrMatch(null, "BKMR26080001"), false)
  assert.equal(isExactMrMatch("", ""), false)

  console.log("check-cache-if: ok")
}

main().catch((e) => { console.error(e); process.exit(1) })
