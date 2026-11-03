// lib/store-withdraw/audit.ts — ตรวจสอบย้อนหลังงานเบิก (อ่านอย่างเดียว): ตรวจโซ่ log · รายการใบตามช่วงวันที่ · ไทม์ไลน์รายใบ · Export
import { listAttachments, countAttachments, type AttachItem } from "./attachments"
import { verifyEntries, type ChainResult } from "./chain"
import { WORK_TYPE_LABEL, workTypeFromKind } from "./core"
import { HttpError } from "./http"
import { NotFoundError, swCol, swLogCol, type LogDoc } from "./db"
import type { SwRequest, SwWorkType } from "./types"

export const AUDIT_MAX_ROWS = 400
export const AUDIT_MAX_DAYS = 93
export const ATMS_BASE = "https://www.mena-atms.com"
export const wdUrl = (gmId: number) => `${ATMS_BASE}/inv/withdraw/view/id/${gmId}`
export const ddUrl = (gmId: number) => `${ATMS_BASE}/inv/deposit/view/id/${gmId}`

/** ตรวจโซ่ log ของใบเดียว */
export async function verifyChain(no: string): Promise<ChainResult> {
  const docs = await (await swLogCol()).find({ no }).sort({ seq: 1 }).toArray()
  return verifyEntries(docs as never)
}

type LogPart = { n: number; chain: ChainResult }

