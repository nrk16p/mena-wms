// ระบบ AI ช่วยจัดการงานซ่อมรถโม่ (ทดสอบระบบ) — prompt + schema ต่อขั้นตอน
// ใช้ฝั่ง server เท่านั้น (API route + server component guard)

export const AI_MIXER_ALLOWED_EMAILS = [
  "narongkorn.a@menatransport.co.th",
  "kittaboon.l@menatransport.co.th",
]

export const AI_MIXER_MODEL = "claude-opus-5"

// system prompt ตัวเดียวใช้ร่วมทุกขั้น — วางไว้หน้าสุดเพื่อให้ prompt cache ทำงาน
export const AI_MIXER_SYSTEM_PROMPT = `คุณคือ "AI ผู้ช่วยจัดการงานซ่อมรถโม่" ของฝ่ายซ่อมบำรุง Fleet รถโม่ปูน (Mixer Truck)
หน้าที่ของคุณคือช่วย ผู้แจ้งซ่อม / QC / Mechanic Supervisor วิเคราะห์งานซ่อม
โดยผลลัพธ์ของคุณเป็น "ข้อเสนอ" ให้ผู้ใช้ตรวจสอบและกดยืนยันเสมอ — คุณไม่ใช่ผู้ตัดสินใจสุดท้าย

กติกา:
1. ตอบเป็นภาษาไทย ใช้ศัพท์ช่างที่ช่างไทยใช้จริง (วงเล็บภาษาอังกฤษเฉพาะที่จำเป็น เช่น ลูกปืนล้อ (Wheel Bearing))
2. ใช้ข้อมูลรถประกอบการวิเคราะห์เสมอ: อายุรถ, เลขไมล์, ประเภทรถ, ลูกค้า/แพล้นท์ (กระทบ Impact ต่อการส่งงาน)
3. ความปลอดภัยมาก่อน: อาการที่กระทบ เบรก / พวงมาลัย / ล้อ / ลูกปืนล้อ / ระบบลม ให้จัดความสำคัญสูงสุด
   และถ้าเสี่ยงต่อการใช้งาน ให้ระบุ "ห้ามใช้งานรถจนกว่าจะซ่อมเสร็จ" ชัดเจน
4. ห้ามฟันธงเกินข้อมูลที่มี — ถ้าข้อมูลไม่พอให้วิเคราะห์ ให้ระบุคำถาม/สิ่งที่ต้องตรวจเพิ่มใน field ที่กำหนด
5. ตอบตาม JSON schema ที่กำหนดเท่านั้น`

export type VehicleInfo = {
  plate: string
  fleetNo?: string
  customer?: string
  plant?: string
  vehicleType?: string
  vehicleAge?: string
  mileage?: string
}

export function vehicleBlock(v: VehicleInfo): string {
  return [
    `ทะเบียน: ${v.plate || "-"} | เลขรถ: ${v.fleetNo || "-"} | ลูกค้า: ${v.customer || "-"} | แพล้นท์: ${v.plant || "-"}`,
    `ประเภทรถ: ${v.vehicleType || "-"} | อายุรถ: ${v.vehicleAge || "-"} | เลขไมล์ล่าสุด: ${v.mileage || "-"}`,
  ].join("\n")
}

// ── Mixer Repair KB API (ฐานความรู้ประวัติซ่อมจริง เช่น เปิดผ่าน ngrok) ──
export type KbConfig = { url: string; key: string }

// config จาก FE มาก่อน, ไม่มีก็ fallback env (MIXER_KB_API_URL / MIXER_KB_API_KEY)
export function resolveKbConfig(fromBody?: { url?: string; key?: string } | null): KbConfig | null {
  const url = String(fromBody?.url ?? process.env.MIXER_KB_API_URL ?? "").trim().replace(/\/+$/, "")
  const key = String(fromBody?.key ?? process.env.MIXER_KB_API_KEY ?? "").trim()
  if (!url || !key) return null
  return { url, key }
}

