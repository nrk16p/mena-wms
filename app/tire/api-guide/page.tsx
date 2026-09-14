import Link from "next/link"
import {
  AlertTriangle, ArrowLeft, BellOff, Code2, FileJson, Link2, Search, ShieldCheck, TriangleAlert,
} from "lucide-react"
import { CodeBlock, Method, Param, Section, guideFontHead, guideFontThai } from "@/components/api-guide-ui"
import { DUE_DUE, DUE_OVER, DUE_WARN, SNOOZE_DAYS } from "@/lib/tire-due"

const BASE = "https://mena-wms.vercel.app"

// หน้าคู่มือ API "ยางถึงกำหนดเปลี่ยน" สำหรับ mobile dev
// ตัวเลขเกณฑ์/จำนวนวันดึงจาก lib/tire-due.ts ตรง ๆ — แก้กติกาที่ไฟล์นั้นแล้วเอกสารเปลี่ยนตาม
// ไม่ต้องมานั่งไล่แก้เลขในหน้านี้ให้ตรงกันทีหลัง
export default function Page() {
  return (
    <div className="mx-auto max-w-[860px] px-4 py-6" style={guideFontThai}>
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#1B8C4B]/10 text-[#1B8C4B]">
          <Code2 size={22} />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-[#14271C] dark:text-white" style={guideFontHead}>
            API · ยางถึงกำหนดเปลี่ยน
          </h1>
          <p className="text-[12.5px] text-[#6B7C72] dark:text-gray-400">
            แจ้งเตือนคนขับว่ายางของรถที่ถืออยู่ใกล้ถึงกำหนด และเลื่อนการแจ้งเตือนได้เมื่อตรวจแล้วยังใช้ต่อได้
          </p>
        </div>
        <Link href="/tire" className="ml-auto hidden shrink-0 items-center gap-1 rounded-[11px] border border-[#EEF2F0] dark:border-white/10 px-3 py-1.5 text-[12px] font-medium text-[#6B7C72] hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-white/5 sm:flex">
          <ArrowLeft size={12} /> กลับหน้ายาง
        </Link>
      </div>

      <div className="space-y-4">
        <Section icon={AlertTriangle} title="เกณฑ์การเตือน">
          <p>
            ระบบคำนวณ <b>ระยะทางที่วิ่งจริงตั้งแต่วันเปลี่ยนยางเข้า</b> เทียบกับ <b>ระยะที่กำหนดของรุ่นยางนั้น</b>
          </p>
          <CodeBlock>{`กม.ที่วิ่งตั้งแต่วันเปลี่ยนเข้า ÷ ระยะที่กำหนดของรุ่นยาง = usedPct

usedPct ≥ ${DUE_OVER}   level "over"   เกินกำหนด
usedPct ≥ ${DUE_DUE}    level "due"    ถึงกำหนดเปลี่ยน
usedPct ≥ ${DUE_WARN}    level "warn"   เฝ้าระวัง`}</CodeBlock>
          <ul className="list-disc space-y-1 pl-5">
            <li>ระยะทางเอาจาก <b>GPS</b> ก่อน ถ้าทะเบียนนั้นไม่มีก็ใช้ <b>ค่าเที่ยว</b> แทน — ดูได้จาก <code>source</code></li>
            <li>ตัวเลขคำนวณรอบกลางคืนวันละครั้ง ไม่ได้คำนวณสดตอนเรียก — <code>dataThrough</code> บอกว่าข้อมูลระยะถึงวันไหน</li>
            <li>ยางอะไหล่ (ตำแหน่ง RB13) ไม่ถูกนับ เพราะยังไม่ได้ใช้งานจริง</li>
          </ul>
        </Section>

        <Section icon={ShieldCheck} title="Authentication">
          <CodeBlock>{`Base URL   ${BASE}
Header     x-api-key: <MOBILE_API_KEY>     ← ขอจาก admin`}</CodeBlock>
          <p>ไม่ส่ง key หรือ key ผิด → <code>401</code> <code>{`{"error":"Unauthorized — login session or valid x-api-key required"}`}</code></p>
        </Section>

        <Section icon={Link2} title="ดูยางของรถคันเดียว">
          <p className="font-mono text-[12.5px]">
            <Method verb="GET" />/api/tire-due?plate=สบ.71-3569
          </p>
          <p className="font-mono text-[12.5px]">
            <Method verb="GET" />/api/tire-due?fleetNo=T-0145
          </p>
          <ul className="mt-2 space-y-1.5">
            <Param name="plate">ทะเบียนรถ เช่น <code>สบ.71-3569</code></Param>
            <Param name="fleetNo">เบอร์รถ เช่น <code>T-0145</code> — ใช้แทน <code>plate</code> ได้ (ส่งอย่างใดอย่างหนึ่ง)</Param>
          </ul>
          <p className="mt-2">
            ส่งกลับ<b>เฉพาะเส้นที่ต้องรู้</b> (เกิน / ถึงกำหนด / เฝ้าระวัง) เรียงตามตำแหน่งล้อจริง
            หน้า → หลัง → หาง (F1 F2 · RA1…RA8 · RB1…RB13) — เส้นที่ยังปกติไม่ส่งมาเพื่อไม่ให้รบกวนคนขับ
          </p>
        </Section>

        <Section icon={FileJson} title="รูปแบบผลลัพธ์">
          <p><b>200</b> — มีเส้นที่ต้องเตือน</p>
          <CodeBlock>{`{
  "plate": "สบ.70-9863",
  "fleetNo": "T-0202",
  "branch": "saraburi",
  "vehicleType": "หัวเบาท์ 12 ล้อ ขนอาหารสัตว์",
  "found": true,
  "alert": true,                                  ← ใช้ค่านี้ตัดสินว่าจะเด้งแจ้งเตือนไหม
  "summary": { "over": 10, "due": 0, "warn": 0 }, ← ไม่นับเส้นที่ถูกเลื่อนไว้
  "dataThrough": "2026-09-12T06:24:28.645Z",
  "computedAt":  "2026-09-14T06:24:33.646Z",
  "items": [
    {
      "id": "6aa77cb6e8d0fdf129544675",           ← ใช้ตอน PATCH เลื่อนแจ้งเตือน
      "tirePosition": "F1ล้อหน้าข้างซ้าย",
      "product": "ยางนอก 11R22.5",
      "serialNo": "A4T1539551 NGR-AZ670",
      "changeIn": "2024-02-07T10:00:00.000Z",
      "kmUsed": 298635,
      "specDistance": 130000,
      "usedPct": 230,
      "level": "over",                             ← over | due | warn
      "levelLabel": "เกินกำหนด",
      "source": "ค่าเที่ยว",                        ← "GPS" | "ค่าเที่ยว"
      "partial": false,                            ← true = ยางใส่ก่อนช่วงที่มีข้อมูล ระยะจริงมากกว่านี้
      "snoozedUntil": null,
      "snoozedBy": ""
    }
  ]
}`}</CodeBlock>
          <p className="mt-3"><b>200</b> — รถมีในระบบ แต่ยางยังไม่ถึงกำหนด</p>
          <CodeBlock>{`{ "plate": "สบ.71-8645", "found": true, "alert": false,
  "summary": { "over": 0, "due": 0, "warn": 0 }, "items": [],
  "message": "ยางทุกเส้นยังไม่ถึงกำหนดเปลี่ยน" }`}</CodeBlock>
          <p className="mt-3"><b>404</b> — ไม่รู้จักทะเบียน/เบอร์รถนี้</p>
          <CodeBlock>{`{ "plate": "XX-9999", "found": false, "alert": false, "items": [],
  "message": "ไม่พบทะเบียน/เบอร์รถนี้ในระบบ" }`}</CodeBlock>
          <p className="mt-1 text-[12.5px] text-[#6B7C72] dark:text-gray-400">
            แยก 2 กรณีนี้ให้แล้ว แอปจะได้บอกผู้ใช้ถูกว่า &quot;ยางยังดีอยู่&quot; หรือ &quot;พิมพ์ทะเบียนผิด&quot;
          </p>
        </Section>

        <Section icon={BellOff} title={`เลื่อนการแจ้งเตือน ${SNOOZE_DAYS} วัน`}>
          <p>
            ใช้เมื่อคนขับไปดูของจริงแล้วเห็นว่ายังใช้ต่อได้ — เลื่อนได้เองไม่ต้องรออนุมัติ
            แต่ระบบบันทึกไว้ว่าใครเลื่อนเพราะอะไร ให้แอดมินตามได้
          </p>
          <p className="font-mono text-[12.5px]"><Method verb="PATCH" />/api/tire-due/{"{id}"}</p>
          <CodeBlock>{`{ "snooze": true, "by": "สมชาย ใจดี", "note": "ตรวจแล้วดอกยางยังเหลือ" }

→ { "ok": true, "snoozeDays": ${SNOOZE_DAYS},
    "snoozedUntil": "2026-09-28T07:30:49.881Z",
    "snoozedAt":    "2026-09-14T07:30:49.881Z",
    "snoozedBy":    "สมชาย ใจดี",
    "snoozedNote":  "ตรวจแล้วดอกยางยังเหลือ" }`}</CodeBlock>
          <ul className="mt-2 space-y-1.5">
            <Param name="snooze" required><code>true</code> = เลื่อน {SNOOZE_DAYS} วัน · <code>false</code> = ยกเลิกการเลื่อน</Param>
            <Param name="by">ชื่อคนกด — ควรส่งเสมอ ไม่งั้นตามตัวไม่ได้ว่าใครเลื่อน</Param>
            <Param name="note">เหตุผลที่เลื่อน</Param>
          </ul>
          <p className="mt-2">
            หลังเลื่อนแล้วเส้นนั้น<b>ยังอยู่ใน <code>items</code></b> (มี <code>snoozedUntil</code>)
            แต่ไม่ถูกนับใน <code>summary</code> และไม่ทำให้ <code>alert</code> เป็น <code>true</code> —
            ครบ {SNOOZE_DAYS} วันแล้วกลับมาเตือนเองถ้ายังไม่ได้เปลี่ยนยาง
          </p>
        </Section>

        <Section icon={TriangleAlert} title="ข้อควรรู้">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <code>POST /api/tire-due</code> (สั่งคำนวณใหม่ทั้งฟลีต) <b>แอปเรียกไม่ได้</b> ตอบ <code>403</code> —
              งานนี้กินเวลาราว 20 วินาที เปิดเฉพาะแอดมินที่ login เว็บ ตัวเลขอัปเดตเองทุกวันอยู่แล้ว (รอบ 11:00 น.)
            </li>
            <li>ยางที่เปลี่ยนออกไปแล้วจะหายจากรายการเองในรอบคำนวณถัดไป ไม่ค้างเตือน</li>
            <li>
              <code>specDistance</code> มาจากสเปคยางที่แอดมินตั้งไว้ที่ <code>/tire/master</code> —
              รุ่นที่ยังไม่ได้ตั้งระยะจะไม่ถูกส่งมาเตือน
            </li>
          </ul>
        </Section>

        <Section icon={Search} title="API ชุดอื่นของโมดูลยาง">
          <p>
            ขอเปลี่ยนยาง / ดูประวัติยางรายคัน / สต๊อกยาง อยู่คนละชุด — ดูที่
            <code className="mx-1">docs/change-tire-request-api.md</code> ในรีโป
            และ Postman collection <code>docs/mena-wms-tire.postman_collection.json</code>
            (โฟลเดอร์ &quot;3. ยางถึงกำหนดเปลี่ยน&quot; คือชุดในหน้านี้)
          </p>
        </Section>
      </div>
    </div>
  )
}
