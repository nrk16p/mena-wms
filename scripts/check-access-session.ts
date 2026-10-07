// scripts/check-access-session.ts — รัน: npx tsx scripts/check-access-session.ts
// รีเฟรชสิทธิ์ใน JWT (lib/access-refresh.ts): ทุก 5 นาที, DB ล่มใช้ค่าเดิม, บันทึกผู้ใช้
import assert from "node:assert/strict"
import { refreshAccess, ACCESS_REFRESH_MS } from "../lib/access-refresh"

async function main() {
  let t = 1_000_000
  const touched: string[] = []
  let stored: Record<string, unknown> | null = { ap: "none" }
  let broken = false
  const deps = {
    now: () => t,
    loadOverrides: async (email: string) => { if (broken) throw new Error("db down"); void email; return stored },
    touchUser: async (u: { email: string }) => { if (broken) throw new Error("db down"); touched.push(u.email) },
  }
  const token: { email?: string; name?: string; employee?: { department?: string }; accessOverrides?: Record<string, unknown>; accessAt?: number } =
    { email: "a@menatransport.co.th", name: "A", employee: { department: "Procurement" } }

  // 1. ครั้งแรก → โหลด override + บันทึกผู้ใช้
  await refreshAccess(token, deps)
  assert.deepEqual(token.accessOverrides, { ap: "none" })
  assert.equal(token.accessAt, t)
  assert.deepEqual(touched, ["a@menatransport.co.th"])

  // 2. ภายใน 5 นาที → ไม่แตะ DB
  stored = { ap: "edit" }
  t += ACCESS_REFRESH_MS - 1
  await refreshAccess(token, deps)
  assert.deepEqual(token.accessOverrides, { ap: "none" })
  assert.equal(touched.length, 1)

  // 3. ครบ 5 นาที → โหลดใหม่ (superadmin เพิ่งแก้ทับ)
  t += 1
  await refreshAccess(token, deps)
  assert.deepEqual(token.accessOverrides, { ap: "edit" })
  assert.equal(touched.length, 2)

  // 4. DB ล่ม → ใช้ค่าเดิม ไม่ throw และลองใหม่ในอีก ~1 นาที (ไม่ต้องรอ 5 นาที)
  broken = true
  t += ACCESS_REFRESH_MS
  await refreshAccess(token, deps)
  assert.deepEqual(token.accessOverrides, { ap: "edit" }, "DB ล่มต้องคงสิทธิ์เดิม")
  broken = false
  stored = null
  t += 60_000
  await refreshAccess(token, deps)
  assert.deepEqual(token.accessOverrides, {}, "ไม่มี override = ตามแผนกล้วน")

  // 5. ไม่มีอีเมล → ไม่ทำอะไร
  const anon: { accessAt?: number } = {}
  await refreshAccess(anon, deps)
  assert.equal(anon.accessAt, undefined)

  // 6. force (ตอน login) → โหลดทันทีแม้เพิ่งโหลด
  stored = { tire: "view" }
  await refreshAccess(token, deps, true)
  assert.deepEqual(token.accessOverrides, { tire: "view" })

  console.log("check-access-session: ok")
}
main().catch((e) => { console.error(e); process.exit(1) })
