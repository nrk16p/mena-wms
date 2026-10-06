// lib/pr-list-cache.ts — ตัวช่วยแคชของ GET /api/pr (ตรรกะล้วน ไม่คุย DB · ตรวจด้วย scripts/check-pr-list-cache.ts)
//
// ทำไม key มี run marker: procurement_runs ถูก insert "ตอนจบ" ทุกรอบของ pipeline ที่เขียน PR/PO/DD/รายการ
// (api-ncac scripts/atms_procurement/*) → รอบจบ = key ใหม่ ปุ่ม "รีเฟรชข้อมูล" ในหน้า /pr ที่รอ run ใหม่จบ
// แล้วโหลดซ้ำจึงได้ข้อมูลรอบใหม่ทันที · แต่ระหว่างรอบ (light ~12 นาที) ข้อมูลถูกเขียนทยอยโดย marker ยังไม่ขยับ
// และถ้า process ตายกลางรอบจะไม่มี marker เลย — จึงยังจำกัดอายุแคชไว้สั้น (สด 2 นาที เก่าสุด 5 นาที)

type Doc = Record<string, unknown>

const s = (v: unknown) => (v == null ? "" : String(v)).trim()

/** ข้อมูล atms มาจาก pipeline ภายนอก — ยอมให้เก่าได้ไม่เกิน 5 นาที */
export const PR_LIST_FRESH_MS = 2 * 60_000
export const PR_LIST_MAX_STALE_MS = 5 * 60_000

/** ตาราง ทะเบียน→เบอร์รถ (vehiclemaster + vehicle_daily) — ข้อมูลอ้างอิงที่ขยับช้า ไม่ผูก tag */
export const PR_FLEET_KEY = "pr:fleet-by-plate:v1"
export const PR_FLEET_FRESH_MS = 60 * 60_000
export const PR_FLEET_MAX_STALE_MS = 6 * 60 * 60_000

/** key ของผลทั้งก้อน — ครบทุก input ที่เปลี่ยนผล: ตัวกรอง 4 ตัว + วันนี้ (days_to_due/overdue/stage) + รอบ pipeline
 *  ห่อด้วย JSON กันข้อความค้นหาที่มีตัวคั่นทำให้ชุด input ต่างกันชนกัน */
export function prListCacheKey(p: {
  q: string; warehouse: string; dept: string; limit: number; todayBKK: string; run: string
}): string {
  return `pr:list:v1:${JSON.stringify([p.todayBKK, p.run, p.q, p.warehouse, p.dept, String(p.limit)])}`
}

/** ตัวแทนของ run ล่าสุดใน procurement_runs — ครอบทุกช่องที่ออกไปเป็น last_refresh
 *  (แคชจึงไม่มีทางคืน last_refresh ที่ต่างจากของจริงตอนนั้น) */
export function runMarker(run: Doc | null): string {
  if (!run) return "none"
  const at = run.finished_at ?? run.created_at
  return JSON.stringify([s(run._id), at instanceof Date ? at.toISOString() : s(at), s(run.from_date), !!run.ok])
}

/** ทะเบียน→เบอร์รถ เป็นคู่ [ทะเบียน, เบอร์รถ] (เก็บผ่าน JSON ได้ · new Map(pairs) ได้ผลเท่าของเดิมเป๊ะ)
 *  vehicle_daily (snapshot ล่าสุด) เป็นหลัก · vehiclemaster เป็น fallback สำหรับรถที่ไม่อยู่ใน daily */
export function fleetPairs(vmDocs: Doc[], vdDocs: Doc[]): [string, string][] {
  const fleetByPlate = new Map(vmDocs.map((v) => [s(v["ทะเบียน"]), s(v["เลขรถ"])]))
  for (const v of vdDocs) {
    const p = s(v["ทะเบียน"]), f = s(v["เบอร์รถ"])
    if (p && f) fleetByPlate.set(p, f)   // daily สดกว่า — ทับค่า master
  }
  return [...fleetByPlate]
}

/** วันนี้ (Asia/Bangkok) เป็น YYYY-MM-DD */
export function bkkToday(nowMs: number): string {
  return new Date(nowMs + 7 * 3600 * 1000).toISOString().slice(0, 10)
}