/** ตรวจโซ่หลายใบในคราวเดียว (query เดียว) + นับเหตุการณ์ */
export async function verifyChains(nos: string[]): Promise<Map<string, LogPart>> {
  const by = new Map<string, LogDoc[]>()
  if (nos.length) {
    const docs = await (await swLogCol()).find({ no: { $in: nos } }).toArray()
    for (const d of docs) by.set(d.no, [...(by.get(d.no) ?? []), d])
  }
  const out = new Map<string, LogPart>()
  for (const no of nos) {
    const list = by.get(no) ?? []
    out.set(no, { n: list.length, chain: verifyEntries(list as never) })
  }
  return out
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** from/to = YYYY-MM-DD (วันตามเวลาไทย รวมวันสุดท้าย) · ต้องมีทั้งคู่ · ไม่เกิน 93 วัน */
export function parseRange(from: unknown, to: unknown): { start: Date; end: Date } {
  const f = String(from ?? ""), t = String(to ?? "")
  if (!DAY.test(f) || !DAY.test(t)) throw new HttpError("ใส่ช่วงวันที่ให้ครบ (from และ to รูปแบบ YYYY-MM-DD)", 400)
  const start = new Date(`${f}T00:00:00+07:00`)
  const last = new Date(`${t}T00:00:00+07:00`)
  if (isNaN(start.getTime()) || isNaN(last.getTime())) throw new HttpError("วันที่ไม่ถูกต้อง", 400)
  if (last < start) throw new HttpError("วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม", 400)
  const days = Math.round((last.getTime() - start.getTime()) / 86_400_000) + 1
  if (days > AUDIT_MAX_DAYS) throw new HttpError(`ช่วงวันที่ยาวเกิน ${AUDIT_MAX_DAYS} วัน แบ่งดูทีละช่วง`, 400)
  return { start, end: new Date(last.getTime() + 86_400_000) }
}

export type AuditFilters = { status?: string; workType?: string; q?: string }

const wtOf = (r: Pick<SwRequest, "kind" | "workType">): SwWorkType => r.workType ?? workTypeFromKind(r.kind)

const atmsCodes = (r: SwRequest): { wd: string[]; dd: string[] } => {
  const wd: string[] = [], dd: string[] = []
  if (r.atms?.code) wd.push(r.atms.code)
  for (const g of r.settleGroups ?? []) if (g.atms?.code) wd.push(g.atms.code)
  for (const x of r.returns ?? []) if (x.atms?.code) dd.push(x.atms.code)
  return { wd, dd }
}

const linesSummary = (r: SwRequest) =>
  r.lines.map((l) => `${l.skuCode} ${l.skuName} x${l.issuedQty ?? l.requestedQty}`).join(" · ")

export type AuditRow = {
  no: string; createdAt: Date; workType: SwWorkType; workTypeLabel: string; status: string
  requester: string; plate: string; mr: string | null; lines: string
  wd: string[]; dd: string[]; events: number; attachments: number; chainOk: boolean
}

export async function listAudit(from: unknown, to: unknown, f: AuditFilters): Promise<{ rows: AuditRow[]; truncated: boolean }> {
  const { start, end } = parseRange(from, to)
  const filter: Record<string, unknown> = { createdAt: { $gte: start, $lt: end } }
  if (f.status) filter.status = String(f.status)
  if (f.workType) {
    const w = String(f.workType)
    if (!(w in WORK_TYPE_LABEL)) throw new HttpError("ประเภทงานไม่ถูกต้อง", 400)
    const kind = w === "garage_out" ? "cutoff" : "stock"
    filter.$or = [{ workType: w }, { workType: { $exists: false }, kind: w === "mobile_pm" ? "__none__" : kind }]
  }
  const q = String(f.q ?? "").trim()
  if (/^SW-/i.test(q)) filter.no = { $regex: "^" + q.toUpperCase().replace(/[^A-Z0-9-]/g, "") }
  const docs = await (await swCol()).find(filter, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(AUDIT_MAX_ROWS + 1).toArray()
  const truncated = docs.length > AUDIT_MAX_ROWS
  let list = truncated ? docs.slice(0, AUDIT_MAX_ROWS) : docs
  if (q && !/^SW-/i.test(q)) {
    const n = q.toLowerCase()
    list = list.filter((r) => {
      const c = atmsCodes(r)
      return [r.no, r.plate, r.mrCode ?? "", r.requestedBy.email, r.requestedBy.name, ...c.wd, ...c.dd].some((x) => x.toLowerCase().includes(n))
    })
  }
  const nos = list.map((r) => r.no)
  const [chains, counts] = await Promise.all([verifyChains(nos), countAttachments(nos)])
  const rows = list.map((r): AuditRow => {
    const c = atmsCodes(r)
    const ch = chains.get(r.no)!
    return {
      no: r.no, createdAt: r.createdAt, workType: wtOf(r), workTypeLabel: WORK_TYPE_LABEL[wtOf(r)], status: r.status,
      requester: r.requestedBy.name || r.requestedBy.email, plate: r.plate, mr: r.mrCode, lines: linesSummary(r),
      wd: c.wd, dd: c.dd, events: ch.n, attachments: counts.get(r.no) ?? 0, chainOk: ch.chain.ok,
    }
  })
  return { rows, truncated }
}

export type AuditDetail = {
  no: string; status: string; workType: SwWorkType; workTypeLabel: string; requester: { email: string; name: string; via: string }
  plate: string; mrCode: string | null; ref: SwRequest["ref"] | null; createdAt: Date
  lines: { skuCode: string; skuName: string; requestedQty: number; issuedQty: number | null; returnedQty: number; mrItemLabel: string | null }[]
  returns: { rid: string; status: string; reason: string | null; lines: { lineIndex: number; qty: number }[]; requestedBy: string; acceptedBy: string | null; code: string | null; url: string | null; createdAt: Date }[]
  atms: { type: "WD" | "DD"; code: string; label: string; url: string | null }[]
  timeline: { seq: number | null; action: string; from: string | null; to: string | null; actor: string; via: string; at: Date; note: string | null }[]
  attachments: AttachItem[]
  /** Mobile/PM: สรุปการใช้รายคัน + ลิงก์รูปหลักฐานของแต่ละแถว (ใบเก่าที่ไม่มี attachmentIds = รายการว่าง) */
  summary: AuditSummary | null
  chain: ChainResult
}

export type AuditSummary = {
  by: { email: string; name: string }; at: Date; note: string
  usages: { lineIndex: number; skuCode: string; skuName: string; plate: string; mrCode: string; mrItemLabel: string; qty: number; attachments: { id: string; filename: string; url: string }[] }[]
  returns: { lineIndex: number; skuName: string; qty: number }[]
}

/** แปลงสรุปการใช้ของใบให้มีชื่ออะไหล่ + ลิงก์ไฟล์ต่อแถว (id ที่ไม่เจอในไฟล์ที่ยืนยันแล้ว = ข้าม) */
export function summaryWithFiles(r: Pick<SwRequest, "lines" | "summary">, att: Pick<AttachItem, "id" | "filename" | "url">[]): AuditSummary | null {
  const s = r.summary
  if (!s) return null
  const byId = new Map(att.map((a) => [a.id, a]))
  const name = (i: number) => r.lines[i]?.skuName ?? "?"
  return {
    by: s.by, at: s.at, note: s.note ?? "",
    usages: (s.usages ?? []).map((u) => ({
      lineIndex: u.lineIndex, skuCode: r.lines[u.lineIndex]?.skuCode ?? "", skuName: name(u.lineIndex),
      plate: u.plate, mrCode: u.mrCode, mrItemLabel: u.mrItemLabel, qty: u.qty,
      attachments: (u.attachmentIds ?? []).flatMap((id) => { const a = byId.get(id); return a ? [{ id, filename: a.filename, url: a.url }] : [] }),
    })),
    returns: (s.returns ?? []).map((x) => ({ lineIndex: x.lineIndex, skuName: name(x.lineIndex), qty: x.qty })),
  }
}

export async function auditDetail(no: string): Promise<AuditDetail> {
  const r = await (await swCol()).findOne({ no }, { projection: { _id: 0 } })
  if (!r) throw new NotFoundError()
  const logs = await (await swLogCol()).find({ no }).toArray()
  logs.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || a.at.getTime() - b.at.getTime())
  const att = (await listAttachments([no])).get(no) ?? []
  const atms: AuditDetail["atms"] = []
  if (r.atms?.code) atms.push({ type: "WD", code: r.atms.code, label: "ใบเบิก", url: r.atms.gmId != null ? wdUrl(r.atms.gmId) : null })
  for (const g of r.settleGroups ?? []) if (g.atms?.code) atms.push({ type: "WD", code: g.atms.code, label: `ทะเบียน ${g.plate}`, url: g.atms.gmId != null ? wdUrl(g.atms.gmId) : null })
  for (const x of r.returns ?? []) if (x.atms?.code) atms.push({ type: "DD", code: x.atms.code, label: `คืน ${x.rid}`, url: x.atms.gmId != null ? ddUrl(x.atms.gmId) : null })
  return {
    no, status: r.status, workType: wtOf(r), workTypeLabel: WORK_TYPE_LABEL[wtOf(r)], requester: r.requestedBy,
    plate: r.plate, mrCode: r.mrCode, ref: r.ref ?? null, createdAt: r.createdAt,
    lines: r.lines.map((l) => ({ skuCode: l.skuCode, skuName: l.skuName, requestedQty: l.requestedQty, issuedQty: l.issuedQty, returnedQty: l.returnedQty, mrItemLabel: l.mrItemLabel })),
    returns: (r.returns ?? []).map((x) => ({
      rid: x.rid, status: x.status, reason: x.reason ?? null, lines: x.lines, requestedBy: x.requestedBy, acceptedBy: x.acceptedBy,
      code: x.atms?.code ?? null, url: x.atms?.gmId != null ? ddUrl(x.atms.gmId) : null, createdAt: x.createdAt,
    })),
    atms,
    timeline: logs.map((l) => ({ seq: l.seq ?? null, action: l.action, from: l.from, to: l.to, actor: l.actor.name || l.actor.email, via: l.actor.via, at: l.at, note: l.note ?? null })),
    attachments: att,
    summary: summaryWithFiles(r, att),
    chain: verifyEntries(logs as never),
  }
}

/** Excel: ใบเบิก · เหตุการณ์ · หลักฐานแนบ (ช่วงวันที่/ตัวกรองเดียวกับรายการ) */
export async function buildAuditWorkbook(from: unknown, to: unknown, f: AuditFilters = {}): Promise<{ buffer: Buffer; rows: number; truncated: boolean }> {
  const { rows, truncated } = await listAudit(from, to, f)
  const nos = rows.map((r) => r.no)
  const logs = nos.length ? await (await swLogCol()).find({ no: { $in: nos } }).toArray() : []
  logs.sort((a, b) => a.no.localeCompare(b.no) || (a.seq ?? 0) - (b.seq ?? 0) || a.at.getTime() - b.at.getTime())
  const att = await listAttachments(nos)
  const ExcelJS = (await import("exceljs")).default
  const wb = new ExcelJS.Workbook()
  const s1 = wb.addWorksheet("ใบเบิก")
  s1.columns = [
    { header: "เลขที่ใบ", key: "no", width: 16 }, { header: "วันที่ยื่น", key: "at", width: 20 }, { header: "ประเภทงาน", key: "wt", width: 12 },
    { header: "สถานะ", key: "st", width: 14 }, { header: "ผู้ขอ", key: "rq", width: 24 }, { header: "ทะเบียน", key: "pl", width: 12 },
    { header: "MR", key: "mr", width: 16 }, { header: "รายการ", key: "ln", width: 60 }, { header: "WD", key: "wd", width: 24 },
    { header: "DD", key: "dd", width: 24 }, { header: "จำนวนเหตุการณ์", key: "ev", width: 12 }, { header: "ไฟล์แนบ", key: "ap", width: 10 },
    { header: "โซ่ log", key: "ch", width: 16 },
  ]
  for (const r of rows) s1.addRow({ no: r.no, at: r.createdAt.toISOString(), wt: r.workTypeLabel, st: r.status, rq: r.requester, pl: r.plate, mr: r.mr ?? "", ln: r.lines, wd: r.wd.join(", "), dd: r.dd.join(", "), ev: r.events, ap: r.attachments, ch: r.chainOk ? "ครบ ไม่ถูกแก้" : "พบความผิดปกติ" })
  const s2 = wb.addWorksheet("เหตุการณ์")
  s2.columns = [
    { header: "เลขที่ใบ", key: "no", width: 16 }, { header: "ลำดับ", key: "seq", width: 8 }, { header: "เวลา", key: "at", width: 22 },
    { header: "เหตุการณ์", key: "ac", width: 18 }, { header: "จาก", key: "fr", width: 14 }, { header: "เป็น", key: "to", width: 14 },
    { header: "ผู้ทำ", key: "ac2", width: 26 }, { header: "ช่องทาง", key: "via", width: 8 }, { header: "หมายเหตุ", key: "nt", width: 60 },
  ]
  for (const l of logs) s2.addRow({ no: l.no, seq: l.seq ?? "", at: l.at.toISOString(), ac: l.action, fr: l.from ?? "", to: l.to ?? "", ac2: l.actor.name || l.actor.email, via: l.actor.via, nt: l.note ?? "" })
  const s3 = wb.addWorksheet("หลักฐานแนบ")
  s3.columns = [
    { header: "เลขที่ใบ", key: "no", width: 16 }, { header: "หัวข้อ", key: "cx", width: 10 }, { header: "ชื่อไฟล์", key: "fn", width: 36 },
    { header: "ขนาด (ไบต์)", key: "sz", width: 12 }, { header: "sha256", key: "sh", width: 66 }, { header: "อัปโหลดโดย", key: "by", width: 26 },
    { header: "ยืนยันเมื่อ", key: "cf", width: 22 }, { header: "ผูกกับ", key: "lk", width: 16 }, { header: "ลิงก์ (หมดอายุเร็ว)", key: "url", width: 60 },
  ]
  for (const no of nos) for (const a of att.get(no) ?? []) {
    s3.addRow({ no, cx: a.context, fn: a.filename, sz: a.size, sh: a.sha256 ?? "", by: a.by.name || a.by.email, cf: a.confirmedAt.toISOString(), lk: a.linkedTo ? `${a.linkedTo.type}${a.linkedTo.rid ? " " + a.linkedTo.rid : ""}` : "", url: a.url })
  }
  for (const ws of [s1, s2, s3]) ws.getRow(1).font = { bold: true }
  const buffer = Buffer.from(await wb.xlsx.writeBuffer())
  return { buffer, rows: rows.length, truncated }
}
