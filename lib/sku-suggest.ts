// lib/sku-suggest.ts — แนะนำ L1/L2/L3 + ตั้งชื่อมาตรฐาน ด้วย LLM บน Groq (ฟรี)
//
// โครง: คัดตัวเลือกจากผังสินค้าด้วยตรรกะในเครื่องก่อน (sku-suggest-core) → ส่งรายการสั้นให้ LLM เลือก
// → ตรวจคำตอบว่าเป็นรหัสที่มีอยู่จริงในผัง ถ้าไม่ใช่ก็ทิ้ง · **ไม่มีทางที่รหัสแปลกปลอมจะหลุดถึงฟอร์ม**
//
// กติกา
//   · fail-soft: ไม่มีคีย์ / Groq ล่ม / ตอบไม่เป็น JSON → คืนผลจากการเทียบตัวอักษรล้วน (engine="lexical")
//     หน้าเว็บยังใช้งานได้ แค่ไม่มีคำอธิบายและชื่อมาตรฐาน
//   · เป็น "คำแนะนำ" เท่านั้น — หน้าเว็บต้องให้คนกดเลือก ห้ามเติมลงฟอร์มเองเงียบ ๆ
//   · ไม่ส่งอะไรนอกจากชื่อสินค้า/กลุ่มของ ATMS กับผังสินค้าของเราออกไป (ไม่มีข้อมูลคน ราคา ผู้ขาย)
import { buildLeaves, expandQuery, headPreserved, retrieveLeaves, type ScoredLeaf, type TaxonomyLeaf } from "./sku-suggest-core"
import type { MasterCodeRow } from "./sku-convert-types"

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
/** gpt-oss-120b — โควตาฟรีของ Groq, ตอบไทยได้ดีและเร็ว (ผู้ใช้เลือกเอง 19/10/2026) */
const MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b"
/** โควตาฟรีนับแยกต่อรุ่น — รุ่นหลักชน 429 แล้วยังยิงรุ่นสำรองได้ทันที
 *  (รุ่นที่คีย์นี้เข้าถึงได้ ตรวจ 19/10/2026: gpt-oss-120b, gpt-oss-20b, qwen3.8-27b) */
const MODEL_FALLBACK = process.env.GROQ_MODEL_FALLBACK ?? "openai/gpt-oss-20b"
const TIMEOUT_MS = 20_000
/** ตัวเลือกที่ส่งให้ LLM ต่อครั้ง — โควตาฟรีของ Groq จำกัดที่ 8,000 token/นาที (ทั้งองค์กร)
 *  18 ตัวเลือก ≈ 1,100 token/ครั้ง = ยิงได้ ~7 ครั้ง/นาที · 40 ตัวเลือกเคยทำให้ชน 429 ตั้งแต่ครั้งที่ 4
 *  (วัดจริง 19/10/2026) และคำตอบไม่ได้ดีขึ้นเลย เพราะตัวที่ถูกมักอยู่ 10 อันดับแรกอยู่แล้ว */
const CANDIDATES = 24

export type SuggestInput = {
  /** ชื่อสินค้าที่เห็นในทะเบียน ATMS หรือที่ผู้ใช้พิมพ์ไว้ */
  name: string
  /** กลุ่มสินค้าใน ATMS เช่น "ระบบโม่" (ถ้ามี) */
  group?: string
  /** ประเภทค่าใช้จ่ายที่เลือกไว้ในฟอร์ม เช่น PRT */
  type: string
  /** L1 ที่กลุ่มของ ATMS ชี้มา — ใช้ดันตัวเลือก ไม่ใช่ล็อกคำตอบ */
  l1Hint?: string[]
  brand?: string
}

export type SuggestOption = {
  l1: string; l2: string; l3: string
  label: string
  why: string
  /** 0..1 — ของ LLM ถ้ามี ไม่มีก็ใช้คะแนนเทียบตัวอักษร */
  confidence: number
}

