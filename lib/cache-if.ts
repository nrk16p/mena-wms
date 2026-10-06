// lib/cache-if.ts — sharedCache.get ที่เก็บเฉพาะผลที่ผ่านเงื่อนไข (keep)
// ใช้กับ API ภายนอกที่ตอบ error เป็น "ค่า" (401 / 404 / session หมดอายุ) ไม่ใช่ throw:
//   ผลไม่ผ่าน → คืนให้ผู้เรียกตามจริง แต่ไม่เก็บลงแคช (ครั้งถัดไปยิงใหม่)
//   load throw → throw ต่อตามเดิม
//   ค่าในแคชเก่า + โหลดเบื้องหลังได้ผลไม่ผ่าน → ยังเสิร์ฟค่าเดิมที่ผ่าน (ไม่เอาผล error มาทับ)
import type { GetOptions } from "@/lib/shared-cache"

type CacheGetter = { get<T>(o: GetOptions<T>): Promise<T> }

/** ผลที่ไม่ผ่าน keep — โยนผ่าน sharedCache เพื่อไม่ให้ถูกเก็บ แล้วแกะคืนข้างนอก */
class NotKept<T> extends Error {
  constructor(readonly value: T) { super("ไม่เก็บลงแคช: ผลไม่ผ่านเงื่อนไข") }
}

export async function cachedIf<T>(
  cache: CacheGetter,
  o: GetOptions<T> & { keep: (v: T) => boolean },
): Promise<T> {
  const { keep, load, ...rest } = o
  try {
    return await cache.get<T>({
      ...rest,
      load: async () => {
        const v = await load()
        if (!keep(v)) throw new NotKept(v)
        return v
      },
    })
  } catch (e) {
    if (e instanceof NotKept) return e.value as T
    throw e
  }
}
