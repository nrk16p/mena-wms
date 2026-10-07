// lib/next-job-map.ts
// หา "รหัสงานจริง" ของ Mena-Next (maintenance_jobs.job_id) จากเลข MR — โดยไม่ต้องให้ทีม Mena-Next แก้อะไร
//
// ทำไมต้องมี: open-jobs (mongodbapi) ส่ง maintenance_job_id = MR id ของ ATMS (เช่น 173856) แต่ endpoint เขียน
// ของ fastapinextjs (POST /maintenance-jobs/{job_id}/segments) ใช้รหัสงานของ Mena-Next เอง (เลขเล็ก เช่น 100)
// และไม่มี endpoint หา job จาก MR — มีแค่ GET /maintenance-jobs/{job_id}/timeline ที่บอกว่างานนั้นเป็น MR ไหน
// → ไล่อ่าน timeline ทีละรหัส เก็บ MR → job_id ไว้ใน next_job_map · ครั้งถัดไปอ่านเฉพาะรหัสใหม่ที่ยังไม่เคยเห็น
// (รหัสงานเพิ่มทีละ 1 · ณ 07/10/2569 มีถึง ~301 · ครั้งแรก ~300 คำขอ อ่านอย่างเดียว)
import type { Db } from "mongodb"

const FLEET_API_URL = process.env.ATMS_FLEET_API_URL ?? "https://fastapinextjs-548129382487.asia-southeast3.run.app"
const API_KEY       = process.env.ATMS_API_KEY ?? ""
export const NEXT_JOB_MAP_COLL = "next_job_map"

const BATCH      = 10   // อ่านพร้อมกันทีละ 10 รหัส (ไม่ถล่ม API ของ Mena-Next)
const STOP_AFTER = 20   // ไม่เจอติดกันเกินนี้ = ถึงรหัสล่าสุดแล้ว (เผื่อรหัสที่ถูกลบเว้นช่วง)

export type NextSegment = { segment_id: number; repair_mode: string; vendor_id: number | null; vendor_name: string | null; started_at: string; ended_at: string | null }
export type NextJob = {
  job_id: number
  maintenance_request: string
  maintenance_request_id: number
  vehicle_plate: string
  closed_at: string | null
  current_segment_id: number | null
  segments?: NextSegment[]
}

const normMr = (s: unknown) => String(s ?? "").replace(/[\s.]/g, "").toUpperCase()