export type SuggestResult = {
  /** groq = LLM เลือกให้ · lexical = เทียบตัวอักษรล้วน (ไม่มีคีย์/เรียกไม่สำเร็จ) */
  engine: "groq" | "lexical"
  options: SuggestOption[]
  /** ชื่อมาตรฐานที่เสนอ — ว่างเมื่อ engine=lexical */
  nameTh: string
  nameEn: string
  note: string
  ms: number
}

const SYSTEM = `คุณเป็นวิศวกรอะไหล่รถผสมคอนกรีต (mixer truck) ที่จัดผังรหัสอะไหล่ให้บริษัทขนส่งไทย
หน้าที่: จากชื่ออะไหล่ที่คนคลังพิมพ์ไว้ (มักพิมพ์ย่อ สะกดไม่ตรงมาตรฐาน ปนยี่ห้อรถและขนาด)
ให้เลือกหมวดในผังสินค้าที่ "ให้มา" และตั้งชื่อใหม่ให้เป็นมาตรฐาน

กฎเหล็ก
1. เลือกได้เฉพาะรหัสที่อยู่ในรายการตัวเลือกที่ให้มาเท่านั้น ห้ามคิดรหัสใหม่เอง
2. ดูที่ "หน้าที่ของชิ้นส่วน" เป็นหลัก ไม่ใช่คำที่สะกดคล้ายกัน
   ตัวอย่างที่คนมักจัดผิด: "หม้อลมคลัทช์" ทำงานกับระบบคลัทช์/ส่งกำลัง ไม่ใช่ระบบเบรก
   แม้คำว่า "หม้อลม" จะไปโผล่ในระบบเบรกบ่อยกว่า
3. กลุ่มสินค้าที่ ATMS ติดมาเป็นเพียงเบาะแส — คนคลังติดกลุ่มผิดได้ ถ้าขัดกับหน้าที่ชิ้นส่วน ให้เชื่อหน้าที่

การตั้งชื่อมาตรฐาน
- ชื่อไทย: <ชนิดชิ้นส่วน><ตำแหน่ง/คุณสมบัติ> <ขนาด> <ยี่ห้อ/รุ่นรถ>
  เช่น "หม้อลมคลัตช์ล่าง 105 มม. HINO"
- **ห้ามเปลี่ยนว่าของชิ้นนี้คืออะไร** คำที่บอกชนิดชิ้นส่วนในชื่อเดิม (หม้อลม, กากบาท, ไส้กรอง, ซีล)
  ต้องคงอยู่ในชื่อใหม่ · แก้ได้แค่การสะกด ลำดับคำ และรูปแบบขนาด
  ผิด: "หม้อลมคลัตช์ล่าง" → "แม่ปั๊มคลัตช์ล่าง" (คนละชิ้นกัน) · ชื่อเดิมถูกอยู่แล้วก็คืนชื่อเดิมได้
- สะกดตามผังสินค้า: คลัตช์ (ไม่ใช่ ครัช/คลัช/คลัทช์) · เบรก (ไม่ใช่ เบรค) · ไฮดรอลิก (ไม่ใช่ ไฮดรอลิค)
- ขนาดเขียน ตัวเลข + หน่วยย่อ: "105 มม." ไม่ใช่ "105 มิล"
- ยี่ห้อรถเขียนอังกฤษตัวพิมพ์ใหญ่: HINO, ISUZU, UD, FUSO · ใส่ทุกรุ่นที่ชื่อเดิมระบุไว้ ห้ามตัดทิ้ง
- ห้ามใส่: ยี่ห้ออะไหล่ (มีช่องแยก) · จำนวน/หน่วย · ราคา · คำว่า "อะไหล่"
- ชื่ออังกฤษ: Title Case เช่น "Clutch Booster, Lower, 105mm, HINO"

ตอบเป็น JSON เท่านั้น ตามรูปนี้
{"l1":"","l2":"","l3":"","confidence":0.0,"why":"เหตุผลสั้นไม่เกิน 25 คำ",
 "alternatives":[{"l1":"","l2":"","l3":"","why":""}],
 "nameTh":"","nameEn":""}`