async function kbFetch(kb: KbConfig, path: string): Promise<unknown> {
  const res = await fetch(`${kb.url}${path}`, {
    headers: { "X-API-Key": kb.key, "ngrok-skip-browser-warning": "1" },
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`KB API ${res.status}`)
  return res.json()
}

export async function kbHealth(kb: KbConfig): Promise<unknown> {
  return kbFetch(kb, "/health")
}

// ตัด response /diagnose ให้เหลือเฉพาะ field ที่มีประโยชน์กับ prompt (top 3 matches)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function trimDiagnose(d: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawMatches: any[] = Array.isArray(d?.matches) ? d.matches : []
  return {
    query: d?.query,
    matches: rawMatches.slice(0, 3).map((m) => ({
      symptom_code: m.symptom_code, name_th: m.name_th, similarity: m.similarity,
      severity: m.severity, safety_critical: m.safety_critical, stop_vehicle: m.stop_vehicle,
      typical_causes: m.typical_causes,
      parts_likely: (Array.isArray(m.parts_likely) ? m.parts_likely : []).slice(0, 8),
      downtime_median_h: m.downtime_median_h, cases_in_history: m.cases_in_history,
      specs: (Array.isArray(m.specs) ? m.specs : []).slice(0, 5),
    })),
  }
}

// ยิง /diagnose หลายคำค้นพร้อมกัน (fail-soft ต่อคำ) แล้วรวมเป็น JSON string สำหรับแนบ prompt
export async function kbDiagnoseMany(kb: KbConfig, queries: string[], plate?: string): Promise<string | null> {
  const qs = [...new Set(queries.map((q) => q.trim()).filter(Boolean))].slice(0, 5)
  if (!qs.length) return null
  const results = await Promise.allSettled(
    qs.map((q) => {
      const p = new URLSearchParams({ q })
      if (plate) p.set("plate", plate)
      return kbFetch(kb, `/diagnose?${p.toString()}`)
    }),
  )
  const ok = results.filter((r): r is PromiseFulfilledResult<unknown> => r.status === "fulfilled").map((r) => trimDiagnose(r.value))
  if (!ok.length) return null
  return JSON.stringify(ok, null, 1)
}

// ═══════════════════════════════════════════════════════════════
// โหมด "KB อย่างเดียว" (engine=kb) — ไม่เรียก LLM เลย ฟรี 100%
// ประกอบผลลัพธ์ตาม schema เดียวกับโหมด AI จากข้อมูล KB ตรงๆ
// ═══════════════════════════════════════════════════════════════

const SEVERITY_RANK: Record<string, number> = { "วิกฤต-ห้ามใช้รถ": 0, "เร่งด่วน": 1, "ปกติ": 2, "เฝ้าระวัง": 3 }

function mapSeverity(sev?: string, stopVehicle?: boolean): string {
  const s = String(sev ?? "")
  if (s.startsWith("S1")) return stopVehicle ? "วิกฤต-ห้ามใช้รถ" : "เร่งด่วน"
  if (s.startsWith("S2")) return "เร่งด่วน"
  if (s.startsWith("S4")) return "เฝ้าระวัง"
  return "ปกติ"
}

