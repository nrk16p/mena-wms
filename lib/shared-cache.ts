// lib/shared-cache.ts — แคชกลางของทุก instance บน Vercel (Runtime Cache) สำหรับ API ที่อ่านหนัก
//
//   • stale-while-revalidate: เลยช่วงสด (freshMs) แต่ยังไม่เกิน maxStaleMs → คืนค่าเดิมทันที แล้วโหลดใหม่เบื้องหลัง
//     เกิน maxStaleMs → รอโหลดใหม่ (ไม่เสิร์ฟของเก่าเกินกำหนด)
//   • ล้างด้วย tag: invalidate(["ap"]) ตอนบันทึก → ครั้งถัดไปทุก instance โหลดใหม่ทันที
//     ใช้ "generation" ต่อ tag เก็บใน store — ผลที่เริ่มโหลดก่อนการบันทึกแต่เสร็จทีหลังจะไม่ถูกนับว่าใหม่
//   • ก้อนเกิน maxBytes (Runtime Cache รับ ≤ 2 MB) → เก็บในหน่วยความจำของ instance แทน (แบบเดิม)
//     generation ยังอ่านจาก store กลาง การล้างด้วย tag จึงมีผลกับก้อนนี้ทุก instance เหมือนกัน
//   • store พัง/ช้า → ทำเหมือนไม่มีแคช ไม่ทำให้ request ล้ม
//
// นอก Vercel (dev / สคริปต์) getCache() ถอยไปใช้แคชในหน่วยความจำเองอัตโนมัติ
import { createHash } from "node:crypto"
import { getCache } from "@vercel/functions"
import { after } from "next/server"

export type CacheStore = {
  get: (key: string) => Promise<unknown | null>
  set: (key: string, value: unknown, options?: { ttl?: number; tags?: string[]; name?: string }) => Promise<void>
  delete: (key: string) => Promise<void>
  expireTag: (tag: string | string[]) => Promise<void>
}

/** tag ของข้อมูลแต่ละกลุ่ม — เส้นที่เขียนข้อมูลกลุ่มนั้นต้องเรียก invalidateCache(tag) */
export const CACHE_TAGS = {
  ap: "ap",             // ap_tracking / ผู้ขาย / แม่แบบเอกสาร (หน้า AP)
  pr: "pr",             // pr_tracking (วันส่งของที่คนแก้)
  tire: "tire",         // ข้อมูลยางทุก collection (คำขอ / สต็อก / ประวัติเปลี่ยน / ระยะ)
  handover: "handover", // ชีต Onboarding (ส่งมอบรถ พจส.ใหม่)
} as const

type Entry<T> = { k: string; v: T; at: number; gens: Record<string, string> }   // k = key เต็ม กัน hash ชน

export type GetOptions<T> = {
  key: string
  load: () => Promise<T>
  freshMs: number
  maxStaleMs: number
  tags?: string[]
  force?: boolean
}

type Deps = {
  store?: CacheStore
  now?: () => number
  background?: (p: Promise<unknown>) => void
  maxBytes?: number
}

const DEFAULT_MAX_BYTES = 1.9 * 1024 * 1024

function defaultBackground(p: Promise<unknown>) {
  // after() ยืดอายุ function ให้งานเบื้องหลังจบก่อนถูกแช่แข็ง — ใช้ได้เฉพาะใน request scope
  try { after(() => p) } catch { void p }
}