function userPrompt(input: SuggestInput, cands: ScoredLeaf[]): string {
  const lines = cands.map((c) => `${c.path}  = ${c.label}`).join("\n")
  return `ชื่อที่คนคลังพิมพ์ไว้: ${input.name}
กลุ่มสินค้าใน ATMS: ${input.group || "(ไม่มี)"}
ประเภทค่าใช้จ่าย: ${input.type}
ยี่ห้ออะไหล่: ${input.brand || "(ไม่มี)"}

ตัวเลือกที่เลือกได้ (รูปแบบ L1:L2:L3 = ระบบ › ชุดประกอบ › ชิ้นส่วน)
${lines}

เลือกตัวเลือกที่ตรงที่สุด 1 อัน และอีก 2 อันเป็นทางเลือก แล้วตั้งชื่อมาตรฐานไทย/อังกฤษ`
}

type GroqReply = {
  l1?: unknown; l2?: unknown; l3?: unknown; confidence?: unknown; why?: unknown
  nameTh?: unknown; nameEn?: unknown
  alternatives?: { l1?: unknown; l2?: unknown; l3?: unknown; why?: unknown }[]
}

const s = (v: unknown) => (v == null ? "" : String(v).trim())

/** แกะ JSON จากคำตอบ — บางรอบ LLM ห่อ markdown fence หรือพูดนำหน้า */
function parseJson(text: string): GroqReply | null {
  const direct = text.trim()
  const body = direct.startsWith("{") ? direct : direct.slice(direct.indexOf("{"), direct.lastIndexOf("}") + 1)
  if (!body) return null
  try { return JSON.parse(body) as GroqReply } catch { return null }
}

const pathOf = (l1: string, l2: string, l3: string) => (l3 ? `${l1}:${l2}:${l3}` : `${l1}:${l2}`)

function toOption(leaf: TaxonomyLeaf, why: string, confidence: number): SuggestOption {
  return { l1: leaf.l1, l2: leaf.l2, l3: leaf.l3, label: leaf.label, why, confidence }
}

/** คำแนะนำจากการเทียบตัวอักษรล้วน — ใช้เมื่อไม่มีคีย์ Groq หรือเรียกไม่สำเร็จ */
function lexicalResult(cands: ScoredLeaf[], note: string, ms: number): SuggestResult {
  return {
    engine: "lexical",
    options: cands.slice(0, 3).map((c) => toOption(c, "ชื่อใกล้เคียงกับหมวดนี้", Math.min(1, c.score * 2))),
    nameTh: "", nameEn: "", note, ms,
  }
}

