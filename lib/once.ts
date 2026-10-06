// lib/once.ts — งานที่ควรทำครั้งเดียวต่อ process (เช่น createIndex ตอนเปิดใช้ collection)
//   • สำเร็จแล้ว → ครั้งถัดไปคืนผลเดิมทันที ไม่ยิงซ้ำ
//   • เรียกพร้อมกันหลายที่ → รอผลเดียวกัน
//   • ล้มเหลว → ผู้เรียกครั้งนั้นได้ error แล้วครั้งถัดไปลองใหม่ (ไม่จำความล้มเหลวไว้ทั้ง process)

export function onceUntilOk<A extends unknown[], T>(fn: (...args: A) => Promise<T>): (...args: A) => Promise<T> {
  let running: Promise<T> | null = null
  return (...args: A) => {
    if (running) return running
    const p: Promise<T> = (async () => fn(...args))()   // throw แบบ sync ก็กลายเป็น rejected promise
    running = p
    p.catch(() => { if (running === p) running = null })
    return p
  }
}