export function createSharedCache(deps: Deps = {}) {
  const now = deps.now ?? Date.now
  const background = deps.background ?? defaultBackground
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES
  let store = deps.store
  const inflight = new Map<string, Promise<unknown>>()
  const local = new Map<string, { entry: Entry<unknown>; exp: number }>()   // ก้อนใหญ่เกิน store กลาง
  const warned = new Set<string>()

  // เตือนครั้งเดียวต่อชนิดปัญหา (ไม่ให้ log ท่วมทุก request แต่ปัญหาคนละชนิดยังเห็นครบ)
  const warn = (msg: string, e: unknown) => {
    const kind = msg.split(" ")[0]
    if (warned.has(kind)) return
    warned.add(kind)
    console.warn(`[shared-cache] ${msg}:`, e instanceof Error ? e.message : e)
  }
  const getStore = (): CacheStore | null => {
    if (store) return store
    // hash ค่าเริ่มต้นของ getCache เป็น 32 บิต (ชนได้) — ใช้ sha256 แทน และเทียบ key เต็มตอนอ่านอีกชั้น
    try { store = getCache({ namespace: "wms", keyHashFunction: (k) => createHash("sha256").update(k).digest("hex") }) as CacheStore } catch (e) { warn("no cache store", e); return null }
    return store
  }
  const safeGet = async (key: string): Promise<unknown | null> => {
    try { return (await getStore()?.get(key)) ?? null } catch (e) { warn("get failed", e); return null }
  }
  const readGens = async (tags: string[]): Promise<Record<string, string>> => {
    const vals = await Promise.all(tags.map((t) => safeGet(`gen:${t}`)))
    return Object.fromEntries(tags.map((t, i) => [t, typeof vals[i] === "string" ? (vals[i] as string) : "0"]))
  }
  const sameGens = (a: Record<string, string>, b: Record<string, string>) =>
    Object.keys(b).every((t) => a[t] === b[t])

  function loadAndStore<T>(o: GetOptions<T>): Promise<T> {
    const running = inflight.get(o.key) as Promise<T> | undefined
    if (running) return running
    const tags = o.tags ?? []
    const p = (async () => {
      const gens = await readGens(tags)   // จับ generation ก่อนเริ่มอ่านข้อมูล
      const at = now()
      const v = await o.load()
      const entry: Entry<T> = { k: o.key, v, at, gens }
      const bytes = Buffer.byteLength(JSON.stringify(entry))
      if (bytes <= maxBytes) {
        local.delete(o.key)
        try {
          await getStore()?.set(`v:${o.key}`, entry, { ttl: Math.ceil(o.maxStaleMs / 1000), tags, name: o.key.split(":")[0] })
        } catch (e) { warn("set failed", e) }
      } else {
        local.set(o.key, { entry, exp: now() + o.maxStaleMs })
      }
      return v
    })().finally(() => inflight.delete(o.key))
    inflight.set(o.key, p)
    return p
  }

  return {
    async get<T>(o: GetOptions<T>): Promise<T> {
      if (!o.force) {
        const [raw, gens] = await Promise.all([safeGet(`v:${o.key}`), readGens(o.tags ?? [])])
        const loc = local.get(o.key)
        if (loc && loc.exp <= now()) local.delete(o.key)
        const entry = (raw ?? (loc && loc.exp > now() ? loc.entry : null)) as Entry<T> | null
        if (entry && typeof entry === "object" && entry.k === o.key && sameGens(entry.gens ?? {}, gens)) {
          const age = now() - entry.at
          if (age < o.freshMs) return entry.v
          if (age < o.maxStaleMs) {
            if (!inflight.has(o.key)) {
              background(loadAndStore(o).catch((e) => console.warn(`[shared-cache] refresh ${o.key} failed:`, e instanceof Error ? e.message : e)))
            }
            return entry.v
          }
        }
      }
      return loadAndStore(o)
    },

    /** เรียกหลังบันทึกข้อมูลสำเร็จ — ไม่ throw แม้ store พัง */
    async invalidate(tags: string[]): Promise<void> {
      const s = getStore()
      if (!s || !tags.length) return
      const gen = `${now()}-${Math.random().toString(36).slice(2, 10)}`
      try {
        await Promise.all([...tags.map((t) => s.set(`gen:${t}`, gen)), s.expireTag(tags)])
      } catch (e) { warn("invalidate failed", e) }
    },
  }
}

declare global {
  var _wmsSharedCache: ReturnType<typeof createSharedCache> | undefined
}

/** ตัวเดียวทั้ง process (รอด hot-reload ตอน dev) */
export const sharedCache = (globalThis._wmsSharedCache ??= createSharedCache())

export const invalidateCache = (tags: string[]) => sharedCache.invalidate(tags)