export async function suggestTaxonomy(
  rows: MasterCodeRow[],
  input: SuggestInput,
): Promise<SuggestResult> {
  const t0 = Date.now()
  const leaves = buildLeaves(rows, input.type)
  if (!leaves.length) {
    return { engine: "lexical", options: [], nameTh: "", nameEn: "",
             note: `ไม่มีผังสินค้าสำหรับประเภท ${input.type}`, ms: Date.now() - t0 }
  }
  const query = expandQuery(input.name, input.group)
  const cands = retrieveLeaves(leaves, query, { limit: CANDIDATES, l1Boost: input.l1Hint })
  const byPath = new Map(cands.map((c) => [c.path, c as TaxonomyLeaf]))

  const key = process.env.GROQ_API_KEY
  if (!key) return lexicalResult(cands, "ยังไม่ได้ตั้งค่า GROQ_API_KEY — แสดงผลจากการเทียบชื่อเท่านั้น", Date.now() - t0)

  const prompt = userPrompt(input, cands)
  let reply: GroqReply | null = null
  let status = 0
  for (const model of [MODEL, MODEL_FALLBACK]) {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(GROQ_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }],
          temperature: 0,          // งานเลือกจากรายการ — ขอคำตอบเดิมทุกครั้งสำหรับชื่อเดียวกัน
          max_completion_tokens: 1200,
          reasoning_effort: "low",          // ตอบเร็วกว่า และงานนี้เป็นการ "เลือกจากรายการ" ไม่ต้องคิดยาว
          response_format: { type: "json_object" },
        }),
        signal: ctl.signal,
        cache: "no-store",
      })
      status = res.status
      if (res.status === 429) {            // โควตารุ่นนี้เต็มนาทีนี้ — ลองรุ่นสำรอง (นับแยกโควตากัน)
        console.warn(`[sku-suggest] Groq 429 ที่รุ่น ${model}`)
        continue
      }
      if (!res.ok) {
        console.warn(`[sku-suggest] Groq ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`)
        break
      }
      const data = await res.json() as { choices?: { message?: { content?: string } }[] }
      reply = parseJson(data.choices?.[0]?.message?.content ?? "")
      break
    } catch (e) {
      console.warn(`[sku-suggest] เรียก Groq (${model}) ไม่สำเร็จ: ${e instanceof Error ? e.message : e}`)
    } finally {
      clearTimeout(timer)
    }
  }
  if (!reply) {
    const note = status === 429
      ? "โควตา AI ฟรีเต็มชั่วคราว (จำกัดรวมทั้งบริษัท) — รอ 1 นาทีแล้วกดอีกครั้ง ด้านล่างคือผลจากการเทียบชื่อ"
      : status && status !== 200
        ? `เรียก AI ไม่สำเร็จ (${status}) — แสดงผลจากการเทียบชื่อ`
        : "เรียก AI ไม่สำเร็จ — แสดงผลจากการเทียบชื่อ"
    return lexicalResult(cands, note, Date.now() - t0)
  }

  // ── ตรวจคำตอบ: รับเฉพาะรหัสที่อยู่ในรายการตัวเลือกที่ส่งไปจริง ────────────
  const options: SuggestOption[] = []
  const seen = new Set<string>()
  const push = (l1: unknown, l2: unknown, l3: unknown, why: unknown, conf: number) => {
    const p = pathOf(s(l1), s(l2), s(l3))
    const leaf = byPath.get(p)
    if (!leaf || seen.has(p)) return
    seen.add(p)
    options.push(toOption(leaf, s(why).slice(0, 200), conf))
  }
  const conf = Number(reply.confidence)
  push(reply.l1, reply.l2, reply.l3, reply.why, Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0.6)
  for (const a of reply.alternatives ?? []) push(a.l1, a.l2, a.l3, a.why, 0.4)

  if (!options.length) {
    return lexicalResult(cands, "AI ตอบรหัสที่ไม่มีในผังสินค้า — แสดงผลจากการเทียบชื่อแทน", Date.now() - t0)
  }
  const nameTh = s(reply.nameTh).slice(0, 120)
  // กันเคสที่ LLM เปลี่ยน "ชนิดชิ้นส่วน" ให้ตรงกับชื่อหมวดที่มันเลือก (เคสจริง: หม้อลมคลัตช์ → แม่ปั๊มคลัตช์
  // ซึ่งเป็นของคนละชิ้น) · เตือนแบบตรวจได้เอง ไม่ต้องเชื่อว่า LLM จะทำตามกฎในพรอมต์ทุกครั้ง
  const renamed = !headPreserved(input.name, nameTh)
  const head = input.name.trim().split(/[\s\d(/,.-]/)[0]
  return {
    engine: "groq",
    options,
    nameTh,
    nameEn: s(reply.nameEn).slice(0, 120),
    note: renamed ? `AI เปลี่ยนคำว่า "${head}" ในชื่อใหม่ — ตรวจว่าเป็นชิ้นส่วนเดียวกันก่อนกดใช้` : "",
    ms: Date.now() - t0,
  }
}
