"use client"
// โหลดรายการสินค้าของ PO หลายใบผ่าน /api/po/items — ทีละ PO_ITEMS_CHUNK ใบ ยิงพร้อมกัน 3 request
// ส่งผลกลับทีละก้อน (onChunk) หน้าเว็บจะได้ขึ้นรายการไปเรื่อย ๆ ไม่ต้องรอครบทุกใบ
import { PO_ITEMS_CHUNK, type PoItem } from "@/lib/po-export"

export type PoItemsChunk = { codes: string[]; items: Record<string, PoItem[]>; detailIds: Record<string, string> }

/** คืน null = ครบ · คืนข้อความ = มีก้อนที่โหลดไม่สำเร็จ (ก้อนที่ได้แล้วส่งผ่าน onChunk ไปแล้ว) */
export async function fetchPoItems(
  codes: string[],
  onChunk: (c: PoItemsChunk) => void,
  cancelled: () => boolean = () => false,
): Promise<string | null> {
  const chunks: string[][] = []
  for (let i = 0; i < codes.length; i += PO_ITEMS_CHUNK) chunks.push(codes.slice(i, i + PO_ITEMS_CHUNK))
  let next = 0
  let failed: string | null = null
  const worker = async () => {
    while (next < chunks.length && !failed && !cancelled()) {
      const chunk = chunks[next++]
      const res = await fetch(`/api/po/items?codes=${encodeURIComponent(chunk.join(","))}`).catch(() => null)
      const d = res ? await res.json().catch(() => ({})) : {}
      if (cancelled()) return
      if (!res || !res.ok) { failed = d?.error ?? "โหลดรายการสินค้าไม่สำเร็จ ลองใหม่อีกครั้ง"; return }
      onChunk({ codes: chunk, items: d.items ?? {}, detailIds: d.detailIds ?? {} })
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return failed
}
