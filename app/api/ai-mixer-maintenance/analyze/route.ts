import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import Anthropic from "@anthropic-ai/sdk"
import { authOptions } from "@/lib/auth"
import clientPromise from "@/lib/mongo"
import {
  AI_MIXER_ALLOWED_EMAILS,
  AI_MIXER_MODEL,
  AI_MIXER_SYSTEM_PROMPT,
  step1Prompt, STEP1_SCHEMA,
  step2Prompt, STEP2_SCHEMA,
  step3Prompt, STEP3_SCHEMA,
  resolveKbConfig, kbDiagnoseMany,
  type VehicleInfo,
} from "@/lib/ai-mixer"

const DB = process.env.MONGO_DB ?? "master_data"
const LOG_COLL = "ai_mixer_logs"

// เรียก Claude อาจใช้เวลาหลายสิบวินาที — ขยาย limit ของ Vercel function
export const maxDuration = 300

// POST /api/ai-mixer-maintenance/analyze
// body: { step: 1|2|3, notifyText?, vehicle, confirmedTicket?, qcResult? }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email ?? ""
  if (!AI_MIXER_ALLOWED_EMAILS.includes(email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const step = Number(body?.step)
  if (![1, 2, 3].includes(step)) {
    return NextResponse.json({ error: "step ต้องเป็น 1, 2 หรือ 3" }, { status: 400 })
  }

  const vehicle: VehicleInfo = body?.vehicle ?? { plate: "" }

  // ฐานความรู้ประวัติซ่อมจริง (Mixer Repair KB API) — config จากหน้าเว็บมาก่อน, fallback env
  // ล่ม/ไม่ตั้งค่า = วิเคราะห์ต่อได้ตามปกติ (fail-soft)
  const kb = resolveKbConfig(body?.kb)
  let kbJson: string | null = null
  let kbError: string | null = null

  let userPrompt = ""
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let schema: any
  if (step === 1) {
    const notifyText = String(body?.notifyText ?? "").trim()
    if (!notifyText) return NextResponse.json({ error: "กรุณาระบุข้อความแจ้งซ่อม" }, { status: 400 })
    if (kb) {
      try { kbJson = await kbDiagnoseMany(kb, [notifyText], vehicle.plate) }
      catch (e) { kbError = e instanceof Error ? e.message : "KB API error" }
    }
    userPrompt = step1Prompt(notifyText, vehicle, kbJson ?? undefined)
    schema = STEP1_SCHEMA
  } else if (step === 2) {
    if (!body?.confirmedTicket) return NextResponse.json({ error: "ไม่มีข้อมูลใบแจ้งซ่อมที่ยืนยันแล้ว" }, { status: 400 })
    userPrompt = step2Prompt(JSON.stringify({ vehicle, ...body.confirmedTicket }, null, 2))
    schema = STEP2_SCHEMA
  } else {
    if (!body?.qcResult) return NextResponse.json({ error: "ไม่มีผลตรวจ QC" }, { status: 400 })
    if (kb) {
      // ยิง /diagnose ต่ออาการที่ QC ยืนยันว่าพบจริง เพื่อ ground สาเหตุ/อะไหล่/เวลาซ่อมกับประวัติจริง
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const confirmed: any[] = Array.isArray(body.qcResult?.confirmed_symptoms) ? body.qcResult.confirmed_symptoms : []
      const queries = confirmed
        .filter((s) => s?.qc_confirmed !== "ไม่พบ")
        .map((s) => String(s?.symptom ?? ""))
      try { kbJson = await kbDiagnoseMany(kb, queries, vehicle.plate) }
      catch (e) { kbError = e instanceof Error ? e.message : "KB API error" }
    }
    userPrompt = step3Prompt(JSON.stringify({ vehicle, ...body.qcResult }, null, 2), vehicle, kbJson ?? undefined)
    schema = STEP3_SCHEMA
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY บนเซิร์ฟเวอร์" }, { status: 500 })
  }

  const anthropic = new Anthropic()

  try {
    const response = await anthropic.messages.create({
      model: AI_MIXER_MODEL,
      max_tokens: 16000,
      system: [{ type: "text", text: AI_MIXER_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userPrompt }],
      output_config: { format: { type: "json_schema", schema } },
    })

    if (response.stop_reason === "refusal") {
      return NextResponse.json({ error: "AI ปฏิเสธการวิเคราะห์คำขอนี้ กรุณาปรับข้อความแล้วลองใหม่" }, { status: 422 })
    }

    const text = response.content.find((b) => b.type === "text")?.text ?? ""
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let result: any
    try {
      result = JSON.parse(text)
    } catch {
      return NextResponse.json({ error: "AI ตอบกลับไม่ตรงรูปแบบ กรุณาลองใหม่" }, { status: 502 })
    }

    // audit log — fail-soft ไม่ให้กระทบผลลัพธ์
    try {
      const client = await clientPromise
      await client.db(DB).collection(LOG_COLL).insertOne({
        at: new Date(),
        email,
        step,
        model: AI_MIXER_MODEL,
        vehicle,
        input: step === 1 ? body.notifyText : step === 2 ? body.confirmedTicket : body.qcResult,
        output: result,
        usage: response.usage,
        kbUsed: Boolean(kbJson),
        kbError,
      })
    } catch (e) {
      console.error("[ai-mixer] log failed", e)
    }

    return NextResponse.json({ step, result, usage: response.usage, kbUsed: Boolean(kbJson), kbError })
  } catch (e) {
    console.error("[ai-mixer] analyze failed", e)
    const msg = e instanceof Anthropic.APIError ? `Claude API error (${e.status})` : "วิเคราะห์ไม่สำเร็จ"
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
