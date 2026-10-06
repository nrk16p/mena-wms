// scripts/check-once.ts — รัน: npx tsx scripts/check-once.ts
// onceUntilOk (lib/once.ts): งานที่ทำครั้งเดียวต่อ process (เช่น createIndex) — สำเร็จแล้วไม่ทำซ้ำ · ล้มเหลวให้ลองใหม่ครั้งถัดไป
import assert from "node:assert/strict"
import { onceUntilOk } from "../lib/once"

async function main() {
  // 1. สำเร็จครั้งแรก → ครั้งถัดไปไม่เรียกซ้ำ แต่ได้ผลเดิม
  {
    let n = 0
    const run = onceUntilOk(async (x: string) => { n++; return `ok:${x}` })
    assert.equal(await run("a"), "ok:a")
    assert.equal(await run("b"), "ok:a", "สำเร็จแล้วต้องคืนผลเดิม ไม่ทำซ้ำ")
    assert.equal(n, 1)
  }
  // 2. เรียกพร้อมกันหลายที่ → ทำครั้งเดียว
  {
    let n = 0
    let release!: () => void
    const run = onceUntilOk(() => { n++; return new Promise<void>((r) => { release = r }) })
    const a = run(), b = run(), c = run()
    release()
    await Promise.all([a, b, c])
    assert.equal(n, 1, "เรียกพร้อมกันต้องรอผลเดียวกัน")
  }
  // 3. ล้มเหลว → ผู้เรียกครั้งนั้นได้ error · ครั้งถัดไปลองใหม่ · สำเร็จแล้วหยุด
  {
    let n = 0
    const run = onceUntilOk(async () => { if (++n === 1) throw new Error("index failed") })
    await assert.rejects(run(), /index failed/)
    await run()
    await run()
    assert.equal(n, 2, "ล้มเหลวต้องลองใหม่ครั้งถัดไป และหยุดเมื่อสำเร็จ")
  }
  // 4. ล้มเหลวระหว่างมีหลายคนรอ → ทุกคนได้ error เดียวกัน แล้วครั้งถัดไปลองใหม่
  {
    let n = 0
    let fail!: (e: Error) => void
    const run = onceUntilOk(() => (++n === 1 ? new Promise<void>((_, rej) => { fail = rej }) : Promise.resolve()))
    const a = run(), b = run()
    fail(new Error("boom"))
    await assert.rejects(a, /boom/)
    await assert.rejects(b, /boom/)
    await run()
    assert.equal(n, 2)
  }
  // 5. fn throw แบบ sync → ได้ rejected promise (ไม่ throw ออกมาตรง ๆ) และลองใหม่ได้
  {
    let n = 0
    const run = onceUntilOk((): Promise<void> => { if (++n === 1) throw new Error("sync"); return Promise.resolve() })
    await assert.rejects(run(), /sync/)
    await run()
    assert.equal(n, 2)
  }
  console.log("check-once: ok")
}

main().catch((e) => { console.error(e); process.exit(1) })
