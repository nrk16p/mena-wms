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