/** อ่าน timeline ของงานเดียว — null = ไม่มีรหัสนี้ (404) */
export async function fetchNextJob(jobId: number): Promise<NextJob | null> {
  const res = await fetch(`${FLEET_API_URL}/maintenance-jobs/${jobId}/timeline`, { headers: { "X-API-Key": API_KEY }, cache: "no-store" })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Mena-Next timeline ${res.status} (job ${jobId})`)
  return (await res.json()) as NextJob
}

/** อู่ปัจจุบันของงาน = segment ที่ยังไม่ปิด (หรือ current_segment_id) */
export function currentSegment(job: NextJob): NextSegment | null {
  const segs = job.segments ?? []
  return segs.find((s) => s.segment_id === job.current_segment_id) ?? segs.find((s) => !s.ended_at) ?? segs[segs.length - 1] ?? null
}

async function saveJobs(db: Db, jobs: NextJob[]) {
  if (!jobs.length) return
  const now = new Date()
  await db.collection(NEXT_JOB_MAP_COLL).bulkWrite(jobs.map((j) => ({
    updateOne: {
      filter: { _id: j.job_id as unknown as never },
      update: { $set: { mrKey: normMr(j.maintenance_request), mrCode: j.maintenance_request, mrId: j.maintenance_request_id, plate: j.vehicle_plate, closedAt: j.closed_at, scannedAt: now } },
      upsert: true,
    },
  })))
}

/** อ่านรหัสงานใหม่ต่อจากตัวล่าสุดที่รู้จัก จนไม่เจอติดกัน STOP_AFTER รหัส — คืนจำนวนงานที่เก็บเพิ่ม */
export async function scanNewNextJobs(db: Db): Promise<number> {
  const last = await db.collection(NEXT_JOB_MAP_COLL).find({}, { projection: { _id: 1 } }).sort({ _id: -1 }).limit(1).toArray()
  let next = (Number(last[0]?._id) || 0) + 1
  let misses = 0, added = 0
  while (misses < STOP_AFTER) {
    const ids = Array.from({ length: BATCH }, (_, i) => next + i)
    const got = await Promise.all(ids.map((id) => fetchNextJob(id)))
    const found = got.filter((j): j is NextJob => !!j)
    await saveJobs(db, found)
    added += found.length
    // นับ "ไม่เจอติดกัน" จากท้ายชุด — ชุดที่เจอบางตัวจะรีเซ็ตตัวนับ
    for (const j of got) misses = j ? 0 : misses + 1
    next += BATCH
  }
  return added
}

/**
 * MR → รหัสงานของ Mena-Next (อ่าน timeline สดของงานนั้นมาด้วย เพื่อรู้อู่ปัจจุบัน/สถานะปิด)
 * MR เดียวมีหลายงานได้ (เปิดซ่อมซ้ำ) → เอางานที่ยังไม่ปิด รหัสล่าสุด
 */
export async function resolveNextJob(db: Db, mrCode: string): Promise<NextJob | null> {
  const key = normMr(mrCode)
  if (!key) return null
  const find = () => db.collection(NEXT_JOB_MAP_COLL).find({ mrKey: key }).sort({ _id: -1 }).toArray()
  let hits = await find()
  if (!hits.length) { await scanNewNextJobs(db); hits = await find() }
  // อ่านสดทีละตัว (ข้อมูลใน map อาจเก่า เช่น งานถูกปิดไปแล้ว) — เอาตัวที่ยังเปิดก่อน
  const fresh = (await Promise.all(hits.map((h) => fetchNextJob(Number(h._id))))).filter((j): j is NextJob => !!j)
  await saveJobs(db, fresh)
  return fresh.find((j) => !j.closed_at) ?? fresh[0] ?? null
}

/**
 * อู่ปัจจุบันจาก timeline ของ Mena-Next สำหรับใบงาน WMS ที่ยังเปิด (MR ตรงกับงานในตารางของ Mena-Next)
 * ทำไม timeline: open-jobs ไม่ตามการย้ายอู่แบบทันที (วัดจริง 07/10/2569: >46 นาทียังไม่เปลี่ยน) แต่ timeline เปลี่ยนทันที
 * ไล่หางานใหม่ครั้งเดียวต่อรอบ แล้วอ่าน timeline เฉพาะ MR ที่มีงานใน Mena-Next (ใบอื่นข้าม — ไม่มีอะไรให้เทียบ)
 */
export async function nextVendorsForOpenWms(db: Db, wmsColl: string, doneStatuses: string[]) {
  const wms = await db.collection(wmsColl).find(
    { status: { $nin: doneStatuses }, mrNo: { $nin: ["", null] }, jobType: { $ne: "อะไหล่ลงคัน" } },
    { projection: { plate: 1, fleetNo: 1, mrNo: 1, garage: 1, nextPushAt: 1, nextPushFrom: 1 } },
  ).toArray()
  await scanNewNextJobs(db)
  const keys = [...new Set(wms.map((w) => normMr(w.mrNo)))]
  // MR เดียวมีหลายงานได้ → งานที่ยังไม่ปิด รหัสล่าสุด (ตามข้อมูลในตาราง — ยืนยันสถานะจาก timeline สดอีกที)
  const rows = await db.collection(NEXT_JOB_MAP_COLL).find({ mrKey: { $in: keys } }).sort({ _id: -1 }).toArray()
  const jobOf = new Map<string, { id: number; closed: boolean }>()
  for (const r of rows) {
    const cur = jobOf.get(r.mrKey)
    if (!cur || (cur.closed && !r.closedAt)) jobOf.set(r.mrKey, { id: Number(r._id), closed: !!r.closedAt })
  }
  const ids = [...new Set([...jobOf.values()].map((v) => v.id))]
  const jobs = new Map<number, NextJob>()
  for (let i = 0; i < ids.length; i += BATCH) {
    const got = await Promise.all(ids.slice(i, i + BATCH).map((id) => fetchNextJob(id).catch(() => null)))
    const ok = got.filter((j): j is NextJob => !!j)
    ok.forEach((j) => jobs.set(j.job_id, j))
    await saveJobs(db, ok)
  }
  const out: { id: (typeof wms)[number]["_id"]; plate: string; fleetNo: string; garage: string | null; nextPushAt?: Date | null; nextPushFrom?: string | null; vendor: string }[] = []
  for (const w of wms) {
    const j = jobs.get(jobOf.get(normMr(w.mrNo))?.id ?? -1)
    const seg = j && !j.closed_at ? currentSegment(j) : null
    if (seg?.repair_mode === "external" && seg.vendor_name) out.push({
      id: w._id, plate: String(w.plate ?? ""), fleetNo: String(w.fleetNo ?? ""), garage: (w.garage as string | undefined) ?? null,
      nextPushAt: w.nextPushAt ?? null, nextPushFrom: w.nextPushFrom ?? null, vendor: seg.vendor_name,
    })
  }
  return out
}