// เดาหมวดระบบจากชื่ออาการ (KB ใช้รหัส S1-S15 ที่ไม่ตรงกับ enum ของเรา)
function mapSystemGroup(nameTh: string): string {
  const n = nameTh
  if (/โม่|รางเท|กรวย|ปูน/.test(n)) return "โม่ผสมปูน" // เช็คก่อนช่วงล่าง — "ลูกปืนลูกกลิ้งโม่" ต้องเข้าหมวดโม่
  if (/เบรก|ลมรั่ว|ผ้าเบรก|หม้อลม/.test(n)) return "ระบบเบรก/ลม"
  if (/ยาง|ล้อ|ลูกปืน|โช้ค|แหนบ|คันชัก|คันส่ง|ศูนย์|ช่วงล่าง/.test(n)) return "ช่วงล่าง/ล้อ/ยาง"
  if (/ไฟ|แบตเตอรี่|ไดชาร์จ|ไดสตาร์ท|แอร์|สาย/.test(n)) return "ระบบไฟฟ้า"
  if (/ไฮดรอลิก|กระบอก|ปั๊ม/.test(n)) return "ไฮดรอลิก"
  if (/เกียร์|คลัตช์|เพลา|ยอย/.test(n)) return "ระบบส่งกำลัง"
  if (/เครื่อง|น้ำมันเครื่อง|หม้อน้ำ|ความร้อน|สตาร์ท|ควัน/.test(n)) return "เครื่องยนต์"
  if (/ตัวถัง|แชสซี|ประตู|กระจก|สี/.test(n)) return "ตัวถัง/แชสซี"
  return "อื่นๆ"
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function kbDiagnoseRaw(kb: KbConfig, q: string, plate?: string): Promise<any> {
  const p = new URLSearchParams({ q })
  if (plate) p.set("plate", plate)
  return kbFetch(kb, `/diagnose?${p.toString()}`)
}

// ขั้น 1 (KB): /diagnose → รายการอาการ + ความรุนแรง + note จากสถิติเคสจริง
export async function kbOnlyStep1(kb: KbConfig, notifyText: string, plate?: string) {
  const d = await kbDiagnoseRaw(kb, notifyText, plate)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: any[] = Array.isArray(d?.matches) ? d.matches : []
  const strong = all.filter((m) => (m.similarity ?? 0) >= 0.45).slice(0, 3)
  const matches = strong.length ? strong : all.slice(0, 1)

  const symptoms = matches.map((m) => ({
    symptom: m.name_th,
    system_group: mapSystemGroup(String(m.name_th ?? "")),
    severity: mapSeverity(m.severity, m.stop_vehicle),
    safety_risk: Boolean(m.safety_critical),
    initial_note: [
      `ตรงกับฐานความรู้ ${Math.round((m.similarity ?? 0) * 100)}%`,
      m.cases_in_history ? `เคยเกิด ${m.cases_in_history} เคส` : "",
      Array.isArray(m.typical_causes) && m.typical_causes.length ? `สาเหตุที่พบบ่อย: ${m.typical_causes.slice(0, 3).join(", ")}` : "",
      m.stop_vehicle ? "⚠ ประวัติระบุควรหยุดใช้รถ" : "",
    ].filter(Boolean).join(" · "),
    kb_code: m.symptom_code, // ใช้ต่อในขั้น 2/3 (นอก schema AI — โหมด KB เท่านั้น)
  }))

  const worst = symptoms.reduce((acc, s) => Math.min(acc, SEVERITY_RANK[s.severity] ?? 2), 2)
  const overall = worst === 0 ? "วิกฤต-ห้ามใช้รถ" : worst === 1 ? "เร่งด่วน" : "ปกติ"
  const topSim = matches[0]?.similarity ?? 0

  return {
    symptoms,
    overall_urgency: overall,
    questions_to_reporter: topSim < 0.55
      ? ["อาการที่แจ้งตรงกับฐานความรู้ไม่ชัดเจน โปรดยืนยันอาการ/ตำแหน่งที่เสียให้ละเอียดขึ้น"]
      : [],
    summary_for_confirm: symptoms.length
      ? `พบอาการที่ตรงกับฐานความรู้ ${symptoms.length} รายการ (จากประวัติซ่อมจริง) ความเร่งด่วนรวม: ${overall} — โปรดตรวจสอบและยืนยัน`
      : "ไม่พบอาการที่ตรงในฐานความรู้ โปรดระบุอาการให้ละเอียดขึ้น",
  }
}

// ขั้น 2 (KB): symptom → /symptoms/{code} → checklist_refs → /checklists/{id} → รายการตรวจ + อะไหล่จากเคสจริง
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function kbOnlyStep2(kb: KbConfig, symptoms: any[], plate?: string) {
  const list = symptoms.slice(0, 5)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const checklistCache = new Map<string, any>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const checklist: any[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const expected_parts: any[] = []
  const seenItems = new Set<string>()
  const seenParts = new Set<string>()
  let anyStop = false
  let anySafety = false

  for (const s of list) {
    const name = String(s?.symptom ?? "").trim()
    if (!name) continue
    try {
      const d = await kbDiagnoseRaw(kb, name, plate)
      const m = (Array.isArray(d?.matches) ? d.matches : [])[0]
      if (!m) continue
      if (m.stop_vehicle) anyStop = true
      if (m.safety_critical) anySafety = true

      // อะไหล่จาก % เคสจริง
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const p of (Array.isArray(m.parts_likely) ? m.parts_likely : []).slice(0, 8) as any[]) {
        if (seenParts.has(p.part)) continue
        seenParts.add(p.part)
        expected_parts.push({
          part_name: p.part,
          qty: "-",
          condition: `ใช้ใน ${p.pct_of_cases}% ของเคส "${m.name_th}" — รอผลตรวจยืนยัน`,
        })
      }

      // checklist จาก refs ของ symptom นี้
      const code = s?.kb_code || m.symptom_code
      if (!code) continue
      const sym = await kbFetch(kb, `/symptoms/${encodeURIComponent(String(code))}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const refs: any[] = Array.isArray((sym as any)?.checklist_refs) ? (sym as any).checklist_refs : []
      for (const ref of refs.slice(0, 4)) {
        const key = `${ref.checklist_id}:${ref.item_code}`
        if (seenItems.has(key)) continue
        seenItems.add(key)
        if (!checklistCache.has(ref.checklist_id)) {
          try { checklistCache.set(ref.checklist_id, await kbFetch(kb, `/checklists/${encodeURIComponent(ref.checklist_id)}`)) }
          catch { checklistCache.set(ref.checklist_id, null) }
        }
        const cl = checklistCache.get(ref.checklist_id)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const item = (Array.isArray(cl?.items) ? cl.items : []).find((it: any) => it.code === ref.item_code)
        if (!item) continue
        checklist.push({
          item: `[${cl.title_th}] ${item.symptom}`,
          method: item.inspection || "ตรวจด้วยสายตา/เครื่องมือตามมาตรฐาน",
          expected: Array.isArray(item.failure_modes) && item.failure_modes.length
            ? `ต้องไม่พบ: ${item.failure_modes.join(", ")}` : "สภาพปกติ ไม่พบความผิดปกติ",
          related_symptom: name,
        })
      }
    } catch { /* fail-soft ต่ออาการ */ }
  }

  if (!checklist.length) {
    checklist.push({
      item: "ตรวจสภาพทั่วไปตามอาการที่แจ้ง",
      method: "ตรวจด้วยสายตาและทดสอบการทำงานจริง",
      expected: "สภาพปกติ ไม่พบความผิดปกติ",
      related_symptom: list[0]?.symptom ?? "-",
    })
  }

  const safety_precautions = [
    ...(anyStop ? ["ห้ามนำรถไปใช้งานจนกว่าจะตรวจ/ซ่อมเสร็จ (ประวัติระบุอาการนี้ต้องหยุดรถ)"] : []),
    ...(anySafety ? ["อาการเกี่ยวข้องกับความปลอดภัย — ตรวจโดยช่างที่ได้รับมอบหมายเท่านั้น"] : []),
    "หนุนล้อ/ใช้ขาตั้งรองรับทุกครั้งที่ขึ้นแม่แรง และดับเครื่อง-ดึงเบรกมือก่อนตรวจ",
  ]

  return { checklist, expected_parts, safety_precautions }
}

// ขั้น 3 (KB): อาการที่ QC ยืนยัน → /diagnose → สาเหตุ/อะไหล่/เวลา จากสถิติจริง + จัดลำดับตามความรุนแรง
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function kbOnlyStep3(kb: KbConfig, qcResult: any, vehicle: VehicleInfo) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const confirmed: any[] = (Array.isArray(qcResult?.confirmed_symptoms) ? qcResult.confirmed_symptoms : [])
    .filter((s: { qc_confirmed?: string }) => s?.qc_confirmed !== "ไม่พบ")
    .slice(0, 5)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = []
  for (const s of confirmed) {
    const name = String(s?.symptom ?? "").trim()
    if (!name) continue
    try {
      const d = await kbDiagnoseRaw(kb, name, vehicle.plate)
      const m = (Array.isArray(d?.matches) ? d.matches : [])[0]
      const sev = mapSeverity(m?.severity, m?.stop_vehicle)
      const downtime = typeof m?.downtime_median_h === "number" ? m.downtime_median_h : null
      rows.push({
        symptom: name,
        probable_causes: Array.isArray(m?.typical_causes) && m.typical_causes.length ? m.typical_causes : ["ไม่มีข้อมูลสาเหตุในฐานความรู้ — ให้ช่างวินิจฉัยหน้างาน"],
        _sevRank: SEVERITY_RANK[sev] ?? 2,
        _sim: m?.similarity ?? 0,
        _downtime: downtime,
        repair_now: !sev.startsWith("เฝ้าระวัง"),
        reason: [
          `ความรุนแรง: ${sev}`,
          m?.safety_critical ? "กระทบความปลอดภัย" : "",
          m?.cases_in_history ? `อ้างอิงประวัติ ${m.cases_in_history} เคส` : "",
        ].filter(Boolean).join(" · "),
        impact: [
          m?.stop_vehicle ? "รถต้องจอด ห้ามใช้งานจนกว่าจะซ่อมเสร็จ" : "รถยังพอใช้งานได้แต่ควรรีบซ่อม",
          vehicle.customer || vehicle.plant ? `กระทบงานส่งปูน ${vehicle.customer ?? ""} ${vehicle.plant ? `แพล้นท์ ${vehicle.plant}` : ""}`.trim() : "",
        ].filter(Boolean).join(" · "),
        est_repair_hours: downtime != null ? `~${downtime} ชม. (median จากเคสจริง)` : "ไม่มีข้อมูล — ให้ Supervisor ประเมิน",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parts: (Array.isArray(m?.parts_likely) ? m.parts_likely : []).slice(0, 8).map((p: any) => ({
          part_name: p.part,
          spec: `ตามสเปคของเดิม/เทียบรุ่นรถ · ใช้ใน ${p.pct_of_cases}% ของเคสจริง`,
          qty: "-",
        })),
      })
    } catch { /* fail-soft */ }
  }

  rows.sort((a, b) => a._sevRank - b._sevRank || b._sim - a._sim)
  const analysis = rows.map((r, i) => {
    const { _sevRank, _sim, _downtime, ...rest } = r
    void _sevRank; void _sim; void _downtime
    return { ...rest, priority: i + 1 }
  })

  const totalH = rows.filter((r) => r.repair_now && r._downtime != null).reduce((s, r) => s + r._downtime, 0)
  return {
    analysis,
    total_est_downtime: totalH > 0 ? `~${totalH} ชม. (รวม median งานที่ซ่อมรอบนี้)` : "ประเมินจากหน้างาน",
    supervisor_notes: "ผลนี้สรุปจากฐานความรู้ประวัติซ่อมจริงโดยตรง (โหมดไม่ใช้ AI) — สาเหตุ/อะไหล่เรียงตามสถิติ โปรดใช้วิจารณญาณช่างประกอบ และตรวจอะไหล่เทียบของเดิมก่อนสั่งซื้อ",
  }
}

// block ข้อมูลอ้างอิงจาก Mixer Repair KB API (ประวัติซ่อมจริง) — แนบต่อท้าย prompt เมื่อมีข้อมูล
export function kbBlock(kbJson: string): string {
  return `

<ข้อมูลอ้างอิงจากฐานความรู้ประวัติซ่อมจริง>
ข้อมูลด้านล่างมาจากระบบฐานความรู้ที่สรุปจากประวัติการซ่อมรถโม่จริงของ Fleet นี้
(similarity = ความใกล้เคียงกับอาการที่แจ้ง, parts_likely = อะไหล่ที่ใช้จริงพร้อม % ของเคส, downtime_median_h = เวลาซ่อมกลางจากเคสจริง)
ให้ใช้เป็นข้อมูลประกอบหลักในการวิเคราะห์ ระบุอะไหล่ และประเมินเวลา — แต่ถ้าขัดแย้งกับอาการ/ผลตรวจจริง ให้เชื่อข้อมูลจริงและระบุเหตุผล
${kbJson}
</ข้อมูลอ้างอิงจากฐานความรู้ประวัติซ่อมจริง>`
}

// ── ขั้น 1: รับแจ้งซ่อม — แยกอาการ + จัดหมวด + ประเมินความเร่งด่วน ──
export function step1Prompt(notifyText: string, vehicle: VehicleInfo, kbJson?: string): string {
  return `วิเคราะห์การแจ้งซ่อมต่อไปนี้ แยกอาการเสียเป็นรายการ จัดหมวดระบบ และประเมินความเร่งด่วนเบื้องต้น

<ข้อความแจ้งซ่อม>
${notifyText}
</ข้อความแจ้งซ่อม>

<ข้อมูลรถ>
${vehicleBlock(vehicle)}
</ข้อมูลรถ>${kbJson ? kbBlock(kbJson) : ""}`
}

export const STEP1_SCHEMA = {
  type: "object",
  properties: {
    symptoms: {
      type: "array",
      items: {
        type: "object",
        properties: {
          symptom:      { type: "string", description: "อาการเสีย 1 รายการ เขียนเป็นภาษาช่างที่ชัดเจน" },
          system_group: { type: "string", enum: ["เครื่องยนต์", "ระบบส่งกำลัง", "ช่วงล่าง/ล้อ/ยาง", "ระบบเบรก/ลม", "ระบบไฟฟ้า", "โม่ผสมปูน", "ไฮดรอลิก", "ตัวถัง/แชสซี", "อื่นๆ"] },
          severity:     { type: "string", enum: ["วิกฤต-ห้ามใช้รถ", "เร่งด่วน", "ปกติ", "เฝ้าระวัง"] },
          safety_risk:  { type: "boolean" },
          initial_note: { type: "string", description: "ข้อสังเกตเบื้องต้นจากอาการ+ข้อมูลรถ เช่น อายุรถ/เลขไมล์ที่เกี่ยวข้อง" },
        },
        required: ["symptom", "system_group", "severity", "safety_risk", "initial_note"],
        additionalProperties: false,
      },
    },
    overall_urgency:       { type: "string", enum: ["วิกฤต-ห้ามใช้รถ", "เร่งด่วน", "ปกติ"] },
    questions_to_reporter: { type: "array", items: { type: "string" }, description: "คำถามที่ควรถามผู้แจ้งเพิ่ม ถ้าข้อมูลไม่พอ" },
    summary_for_confirm:   { type: "string", description: "สรุปสั้นๆ ให้ผู้แจ้งอ่านยืนยัน" },
  },
  required: ["symptoms", "overall_urgency", "questions_to_reporter", "summary_for_confirm"],
  additionalProperties: false,
} as const

// ── ขั้น 2: QC — สร้าง checklist ตรวจก่อนซ่อม + อะไหล่คาดว่าต้องใช้ ──
export function step2Prompt(confirmedTicketJson: string): string {
  return `จากใบแจ้งซ่อมที่ยืนยันแล้วด้านล่าง จงสร้าง:
1. Checklist ตรวจสภาพก่อนซ่อมสำหรับ QC — เจาะจงตามอาการ ไม่ใช่ checklist ทั่วไป
   รวมจุดที่ต้องตรวจ "ข้างเคียง" ที่อาการนี้มักลามถึง (เช่น ลูกปืนแตก → ตรวจจานเบรก ดุมล้อ ซีล น้ำมันหล่อลื่น ล้ออีกข้าง)
2. รายการอะไหล่ที่คาดว่าต้องใช้ (เบื้องต้น เพื่อให้ QC เช็คสต็อกล่วงหน้า)

<ใบแจ้งซ่อม>
${confirmedTicketJson}
</ใบแจ้งซ่อม>`
}

export const STEP2_SCHEMA = {
  type: "object",
  properties: {
    checklist: {
      type: "array",
      items: {
        type: "object",
        properties: {
          item:            { type: "string", description: "สิ่งที่ต้องตรวจ" },
          method:          { type: "string", description: "วิธีตรวจ/เครื่องมือ" },
          expected:        { type: "string", description: "เกณฑ์ปกติ ถ้าผิดจากนี้คือพบปัญหา" },
          related_symptom: { type: "string", description: "โยงกับอาการข้อไหน" },
        },
        required: ["item", "method", "expected", "related_symptom"],
        additionalProperties: false,
      },
    },
    expected_parts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          part_name: { type: "string" },
          qty:       { type: "string" },
          condition: { type: "string", description: "ต้องใช้แน่ / ขึ้นกับผลตรวจข้อไหน" },
        },
        required: ["part_name", "qty", "condition"],
        additionalProperties: false,
      },
    },
    safety_precautions: { type: "array", items: { type: "string" }, description: "ข้อควรระวังตอนตรวจ เช่น ขึ้นแม่แรง ห้ามสตาร์ท" },
  },
  required: ["checklist", "expected_parts", "safety_precautions"],
  additionalProperties: false,
} as const

// ── ขั้น 3: Supervisor — วิเคราะห์สาเหตุ + จัดลำดับ + Impact + อะไหล่/Spec ──
export function step3Prompt(qcResultJson: string, vehicle: VehicleInfo, kbJson?: string): string {
  return `จากผลตรวจ QC ด้านล่าง จงวิเคราะห์สำหรับ Mechanic Supervisor:
1. วิเคราะห์สาเหตุของแต่ละอาการ (root cause ที่เป็นไปได้ เรียงตามความน่าจะเป็น)
2. จัดลำดับความสำคัญของงานซ่อม
3. ประเมิน Impact (ความปลอดภัย, รถจอด/วิ่งได้, กระทบงานส่งปูนลูกค้า ${vehicle.customer || "-"}/แพล้นท์ ${vehicle.plant || "-"}) และระยะเวลาซ่อมโดยประมาณ
4. สรุปรายการอะไหล่ + Spec ต่ออาการ
5. แยกงานเป็น "ต้องซ่อมตอนนี้" กับ "เลื่อนได้/เฝ้าระวัง" พร้อมเหตุผล

<ผลตรวจ QC>
${qcResultJson}
</ผลตรวจ QC>${kbJson ? kbBlock(kbJson) : ""}`
}

export const STEP3_SCHEMA = {
  type: "object",
  properties: {
    analysis: {
      type: "array",
      items: {
        type: "object",
        properties: {
          symptom:          { type: "string" },
          probable_causes:  { type: "array", items: { type: "string" }, description: "เรียงจากน่าจะเป็นมากสุด" },
          priority:         { type: "integer", description: "1 = ทำก่อนสุด" },
          repair_now:       { type: "boolean", description: "true=ต้องซ่อมรอบนี้, false=เลื่อนได้/เฝ้าระวัง" },
          reason:           { type: "string", description: "เหตุผลการจัดลำดับ/เลื่อน" },
          impact:           { type: "string", description: "ผลกระทบ: ความปลอดภัย, รถใช้งานได้หรือไม่, กระทบงานลูกค้า" },
          est_repair_hours: { type: "string", description: "ประมาณเวลาซ่อม เช่น 3-4 ชม." },
          parts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                part_name: { type: "string" },
                spec:      { type: "string", description: "สเปค/ขนาด/รุ่นที่เข้ากับรถคันนี้ ถ้าไม่แน่ใจให้ระบุว่าต้องเทียบของเดิม" },
                qty:       { type: "string" },
              },
              required: ["part_name", "spec", "qty"],
              additionalProperties: false,
            },
          },
        },
        required: ["symptom", "probable_causes", "priority", "repair_now", "reason", "impact", "est_repair_hours", "parts"],
        additionalProperties: false,
      },
    },
    total_est_downtime: { type: "string" },
    supervisor_notes:   { type: "string", description: "ข้อเสนอแนะเพิ่มเติม เช่น ควรตรวจล้ออีกข้าง, งาน PM ที่ควรทำพร้อมกัน" },
  },
  required: ["analysis", "total_est_downtime", "supervisor_notes"],
  additionalProperties: false,
} as const
